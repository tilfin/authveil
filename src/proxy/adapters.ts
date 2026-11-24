import { duration } from "../config/index.js";
import { claim } from "../identity/identity.js";
import { TokenCache } from "./token-cache.js";
import type {
  AdapterContext,
  HeaderMapping,
  IdentityProxyAdapter,
  IdentityProxyConfig,
  ProxyIdentity,
} from "../core/types.js";

export const BUILTIN_RESERVED_HEADERS = [
  "x-amzn-oidc-data",
  "x-amzn-oidc-identity",
  "x-amzn-oidc-accesstoken",
  "x-goog-iap-jwt-assertion",
  "x-goog-authenticated-user-email",
  "x-goog-authenticated-user-id",
  "x-authveil-request-id",
] as const;

function standardClaims(identity: ProxyIdentity): Record<string, unknown> {
  return {
    ...identity.claims,
    sub: identity.subject,
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.name ? { name: identity.name } : {}),
  };
}

class AlbAdapter implements IdentityProxyAdapter {
  readonly type = "alb" as const;
  readonly #cache = new TokenCache();
  constructor(private readonly config: Extract<IdentityProxyConfig, { type: "alb" }>) {}
  reservedHeaderNames() {
    return BUILTIN_RESERVED_HEADERS;
  }
  async createHeaders(
    identity: ProxyIdentity,
    context: AdapterContext,
  ): Promise<Record<string, string>> {
    const now = Math.floor(context.now.getTime() / 1000),
      exp = now + duration(this.config.tokenTtl, 300_000) / 1000;
    const key = await context.keyStore.current();
    const header = {
      signer:
        this.config.albArn ??
        "arn:aws:elasticloadbalancing:local:000000000000:loadbalancer/app/authveil/local",
      iss: this.config.issuer ?? "https://authveil.local",
      client: this.config.clientId ?? "authveil",
      exp,
    };
    const token = await this.#cache.get(
      ["data", identity, this.config, key.keyId],
      context.now.getTime(),
      exp * 1000,
      () => key.sign(standardClaims(identity), header),
    );
    const accessTokenPayload = {
      ...standardClaims(identity),
      iss: header.iss,
      aud: header.client,
      iat: now,
      exp,
    };
    const accessToken = await this.#cache.get(
      ["access", identity, this.config, key.keyId],
      context.now.getTime(),
      exp * 1000,
      () => key.sign(accessTokenPayload),
    );
    return {
      "x-amzn-oidc-data": token,
      "x-amzn-oidc-identity": identity.subject,
      "x-amzn-oidc-accesstoken": accessToken,
    };
  }
}

class IapAdapter implements IdentityProxyAdapter {
  readonly type = "iap" as const;
  readonly #cache = new TokenCache();
  constructor(private readonly config: Extract<IdentityProxyConfig, { type: "iap" }>) {}
  reservedHeaderNames() {
    return BUILTIN_RESERVED_HEADERS;
  }
  async createHeaders(
    identity: ProxyIdentity,
    context: AdapterContext,
  ): Promise<Record<string, string>> {
    const now = Math.floor(context.now.getTime() / 1000),
      ttl = duration(this.config.tokenTtl, 600_000) / 1000,
      testType = context.iapSecureTokenTestType,
      iat =
        testType === "FUTURE_ISSUE"
          ? now + 3_600
          : testType === "PAST_EXPIRATION"
            ? now - ttl - 3_600
            : now,
      exp = testType === "PAST_EXPIRATION" ? now - 3_600 : iat + ttl;
    const key = await context.keyStore.current(),
      issuer = this.config.issuer ?? "https://cloud.google.com/iap";
    const payload = {
      ...standardClaims(identity),
      iss: testType === "ISSUER" ? `${issuer}#authveil-invalid` : issuer,
      aud:
        testType === "AUDIENCE" ? `${this.config.audience}#authveil-invalid` : this.config.audience,
      iat,
      exp,
    };
    let token = await this.#cache.get(
      [identity, this.config, key.keyId, testType ?? "NOT_SET"],
      context.now.getTime(),
      exp * 1000,
      () => key.sign(payload),
    );
    if (testType === "SIGNATURE") token = invalidateSignature(token);
    const namespace = this.config.identityNamespace ?? "accounts.google.com";
    return {
      "x-goog-iap-jwt-assertion": token,
      "x-goog-authenticated-user-id": `${namespace}:${identity.subject}`,
      ...(identity.email
        ? { "x-goog-authenticated-user-email": `${namespace}:${identity.email}` }
        : {}),
    };
  }
}

function invalidateSignature(token: string): string {
  const parts = token.split(".");
  const signature = parts[2]!;
  parts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  return parts.join(".");
}

function transform(value: unknown, mapping: HeaderMapping): string | undefined {
  if (value === undefined || value === null) return undefined;
  switch (mapping.transform ?? "string") {
    case "join":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
        throw new TypeError(`Claim ${mapping.claim} must be a string array`);
      return value.join(mapping.separator ?? ",");
    case "json":
      return JSON.stringify(value);
    case "prefix":
      if (["object", "function"].includes(typeof value))
        throw new TypeError(`Claim ${mapping.claim} must be scalar`);
      return `${mapping.prefix ?? ""}${String(value)}`;
    case "string":
      if (["object", "function"].includes(typeof value))
        throw new TypeError(`Claim ${mapping.claim} must be scalar`);
      return String(value);
  }
}

class MappingAdapter implements IdentityProxyAdapter {
  readonly type: "entra-app-proxy" | "generic";
  constructor(
    private readonly config: Extract<IdentityProxyConfig, { type: "generic" | "entra-app-proxy" }>,
  ) {
    this.type = config.type;
  }
  reservedHeaderNames() {
    return [
      ...BUILTIN_RESERVED_HEADERS,
      ...Object.keys(this.config.headers).map((name) => name.toLowerCase()),
    ];
  }
  async createHeaders(identity: ProxyIdentity): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [name, mapping] of Object.entries(this.config.headers)) {
      const value = transform(claim(identity, mapping.claim), mapping);
      if (value !== undefined) result[name.toLowerCase()] = value;
    }
    return result;
  }
}

class NoneAdapter implements IdentityProxyAdapter {
  readonly type = "none" as const;
  reservedHeaderNames() {
    return BUILTIN_RESERVED_HEADERS;
  }
  async createHeaders() {
    return {};
  }
}

export function createIdentityProxyAdapter(config: IdentityProxyConfig): IdentityProxyAdapter {
  switch (config.type) {
    case "alb":
      return new AlbAdapter(config);
    case "iap":
      return new IapAdapter(config);
    case "generic":
    case "entra-app-proxy":
      return new MappingAdapter(config);
    case "none":
      return new NoneAdapter();
  }
}
