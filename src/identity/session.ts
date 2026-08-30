import { randomBytes } from "node:crypto";
import type { ProxyIdentity } from "../core/types.js";

export class SecretString {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  toString(): string {
    return "[REDACTED]";
  }
}

export interface SessionRecord {
  id: string;
  identity: ProxyIdentity;
  accessToken?: SecretString;
  createdAt: number;
  expiresAt: number;
  csrfToken: string;
}

export class SessionStore {
  readonly #records = new Map<string, SessionRecord>();

  constructor(private readonly ttl: number) {}

  create(identity: ProxyIdentity, accessToken?: string): SessionRecord {
    const now = Date.now();
    const record: SessionRecord = {
      id: randomBytes(24).toString("base64url"),
      identity,
      ...(accessToken ? { accessToken: new SecretString(accessToken) } : {}),
      createdAt: now,
      expiresAt: now + this.ttl,
      csrfToken: randomBytes(24).toString("base64url"),
    };
    this.#records.set(record.id, record);
    return record;
  }

  get(id: string | undefined): SessionRecord | undefined {
    if (!id) return undefined;
    const record = this.#records.get(id);
    if (record && record.expiresAt <= Date.now()) {
      this.#records.delete(id);
      return undefined;
    }
    return record;
  }

  delete(id: string | undefined): void {
    if (id) this.#records.delete(id);
  }

  clear(): void {
    this.#records.clear();
  }

  sweep(): void {
    const now = Date.now();
    for (const [id, record] of this.#records) if (record.expiresAt <= now) this.#records.delete(id);
  }
}

export function parseCookies(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of value?.split(";") ?? []) {
    const index = item.indexOf("=");
    if (index > 0)
      result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return result;
}

export function sessionCookie(
  name: string,
  id: string,
  options: { secure: boolean; sameSite: string; maxAge?: number },
): string {
  return [
    `${name}=${encodeURIComponent(id)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${options.sameSite[0]!.toUpperCase()}${options.sameSite.slice(1)}`,
    ...(options.secure ? ["Secure"] : []),
    ...(options.maxAge !== undefined
      ? [`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`]
      : []),
  ].join("; ");
}
