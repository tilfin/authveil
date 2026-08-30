import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  duration,
  expandEnvironment,
  findConfig,
  loadConfig,
  resolveConfig,
} from "../src/config/index.js";
import { KeyStore } from "../src/keys/key-store.js";

describe("configuration", () => {
  it("parses durations and environment references", () => {
    expect(duration("5m", 0)).toBe(300_000);
    expect(expandEnvironment("https://${HOST}/", { HOST: "example.test" })).toBe(
      "https://example.test/",
    );
  });

  it("allows a remote bind in mock mode", () => {
    expect(
      resolveConfig({ upstream: { url: "http://localhost:8080" }, server: { host: "0.0.0.0" } })
        .server.host,
    ).toBe("0.0.0.0");
  });

  it("applies safe defaults", () => {
    const config = resolveConfig({ upstream: { url: "http://localhost:8080" } });
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.auth.mode).toBe("mock");
    expect(config.auth.cookie.name).toBe("authveil_session");
    expect(config.identityProxy).toEqual({ type: "none" });
  });

  it("uses the ALB authentication session cookie name by default", () => {
    const config = resolveConfig({
      upstream: { url: "http://localhost:8080" },
      identityProxy: { type: "alb" },
    });
    expect(config.auth.cookie.name).toBe("AWSELBAuthSessionCookie-0");
  });

  it("uses identityProxy configuration and rejects removed output settings", () => {
    expect(
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        identityProxy: { type: "generic", hostHeader: "upstream", headers: {} },
      }).identityProxy,
    ).toEqual({ type: "generic", hostHeader: "upstream", headers: {} });

    expect(() =>
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        output: { type: "none" },
      } as never),
    ).toThrow("output has been renamed to identityProxy");
    expect(() =>
      resolveConfig({
        upstream: { url: "http://localhost:8080", changeOrigin: true },
      } as never),
    ).toThrow("upstream.changeOrigin has been removed");
  });

  it("supports a fixed mock identity and rejects invalid mock-only settings", () => {
    const config = resolveConfig({
      upstream: { url: "http://localhost:8080" },
      auth: { mode: "mock", mockUser: "admin" },
      mockUsers: [{ id: "admin", subject: "local-admin" }],
    });
    expect(config.auth.mockUser).toBe("admin");
    expect(config.mockUsers).toHaveLength(1);

    expect(() =>
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        auth: { mode: "mock", mockUser: "missing" },
        mockUsers: [{ id: "admin", subject: "local-admin" }],
      }),
    ).toThrow("auth.mockUser must reference an entry in mockUsers");
    expect(() =>
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        auth: {
          mode: "oidc",
          oidc: {
            issuer: "https://issuer.example.test",
            clientId: "client",
            redirectUri: "http://127.0.0.1:3080/_authveil/callback",
          },
        },
        mockUsers: [{ id: "admin", subject: "local-admin" }],
      }),
    ).toThrow("mockUsers are only supported in mock mode");
  });

  it("accepts groups as a claim, not as a reserved mock-user field", () => {
    expect(
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        mockUsers: [{ id: "admin", subject: "local-admin", claims: { groups: ["admin"] } }],
      }).mockUsers[0]?.claims,
    ).toEqual({ groups: ["admin"] });

    expect(() =>
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        mockUsers: [{ id: "admin", subject: "local-admin", groups: ["admin"] }],
      } as never),
    ).toThrow(ConfigError);
  });

  it("does not allow WebSocket proxying to be disabled", () => {
    expect(() =>
      resolveConfig({ upstream: { url: "http://localhost:8080", websocket: false } } as never),
    ).toThrow(ConfigError);
  });

  it("rejects simultaneous inline and file signing keys", () => {
    expect(() =>
      resolveConfig({
        upstream: { url: "http://localhost:8080" },
        keys: { privateKey: "inline-key", privateKeyFile: "private-key.pem" },
      }),
    ).toThrow("keys.privateKey and keys.privateKeyFile cannot be used together");
  });

  it("resolves privateKeyFile relative to its configuration and persists generated keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "authveil-config-"));
    try {
      const configPath = join(directory, "authveil.config.yaml");
      await writeFile(
        configPath,
        "upstream:\n  url: http://localhost:8080\nkeys:\n  privateKeyFile: keys/private-key.pem\n",
      );
      const config = await loadConfig(configPath);
      const keyPath = join(directory, "keys", "private-key.pem");
      expect(config.keys.privateKeyFile).toBe(keyPath);

      const first = await KeyStore.create(config.keys);
      if (process.platform !== "win32") {
        expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
      }
      expect(await readFile(keyPath, "utf8")).toContain("BEGIN PRIVATE KEY");
      const second = await KeyStore.create(config.keys);
      expect(await second.publicJwks()).toEqual(await first.publicJwks());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("only overrides host, port, and upstream from AUTHVEIL environment variables", async () => {
    const directory = await mkdtemp(join(tmpdir(), "authveil-config-"));
    try {
      const configPath = join(directory, "authveil.config.yaml");
      await writeFile(
        configPath,
        [
          "server:",
          "  host: 127.0.0.1",
          "  port: 3080",
          "upstream:",
          "  url: http://localhost:8080",
          "auth:",
          "  mode: mock",
          "identityProxy:",
          "  type: none",
          "logging:",
          "  level: info",
          "",
        ].join("\n"),
      );
      const config = await loadConfig(configPath, {
        AUTHVEIL_HOST: "localhost",
        AUTHVEIL_PORT: "4080",
        AUTHVEIL_UPSTREAM: "http://localhost:9090",
        AUTHVEIL_MODE: "oidc",
        AUTHVEIL_IDENTITY_PROXY: "alb",
        AUTHVEIL_LOG_LEVEL: "silent",
        AUTHVEIL_OUTPUT: "alb",
      });

      expect(config.server.host).toBe("localhost");
      expect(config.server.port).toBe(4080);
      expect(config.upstream.url).toBe("http://localhost:9090/");
      expect(config.auth.mode).toBe("mock");
      expect(config.identityProxy).toEqual({ type: "none" });
      expect(config.logging.level).toBe("info");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects the configuration file with AUTHVEIL_CONFIG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "authveil-config-"));
    try {
      expect(await findConfig(undefined, { AUTHVEIL_CONFIG: "developer.yaml" }, directory)).toBe(
        join(directory, "developer.yaml"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
