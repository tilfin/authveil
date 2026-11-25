import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import WebSocket, { WebSocketServer } from "ws";
import { createAuthVeil } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function upstream() {
  const server = http.createServer((request, response) => {
    if (request.url === "/translate") {
      const origin = `http://${request.headers.host}`;
      response.writeHead(302, {
        Location: `${origin}/after`,
        "Content-Location": `${origin}/content`,
        "Set-Cookie": "session=1; Domain=127.0.0.1; Path=/; HttpOnly",
      });
      response.end();
      return;
    }
    if (request.url === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      setTimeout(() => response.end("data: second\n\n"), 50);
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  });

  const webSockets = new WebSocketServer({ server });
  webSockets.on("connection", (socket, request) => {
    socket.send(JSON.stringify(request.headers));
    socket.on("message", (message) => socket.send(message));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function mirror(
  identityProxy: Parameters<typeof createAuthVeil>[0]["identityProxy"] = {
    type: "generic",
    headers: { "X-User-Id": { claim: "sub" } },
  },
) {
  const instance = await createAuthVeil({
    upstream: { url: await upstream() },
    server: { port: 0 },
    auth: { mode: "mock" },
    mockUsers: [{ id: "admin", subject: "trusted-user", email: "admin@example.test" }],
    identityProxy,
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return address.url;
}

async function loginCookie(base: string): Promise<string> {
  const login = await fetch(`${base}/_authveil/login?user=admin`, { redirect: "manual" });
  return login.headers.get("set-cookie")!.split(";")[0]!;
}

async function proxyRequest(
  base: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: url.hostname, port: url.port, path, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("AuthVeil server", () => {
  it("serves health, redirects, logs in, proxies body, and strips spoofed headers", async () => {
    const base = await mirror();
    expect(await (await fetch(`${base}/_authveil/health`)).json()).toMatchObject({
      status: "ok",
      version: "0.2.0",
    });
    const unauthenticated = await fetch(`${base}/hello?q=1`, { redirect: "manual" });
    expect(unauthenticated.status).toBe(302);
    const login = await fetch(`${base}/_authveil/login?user=admin&returnTo=%2Fhello%3Fq%3D1`, {
      redirect: "manual",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const proxied = await fetch(`${base}/hello?q=1`, {
      method: "POST",
      headers: { cookie, "x-user-id": "attacker" },
      body: "stream me",
    });
    const seen = (await proxied.json()) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(seen).toMatchObject({ method: "POST", url: "/hello?q=1", body: "stream me" });
    expect(seen.headers["x-user-id"]).toBe("trusted-user");
    expect(seen.headers["x-authveil-request-id"]).toBeTruthy();
  });

  it("injects a configured fixed mock user without a login session", async () => {
    const instance = await createAuthVeil({
      upstream: { url: await upstream() },
      server: { port: 0 },
      auth: { mode: "mock", mockUser: "admin" },
      mockUsers: [{ id: "admin", subject: "trusted-user" }],
      identityProxy: { type: "generic", headers: { "X-User-Id": { claim: "sub" } } },
    });
    const address = await instance.listen();
    cleanups.push(() => instance.close());
    const base = address.url;
    const response = await fetch(`${base}/hello`);
    const seen = (await response.json()) as { headers: Record<string, string> };
    expect(seen.headers["x-user-id"]).toBe("trusted-user");
  });

  it("rejects an unauthenticated IAP WebSocket upgrade with a generated-response header", async () => {
    const instance = await createAuthVeil({
      upstream: { url: await upstream() },
      server: { port: 0 },
      auth: { mode: "mock" },
      mockUsers: [{ id: "admin", subject: "trusted-user" }],
      identityProxy: { type: "iap", audience: "/projects/1/global/backendServices/2" },
    });
    const address = await instance.listen();
    cleanups.push(() => instance.close());
    const base = address.url;
    const url = new URL(base);
    const rejected = await new Promise<{ status: number; generated: string | undefined }>(
      (resolve, reject) => {
        const socket = http.request({
          host: url.hostname,
          port: url.port,
          path: "/socket",
          headers: { connection: "Upgrade", upgrade: "websocket" },
        });
        socket.on("upgrade", () => reject(new Error("unexpected upgrade")));
        socket.on("response", (response) =>
          resolve({
            status: response.statusCode!,
            generated: response.headers["x-goog-iap-generated-response"] as string | undefined,
          }),
        );
        socket.on("error", reject);
        socket.end();
      },
    );
    expect(rejected).toEqual({ status: 401, generated: "true" });
  });

  it("streams SSE without changing its content type", async () => {
    const base = await mirror({ type: "none" });
    const login = await fetch(`${base}/_authveil/login?user=admin`, { redirect: "manual" }),
      cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(`${base}/events`, { headers: { cookie } });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const first = await response.body!.getReader().read();
    expect(new TextDecoder().decode(first.value)).toContain("data: first");
  });

  it("generates an ALB access token for mock identities", async () => {
    const base = await mirror({ type: "alb" });
    const login = await fetch(`${base}/_authveil/login?user=admin`, { redirect: "manual" }),
      cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toMatch(/^AWSELBAuthSessionCookie-0=/);
    const response = await fetch(`${base}/`, { headers: { cookie } });
    const seen = (await response.json()) as { headers: Record<string, string> };
    expect(seen.headers["x-amzn-oidc-accesstoken"]).toBeTruthy();
    expect(seen.headers["x-amzn-oidc-data"]).toBeTruthy();
  });

  it("emulates the IAP identity and login-cookie query modes", async () => {
    const base = await mirror({
      type: "iap",
      audience: "/projects/1/global/backendServices/2",
    });
    const unauthenticated = await fetch(`${base}/account?gcp-iap-mode=IDENTITY`, {
      redirect: "manual",
    });
    expect(unauthenticated.status).toBe(302);
    expect(unauthenticated.headers.get("x-goog-iap-generated-response")).toBe("true");

    const cookie = await loginCookie(base);
    const identity = await fetch(`${base}/account?gcp-iap-mode=IDENTITY`, {
      headers: { cookie },
    });
    expect(identity.headers.get("x-goog-iap-generated-response")).toBe("true");
    expect(await identity.json()).toEqual({
      email: "accounts.google.com:admin@example.test",
      sub: "accounts.google.com:trusted-user",
    });

    const cleared = await fetch(
      `${base}/account?keep=1&gcp-iap-mode=CLEAR_LOGIN_COOKIE&iap-secure-token-test-type=SIGNATURE`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(cleared.status).toBe(302);
    expect(cleared.headers.get("location")).toBe("/account?keep=1");
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(cleared.headers.get("x-goog-iap-generated-response")).toBe("true");
    expect(
      (
        await fetch(`${base}/account`, {
          headers: { cookie },
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
  });

  it("emulates every IAP secure-token verification scenario", async () => {
    const audience = "/projects/1/global/backendServices/2";
    const base = await mirror({ type: "iap", audience });
    const cookie = await loginCookie(base);
    const jwks = createLocalJWKSet(
      (await (await fetch(`${base}/_authveil/.well-known/jwks.json`)).json()) as never,
    );
    const token = async (type: string) => {
      const response = await fetch(
        `${base}/?gcp-iap-mode=SECURE_TOKEN_TEST&iap-secure-token-test-type=${type}`,
        { headers: { cookie } },
      );
      const seen = (await response.json()) as { headers: Record<string, string> };
      return seen.headers["x-goog-iap-jwt-assertion"]!;
    };

    await expect(
      jwtVerify(await token("NOT_SET"), jwks, {
        issuer: "https://cloud.google.com/iap",
        audience,
      }),
    ).resolves.toBeDefined();
    expect(decodeJwt(await token("FUTURE_ISSUE")).iat).toBeGreaterThan(Date.now() / 1000);
    expect(decodeJwt(await token("PAST_EXPIRATION")).exp).toBeLessThan(Date.now() / 1000);
    expect(decodeJwt(await token("ISSUER")).iss).not.toBe("https://cloud.google.com/iap");
    expect(decodeJwt(await token("AUDIENCE")).aud).not.toBe(audience);
    await expect(jwtVerify(await token("SIGNATURE"), jwks)).rejects.toThrow();
  });

  it("proxies authenticated WebSocket messages and replaces spoofed identity", async () => {
    const base = await mirror();
    const login = await fetch(`${base}/_authveil/login?user=admin`, { redirect: "manual" }),
      cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const socket = new WebSocket(base.replace("http", "ws"), {
      headers: { cookie, "x-user-id": "attacker" },
    });
    const headers = await new Promise<Record<string, string>>((resolve, reject) => {
      socket.once("message", (message) =>
        resolve(JSON.parse(message.toString()) as Record<string, string>),
      );
      socket.once("error", reject);
    });
    expect(headers["x-user-id"]).toBe("trusted-user");
    socket.send("hello");
    expect(
      await new Promise<string>((resolve) =>
        socket.once("message", (message) => resolve(message.toString())),
      ),
    ).toBe("hello");
    socket.close();
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  });

  it("returns 502 when upstream is unavailable", async () => {
    const instance = await createAuthVeil({
      upstream: { url: "http://127.0.0.1:1" },
      server: { port: 0 },
      auth: { mode: "mock", mockUser: "admin" },
      mockUsers: [{ id: "admin", subject: "trusted-user" }],
    });
    const address = await instance.listen();
    cleanups.push(() => instance.close());
    expect((await fetch(address.url)).status).toBe(502);
  });

  it("regenerates forwarding metadata and applies profile Host policies", async () => {
    const generic = await mirror({
      type: "generic",
      headers: { "X-User-Id": { claim: "sub" } },
    });
    const genericCookie = await loginCookie(generic);
    const genericSeen = JSON.parse(
      (
        await proxyRequest(generic, "/", {
          cookie: genericCookie,
          host: "public.example.test:4444",
          "x-forwarded-for": "attacker",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "443",
          forwarded: "for=attacker",
        })
      ).body,
    ) as { headers: Record<string, string> };
    expect(genericSeen.headers.host).toBe("public.example.test:4444");
    expect(genericSeen.headers["x-forwarded-host"]).toBe("public.example.test:4444");
    expect(genericSeen.headers["x-forwarded-proto"]).toBe("http");
    expect(genericSeen.headers["x-forwarded-port"]).toBe("4444");
    expect(genericSeen.headers["x-forwarded-for"]).not.toBe("attacker");
    expect(genericSeen.headers.forwarded).toBeUndefined();

    const iap = await mirror({
      type: "iap",
      audience: "/projects/1/global/backendServices/2",
      hostRewrite: "internal.example.test",
    });
    const iapCookie = await loginCookie(iap);
    const iapSeen = JSON.parse(
      (await proxyRequest(iap, "/", { cookie: iapCookie, host: "public.example.test:4444" })).body,
    ) as { headers: Record<string, string> };
    expect(iapSeen.headers.host).toBe("internal.example.test");

    const alb = await mirror({ type: "alb", preserveHostHeader: false });
    const albCookie = await loginCookie(alb);
    const albPort = new URL(alb).port;
    const albSeen = JSON.parse(
      (await proxyRequest(alb, "/", { cookie: albCookie, host: "public.example.test:4444" })).body,
    ) as { headers: Record<string, string> };
    expect(albSeen.headers.host).toBe(`public.example.test:${albPort}`);
    expect(albSeen.headers["x-forwarded-host"]).toBeUndefined();
    expect(albSeen.headers["x-forwarded-proto"]).toBe("http");
  });

  it("translates Entra request and response URL headers", async () => {
    const base = await mirror({
      type: "entra-app-proxy",
      translateUrlsInHeaders: true,
      headers: { "X-User-Id": { claim: "sub" } },
    });
    const cookie = await loginCookie(base);
    const response = await proxyRequest(base, "/translate", {
      cookie,
      host: "external.example.test:4444",
    });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://external.example.test:4444/after");
    expect(response.headers["content-location"]).toBe("http://external.example.test:4444/content");
    expect(response.headers["set-cookie"]?.join(";")).toContain("Domain=external.example.test");
  });
});
