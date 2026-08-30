import * as oidc from "openid-client";
import { validateIdentity } from "./identity.js";
import type { OidcConfig, ProxyIdentity } from "../core/types.js";

interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

export class OidcAuthenticator {
  readonly #pending = new Map<string, PendingLogin>();

  private constructor(
    private readonly options: OidcConfig,
    private readonly configuration: oidc.Configuration,
  ) {}

  static async create(options: OidcConfig): Promise<OidcAuthenticator> {
    const configuration = await oidc.discovery(
      new URL(options.issuer),
      options.clientId,
      options.clientSecret,
    );
    return new OidcAuthenticator(options, configuration);
  }
  async authorizationUrl(returnTo: string): Promise<URL> {
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    this.#pending.set(state, {
      state,
      nonce,
      verifier,
      returnTo,
      expiresAt: Date.now() + 10 * 60_000,
    });
    return oidc.buildAuthorizationUrl(this.configuration, {
      redirect_uri: this.options.redirectUri,
      scope: (this.options.scopes ?? ["openid", "profile", "email"]).join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
  }

  async callback(
    url: URL,
  ): Promise<{ identity: ProxyIdentity; accessToken?: string; returnTo: string }> {
    const state = url.searchParams.get("state") ?? "";
    const pending = this.#pending.get(state);
    this.#pending.delete(state);
    if (!pending || pending.expiresAt <= Date.now())
      throw new Error("OIDC state is invalid or expired");
    const tokens = await oidc.authorizationCodeGrant(this.configuration, url, {
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      pkceCodeVerifier: pending.verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("OIDC provider did not return an ID token");
    const mapping = this.options.claimMapping ?? {};
    const identity = validateIdentity({
      subject: String(getPath(claims, mapping.subject ?? "sub") ?? ""),
      ...(getPath(claims, mapping.email ?? "email") !== undefined
        ? { email: String(getPath(claims, mapping.email ?? "email")) }
        : {}),
      ...(getPath(claims, mapping.name ?? "name") !== undefined
        ? { name: String(getPath(claims, mapping.name ?? "name")) }
        : {}),
      claims: JSON.parse(JSON.stringify(claims)) as ProxyIdentity["claims"],
      source: { mode: "oidc", issuer: this.options.issuer, authenticatedAt: Date.now() },
    });
    return {
      identity,
      ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
      returnTo: pending.returnTo,
    };
  }
}

function getPath(value: object, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      value,
    );
}
