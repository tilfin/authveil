import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/index.js";
import { identityFromMock } from "../src/identity/identity.js";
import { KeyStore } from "../src/keys/key-store.js";
import { createIdentityProxyAdapter } from "../src/proxy/adapters.js";
import { TokenCache } from "../src/proxy/token-cache.js";

const start = Date.parse("2026-01-01T00:00:00Z");

function counter() {
  let count = 0;
  return {
    create: async () => `token-${++count}`,
    get count() {
      return count;
    },
  };
}

describe("token cache", () => {
  it("reuses a token for the TTL and signs a new one afterwards", async () => {
    const cache = new TokenCache({ ttl: 60_000 });
    const signer = counter();
    const expiresAt = start + 600_000;
    expect(await cache.get("key", start, expiresAt, signer.create)).toBe("token-1");
    expect(await cache.get("key", start + 59_999, expiresAt, signer.create)).toBe("token-1");
    expect(await cache.get("key", start + 60_000, expiresAt, signer.create)).toBe("token-2");
    expect(signer.count).toBe(2);
  });

  it("stops reusing a token 30 seconds before it expires", async () => {
    const cache = new TokenCache();
    const signer = counter();
    const expiresAt = start + 40_000;
    await cache.get("key", start, expiresAt, signer.create);
    expect(await cache.get("key", start + 9_999, expiresAt, signer.create)).toBe("token-1");
    expect(await cache.get("key", start + 10_000, expiresAt, signer.create)).toBe("token-2");
  });

  it("does not store tokens that are already inside the expiry margin", async () => {
    const cache = new TokenCache();
    const signer = counter();
    await cache.get("key", start, start - 1_000, signer.create);
    expect(cache.size).toBe(0);
    expect(await cache.get("key", start, start - 1_000, signer.create)).toBe("token-2");
  });

  it("evicts expired entries when new tokens are stored", async () => {
    const cache = new TokenCache({ ttl: 1_000 });
    const signer = counter();
    for (let index = 0; index < 100; index++)
      await cache.get(`key-${index}`, start + index * 1_000, start + 600_000, signer.create);
    expect(cache.size).toBe(1);
  });

  it("bounds the number of cached tokens", async () => {
    const cache = new TokenCache({ maxEntries: 3 });
    const signer = counter();
    for (let index = 0; index < 10; index++)
      await cache.get(`key-${index}`, start, start + 600_000, signer.create);
    expect(cache.size).toBe(3);
    expect(await cache.get("key-9", start, start + 600_000, signer.create)).toBe("token-10");
  });
});

describe("adapter token caching", () => {
  const identity = identityFromMock({ id: "admin", subject: "user-1" }, 1);

  async function keyStore() {
    return KeyStore.create(resolveConfig({ upstream: { url: "http://localhost" } }).keys);
  }

  it("reuses ALB tokens across requests within the cache TTL", async () => {
    const adapter = createIdentityProxyAdapter({ type: "alb" });
    const keys = await keyStore();
    const first = await adapter.createHeaders(identity, {
      now: new Date(start),
      keyStore: keys,
      requestId: "1",
    });
    const second = await adapter.createHeaders(identity, {
      now: new Date(start + 5_000),
      keyStore: keys,
      requestId: "2",
    });
    expect(second["x-amzn-oidc-data"]).toBe(first["x-amzn-oidc-data"]);
    expect(second["x-amzn-oidc-accesstoken"]).toBe(first["x-amzn-oidc-accesstoken"]);

    const later = await adapter.createHeaders(identity, {
      now: new Date(start + 60_000),
      keyStore: keys,
      requestId: "3",
    });
    expect(decodeProtectedHeader(later["x-amzn-oidc-data"]!).exp).toBe(start / 1000 + 360);
    expect(decodeJwt(later["x-amzn-oidc-accesstoken"]!).iat).toBe(start / 1000 + 60);
  });

  it("keeps IAP secure-token test variants separate from the valid token", async () => {
    const adapter = createIdentityProxyAdapter({ type: "iap", audience: "/projects/1" });
    const keys = await keyStore();
    const context = { now: new Date(start), keyStore: keys, requestId: "r" };
    const valid = await adapter.createHeaders(identity, context);
    const invalidIssuer = await adapter.createHeaders(identity, {
      ...context,
      iapSecureTokenTestType: "ISSUER",
    });
    expect(decodeJwt(valid["x-goog-iap-jwt-assertion"]!).iss).toBe("https://cloud.google.com/iap");
    expect(decodeJwt(invalidIssuer["x-goog-iap-jwt-assertion"]!).iss).not.toBe(
      "https://cloud.google.com/iap",
    );
    expect((await adapter.createHeaders(identity, context))["x-goog-iap-jwt-assertion"]).toBe(
      valid["x-goog-iap-jwt-assertion"],
    );
  });
});
