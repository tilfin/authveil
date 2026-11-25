import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/index.js";
import { identityFromMock, validateIdentity } from "../src/identity/identity.js";
import { KeyStore } from "../src/keys/key-store.js";
import { createIdentityProxyAdapter } from "../src/proxy/adapters.js";
import type { HeaderMapping, ProxyIdentity } from "../src/index.js";

const identity = identityFromMock(
  {
    id: "user",
    subject: "user-1",
    email: "user@example.test",
    claims: {
      groups: ["a", "b"],
      level: 3,
      admin: false,
      profile: { department: "engineering" },
      mixed: ["a", 1],
    },
  },
  1,
);

async function mapped(headers: Record<string, HeaderMapping>, subject: ProxyIdentity = identity) {
  const adapter = createIdentityProxyAdapter({ type: "generic", headers });
  return adapter.createHeaders(subject, {
    now: new Date(),
    keyStore: await KeyStore.create(resolveConfig({ upstream: { url: "http://localhost" } }).keys),
    requestId: "r",
  });
}

describe("identity validation", () => {
  it("rejects an empty subject and non-JSON claims", () => {
    expect(() => identityFromMock({ id: "user", subject: "  " })).toThrow(
      "subject must not be empty",
    );
    expect(() =>
      validateIdentity({
        subject: "user-1",
        claims: { callback: (() => undefined) as never },
        source: { mode: "mock", authenticatedAt: 1 },
      }),
    ).toThrow("JSON-compatible");
  });

  it("keeps custom claims, including groups, under claims", () => {
    expect(identity).toMatchObject({
      subject: "user-1",
      email: "user@example.test",
      claims: { groups: ["a", "b"] },
      source: { mode: "mock", authenticatedAt: 1 },
    });
    expect(identity).not.toHaveProperty("groups");
  });
});

describe("header mapping transforms", () => {
  it("maps standard fields, dot paths, and every transform", async () => {
    expect(
      await mapped({
        "X-Subject": { claim: "subject" },
        "X-Email": { claim: "email" },
        "X-Department": { claim: "profile.department" },
        "X-Level": { claim: "level" },
        "X-Admin": { claim: "admin" },
        "X-Groups": { claim: "groups", transform: "join" },
        "X-Profile": { claim: "profile", transform: "json" },
        "X-Prefixed": { claim: "sub", transform: "prefix", prefix: "user:" },
        "X-First-Group": { claim: "groups.0" },
      }),
    ).toEqual({
      "x-subject": "user-1",
      "x-email": "user@example.test",
      "x-department": "engineering",
      "x-level": "3",
      "x-admin": "false",
      "x-groups": "a,b",
      "x-profile": '{"department":"engineering"}',
      "x-prefixed": "user:user-1",
      "x-first-group": "a",
    });
  });

  it("omits headers for missing claims", async () => {
    expect(
      await mapped({ "X-Name": { claim: "name" }, "X-Missing": { claim: "nope.deeper" } }),
    ).toEqual({});
  });

  it("fails instead of changing the shape of a mismatched claim", async () => {
    await expect(mapped({ "X-Profile": { claim: "profile" } })).rejects.toThrow("must be scalar");
    await expect(
      mapped({ "X-Profile": { claim: "profile", transform: "prefix", prefix: "p:" } }),
    ).rejects.toThrow("must be scalar");
    await expect(mapped({ "X-Level": { claim: "level", transform: "join" } })).rejects.toThrow(
      "must be a string array",
    );
    await expect(mapped({ "X-Mixed": { claim: "mixed", transform: "join" } })).rejects.toThrow(
      "must be a string array",
    );
  });
});
