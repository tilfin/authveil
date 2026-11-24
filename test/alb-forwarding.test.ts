import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthVeil } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startEchoUpstream(): Promise<string> {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.headers));
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

async function startAlbProxy(preserveHostHeader = false): Promise<URL> {
  const instance = await createAuthVeil({
    upstream: { url: await startEchoUpstream() },
    server: { port: 0 },
    auth: { mode: "mock", mockUser: "admin" },
    mockUsers: [{ id: "admin", subject: "trusted-user" }],
    identityProxy: { type: "alb", preserveHostHeader },
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return new URL(address.url);
}

function upstreamHeaders(proxy: URL, host: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: proxy.hostname, port: proxy.port, path: "/", headers: { host } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string>),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("ALB forwarding headers", () => {
  it("normalizes an IPv6 Host to the listener port without doubling brackets", async () => {
    const proxy = await startAlbProxy();
    const headers = await upstreamHeaders(proxy, "[::1]:4444");
    expect(headers.host).toBe(`[::1]:${proxy.port}`);
  });

  it("reports the listener port in X-Forwarded-Port", async () => {
    const proxy = await startAlbProxy();
    const headers = await upstreamHeaders(proxy, "public.example.test:4444");
    expect(headers.host).toBe(`public.example.test:${proxy.port}`);
    expect(headers["x-forwarded-port"]).toBe(proxy.port);
  });

  it("keeps the listener port in X-Forwarded-Port when the Host is preserved", async () => {
    const proxy = await startAlbProxy(true);
    const headers = await upstreamHeaders(proxy, "public.example.test:4444");
    expect(headers.host).toBe("public.example.test:4444");
    expect(headers["x-forwarded-port"]).toBe(proxy.port);
  });
});
