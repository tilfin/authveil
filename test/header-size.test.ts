import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createAuthVeil } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startProxy(
  groupCount: number,
): Promise<{ base: string; upstreamRequests: () => number }> {
  let requests = 0;
  const upstream = http.createServer((_request, response) => {
    requests++;
    response.end("ok");
  });
  upstream.on("upgrade", (_request, socket) => {
    requests++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      }),
  );
  const groups = Array.from(
    { length: groupCount },
    (_, index) => `group-${String(index).padStart(4, "0")}`,
  );
  const instance = await createAuthVeil({
    upstream: { url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` },
    server: { port: 0 },
    auth: { mode: "mock", mockUser: "admin" },
    mockUsers: [{ id: "admin", subject: "local-admin-001", claims: { groups } }],
    identityProxy: { type: "alb" },
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return { base: address.url, upstreamRequests: () => requests };
}

describe("generated header size limit", () => {
  it("rejects requests whose generated identity headers exceed the HTTP header limit", async () => {
    const { base, upstreamRequests } = await startProxy(2_000);
    const response = await fetch(`${base}/`, { headers: { accept: "application/json" } });
    expect(response.status).toBe(431);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTHVEIL_HEADER_TOO_LARGE" },
    });
    expect(upstreamRequests()).toBe(0);
  });

  it("rejects WebSocket upgrades whose generated identity headers are too large", async () => {
    const { base, upstreamRequests } = await startProxy(2_000);
    const status = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(base.replace("http", "ws"));
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode!));
      socket.once("error", reject);
    });
    expect(status).toBe(431);
    expect(upstreamRequests()).toBe(0);
  });

  it("forwards requests with ordinary claims", async () => {
    const { base } = await startProxy(20);
    expect((await fetch(`${base}/`)).status).toBe(200);
  });
});
