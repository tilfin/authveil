import type { AddressInfo } from "node:net";
import http from "node:http";
import { createAuthVeil } from "./index.js";
import type { AuthVeilOptions, MockUser } from "./core/types.js";

export const testUsers: Record<"admin" | "viewer", MockUser> = {
  admin: {
    id: "admin",
    subject: "local-admin-001",
    email: "admin@example.com",
    name: "Local Admin",
    claims: { groups: ["administrators", "developers"] },
  },
  viewer: {
    id: "viewer",
    subject: "local-viewer-001",
    email: "viewer@example.com",
    name: "Local Viewer",
    claims: { groups: ["viewers"] },
  },
};

export async function startTestProxy(
  options: Partial<AuthVeilOptions> & Pick<AuthVeilOptions, "upstream">,
) {
  const mirror = await createAuthVeil({
    ...options,
    upstream: options.upstream,
    server: { ...options.server, port: 0 },
    auth: { mode: "mock", ...options.auth },
    mockUsers: options.mockUsers ?? Object.values(testUsers),
  });
  const address = await mirror.listen();
  return { mirror, address, close: () => mirror.close() };
}

export async function startEchoUpstream() {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
