import type { JsonValue, MockUser, ProxyIdentity } from "../core/types.js";

function isJson(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJson);
  return typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJson);
}

export function validateIdentity(identity: ProxyIdentity): ProxyIdentity {
  if (!identity.subject.trim()) throw new TypeError("Identity subject must not be empty");
  if (!isJson(identity.claims)) throw new TypeError("Identity claims must be JSON-compatible");
  return identity;
}

export function identityFromMock(user: MockUser, now = Date.now()): ProxyIdentity {
  return validateIdentity({
    subject: user.subject,
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { name: user.name } : {}),
    claims: user.claims ?? {},
    source: { mode: "mock", authenticatedAt: now },
  });
}

export function claim(identity: ProxyIdentity, name: string): unknown {
  if (name === "sub" || name === "subject") return identity.subject;
  if (name === "email") return identity.email;
  if (name === "name") return identity.name;
  return name
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined,
      identity.claims,
    );
}
