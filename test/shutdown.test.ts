import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createAuthVeil } from "../src/index.js";
import type { AuthVeil } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Upstream whose SSE stream and WebSockets stay open until the client goes away. */
async function startUpstream(): Promise<string> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: open\n\n");
  });
  new WebSocketServer({ server }).on("connection", (socket) => socket.send("open"));
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

async function startProxy(): Promise<{ instance: AuthVeil; url: string }> {
  const instance = await createAuthVeil({
    upstream: { url: await startUpstream() },
    server: { port: 0 },
    auth: { mode: "mock", mockUser: "admin" },
    mockUsers: [{ id: "admin", subject: "trusted-user" }],
    logging: { level: "silent" },
  });
  const { url } = await instance.listen();
  cleanups.push(() => instance.close());
  return { instance, url };
}

function closesWithin(instance: AuthVeil, milliseconds: number): Promise<boolean> {
  return Promise.race([
    instance.close().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
}

describe("graceful shutdown", () => {
  it("closes once an open SSE stream outlives the grace period", { timeout: 10_000 }, async () => {
    const { instance, url } = await startProxy();
    const response = await fetch(`${url}/events`);
    const reader = response.body!.getReader();
    await reader.read();

    expect(await closesWithin(instance, 5_000)).toBe(true);
    await expect(reader.read()).rejects.toThrow();
    expect(instance.address()).toBeUndefined();
  });

  it("closes once an open WebSocket outlives the grace period", { timeout: 10_000 }, async () => {
    const { instance, url } = await startProxy();
    const socket = new WebSocket(url.replace("http", "ws"));
    await new Promise((resolve) => socket.once("message", resolve));
    const socketClosed = new Promise((resolve) => socket.once("close", resolve));

    expect(await closesWithin(instance, 5_000)).toBe(true);
    await socketClosed;
  });

  it("closes immediately when no connection is active", async () => {
    const { instance } = await startProxy();
    expect(await closesWithin(instance, 500)).toBe(true);
  });
});
