import type { IncomingMessage, ServerResponse } from "node:http";
import { createIdentityProxyAdapter } from "../proxy/adapters.js";
import { identityFromMock } from "../identity/identity.js";
import type { KeyStore } from "../keys/key-store.js";
import type { OidcAuthenticator } from "../identity/oidc.js";
import { sessionCookie, type SessionRecord, type SessionStore } from "../identity/session.js";
import type { ProxyIdentity, ResolvedConfig } from "../core/types.js";
import { escapeHtml, html, json, safeEqual, safeReturnTo, sendError } from "./responses.js";
import { VERSION } from "../core/version.js";

export interface ControlRoutesDependencies {
  config: ResolvedConfig;
  keys: KeyStore;
  sessions: SessionStore;
  adapter: ReturnType<typeof createIdentityProxyAdapter>;
  oidc?: OidcAuthenticator;
  /** Identity injected for every request when auth.mockUser is configured. */
  fixedIdentity?: ProxyIdentity;
  oidcBase(): string;
  getSession(request: IncomingMessage): SessionRecord | undefined;
}

export class ControlRoutes {
  constructor(private readonly dependencies: ControlRoutesDependencies) {}

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    requestId: string,
  ): Promise<void> {
    const { adapter, config, fixedIdentity, getSession, keys, oidc, oidcBase, sessions } =
      this.dependencies;
    const path = url.pathname.slice(config.server.controlPrefix.length) || "/";
    if (request.method === "GET" && path === "/health")
      return json(response, 200, { status: "ok", version: VERSION });
    if (request.method === "GET" && path === "/ready")
      return json(response, 200, { status: "ready" });
    if (request.method === "GET" && path === "/.well-known/jwks.json") {
      response.setHeader("Cache-Control", "public, max-age=300");
      response.setHeader("ETag", await keys.etag());
      return json(response, 200, await keys.publicJwks());
    }
    if (request.method === "GET" && path.startsWith("/keys/")) {
      const keyId = decodePathSegment(path.slice(6));
      const pem = keyId === undefined ? undefined : await keys.publicPem(keyId);
      if (!pem)
        return sendError(
          request,
          response,
          404,
          "AUTHVEIL_KEY_INVALID",
          "Key not found.",
          requestId,
        );
      response.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Cache-Control": "public, max-age=300",
      });
      response.end(pem);
      return;
    }
    if (request.method === "GET" && path === "/login") return this.login(response, url);
    if (request.method === "GET" && path === "/callback" && oidc) {
      try {
        const result = await oidc.callback(new URL(request.url!, oidcBase()));
        const session = sessions.create(result.identity, result.accessToken);
        response.writeHead(302, {
          "Set-Cookie": this.cookie(session.id),
          Location: result.returnTo,
        });
        response.end();
      } catch {
        sendError(
          request,
          response,
          400,
          "AUTHVEIL_OIDC_CALLBACK_FAILED",
          "OIDC callback validation failed.",
          requestId,
        );
      }
      return;
    }

    const session = getSession(request);
    if (request.method === "GET" && path === "/me") {
      // The fixed identity has no session to log out of, so no CSRF token is returned.
      if (fixedIdentity) return json(response, 200, { identity: fixedIdentity });
      if (!session) return this.missingSession(request, response, requestId);
      return json(response, 200, { identity: session.identity, csrfToken: session.csrfToken });
    }
    if (request.method === "GET" && path === "/debug/headers" && config.auth.mode === "mock") {
      const identity = fixedIdentity ?? session?.identity;
      if (!identity) return this.missingSession(request, response, requestId);
      const headers = await adapter.createHeaders(identity, {
        now: new Date(),
        keyStore: keys,
        requestId,
      });
      return json(
        response,
        200,
        Object.fromEntries(
          Object.entries(headers).map(([name, value]) => [
            name,
            value.length > 24 ? `${value.slice(0, 12)}…[masked]` : value,
          ]),
        ),
      );
    }
    if (request.method === "POST" && path === "/logout") {
      if (!session) return this.missingSession(request, response, requestId);
      if (!safeEqual(String(request.headers["x-authveil-csrf"] ?? ""), session.csrfToken))
        return sendError(
          request,
          response,
          400,
          "AUTHVEIL_OIDC_STATE_INVALID",
          "CSRF token is invalid.",
          requestId,
        );
      sessions.delete(session.id);
      response.writeHead(204, { "Set-Cookie": this.cookie("", 0) });
      response.end();
      return;
    }
    sendError(request, response, 404, "AUTHVEIL_INTERNAL", "Control route not found.", requestId);
  }

  private missingSession(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
  ): void {
    sendError(
      request,
      response,
      401,
      "AUTHVEIL_SESSION_MISSING",
      "Authentication is required.",
      requestId,
    );
  }

  private async login(response: ServerResponse, url: URL): Promise<void> {
    const { config, oidc, sessions } = this.dependencies;
    const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
    if (config.auth.mockUser) {
      response.writeHead(302, { Location: returnTo });
      response.end();
      return;
    }
    if (config.auth.mode === "oidc") {
      response.writeHead(302, { Location: (await oidc!.authorizationUrl(returnTo)).toString() });
      response.end();
      return;
    }
    const userId = url.searchParams.get("user");
    if (userId) {
      const user = config.mockUsers.find((candidate) => candidate.id === userId);
      if (!user) {
        response.writeHead(400);
        response.end("Unknown mock user");
        return;
      }
      const session = sessions.create(identityFromMock(user));
      response.writeHead(302, { "Set-Cookie": this.cookie(session.id), Location: returnTo });
      response.end();
      return;
    }
    const links = config.mockUsers
      .map(
        (user) =>
          `<li><a href="${escapeHtml(config.server.controlPrefix)}/login?user=${encodeURIComponent(user.id)}&amp;returnTo=${encodeURIComponent(returnTo)}">${escapeHtml(user.name ?? user.email ?? user.id)}</a></li>`,
      )
      .join("");
    html(
      response,
      200,
      `<!doctype html><html><head><meta charset="utf-8"><title>AuthVeil login</title></head><body><main><h1>Choose a local user</h1><ul>${links}</ul><p>Development use only.</p></main></body></html>`,
    );
  }

  private cookie(id: string, maxAge = this.dependencies.config.auth.sessionTtl): string {
    const { auth } = this.dependencies.config;
    return sessionCookie(auth.cookie.name, id, { ...auth.cookie, maxAge });
  }
}

function decodePathSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
