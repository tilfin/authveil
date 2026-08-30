import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function html(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  requestId: string,
): void {
  const wantsJson =
    request.headers.accept?.includes("application/json") || request.url?.startsWith("/api/");
  if (wantsJson) json(response, status, { error: { code, message, requestId } });
  else
    html(
      response,
      status,
      `<!doctype html><html><body><h1>${status}</h1><p>${escapeHtml(message)}</p><small>${escapeHtml(requestId)}</small></body></html>`,
    );
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
