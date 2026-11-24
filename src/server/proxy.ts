import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { IdentityProxyAdapter, ResolvedConfig } from "../core/types.js";

const FORWARDING_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export interface ExternalOrigin {
  readonly host: string;
  readonly hostname: string;
  readonly port: string;
  readonly protocol: "http:" | "https:";
}

export function targetFor(config: ResolvedConfig): URL {
  return new URL(config.upstream.url);
}

function splitHost(host: string): { hostname: string; port: string } {
  try {
    const url = new URL(`http://${host}`);
    return { hostname: url.hostname, port: url.port };
  } catch {
    return { hostname: host, port: "" };
  }
}

export function externalOrigin(request: IncomingMessage): ExternalOrigin {
  const protocol = (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted
    ? "https:"
    : "http:";
  const host = request.headers.host ?? "localhost";
  const { hostname, port } = splitHost(host);
  return { host, hostname, port, protocol };
}

function hostForAlb(origin: ExternalOrigin, listenerPort: number): string {
  // URL.hostname already keeps the brackets around an IPv6 address.
  return listenerPort === 80 ? origin.hostname : `${origin.hostname}:${listenerPort}`;
}

function forwardedHeaders(request: IncomingMessage, origin: ExternalOrigin): IncomingHttpHeaders {
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  return {
    "x-forwarded-for": request.socket.remoteAddress ?? "",
    "x-forwarded-host": origin.host,
    "x-forwarded-proto": origin.protocol.slice(0, -1),
    "x-forwarded-port": port,
  };
}

function hostHeader(
  config: ResolvedConfig,
  target: URL,
  origin: ExternalOrigin,
  listenerPort: number,
): string {
  const profile = config.identityProxy;
  switch (profile.type) {
    case "alb":
      return profile.preserveHostHeader ? origin.host : hostForAlb(origin, listenerPort);
    case "iap":
      return profile.hostRewrite ?? origin.host;
    case "entra-app-proxy":
      return profile.translateUrlsInHeaders === false ? origin.host : target.host;
    case "generic":
    case "none":
      return profile.hostHeader === "upstream" ? target.host : origin.host;
  }
}

export function forwardHeaders(
  request: IncomingMessage,
  generated: Record<string, string>,
  target: URL,
  adapter: IdentityProxyAdapter,
  config: ResolvedConfig,
  listenerPort: number,
  origin = externalOrigin(request),
): IncomingHttpHeaders {
  const reserved = new Set(adapter.reservedHeaderNames().map((name) => name.toLowerCase()));
  const headers: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (
      !reserved.has(lowerName) &&
      !FORWARDING_HEADERS.has(lowerName) &&
      !["proxy-authorization", "proxy-authenticate"].includes(lowerName)
    ) {
      headers[name] = value;
    }
  }
  Object.assign(headers, generated);
  headers.host = hostHeader(config, target, origin, listenerPort);

  const forwarding = forwardedHeaders(request, origin);
  if (config.identityProxy.type === "alb") {
    headers["x-forwarded-for"] = forwarding["x-forwarded-for"];
    headers["x-forwarded-proto"] = forwarding["x-forwarded-proto"];
    // ALB reports the listener port, matching its Host normalization.
    headers["x-forwarded-port"] = String(listenerPort);
  } else {
    Object.assign(headers, forwarding);
  }
  return headers;
}

function replaceOrigin(value: string, internal: URL, external: ExternalOrigin): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.origin !== internal.origin) return value;
  url.protocol = external.protocol;
  url.host = external.host;
  return url.toString();
}

function translateSetCookie(value: string, internal: URL, external: ExternalOrigin): string {
  const internalHost = internal.hostname.replace(/^\./, "").toLowerCase();
  const externalHost = external.hostname.replace(/^\./, "");
  return value.replace(/(;\s*Domain=)([^;]+)/i, (whole, prefix: string, domain: string) => {
    const normalized = domain.trim().replace(/^\./, "").toLowerCase();
    return normalized === internalHost ? `${prefix}${externalHost}` : whole;
  });
}

/** Safely maps Entra Application Proxy internal response URLs to the client origin. */
export function translateEntraResponseHeaders(
  headers: IncomingHttpHeaders,
  target: URL,
  origin: ExternalOrigin,
): void {
  for (const name of ["location", "content-location"] as const) {
    const value = headers[name];
    if (typeof value === "string") headers[name] = replaceOrigin(value, target, origin);
  }
  const setCookie = headers["set-cookie"];
  if (Array.isArray(setCookie))
    headers["set-cookie"] = setCookie.map((value) => translateSetCookie(value, target, origin));
}
