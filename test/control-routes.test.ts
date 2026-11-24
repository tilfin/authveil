import { createPublicKey } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthVeil } from "../src/index.js";
import type { AuthVeilOptions } from "../src/index.js";
import { startEchoUpstream } from "../src/testkit.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startProxy(options: Partial<AuthVeilOptions> = {}): Promise<string> {
  const upstream = await startEchoUpstream();
  cleanups.push(() => upstream.close());
  const instance = await createAuthVeil({
    upstream: { url: upstream.url },
    server: { port: 0, ...options.server },
    auth: { mode: "mock", ...options.auth },
    mockUsers: [
      { id: "admin", subject: "local-admin-001", name: "Admin <Ops>" },
      { id: "viewer", subject: "local-viewer-001" },
    ],
    identityProxy: options.identityProxy ?? { type: "alb" },
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return address.url;
}

async function login(base: string, prefix = "/_authveil"): Promise<string> {
  const response = await fetch(`${base}${prefix}/login?user=admin`, { redirect: "manual" });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

describe("control routes", () => {
  it("serves readiness", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/_authveil/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("serves the public JWKS with cache headers and the matching PEM key", async () => {
    const base = await startProxy();
    const jwksResponse = await fetch(`${base}/_authveil/.well-known/jwks.json`);
    expect(jwksResponse.headers.get("cache-control")).toBe("public, max-age=300");
    expect(jwksResponse.headers.get("etag")).toMatch(/^"[\w-]+"$/);
    const jwks = (await jwksResponse.json()) as { keys: Array<Record<string, string>> };
    expect(jwks.keys).toHaveLength(1);
    const [jwk] = jwks.keys;
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(jwk).not.toHaveProperty("d");

    const pemResponse = await fetch(`${base}/_authveil/keys/${encodeURIComponent(jwk!.kid!)}`);
    expect(pemResponse.status).toBe(200);
    expect(pemResponse.headers.get("content-type")).toBe("application/x-pem-file");
    const pem = await pemResponse.text();
    expect(createPublicKey(pem).export({ format: "jwk" })).toMatchObject({ x: jwk!.x, y: jwk!.y });

    expect((await fetch(`${base}/_authveil/keys/unknown`)).status).toBe(404);
  });

  it("lists mock users on the login page with escaped names and a safe returnTo", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/_authveil/login?returnTo=%2Forders`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const page = await response.text();
    expect(page).toContain("Admin &lt;Ops&gt;");
    expect(page).toContain("/_authveil/login?user=admin&amp;returnTo=%2Forders");
    expect(page).toContain("/_authveil/login?user=viewer&amp;returnTo=%2Forders");
  });

  it("rejects an unknown mock user", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/_authveil/login?user=missing`, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets an HttpOnly session cookie with the configured attributes", async () => {
    const base = await startProxy({
      auth: { sessionTtl: "1h", cookie: { name: "dev_session", sameSite: "strict", secure: true } },
    });
    const response = await fetch(`${base}/_authveil/login?user=admin&returnTo=/next`, {
      redirect: "manual",
    });
    expect(response.headers.get("location")).toBe("/next");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(
      /^dev_session=[\w-]{32,}; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=3600$/,
    );
  });

  it("returns the session identity and CSRF token, and logs out only with that token", async () => {
    const base = await startProxy();
    expect((await fetch(`${base}/_authveil/me`)).status).toBe(401);

    const cookie = await login(base);
    const me = (await (await fetch(`${base}/_authveil/me`, { headers: { cookie } })).json()) as {
      identity: { subject: string };
      csrfToken: string;
    };
    expect(me.identity.subject).toBe("local-admin-001");
    expect(me.csrfToken.length).toBeGreaterThan(20);

    const missingToken = await fetch(`${base}/_authveil/logout`, {
      method: "POST",
      headers: { cookie },
    });
    expect(missingToken.status).toBe(400);
    const wrongToken = await fetch(`${base}/_authveil/logout`, {
      method: "POST",
      headers: { cookie, "x-authveil-csrf": "wrong" },
    });
    expect(wrongToken.status).toBe(400);
    expect((await fetch(`${base}/_authveil/me`, { headers: { cookie } })).status).toBe(200);

    const logout = await fetch(`${base}/_authveil/logout`, {
      method: "POST",
      headers: { cookie, "x-authveil-csrf": me.csrfToken },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(`${base}/_authveil/me`, { headers: { cookie } })).status).toBe(401);
    expect((await fetch(`${base}/`, { headers: { cookie }, redirect: "manual" })).status).toBe(302);
  });

  it("masks long values in the generated header preview", async () => {
    const base = await startProxy();
    const cookie = await login(base);
    const preview = (await (
      await fetch(`${base}/_authveil/debug/headers`, { headers: { cookie } })
    ).json()) as Record<string, string>;
    expect(preview["x-amzn-oidc-identity"]).toBe("local-admin-001");
    expect(preview["x-amzn-oidc-data"]).toMatch(/^.{12}…\[masked\]$/);
    expect(preview["x-amzn-oidc-accesstoken"]).toMatch(/^.{12}…\[masked\]$/);
  });

  it("answers unknown control routes with 404 and never proxies them", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/_authveil/unknown`, {
      headers: { accept: "application/json" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { requestId: expect.any(String) } });
  });

  it("serves control routes under a custom prefix", async () => {
    const base = await startProxy({ server: { controlPrefix: "/_dev/auth/" } });
    expect((await fetch(`${base}/_dev/auth/health`)).status).toBe(200);
    const unauthenticated = await fetch(`${base}/page`, { redirect: "manual" });
    expect(unauthenticated.headers.get("location")).toBe("/_dev/auth/login?returnTo=%2Fpage");
    const cookie = await login(base, "/_dev/auth");
    expect((await fetch(`${base}/page`, { headers: { cookie } })).status).toBe(200);
    // The default prefix is an ordinary upstream path once a custom prefix is set.
    const proxied = await fetch(`${base}/_authveil/health`, { headers: { cookie } });
    expect(((await proxied.json()) as { url: string }).url).toBe("/_authveil/health");
  });
});
