import { describe, expect, it } from "vitest";
import { ConfigError, resolveConfig } from "../src/config/index.js";
import type { AuthVeilOptions } from "../src/index.js";

const upstream = { url: "http://localhost:8080" };

function rejects(options: unknown, message: string | RegExp): void {
  expect(() => resolveConfig(options as AuthVeilOptions)).toThrow(ConfigError);
  expect(() => resolveConfig(options as AuthVeilOptions)).toThrow(message);
}

describe("configuration validation", () => {
  it("reports a missing or non-mapping configuration as a ConfigError", () => {
    rejects(null, "Configuration must be a mapping");
    rejects([], "Configuration must be a mapping");
    rejects({}, "must have required property 'upstream'");
  });

  it("validates duration settings when the configuration is loaded", () => {
    rejects({ upstream, identityProxy: { type: "alb", tokenTtl: "5 minutes" } }, "tokenTtl");
    rejects(
      { upstream, identityProxy: { type: "iap", audience: "/a", tokenTtl: "0s" } },
      "tokenTtl",
    );
    rejects({ upstream, auth: { sessionTtl: 0 } }, "sessionTtl");
    rejects({ upstream: { ...upstream, requestTimeout: -1 } }, "requestTimeout");
    rejects({ upstream: { ...upstream, requestTimeout: "30" } }, "requestTimeout");

    const config = resolveConfig({
      upstream: { ...upstream, requestTimeout: 0 },
      auth: { sessionTtl: "1h" },
      identityProxy: { type: "alb", tokenTtl: 60_000 },
    });
    expect(config.upstream.requestTimeout).toBe(0);
    expect(config.auth.sessionTtl).toBe(3_600_000);
  });

  it("requires a Secure cookie for SameSite=None", () => {
    rejects({ upstream, auth: { cookie: { sameSite: "none" } } }, "requires auth.cookie.secure");
    expect(
      resolveConfig({ upstream, auth: { cookie: { sameSite: "none", secure: true } } }).auth.cookie,
    ).toMatchObject({ sameSite: "none", secure: true });
  });

  it("requires a control prefix with at least one path segment", () => {
    rejects({ upstream, server: { controlPrefix: "/" } }, "controlPrefix");
    rejects({ upstream, server: { controlPrefix: "//authveil" } }, "controlPrefix");
    rejects({ upstream, server: { controlPrefix: "/auth veil" } }, "controlPrefix");
    rejects({ upstream, server: { controlPrefix: "/authveil?x=1" } }, "controlPrefix");
    expect(
      resolveConfig({ upstream, server: { controlPrefix: "/_dev/auth/" } }).server,
    ).toMatchObject({ controlPrefix: "/_dev/auth" });
  });

  it("rejects mapped header names that are invalid or managed by AuthVeil", () => {
    rejects(
      { upstream, identityProxy: { type: "generic", headers: { "X User": { claim: "sub" } } } },
      "property name must be valid",
    );
    for (const name of ["Host", "X-Forwarded-For", "x-authveil-request-id", "Content-Length"])
      rejects(
        { upstream, identityProxy: { type: "generic", headers: { [name]: { claim: "sub" } } } },
        `identityProxy.headers.${name} is managed by AuthVeil`,
      );
    rejects(
      {
        upstream,
        identityProxy: { type: "entra-app-proxy", headers: { Host: { claim: "sub" } } },
      },
      "managed by AuthVeil",
    );
  });

  it("rejects duplicate mock user IDs", () => {
    rejects(
      {
        upstream,
        mockUsers: [
          { id: "admin", subject: "first" },
          { id: "admin", subject: "second" },
        ],
      },
      "mockUsers contains duplicate id admin",
    );
  });

  it("requires HTTP(S) URLs for the OIDC issuer and redirect URI", () => {
    const oidc = {
      issuer: "https://issuer.example.test",
      clientId: "client",
      redirectUri: "http://127.0.0.1:3080/_authveil/callback",
    };
    rejects(
      { upstream, auth: { mode: "oidc", oidc: { ...oidc, issuer: "issuer" } } },
      "auth.oidc.issuer",
    );
    rejects(
      { upstream, auth: { mode: "oidc", oidc: { ...oidc, redirectUri: "/_authveil/callback" } } },
      "auth.oidc.redirectUri",
    );
    rejects(
      { upstream, auth: { mode: "oidc", oidc: { ...oidc, redirectUri: "ftp://127.0.0.1/" } } },
      "auth.oidc.redirectUri must use http or https",
    );
  });
});
