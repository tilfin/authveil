import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_KEY_PATH, runCli, USAGE, type CliEnvironment } from "../src/cli/commands.js";
import { VERSION } from "../src/core/version.js";

let directory: string;
let output: string[];
let environment: CliEnvironment;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "authveil-cli-"));
  output = [];
  environment = { cwd: directory, env: {}, print: (text) => output.push(text) };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeConfig(name: string, lines: string[]): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, lines.join("\n"));
  return path;
}

const baseConfig = [
  "server:",
  "  port: 0",
  "upstream:",
  "  url: http://127.0.0.1:8080",
  "mockUsers:",
  "  - id: admin",
  "    subject: local-admin-001",
  "    name: Local Admin",
  "  - id: viewer",
  "    subject: local-viewer-001",
  "logging:",
  "  level: silent",
];

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("CLI", () => {
  it("prints the version and help", async () => {
    await runCli(["version"], environment);
    await runCli(["--help"], environment);
    expect(output).toEqual([VERSION, USAGE]);
  });

  it("rejects unknown commands and options without values", async () => {
    await expect(runCli(["deploy"], environment)).rejects.toThrow("Unknown command: deploy");
    await expect(runCli(["keys", "rotate"], environment)).rejects.toThrow(
      "Unknown command: keys rotate",
    );
    await expect(runCli(["validate", "--config"], environment)).rejects.toThrow(
      "--config requires a value",
    );
  });

  it("reports a missing configuration file", async () => {
    await expect(runCli(["validate"], environment)).rejects.toThrow("No configuration found");
  });

  it("validates a configuration found in the working directory", async () => {
    const path = await writeConfig("authveil.config.yaml", baseConfig);
    await runCli(["validate"], environment);
    expect(output).toEqual([`${path}: valid`]);
  });

  it("validates without creating a missing private key file", async () => {
    const path = await writeConfig("authveil.config.yaml", [
      ...baseConfig,
      "keys:",
      "  privateKeyFile: keys/private-key.pem",
    ]);
    await runCli(["validate"], environment);
    expect(output.at(-1)).toBe(`${path}: valid`);
    expect(await exists(join(directory, "keys", "private-key.pem"))).toBe(false);
  });

  it("reports an invalid private key during validation", async () => {
    await writeFile(join(directory, "broken.pem"), "not a key");
    await writeConfig("authveil.config.yaml", [
      ...baseConfig,
      "keys:",
      "  privateKeyFile: broken.pem",
    ]);
    await expect(runCli(["validate"], environment)).rejects.toThrow();
  });

  it("lists mock users from an explicit configuration path", async () => {
    await writeConfig("custom.yaml", baseConfig);
    await runCli(["users", "--config", "custom.yaml"], environment);
    expect(output).toEqual(["admin\tlocal-admin-001\tLocal Admin", "viewer\tlocal-viewer-001\t"]);
  });

  it("generates a key at the documented default path and refuses to overwrite it", async () => {
    await runCli(["keys", "generate"], environment);
    const path = join(directory, DEFAULT_KEY_PATH);
    expect(output).toEqual([`Created ${path}`]);
    const first = await readFile(path, "utf8");
    expect(first).toContain("BEGIN PRIVATE KEY");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);

    await expect(runCli(["keys", "generate"], environment)).rejects.toThrow("--force");
    await runCli(["keys", "generate", "--force"], environment);
    expect(await readFile(path, "utf8")).not.toBe(first);
  });

  it("shows the public JWKS of the configured key", async () => {
    await runCli(["keys", "generate", "--out", "keys/key.pem"], environment);
    await writeConfig("authveil.config.yaml", [
      ...baseConfig,
      "keys:",
      "  privateKeyFile: keys/key.pem",
    ]);
    output = [];
    await runCli(["keys", "show"], environment);
    const first = JSON.parse(output[0]!) as { keys: Array<Record<string, string>> };
    expect(first.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(first.keys[0]).not.toHaveProperty("d");

    await runCli(["keys", "show"], environment);
    expect(output[1]).toBe(output[0]);
  });

  it("starts when no command is given, including when options come first", async () => {
    await writeConfig("custom.yaml", baseConfig);
    for (const args of [
      ["--config", "custom.yaml"],
      ["start", "--config", "custom.yaml"],
    ]) {
      output = [];
      const authveil = await runCli(args, environment);
      try {
        const address = authveil!.address()!;
        expect(output[0]).toContain(`Proxy:          ${address.url}`);
        expect(output[0]).toContain("Development use only.");
        expect((await fetch(`${address.url}/_authveil/health`)).status).toBe(200);
      } finally {
        await authveil?.close();
      }
    }
  });
});
