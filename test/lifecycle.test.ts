import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthVeil } from "../src/index.js";
import { SessionStore } from "../src/identity/session.js";
import { identityFromMock } from "../src/identity/identity.js";
import { startEchoUpstream, startTestProxy, testUsers } from "../src/testkit.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function echoUpstream() {
  const upstream = await startEchoUpstream();
  cleanups.push(() => upstream.close());
  return upstream;
}

describe("lifecycle", () => {
  it("rejects a second listen call and closes idempotently", async () => {
    const upstream = await echoUpstream();
    const instance = await createAuthVeil({
      upstream: { url: upstream.url },
      server: { port: 0 },
      logging: { level: "silent" },
    });
    expect(instance.address()).toBeUndefined();
    const address = await instance.listen();
    expect(instance.address()).toEqual(address);
    expect(address.url).toBe(`http://127.0.0.1:${address.port}`);
    await expect(instance.listen()).rejects.toThrow("already listening");

    const first = instance.close();
    expect(instance.close()).toBe(first);
    await first;
    expect(instance.address()).toBeUndefined();
    await expect(fetch(`${address.url}/_authveil/health`)).rejects.toThrow();
  });

  it("formats IPv6 listen addresses with brackets", async () => {
    const upstream = await echoUpstream();
    const instance = await createAuthVeil({
      upstream: { url: upstream.url },
      logging: { level: "silent" },
    });
    let address;
    try {
      address = await instance.listen({ host: "::1", port: 0 });
    } catch {
      return; // IPv6 loopback is not available on this machine.
    }
    cleanups.push(() => instance.close());
    expect(address.url).toBe(`http://[::1]:${address.port}`);
    expect((await fetch(`${address.url}/_authveil/health`)).status).toBe(200);
  });
});

describe("identity header protection", () => {
  it("removes spoofed built-in, mapped, request-ID, and proxy-auth headers case-insensitively", async () => {
    const upstream = await echoUpstream();
    const proxy = await startTestProxy({
      upstream: { url: upstream.url },
      auth: { mockUser: "admin" },
      identityProxy: { type: "generic", headers: { "X-User-Id": { claim: "sub" } } },
      logging: { level: "silent" },
    });
    cleanups.push(proxy.close);
    const response = await fetch(`${proxy.address.url}/`, {
      headers: {
        "X-Amzn-Oidc-Data": "forged",
        "X-Goog-Iap-Jwt-Assertion": "forged",
        "X-Goog-Authenticated-User-Email": "forged",
        "X-USER-ID": "forged",
        "X-AuthVeil-Request-Id": "forged",
        "Proxy-Authorization": "Basic forged",
        "X-Custom": "kept",
      },
    });
    const { headers } = (await response.json()) as { headers: Record<string, string> };
    expect(headers["x-amzn-oidc-data"]).toBeUndefined();
    expect(headers["x-goog-iap-jwt-assertion"]).toBeUndefined();
    expect(headers["x-goog-authenticated-user-email"]).toBeUndefined();
    expect(headers["proxy-authorization"]).toBeUndefined();
    expect(headers["x-user-id"]).toBe("local-admin-001");
    expect(headers["x-authveil-request-id"]).not.toBe("forged");
    expect(headers["x-authveil-request-id"]).toBe(response.headers.get("x-authveil-request-id"));
    expect(headers["x-custom"]).toBe("kept");
  });
});

describe("testkit", () => {
  it("starts a mock-mode proxy with the built-in test users on a free port", async () => {
    const upstream = await echoUpstream();
    const proxy = await startTestProxy({
      upstream: { url: upstream.url },
      identityProxy: { type: "generic", headers: { "X-User-Id": { claim: "sub" } } },
      logging: { level: "silent" },
    });
    cleanups.push(proxy.close);
    expect(proxy.address.port).toBeGreaterThan(0);

    for (const user of Object.values(testUsers)) {
      const login = await fetch(`${proxy.address.url}/_authveil/login?user=${user.id}`, {
        redirect: "manual",
      });
      const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
      const response = await fetch(`${proxy.address.url}/orders?x=1`, {
        method: "POST",
        headers: { cookie },
        body: "payload",
      });
      expect(await response.json()).toMatchObject({
        method: "POST",
        url: "/orders?x=1",
        body: "payload",
        headers: { "x-user-id": user.subject },
      });
    }
  });
});

describe("session store", () => {
  const identity = identityFromMock({ id: "user", subject: "user-1" }, 1);

  it("expires sessions after their TTL and sweeps them", () => {
    vi.useFakeTimers({ now: 0 });
    const store = new SessionStore(1_000);
    const expired = store.create(identity);
    vi.setSystemTime(500);
    const current = store.create(identity);
    expect(expired.id).not.toBe(current.id);
    expect(expired.csrfToken).not.toBe(current.csrfToken);

    vi.setSystemTime(1_000);
    expect(store.get(expired.id)).toBeUndefined();
    expect(store.get(current.id)).toBe(current);

    vi.setSystemTime(1_500);
    store.sweep();
    expect(store.get(current.id)).toBeUndefined();
    expect(store.get(undefined)).toBeUndefined();
  });
});
