import http from "node:http";
import type { AddressInfo } from "node:net";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthVeil } from "../src/index.js";
import type { IdentityProxyConfig } from "../src/index.js";
import { startOidcProvider, type OidcProviderFixture } from "./fixtures/oidc-provider.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startEchoUpstream(): Promise<string> {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ url: request.url, headers: request.headers }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The redirect URI must contain the listen port, so reserve a free one first. */
async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function startOidcProxy(
  identityProxy: IdentityProxyConfig,
): Promise<{ base: string; provider: OidcProviderFixture }> {
  const provider = await startOidcProvider({
    clientId: "authveil-client",
    claims: {
      sub: "oidc-user-001",
      preferred_username: "oidc.user@example.test",
      name: "OIDC User",
      groups: ["developers"],
      auth_time: 1_700_000_000,
    },
  });
  cleanups.push(() => provider.close());
  const port = await freePort();
  const instance = await createAuthVeil({
    server: { port },
    upstream: { url: await startEchoUpstream() },
    auth: {
      mode: "oidc",
      oidc: {
        issuer: provider.issuer,
        clientId: "authveil-client",
        clientSecret: "secret",
        redirectUri: `http://127.0.0.1:${port}/_authveil/callback`,
        claimMapping: { email: "preferred_username" },
      },
    },
    identityProxy,
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return { base: address.url, provider };
}

async function signIn(base: string, path: string): Promise<{ cookie: string; location: string }> {
  const unauthenticated = await fetch(`${base}${path}`, { redirect: "manual" });
  expect(unauthenticated.status).toBe(302);
  const login = await fetch(new URL(unauthenticated.headers.get("location")!, base), {
    redirect: "manual",
  });
  expect(login.status).toBe(302);
  const authorize = await fetch(login.headers.get("location")!, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual" });
  expect(callback.status).toBe(302);
  return {
    cookie: callback.headers.get("set-cookie")!.split(";")[0]!,
    location: callback.headers.get("location")!,
  };
}

describe("OIDC mode", () => {
  it("signs in with an HTTP issuer using authorization code flow and PKCE", async () => {
    const { base, provider } = await startOidcProxy({ type: "alb" });
    const { cookie, location } = await signIn(base, "/orders?page=2");

    expect(location).toBe("/orders?page=2");
    expect(provider.lastAuthorization?.get("response_type")).toBe("code");
    expect(provider.lastAuthorization?.get("code_challenge_method")).toBe("S256");
    expect(provider.lastAuthorization?.get("scope")).toBe("openid profile email");
    expect(provider.lastAuthorization?.get("nonce")).toBeTruthy();

    const me = await fetch(`${base}/_authveil/me`, { headers: { cookie } });
    expect(await me.json()).toMatchObject({
      identity: {
        subject: "oidc-user-001",
        email: "oidc.user@example.test",
        name: "OIDC User",
        source: { mode: "oidc", issuer: provider.issuer },
      },
    });

    const proxied = await fetch(`${base}/orders?page=2`, { headers: { cookie } });
    const seen = (await proxied.json()) as { headers: Record<string, string> };
    expect(seen.headers["x-amzn-oidc-identity"]).toBe("oidc-user-001");
    expect(seen.headers["x-amzn-oidc-accesstoken"]).toBe(provider.accessToken);
  });

  it("keeps user claims but not ID-token protocol claims in generated tokens", async () => {
    const { base } = await startOidcProxy({ type: "alb" });
    const { cookie } = await signIn(base, "/");
    const proxied = await fetch(`${base}/`, { headers: { cookie } });
    const seen = (await proxied.json()) as { headers: Record<string, string> };
    const payload = decodeJwt(seen.headers["x-amzn-oidc-data"]!);

    expect(payload).toMatchObject({
      sub: "oidc-user-001",
      email: "oidc.user@example.test",
      groups: ["developers"],
      auth_time: 1_700_000_000,
    });
    for (const claim of ["iss", "aud", "exp", "iat", "nonce"])
      expect(payload).not.toHaveProperty(claim);
  });

  it("issues IAP assertions with AuthVeil's issuer and audience", async () => {
    const { base } = await startOidcProxy({ type: "iap", audience: "/projects/1/backend/2" });
    const { cookie } = await signIn(base, "/");
    const proxied = await fetch(`${base}/`, { headers: { cookie } });
    const seen = (await proxied.json()) as { headers: Record<string, string> };
    expect(decodeJwt(seen.headers["x-goog-iap-jwt-assertion"]!)).toMatchObject({
      iss: "https://cloud.google.com/iap",
      aud: "/projects/1/backend/2",
      sub: "oidc-user-001",
    });
    expect(decodeJwt(seen.headers["x-goog-iap-jwt-assertion"]!)).not.toHaveProperty("nonce");
  });

  it("rejects a replayed or unknown callback state", async () => {
    const { base } = await startOidcProxy({ type: "none" });
    const login = await fetch(`${base}/_authveil/login`, { redirect: "manual" });
    const authorize = await fetch(login.headers.get("location")!, { redirect: "manual" });
    const callbackUrl = authorize.headers.get("location")!;

    expect((await fetch(callbackUrl, { redirect: "manual" })).status).toBe(302);
    expect((await fetch(callbackUrl, { redirect: "manual" })).status).toBe(400);
    expect(
      (await fetch(`${base}/_authveil/callback?code=x&state=unknown`, { redirect: "manual" }))
        .status,
    ).toBe(400);
  });
});
