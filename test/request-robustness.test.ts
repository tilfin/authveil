import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createAuthVeil } from "../src/index.js";
import { parseCookies } from "../src/identity/session.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startUpstream(): Promise<{ url: string; webSocketPaths: string[] }> {
  const webSocketPaths: string[] = [];
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ url: request.url, headers: request.headers }));
  });
  const webSockets = new WebSocketServer({ server });
  webSockets.on("connection", (socket, request) => {
    webSocketPaths.push(request.url ?? "");
    socket.send("upstream");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, webSocketPaths };
}

async function startProxy(upstreamUrl: string, mockUser?: string): Promise<string> {
  const instance = await createAuthVeil({
    upstream: { url: upstreamUrl },
    server: { port: 0 },
    auth: { mode: "mock", ...(mockUser ? { mockUser } : {}) },
    mockUsers: [{ id: "admin", subject: "trusted-user" }],
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return address.url;
}

function openWebSocket(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status?: number; message?: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once("message", (message) => {
      resolve({ message: message.toString() });
      socket.close();
    });
    socket.once("unexpected-response", (_request, response) => {
      resolve({ status: response.statusCode });
      response.resume();
    });
    socket.once("error", reject);
  });
}

describe("request handling robustness", () => {
  it("ignores cookie values that are not valid percent-encoding", () => {
    expect(parseCookies("broken=%E0%A4%A; authveil_session=abc%20def")).toEqual({
      authveil_session: "abc def",
    });
  });

  it("returns 404 for a key ID that is not valid percent-encoding", async () => {
    const { url } = await startUpstream();
    const base = await startProxy(url);
    const response = await fetch(`${base}/_authveil/keys/%E0%A4%A`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(404);
  });

  it("answers control routes when an unrelated cookie is malformed", async () => {
    const { url } = await startUpstream();
    const base = await startProxy(url);
    const response = await fetch(`${base}/_authveil/me`, {
      headers: { cookie: "other=%E0%A4%A" },
      signal: AbortSignal.timeout(2_000),
    });
    expect(response.status).toBe(401);
  });

  it("proxies requests when an unrelated cookie is malformed", async () => {
    const { url } = await startUpstream();
    const base = await startProxy(url);
    const login = await fetch(`${base}/_authveil/login?user=admin`, { redirect: "manual" });
    const session = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(`${base}/hello`, {
      headers: { cookie: `other=%E0%A4%A; ${session}` },
    });
    expect(response.status).toBe(200);
  });

  it("rejects a WebSocket upgrade with a malformed cookie as unauthenticated", async () => {
    const { url } = await startUpstream();
    const base = await startProxy(url);
    expect(await openWebSocket(base.replace("http", "ws"), { cookie: "other=%E0%A4%A" })).toEqual({
      status: 401,
    });
  });

  it("does not forward WebSocket upgrades for control routes to the upstream", async () => {
    const upstream = await startUpstream();
    const base = await startProxy(upstream.url, "admin");
    expect(await openWebSocket(`${base.replace("http", "ws")}/_authveil/health`)).toEqual({
      status: 404,
    });
    expect(await openWebSocket(`${base.replace("http", "ws")}/socket`)).toEqual({
      message: "upstream",
    });
    expect(upstream.webSocketPaths).toEqual(["/socket"]);
  });
});
