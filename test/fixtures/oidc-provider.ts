import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export interface OidcProviderFixture {
  readonly issuer: string;
  readonly accessToken: string;
  /** Parameters received by the most recent authorization request. */
  readonly lastAuthorization: URLSearchParams | undefined;
  close(): Promise<void>;
}

interface IssuedCode {
  readonly nonce: string;
  readonly challenge: string;
  readonly redirectUri: string;
}

/**
 * Minimal OpenID Connect provider over plain HTTP for integration tests. The
 * authorization endpoint signs the user in immediately and redirects back.
 */
export async function startOidcProvider(options: {
  clientId: string;
  claims: Record<string, unknown>;
}): Promise<OidcProviderFixture> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: "fixture", alg: "RS256" };
  const codes = new Map<string, IssuedCode>();
  const accessToken = `access-${randomUUID()}`;
  let lastAuthorization: URLSearchParams | undefined;
  let issuer = "";

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });

  async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const url = new URL(request.url ?? "/", issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      return sendJson(response, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return sendJson(response, { keys: [publicJwk] });
    if (url.pathname === "/authorize") {
      lastAuthorization = url.searchParams;
      const code = randomUUID();
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      codes.set(code, {
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri,
      });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { Location: callback.toString() });
      response.end();
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const body = new URLSearchParams(await readBody(request));
      const issued = codes.get(body.get("code") ?? "");
      codes.delete(body.get("code") ?? "");
      const verifier = body.get("code_verifier") ?? "";
      if (
        !issued ||
        issued.redirectUri !== body.get("redirect_uri") ||
        createHash("sha256").update(verifier).digest("base64url") !== issued.challenge
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const idToken = await new SignJWT({ ...options.claims, nonce: issued.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "fixture" })
        .setIssuer(issuer)
        .setAudience(options.clientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return sendJson(response, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }
    response.writeHead(404);
    response.end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    accessToken,
    get lastAuthorization() {
      return lastAuthorization;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

function sendJson(response: http.ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}
