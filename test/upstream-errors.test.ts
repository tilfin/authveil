import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthVeil } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startUpstream(): Promise<string> {
  const server = http.createServer((request, response) => {
    if (request.url === "/slow") return;
    response.end("fast");
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

async function startProxy(upstreamUrl: string, requestTimeout?: string | number): Promise<string> {
  const instance = await createAuthVeil({
    upstream: { url: upstreamUrl, ...(requestTimeout !== undefined ? { requestTimeout } : {}) },
    server: { port: 0 },
    auth: { mode: "mock", mockUser: "admin" },
    mockUsers: [{ id: "admin", subject: "trusted-user" }],
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return address.url;
}

describe("upstream errors", () => {
  it("returns 504 when the upstream does not respond within requestTimeout", async () => {
    const base = await startProxy(await startUpstream(), "200ms");
    const response = await fetch(`${base}/slow`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHVEIL_UPSTREAM_TIMEOUT" },
    });
  });

  it("does not time out responses that arrive within requestTimeout", async () => {
    const base = await startProxy(await startUpstream(), "1s");
    const response = await fetch(`${base}/fast`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("fast");
  });

  it("returns 502 with the unavailable error code when the upstream refuses connections", async () => {
    const base = await startProxy("http://127.0.0.1:1");
    const response = await fetch(`${base}/`, { headers: { accept: "application/json" } });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHVEIL_UPSTREAM_UNAVAILABLE" },
    });
  });
});
