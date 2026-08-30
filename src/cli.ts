#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportPKCS8, generateKeyPair } from "jose";
import { findConfig, loadConfig } from "./config/index.js";
import { createAuthVeil } from "./index.js";
import { KeyStore } from "./keys/key-store.js";
import { VERSION } from "./core/version.js";

const args = process.argv.slice(2);
const command = args[0] ?? "start";

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function configuration() {
  const path = await findConfig(option("--config"));
  if (!path)
    throw new Error(
      "No configuration found. Create authveil.config.yaml from the documentation example.",
    );
  return { path, config: await loadConfig(path) };
}

async function main(): Promise<void> {
  if (["version", "--version", "-v"].includes(command)) {
    console.log(VERSION);
    return;
  }
  if (["help", "--help", "-h"].includes(command)) {
    console.log("Usage: authveil <start|validate|users|keys generate|keys show|version> [options]");
    return;
  }
  if (command === "validate") {
    const { path, config } = await configuration();
    await KeyStore.create(config.keys);
    console.log(`${path}: valid`);
    return;
  }
  if (command === "users") {
    const { config } = await configuration();
    for (const user of config.mockUsers)
      console.log(`${user.id}\t${user.subject}\t${user.name ?? ""}`);
    return;
  }
  if (command === "keys" && args[1] === "generate") {
    const path = resolve(option("--out") ?? ".authveil-private-key.pem");
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    await writeFile(path, await exportPKCS8(privateKey), {
      mode: 0o600,
      flag: args.includes("--force") ? "w" : "wx",
    });
    console.log(`Created ${path}`);
    return;
  }
  if (command === "keys" && args[1] === "show") {
    const { config } = await configuration();
    const keys = await KeyStore.create(config.keys);
    console.log(JSON.stringify(await keys.publicJwks(), null, 2));
    return;
  }
  if (command !== "start") throw new Error(`Unknown command: ${command}`);
  const { config } = await configuration();
  const mirror = await createAuthVeil(config);
  const address = await mirror.listen();
  console.log(
    `AuthVeil v${VERSION}\nProxy:          ${address.url}\nUpstream:       ${config.upstream.url}\nMode:           ${config.auth.mode}\nIdentity proxy: ${config.identityProxy.type}\nLogin:          ${address.url}${config.server.controlPrefix}/login\nJWKS:           ${address.url}${config.server.controlPrefix}/.well-known/jwks.json\nDevelopment use only.`,
  );
  const shutdown = () => {
    void mirror.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(`AuthVeil: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
