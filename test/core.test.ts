import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createIdentityProxyAdapter } from "../src/proxy/adapters.js";
import { identityFromMock } from "../src/identity/identity.js";
import { KeyStore } from "../src/keys/key-store.js";
import { SessionStore } from "../src/identity/session.js";
import { resolveConfig } from "../src/config/index.js";

const identity = identityFromMock(
  {
    id: "admin",
    subject: "user-1",
    email: "a@example.com",
    claims: { groups: ["admin"], roles: ["write", "read"] },
  },
  1,
);
async function keys() {
  return KeyStore.create(resolveConfig({ upstream: { url: "http://localhost" } }).keys);
}

describe("adapters", () => {
  it("generates ALB-compatible JOSE and payload shapes", async () => {
    const adapter = createIdentityProxyAdapter({
      type: "alb",
      albArn: "arn:test",
      issuer: "https://issuer.test",
      clientId: "client",
    });
    const keyStore = await keys();
    const headers = await adapter.createHeaders(identity, {
      now: new Date("2026-01-01T00:00:00Z"),
      keyStore,
      requestId: "r",
    });
    expect(headers["x-amzn-oidc-identity"]).toBe("user-1");
    expect(decodeProtectedHeader(headers["x-amzn-oidc-data"]!)).toMatchObject({
      alg: "ES256",
      signer: "arn:test",
      iss: "https://issuer.test",
      client: "client",
    });
    expect(decodeJwt(headers["x-amzn-oidc-data"]!)).toMatchObject({
      sub: "user-1",
      email: "a@example.com",
      groups: ["admin"],
    });
    expect(decodeProtectedHeader(headers["x-amzn-oidc-accesstoken"]!)).toMatchObject({
      alg: "ES256",
    });
    expect(decodeJwt(headers["x-amzn-oidc-accesstoken"]!)).toMatchObject({
      sub: "user-1",
      email: "a@example.com",
      groups: ["admin"],
      aud: "client",
      iss: "https://issuer.test",
    });
    await expect(
      jwtVerify(
        headers["x-amzn-oidc-accesstoken"]!,
        createLocalJWKSet(await keyStore.publicJwks()),
        {
          currentDate: new Date("2026-01-01T00:00:00Z"),
        },
      ),
    ).resolves.toBeDefined();
  });

  it("generates IAP claims and namespaced headers", async () => {
    const adapter = createIdentityProxyAdapter({ type: "iap", audience: "/projects/1/backend/2" });
    const headers = await adapter.createHeaders(identity, {
      now: new Date("2026-01-01T00:00:00Z"),
      keyStore: await keys(),
      requestId: "r",
    });
    expect(headers["x-goog-authenticated-user-email"]).toBe("accounts.google.com:a@example.com");
    expect(decodeJwt(headers["x-goog-iap-jwt-assertion"]!)).toMatchObject({
      iss: "https://cloud.google.com/iap",
      aud: "/projects/1/backend/2",
      sub: "user-1",
    });
  });

  it("maps generic claims with controlled transforms", async () => {
    const adapter = createIdentityProxyAdapter({
      type: "generic",
      headers: {
        "X-User": { claim: "sub" },
        "X-Roles": { claim: "roles", transform: "join", separator: ";" },
      },
    });
    expect(
      await adapter.createHeaders(identity, {
        now: new Date(),
        keyStore: await keys(),
        requestId: "r",
      }),
    ).toEqual({ "x-user": "user-1", "x-roles": "write;read" });
    expect(adapter.reservedHeaderNames()).toContain("x-roles");
  });

  it("does not add a groups claim when the identity does not provide one", async () => {
    const adapter = createIdentityProxyAdapter({ type: "iap", audience: "/projects/1/backend/2" });
    const headers = await adapter.createHeaders(
      identityFromMock({ id: "user", subject: "user-2" }, 1),
      { now: new Date("2026-01-01T00:00:00Z"), keyStore: await keys(), requestId: "r" },
    );
    expect(decodeJwt(headers["x-goog-iap-jwt-assertion"]!)).not.toHaveProperty("groups");
  });
});

describe("session store", () => {
  it("uses opaque IDs and redacts secrets", () => {
    const store = new SessionStore(1000),
      session = store.create(identity, "secret");
    expect(session.id.length).toBeGreaterThan(20);
    expect(JSON.stringify(session)).not.toContain("secret");
    store.delete(session.id);
    expect(store.get(session.id)).toBeUndefined();
  });
});
