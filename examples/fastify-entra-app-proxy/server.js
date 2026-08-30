import Fastify from "fastify";
import { pathToFileURL } from "node:url";

export function buildServer({ logger = true } = {}) {
  const app = Fastify({ logger });

  app.addHook("preHandler", async (request, reply) => {
    const id = request.headers["x-remote-user-id"];
    const email = request.headers["x-remote-user-email"];
    const name = request.headers["x-remote-user-name"];
    const groups = request.headers["x-remote-user-groups"];

    if (typeof id !== "string") {
      return reply.code(401).send({ error: "Missing remote user ID" });
    }

    request.user = {
      id,
      email: typeof email === "string" ? email : undefined,
      name: typeof name === "string" ? name : undefined,
      groups: typeof groups === "string" && groups.length > 0 ? groups.split(",") : [],
    };
  });

  app.get("/", async (_, res) =>
    res.type("text/html").send('<body><a href="/user">User</a></body>'),
  );
  app.get("/user", async (request) => request.user);

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildServer().listen({ host: "127.0.0.1", port: 8082 });
}
