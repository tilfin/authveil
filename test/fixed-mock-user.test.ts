import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthVeil } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startProxy(): Promise<string> {
  const upstream = http.createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => upstream.close(() => resolve())));
  const instance = await createAuthVeil({
    upstream: { url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}` },
    server: { port: 0 },
    auth: { mode: "mock", mockUser: "admin" },
    mockUsers: [{ id: "admin", subject: "local-admin-001", email: "admin@example.test" }],
    identityProxy: {
      type: "generic",
      headers: { "X-User-Id": { claim: "sub" }, "X-User-Email": { claim: "email" } },
    },
    logging: { level: "silent" },
  });
  const address = await instance.listen();
  cleanups.push(() => instance.close());
  return address.url;
}

describe("control routes with a fixed mock user", () => {
  it("returns the fixed identity from /me without a CSRF token", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/_authveil/me`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      identity: { subject: "local-admin-001", email: "admin@example.test" },
    });
    expect(body).not.toHaveProperty("csrfToken");
  });

  it("previews the headers generated for the fixed identity", async () => {
    const base = await startProxy();
    const response = await fetch(`${base}/_authveil/debug/headers`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      "x-user-id": "local-admin-001",
      "x-user-email": "admin@example.test",
    });
  });
});
