import type { IncomingMessage } from "node:http";
import type { JWK } from "jose";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface IdentitySource {
  readonly mode: "mock" | "oidc" | "verified";
  readonly issuer?: string;
  readonly authenticatedAt: number;
}

export interface ProxyIdentity {
  readonly subject: string;
  readonly email?: string;
  readonly name?: string;
  readonly claims: Readonly<Record<string, JsonValue>>;
  readonly source: IdentitySource;
}

export interface MockUser {
  id: string;
  subject: string;
  email?: string;
  name?: string;
  claims?: Record<string, JsonValue>;
}

export interface HeaderMapping {
  claim: string;
  transform?: "string" | "join" | "json" | "prefix";
  separator?: string;
  prefix?: string;
}

export type HostHeaderMode = "preserve" | "upstream";

export type IdentityProxyConfig =
  | { type: "none"; hostHeader?: HostHeaderMode }
  | {
      type: "alb";
      preserveHostHeader?: boolean;
      albArn?: string;
      issuer?: string;
      clientId?: string;
      tokenTtl?: string | number;
    }
  | {
      type: "iap";
      audience: string;
      hostRewrite?: string;
      issuer?: string;
      identityNamespace?: string;
      tokenTtl?: string | number;
    }
  | {
      type: "entra-app-proxy";
      translateUrlsInHeaders?: boolean;
      headers: Record<string, HeaderMapping>;
    }
  | {
      type: "generic";
      hostHeader?: HostHeaderMode;
      headers: Record<string, HeaderMapping>;
    };

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
  claimMapping?: { subject?: string; email?: string; name?: string };
}

export interface AuthVeilOptions {
  server?: { host?: string; port?: number; controlPrefix?: string };
  upstream: {
    url: string;
    requestTimeout?: string | number;
  };
  auth?: {
    mode?: "mock" | "oidc";
    /** When set in mock mode, inject this user without creating a session. */
    mockUser?: string;
    sessionTtl?: string | number;
    cookie?: { name?: string; sameSite?: "lax" | "strict" | "none"; secure?: boolean };
    oidc?: OidcConfig;
  };
  /** Local identities available when auth.mode is mock. */
  mockUsers?: MockUser[];
  identityProxy?: IdentityProxyConfig;
  keys?: {
    algorithm?: "ES256";
    privateKey?: string;
    privateKeyFile?: string;
    kid?: string;
  };
  logging?: {
    level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
    format?: "json" | "pretty";
  };
}

export interface ResolvedConfig {
  server: { host: string; port: number; controlPrefix: string };
  upstream: {
    url: string;
    requestTimeout: number;
  };
  auth: {
    mode: "mock" | "oidc";
    mockUser?: string;
    sessionTtl: number;
    cookie: { name: string; sameSite: "lax" | "strict" | "none"; secure: boolean };
    oidc?: OidcConfig;
  };
  mockUsers: MockUser[];
  identityProxy: IdentityProxyConfig;
  keys: {
    algorithm: "ES256";
    privateKey?: string;
    privateKeyFile?: string;
    kid?: string;
  };
  logging: {
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
    format: "json" | "pretty";
  };
}

export interface SigningKey {
  readonly keyId: string;
  readonly algorithm: "ES256";
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export interface SigningKeyStore {
  current(): Promise<SigningKey>;
  publicJwks(): Promise<{ keys: JWK[] }>;
  publicPem(keyId: string): Promise<string | undefined>;
}

export interface AdapterContext {
  readonly now: Date;
  readonly keyStore: SigningKeyStore;
  readonly requestId: string;
  /** IAP verification failure to emulate for gcp-iap-mode=SECURE_TOKEN_TEST. */
  readonly iapSecureTokenTestType?: IapSecureTokenTestType;
}

export type IapSecureTokenTestType =
  | "NOT_SET"
  | "FUTURE_ISSUE"
  | "PAST_EXPIRATION"
  | "ISSUER"
  | "AUDIENCE"
  | "SIGNATURE";

export interface IdentityProxyAdapter {
  readonly type: "alb" | "iap" | "entra-app-proxy" | "generic" | "none";
  createHeaders(
    identity: ProxyIdentity,
    context: AdapterContext,
  ): Promise<Readonly<Record<string, string>>>;
  reservedHeaderNames(): readonly string[];
}

export type AuthResult =
  | { authenticated: true; identity: ProxyIdentity; sessionId?: string; accessToken?: string }
  | { authenticated: false; reason: "missing" | "expired" | "invalid" };

export interface Authenticator {
  resolve(request: IncomingMessage): Promise<AuthResult>;
}

export interface ListenOptions {
  host?: string;
  port?: number;
}

export interface BoundAddress {
  host: string;
  port: number;
  url: string;
}

export interface AuthVeil {
  listen(options?: ListenOptions): Promise<BoundAddress>;
  close(): Promise<void>;
  address(): BoundAddress | undefined;
}
