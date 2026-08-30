import Fastify from "fastify";
import { pathToFileURL } from "node:url";

export function buildServer({ logger = true } = {}) {
  const app = Fastify({ logger });

  app.addHook("preHandler", async (request, reply) => {
    const id = request.headers["x-user-id"];
    const roles = request.headers["x-user-roles"];
    const department = request.headers["x-user-department"];

    if (typeof id !== "string") {
      return reply.code(401).send({ error: "Missing user ID" });
    }

    request.user = {
      id,
      roles: typeof roles === "string" && roles.length > 0 ? roles.split(";") : [],
      department: typeof department === "string" ? department : undefined,
    };
  });

  app.get("/", async (_, res) =>
    res.type("text/html").send('<body><a href="/user">User</a></body>'),
  );
  app.get("/user", async (request) => request.user);

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildServer().listen({ host: "127.0.0.1", port: 8083 });
}
