import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import YAML from "yaml";
import type { AuthVeilOptions, IdentityProxyConfig, ResolvedConfig } from "../core/types.js";

export class ConfigError extends Error {
  readonly code = "AUTHVEIL_CONFIG_INVALID";
}

export function duration(value: string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new ConfigError(`Invalid duration: ${value}`);
  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * (units[match[2]!] ?? 1);
}

export function expandEnvironment(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_whole, name: string) => {
    const value = env[name];
    if (value === undefined) throw new ConfigError(`Environment variable ${name} is not set`);
    return value;
  });
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["upstream"],
  properties: {
    server: {
      type: "object",
      additionalProperties: false,
      properties: {
        host: { type: "string" },
        port: { type: "integer", minimum: 0, maximum: 65535 },
        controlPrefix: { type: "string", pattern: "^/" },
      },
    },
    upstream: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string" },
        requestTimeout: { type: ["string", "number"] },
      },
    },
    auth: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { enum: ["mock", "oidc"] },
        mockUser: { type: "string", minLength: 1 },
        sessionTtl: { type: ["string", "number"] },
        cookie: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            sameSite: { enum: ["lax", "strict", "none"] },
            secure: { type: "boolean" },
          },
        },
        oidc: {
          type: "object",
          additionalProperties: false,
          required: ["issuer", "clientId", "redirectUri"],
          properties: {
            issuer: { type: "string" },
            clientId: { type: "string" },
            clientSecret: { type: "string" },
            redirectUri: { type: "string" },
            scopes: { type: "array", items: { type: "string" } },
            claimMapping: {
              type: "object",
              additionalProperties: false,
              properties: {
                subject: { type: "string" },
                email: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      },
    },
    mockUsers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "subject"],
        properties: {
          id: { type: "string", minLength: 1 },
          subject: { type: "string", minLength: 1 },
          email: { type: "string" },
          name: { type: "string" },
          claims: { type: "object" },
        },
      },
    },
    identityProxy: {
      type: "object",
      required: ["type"],
      properties: {
        type: { enum: ["none", "alb", "iap", "entra-app-proxy", "generic"] },
        hostHeader: { enum: ["preserve", "upstream"] },
        preserveHostHeader: { type: "boolean" },
        albArn: { type: "string" },
        issuer: { type: "string" },
        clientId: { type: "string" },
        tokenTtl: { type: ["string", "number"] },
        audience: { type: "string" },
        hostRewrite: { type: "string" },
        identityNamespace: { type: "string" },
        translateUrlsInHeaders: { type: "boolean" },
        headers: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["claim"],
            properties: {
              claim: { type: "string" },
              transform: { enum: ["string", "join", "json", "prefix"] },
              separator: { type: "string" },
              prefix: { type: "string" },
            },
          },
        },
      },
      additionalProperties: false,
    },
    keys: {
      type: "object",
      additionalProperties: false,
      properties: {
        algorithm: { const: "ES256" },
        privateKey: { type: "string", minLength: 1 },
        privateKeyFile: { type: "string", minLength: 1 },
        kid: { type: "string" },
      },
    },
    logging: {
      type: "object",
      additionalProperties: false,
      properties: {
        level: { enum: ["trace", "debug", "info", "warn", "error", "fatal", "silent"] },
        format: { enum: ["json", "pretty"] },
      },
    },
  },
} as const;

export function resolveConfig(input: AuthVeilOptions): ResolvedConfig {
  if ("output" in (input as object))
    throw new ConfigError("output has been renamed to identityProxy");
  if ("changeOrigin" in (input.upstream as object))
    throw new ConfigError(
      "upstream.changeOrigin has been removed; configure Host behavior in identityProxy",
    );
  const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);
  const document = { ...input };
  if (!validate(document)) {
    throw new ConfigError(
      validate.errors
        ?.map((e: ErrorObject) => `${e.instancePath || "/"} ${e.message}`)
        .join("; ") ?? "Invalid configuration",
    );
  }

  let upstream: URL;
  try {
    upstream = new URL(input.upstream.url);
  } catch {
    throw new ConfigError("upstream.url must be a valid URL");
  }

  if (!["http:", "https:"].includes(upstream.protocol))
    throw new ConfigError("upstream.url must use http or https");
  const host = input.server?.host ?? "127.0.0.1";
  const mode = input.auth?.mode ?? "mock";
  if (mode === "oidc" && !input.auth?.oidc)
    throw new ConfigError("auth.oidc is required in oidc mode");
  if (mode !== "mock" && (input.auth?.mockUser || input.mockUsers?.length))
    throw new ConfigError("auth.mockUser and mockUsers are only supported in mock mode");
  const mockUser = input.auth?.mockUser;
  if (mockUser && !input.mockUsers?.some((user) => user.id === mockUser))
    throw new ConfigError("auth.mockUser must reference an entry in mockUsers");
  if (mode === "oidc" && !["127.0.0.1", "::1", "localhost"].includes(host))
    throw new ConfigError("Remote OIDC bind requires HTTPS, which is not configured");
  const identityProxy = input.identityProxy ?? { type: "none" };
  const allowedIdentityProxyKeys: Record<IdentityProxyConfig["type"], readonly string[]> = {
    none: ["type", "hostHeader"],
    alb: ["type", "preserveHostHeader", "albArn", "issuer", "clientId", "tokenTtl"],
    iap: ["type", "audience", "hostRewrite", "issuer", "identityNamespace", "tokenTtl"],
    "entra-app-proxy": ["type", "translateUrlsInHeaders", "headers"],
    generic: ["type", "hostHeader", "headers"],
  };
  const unexpectedIdentityProxyKey = Object.keys(identityProxy).find(
    (key) => !allowedIdentityProxyKeys[identityProxy.type].includes(key),
  );
  if (unexpectedIdentityProxyKey)
    throw new ConfigError(
      `identityProxy.${unexpectedIdentityProxyKey} is not supported for ${identityProxy.type}`,
    );
  if (identityProxy.type === "iap" && !identityProxy.audience)
    throw new ConfigError("identityProxy.audience is required for IAP");
  if (
    (identityProxy.type === "generic" || identityProxy.type === "entra-app-proxy") &&
    !identityProxy.headers
  )
    throw new ConfigError("identityProxy.headers is required for mapped identity proxies");
  if (input.keys?.privateKey && input.keys.privateKeyFile)
    throw new ConfigError("keys.privateKey and keys.privateKeyFile cannot be used together");

  return {
    server: {
      host,
      port: input.server?.port ?? 3080,
      controlPrefix: (input.server?.controlPrefix ?? "/_authveil").replace(/\/$/, ""),
    },
    upstream: {
      url: upstream.toString(),
      requestTimeout: duration(input.upstream.requestTimeout, 0),
    },
    auth: {
      mode,
      ...(input.auth?.mockUser ? { mockUser: input.auth.mockUser } : {}),
      sessionTtl: duration(input.auth?.sessionTtl, 8 * 3_600_000),
      cookie: {
        name:
          input.auth?.cookie?.name ??
          (identityProxy.type === "alb" ? "AWSELBAuthSessionCookie-0" : "authveil_session"),
        sameSite: input.auth?.cookie?.sameSite ?? "lax",
        secure: input.auth?.cookie?.secure ?? false,
      },
      ...(input.auth?.oidc ? { oidc: input.auth.oidc } : {}),
    },
    mockUsers: input.mockUsers ?? [],
    identityProxy,
    keys: {
      algorithm: "ES256",
      ...(input.keys?.privateKey ? { privateKey: input.keys.privateKey } : {}),
      ...(input.keys?.privateKeyFile ? { privateKeyFile: input.keys.privateKeyFile } : {}),
      ...(input.keys?.kid ? { kid: input.keys.kid } : {}),
    },
    logging: { level: input.logging?.level ?? "info", format: input.logging?.format ?? "json" },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findConfig(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<string | undefined> {
  if (explicit) return resolve(cwd, explicit);
  if (env.AUTHVEIL_CONFIG) return resolve(cwd, env.AUTHVEIL_CONFIG);
  for (const name of ["authveil.config.yaml", "authveil.config.yml"]) {
    const path = resolve(cwd, name);
    if (await exists(path)) return path;
  }
  return undefined;
}

export async function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedConfig> {
  let raw: unknown;
  try {
    raw = YAML.parse(expandEnvironment(await readFile(path, "utf8"), env));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `Cannot read configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const config = raw as AuthVeilOptions;
  const overridden: AuthVeilOptions = {
    ...config,
    server: {
      ...config.server,
      ...(env.AUTHVEIL_HOST ? { host: env.AUTHVEIL_HOST } : {}),
      ...(env.AUTHVEIL_PORT ? { port: Number(env.AUTHVEIL_PORT) } : {}),
    },
    upstream: {
      ...config.upstream,
      ...(env.AUTHVEIL_UPSTREAM ? { url: env.AUTHVEIL_UPSTREAM } : {}),
    },
  };
  const resolved = resolveConfig(overridden);
  if (!resolved.keys.privateKeyFile) return resolved;
  return {
    ...resolved,
    keys: {
      ...resolved.keys,
      privateKeyFile: resolve(dirname(path), resolved.keys.privateKeyFile),
    },
  };
}
