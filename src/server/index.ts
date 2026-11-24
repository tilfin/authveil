import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createProxyServer } from "httpxy";
import pino, { type Logger } from "pino";
import { createIdentityProxyAdapter } from "../proxy/adapters.js";
import { KeyStore } from "../keys/key-store.js";
import { OidcAuthenticator } from "../identity/oidc.js";
import { parseCookies, sessionCookie, SessionStore } from "../identity/session.js";
import { ControlRoutes } from "./control-routes.js";
import {
  externalOrigin,
  forwardHeaders,
  targetFor,
  translateEntraResponseHeaders,
  type ExternalOrigin,
} from "./proxy.js";
import { json, relativeUrl, sendError } from "./responses.js";
import type {
  AuthVeil,
  BoundAddress,
  ListenOptions,
  IdentityProxyAdapter,
  IapSecureTokenTestType,
  ProxyIdentity,
  ResolvedConfig,
} from "../core/types.js";
import { identityFromMock } from "../identity/identity.js";

export class AuthVeilServer implements AuthVeil {
  readonly #server: http.Server;
  readonly #proxyEngine = createProxyServer();
  readonly #logger: Logger;
  readonly #sessions: SessionStore;
  readonly #adapter: IdentityProxyAdapter;
  readonly #externalOrigins = new WeakMap<IncomingMessage, ExternalOrigin>();
  readonly #fixedMockIdentity?: ProxyIdentity;
  #control: ControlRoutes;
  #oidc?: OidcAuthenticator;
  #bound?: BoundAddress;
  #closing?: Promise<void>;

  private constructor(
    private readonly config: ResolvedConfig,
    private readonly keys: KeyStore,
  ) {
    this.#logger = pino({
      level: config.logging.level,
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "accessToken",
          "refreshToken",
          "clientSecret",
          "privateKey",
        ],
        censor: "[REDACTED]",
      },
    });
    this.#sessions = new SessionStore(config.auth.sessionTtl);
    this.#adapter = createIdentityProxyAdapter(config.identityProxy);
    const fixedMockUser = config.auth.mockUser
      ? config.mockUsers.find((user) => user.id === config.auth.mockUser)
      : undefined;
    this.#fixedMockIdentity = fixedMockUser ? identityFromMock(fixedMockUser) : undefined;
    this.#control = new ControlRoutes({
      config,
      keys,
      sessions: this.#sessions,
      adapter: this.#adapter,
      getSession: (request) => this.#session(request),
      oidcBase: () => this.#oidcBase(),
    });

    this.#server = http.createServer((request, response) => {
      void this.#handle(request, response);
    });
    this.#server.on("upgrade", (request, socket, head) => {
      void this.#upgrade(request, socket, head);
    });
    this.#server.on("clientError", (_error, socket) =>
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"),
    );
    this.#proxyEngine.on("proxyRes", (proxyResponse, request) => {
      const origin = this.#externalOrigins.get(request);
      if (this.config.identityProxy.type === "entra-app-proxy" && origin) {
        if (this.config.identityProxy.translateUrlsInHeaders !== false)
          translateEntraResponseHeaders(proxyResponse.headers, targetFor(this.config), origin);
      }
      this.#externalOrigins.delete(request);
    });
  }

  static async create(config: ResolvedConfig): Promise<AuthVeilServer> {
    const server = new AuthVeilServer(config, await KeyStore.create(config.keys));
    if (config.auth.mode === "oidc") {
      server.#oidc = await OidcAuthenticator.create(config.auth.oidc!);
      server.#control = new ControlRoutes({
        config,
        keys: server.keys,
        sessions: server.#sessions,
        adapter: server.#adapter,
        oidc: server.#oidc,
        getSession: (request) => server.#session(request),
        oidcBase: () => server.#oidcBase(),
      });
    }
    return server;
  }

  address(): BoundAddress | undefined {
    return this.#bound;
  }

  async listen(options: ListenOptions = {}): Promise<BoundAddress> {
    if (this.#bound || this.#server.listening) throw new Error("AuthVeil is already listening");
    const host = options.host ?? this.config.server.host,
      port = options.port ?? this.config.server.port;
    if (this.config.auth.mode === "oidc" && !["127.0.0.1", "::1", "localhost"].includes(host)) {
      throw new Error("Remote OIDC bind requires HTTPS, which is not configured");
    }

    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(port, host, () => {
        this.#server.off("error", reject);
        resolve();
      });
    });

    const address = this.#server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to determine bound address");
    }

    this.#bound = {
      host,
      port: address.port,
      url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`,
    };
    return this.#bound;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closing = new Promise((resolve, reject) => {
      this.#sessions.clear();
      this.#bound = undefined;
      if (!this.#server.listening) {
        resolve();
        return;
      }
      this.#server.close((error) => (error ? reject(error) : resolve()));
      this.#server.closeIdleConnections();
    });
    return this.#closing;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader("X-AuthVeil-Request-Id", requestId);
    response.once("finish", () =>
      this.#logger.info(
        {
          requestId,
          method: request.method,
          path: request.url?.split("?", 1)[0],
          statusCode: response.statusCode,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
          mode: this.config.auth.mode,
          identityProxy: this.config.identityProxy.type,
        },
        "request completed",
      ),
    );

    try {
      const url = new URL(request.url ?? "/", "http://authveil.local");
      if (this.#isControlPath(url)) {
        await this.#control.handle(request, response, url, requestId);
        return;
      }

      if (
        this.config.identityProxy.type === "iap" &&
        url.searchParams.get("gcp-iap-mode") === "CLEAR_LOGIN_COOKIE"
      ) {
        return this.#clearIapLogin(request, response, url);
      }

      const session = this.#session(request);
      const identity = this.#fixedMockIdentity ?? session?.identity;
      if (!identity) {
        response.writeHead(302, {
          Location: `${this.config.server.controlPrefix}/login?returnTo=${encodeURIComponent(relativeUrl(url))}`,
          ...(this.config.identityProxy.type === "iap"
            ? { "X-Goog-IAP-Generated-Response": "true" }
            : {}),
        });
        response.end();
        return;
      }

      if (
        this.config.identityProxy.type === "iap" &&
        url.searchParams.get("gcp-iap-mode") === "IDENTITY"
      ) {
        const namespace = this.config.identityProxy.identityNamespace ?? "accounts.google.com";
        response.setHeader("X-Goog-IAP-Generated-Response", "true");
        return json(response, 200, {
          ...(identity.email ? { email: `${namespace}:${identity.email}` } : {}),
          sub: `${namespace}:${identity.subject}`,
        });
      }

      const secureTokenTestType = this.#iapSecureTokenTestType(url);

      const generated = await this.#identityHeaders(
        identity,
        session?.accessToken?.reveal(),
        requestId,
        secureTokenTestType,
      );
      await this.#proxy(request, response, { ...generated, "x-authveil-request-id": requestId });
    } catch (error) {
      this.#logger.error(
        { requestId, error: error instanceof Error ? error.message : "unknown" },
        "request failed",
      );
      if (!response.headersSent) {
        sendError(
          request,
          response,
          500,
          "AUTHVEIL_INTERNAL",
          "An internal error occurred.",
          requestId,
        );
      } else {
        response.destroy();
      }
    }
  }

  async #identityHeaders(
    identity: Parameters<IdentityProxyAdapter["createHeaders"]>[0] | undefined,
    accessToken: string | undefined,
    requestId: string,
    iapSecureTokenTestType?: IapSecureTokenTestType,
  ): Promise<Record<string, string>> {
    const headers = identity
      ? await this.#adapter.createHeaders(identity, {
          now: new Date(),
          keyStore: this.keys,
          requestId,
          ...(iapSecureTokenTestType ? { iapSecureTokenTestType } : {}),
        })
      : {};
    if (this.config.identityProxy.type === "alb" && accessToken) {
      (headers as Record<string, string>)["x-amzn-oidc-accesstoken"] = accessToken;
    }
    return { ...headers };
  }

  #iapSecureTokenTestType(url: URL): IapSecureTokenTestType | undefined {
    if (
      this.config.identityProxy.type !== "iap" ||
      url.searchParams.get("gcp-iap-mode") !== "SECURE_TOKEN_TEST"
    )
      return undefined;
    const type = url.searchParams.get("iap-secure-token-test-type");
    return [
      "NOT_SET",
      "FUTURE_ISSUE",
      "PAST_EXPIRATION",
      "ISSUER",
      "AUDIENCE",
      "SIGNATURE",
    ].includes(type ?? "")
      ? (type as IapSecureTokenTestType)
      : undefined;
  }

  #clearIapLogin(request: IncomingMessage, response: ServerResponse, url: URL): void {
    const sessionId = parseCookies(request.headers.cookie)[this.config.auth.cookie.name];
    if (sessionId) this.#sessions.delete(sessionId);
    url.searchParams.delete("gcp-iap-mode");
    url.searchParams.delete("iap-secure-token-test-type");
    response.writeHead(302, {
      "Set-Cookie": sessionCookie(this.config.auth.cookie.name, "", {
        ...this.config.auth.cookie,
        maxAge: 0,
      }),
      Location: relativeUrl(url),
      "X-Goog-IAP-Generated-Response": "true",
    });
    response.end();
  }

  async #proxy(
    request: IncomingMessage,
    response: ServerResponse,
    generated: Record<string, string>,
  ): Promise<void> {
    const target = targetFor(this.config);
    const origin = externalOrigin(request);
    this.#externalOrigins.set(request, origin);
    response.once("close", () => this.#externalOrigins.delete(request));
    request.headers = forwardHeaders(
      request,
      generated,
      target,
      this.#adapter,
      this.config,
      this.#bound?.port ?? this.config.server.port,
      origin,
    );
    try {
      await this.#proxyEngine.web(request, response, {
        target,
        changeOrigin: false,
        proxyTimeout: this.config.upstream.requestTimeout || undefined,
      });
    } catch (error) {
      const timedOut = ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      );
      if (!response.headersSent) {
        sendError(
          request,
          response,
          timedOut ? 504 : 502,
          timedOut ? "AUTHVEIL_UPSTREAM_TIMEOUT" : "AUTHVEIL_UPSTREAM_UNAVAILABLE",
          timedOut
            ? "The upstream application timed out."
            : "The upstream application is unavailable.",
          generated["x-authveil-request-id"]!,
        );
      } else {
        response.destroy();
      }
    }
  }

  async #upgrade(
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      if (this.#isControlPath(new URL(request.url ?? "/", "http://authveil.local"))) {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }

      const session = this.#session(request);
      const identity = this.#fixedMockIdentity ?? session?.identity;
      if (!identity) {
        socket.end(
          `HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nX-AuthVeil-Login: ${this.config.server.controlPrefix}/login\r\n${this.config.identityProxy.type === "iap" ? "X-Goog-IAP-Generated-Response: true\r\n" : ""}Content-Length: 0\r\n\r\n`,
        );
        return;
      }

      const requestId = randomUUID();
      const generated = await this.#identityHeaders(
        identity,
        session?.accessToken?.reveal(),
        requestId,
      );
      const target = targetFor(this.config);
      request.headers = forwardHeaders(
        request,
        { ...generated, "x-authveil-request-id": requestId },
        target,
        this.#adapter,
        this.config,
        this.#bound?.port ?? this.config.server.port,
      );

      await this.#proxyEngine.ws(
        request,
        socket as unknown as import("node:net").Socket,
        { target, changeOrigin: false, ws: true },
        head,
      );
    } catch {
      socket.end("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
    }
  }

  #isControlPath(url: URL): boolean {
    const prefix = this.config.server.controlPrefix;
    return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  }

  #session(request: IncomingMessage) {
    return this.#sessions.get(parseCookies(request.headers.cookie)[this.config.auth.cookie.name]);
  }

  #oidcBase(): string {
    return (
      this.config.auth.oidc?.redirectUri ??
      this.#bound?.url ??
      `http://${this.config.server.host}:${this.config.server.port}`
    );
  }
}
