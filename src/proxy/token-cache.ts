import { createHash } from "node:crypto";

/** Default lifetime of a cached token (design: configured cache TTL, 60 seconds). */
const DEFAULT_TTL_MS = 60_000;
/** Stop reusing a token this long before it expires. */
const EXPIRY_MARGIN_MS = 30_000;
/** Upper bound on cached tokens; the oldest entries are dropped first. */
const DEFAULT_MAX_ENTRIES = 1_000;

interface CachedToken {
  readonly token: string;
  readonly issuedAt: number;
  readonly until: number;
}

/**
 * Short-lived cache for signed identity tokens so that each request does not
 * need a new signature. Entries are reused until min(token expiration - 30s,
 * TTL), expired entries are evicted on insert, and the size is bounded.
 */
export class TokenCache {
  readonly #items = new Map<string, CachedToken>();

  constructor(private readonly options: { ttl?: number; maxEntries?: number } = {}) {}

  get size(): number {
    return this.#items.size;
  }

  /**
   * Returns the cached token for `key`, or signs a new one with `create`.
   * `now` and `expiresAt` are epoch milliseconds; `key` must not contain
   * time-dependent values such as `iat` or `exp`.
   */
  async get(
    key: unknown,
    now: number,
    expiresAt: number,
    create: () => Promise<string>,
  ): Promise<string> {
    const id = fingerprint(key);
    const found = this.#items.get(id);
    if (found && found.issuedAt <= now && now < found.until) return found.token;

    const token = await create();
    this.#items.delete(id);
    const until = Math.min(
      expiresAt - EXPIRY_MARGIN_MS,
      now + (this.options.ttl ?? DEFAULT_TTL_MS),
    );
    if (until > now) {
      this.#evict(now);
      this.#items.set(id, { token, issuedAt: now, until });
    }
    return token;
  }

  #evict(now: number): void {
    for (const [id, item] of this.#items) if (item.until <= now) this.#items.delete(id);
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    for (const id of this.#items.keys()) {
      if (this.#items.size < maxEntries) break;
      this.#items.delete(id);
    }
  }
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
