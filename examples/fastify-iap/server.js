import Fastify from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pathToFileURL } from "node:url";

const namespace = "accounts.google.com:";
const defaultJwksUrl = "http://127.0.0.1:3081/_authveil/.well-known/jwks.json";
const audience = "/projects/123/global/backendServices/456";
const issuer = "https://cloud.google.com/iap";

export function buildServer({ logger = true } = {}) {
  const app = Fastify({ logger });
  const keys = createRemoteJWKSet(new URL(process.env.AUTHVEIL_JWKS_URL ?? defaultJwksUrl));

  app.addHook("preHandler", async (request, reply) => {
    const token = request.headers["x-goog-iap-jwt-assertion"];
    const userId = request.headers["x-goog-authenticated-user-id"];
    const email = request.headers["x-goog-authenticated-user-email"];

    if (typeof token !== "string" || typeof userId !== "string") {
      return reply.code(401).send({ error: "Missing IAP identity headers" });
    }

    try {
      const { payload } = await jwtVerify(token, keys, { algorithms: ["ES256"], audience, issuer });
      if (typeof payload.sub !== "string" || userId !== `${namespace}${payload.sub}`) {
        return reply.code(401).send({ error: "IAP identity headers do not match" });
      }

      request.user = {
        subject: payload.sub,
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        groups: Array.isArray(payload.groups)
          ? payload.groups.filter((group) => typeof group === "string")
          : [],
        claims: payload,
        ...(typeof email === "string" ? { headerEmail: email } : {}),
      };
    } catch {
      return reply.code(401).send({ error: "Invalid IAP identity token" });
    }
  });

  app.get("/", async (_, res) =>
    res.type("text/html").send('<body><a href="/user">User</a></body>'),
  );
  app.get("/user", async (request) => request.user);

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildServer().listen({ host: "127.0.0.1", port: 8081 });
}
