import Fastify from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { pathToFileURL } from "node:url";

const defaultJwksUrl = "http://127.0.0.1:3080/_authveil/.well-known/jwks.json";
const expectedSigner =
  "arn:aws:elasticloadbalancing:local:000000000000:loadbalancer/app/authveil/local";
const expectedIssuer = "https://authveil.local";
const expectedClientId = "fastify-example";

export function buildServer({ logger = true } = {}) {
  const app = Fastify({ logger });
  const keys = createRemoteJWKSet(new URL(process.env.AUTHVEIL_JWKS_URL ?? defaultJwksUrl));

  app.addHook("preHandler", async (request, reply) => {
    const token = request.headers["x-amzn-oidc-data"];
    const headerSubject = request.headers["x-amzn-oidc-identity"];

    if (typeof token !== "string" || typeof headerSubject !== "string") {
      return reply.code(401).send({ error: "Missing ALB identity headers" });
    }

    try {
      const { payload, protectedHeader } = await jwtVerify(token, keys, { algorithms: ["ES256"] });
      if (
        protectedHeader.signer !== expectedSigner ||
        protectedHeader.iss !== expectedIssuer ||
        protectedHeader.client !== expectedClientId ||
        typeof protectedHeader.exp !== "number" ||
        protectedHeader.exp <= Date.now() / 1000
      ) {
        return reply.code(401).send({ error: "Invalid ALB identity token" });
      }

      if (typeof payload.sub !== "string" || payload.sub !== headerSubject) {
        return reply.code(401).send({ error: "ALB identity headers do not match" });
      }

      request.user = {
        subject: payload.sub,
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        groups: Array.isArray(payload.groups)
          ? payload.groups.filter((group) => typeof group === "string")
          : [],
        claims: payload,
      };
    } catch {
      return reply.code(401).send({ error: "Invalid ALB identity token" });
    }
  });

  app.get("/", async (_, res) =>
    res.type("text/html").send('<body><a href="/user">User</a></body>'),
  );
  app.get("/user", async (request) => request.user);

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildServer().listen({ host: "127.0.0.1", port: 8080 });
}
