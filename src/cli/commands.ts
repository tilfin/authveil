import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportPKCS8, generateKeyPair } from "jose";
import { findConfig, loadConfig } from "../config/index.js";
import { VERSION } from "../core/version.js";
import type { AuthVeil, ResolvedConfig } from "../core/types.js";
import { createAuthVeil } from "../index.js";
import { KeyStore } from "../keys/key-store.js";

/** Default output of `keys generate`, matching the documented privateKeyFile. */
export const DEFAULT_KEY_PATH = ".authveil/private-key.pem";

export const USAGE = `Usage: authveil [command] [options]

Commands:
  start [--config PATH]                 Start the proxy (default)
  validate [--config PATH]              Validate the configuration and signing key
  users [--config PATH]                 List mock users
  keys generate [--out PATH] [--force]  Write a new ES256 private key (default: ${DEFAULT_KEY_PATH})
  keys show [--config PATH]             Print the public JWKS
  version                               Print the version
  help                                  Print this help`;

export interface CliEnvironment {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  print(text: string): void;
}

const processEnvironment: CliEnvironment = {
  cwd: process.cwd(),
  env: process.env,
  print: (text) => console.log(text),
};

/**
 * Runs one CLI command. `start` resolves with the listening instance so the
 * caller decides how to handle process signals; other commands resolve with
 * `undefined` once their output is printed.
 */
export async function runCli(
  args: readonly string[],
  environment: CliEnvironment = processEnvironment,
): Promise<AuthVeil | undefined> {
  const command = args[0] === undefined || isStartOption(args[0]) ? "start" : args[0];
  const options = new CliOptions(args);

  if (["version", "--version", "-v"].includes(command)) {
    environment.print(VERSION);
    return undefined;
  }
  if (["help", "--help", "-h"].includes(command)) {
    environment.print(USAGE);
    return undefined;
  }
  if (command === "validate") {
    const { path, config } = await configuration(options, environment);
    await KeyStore.create(await keysForValidation(config.keys, environment));
    environment.print(`${path}: valid`);
    return undefined;
  }
  if (command === "users") {
    const { config } = await configuration(options, environment);
    for (const user of config.mockUsers)
      environment.print(`${user.id}\t${user.subject}\t${user.name ?? ""}`);
    return undefined;
  }
  if (command === "keys" && args[1] === "generate") {
    await generateKey(
      resolve(environment.cwd, options.value("--out") ?? DEFAULT_KEY_PATH),
      options.has("--force"),
      environment,
    );
    return undefined;
  }
  if (command === "keys" && args[1] === "show") {
    const { config } = await configuration(options, environment);
    const keys = await KeyStore.create(config.keys);
    environment.print(JSON.stringify(await keys.publicJwks(), null, 2));
    return undefined;
  }
  if (command !== "start") throw new Error(`Unknown command: ${args.join(" ")}\n\n${USAGE}`);

  const { config } = await configuration(options, environment);
  const authveil = await createAuthVeil(config);
  const address = await authveil.listen();
  environment.print(
    [
      `AuthVeil v${VERSION}`,
      `Proxy:          ${address.url}`,
      `Upstream:       ${config.upstream.url}`,
      `Mode:           ${config.auth.mode}`,
      `Identity proxy: ${config.identityProxy.type}`,
      `Login:          ${address.url}${config.server.controlPrefix}/login`,
      `JWKS:           ${address.url}${config.server.controlPrefix}/.well-known/jwks.json`,
      "Development use only.",
    ].join("\n"),
  );
  return authveil;
}

class CliOptions {
  constructor(private readonly args: readonly string[]) {}

  has(name: string): boolean {
    return this.args.includes(name);
  }

  value(name: string): string | undefined {
    const index = this.args.indexOf(name);
    if (index < 0) return undefined;
    const value = this.args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  }
}

function isStartOption(argument: string): boolean {
  return argument.startsWith("-") && !["--version", "-v", "--help", "-h"].includes(argument);
}

async function configuration(
  options: CliOptions,
  environment: CliEnvironment,
): Promise<{ path: string; config: ResolvedConfig }> {
  const path = await findConfig(options.value("--config"), environment.env, environment.cwd);
  if (!path)
    throw new Error(
      "No configuration found. Create authveil.config.yaml from the documentation example.",
    );
  return { path, config: await loadConfig(path, environment.env) };
}

/** Validates an existing key file without creating a missing one. */
async function keysForValidation(
  keys: ResolvedConfig["keys"],
  environment: CliEnvironment,
): Promise<ResolvedConfig["keys"]> {
  if (!keys.privateKeyFile || (await exists(keys.privateKeyFile))) return keys;
  environment.print(`${keys.privateKeyFile} does not exist yet; start will create it.`);
  const { privateKeyFile: _missing, ...rest } = keys;
  return rest;
}

async function generateKey(
  path: string,
  force: boolean,
  environment: CliEnvironment,
): Promise<void> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, await exportPKCS8(privateKey), { mode: 0o600, flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`${path} already exists. Pass --force to overwrite it.`);
    throw error;
  }
  environment.print(`Created ${path}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
