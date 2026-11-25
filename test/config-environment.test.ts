import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/index.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "authveil-env-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function load(lines: string[], env: NodeJS.ProcessEnv = {}) {
  const path = join(directory, "authveil.config.yaml");
  await writeFile(path, lines.join("\n"));
  return loadConfig(path, env);
}

describe("environment references in configuration files", () => {
  it("inserts values literally without changing the YAML structure", async () => {
    const config = await load(
      [
        "upstream:",
        "  url: http://localhost:8080",
        "auth:",
        "  cookie:",
        "    name: ${COOKIE_NAME}",
        "mockUsers:",
        "  - id: admin",
        "    subject: ${SUBJECT}",
        "    name: ${DISPLAY_NAME}",
      ],
      {
        COOKIE_NAME: "session\nidentityProxy: {type: alb}",
        SUBJECT: "user: one #1",
        DISPLAY_NAME: "*not-an-alias",
      },
    );
    expect(config.auth.cookie.name).toBe("session\nidentityProxy: {type: alb}");
    expect(config.identityProxy).toEqual({ type: "none" });
    expect(config.mockUsers[0]).toMatchObject({ subject: "user: one #1", name: "*not-an-alias" });
  });

  it("ignores references inside comments", async () => {
    const config = await load([
      "# Set ${NOT_SET} before starting",
      "upstream:",
      "  url: http://localhost:8080",
    ]);
    expect(config.upstream.url).toBe("http://localhost:8080/");
  });

  it("expands several references inside one string", async () => {
    const config = await load(["upstream:", "  url: http://${HOST}:${PORT}/app"], {
      HOST: "app.internal",
      PORT: "9000",
    });
    expect(config.upstream.url).toBe("http://app.internal:9000/app");
  });

  it("keeps number typing for an unquoted value that is a single reference", async () => {
    const config = await load(
      [
        "server:",
        "  port: ${PORT}",
        "upstream:",
        "  url: http://localhost:8080",
        "  requestTimeout: ${TIMEOUT}",
      ],
      { PORT: "4080", TIMEOUT: "30s" },
    );
    expect(config.server.port).toBe(4080);
    expect(config.upstream.requestTimeout).toBe(30_000);
  });

  it("keeps quoted single references as strings", async () => {
    const config = await load(
      ["upstream:", "  url: http://localhost:8080", "auth:", "  cookie:", '    name: "${NAME}"'],
      { NAME: "12345" },
    );
    expect(config.auth.cookie.name).toBe("12345");
  });

  it("reports unset variables", async () => {
    await expect(load(["upstream:", "  url: ${UPSTREAM_URL}"])).rejects.toThrow(
      "Environment variable UPSTREAM_URL is not set",
    );
  });

  it("reports empty, non-mapping, and malformed files as configuration errors", async () => {
    await expect(load([""])).rejects.toThrow("Configuration must be a mapping");
    await expect(load(["- upstream"])).rejects.toThrow("Configuration must be a mapping");
    await expect(load(["upstream: [unclosed"])).rejects.toThrow(ConfigError);
  });
});
