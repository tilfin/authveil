#!/usr/bin/env node
import { runCli } from "./cli/commands.js";

runCli(process.argv.slice(2))
  .then((authveil) => {
    if (!authveil) return;
    const shutdown = () => {
      void authveil.close().then(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  })
  .catch((error: unknown) => {
    console.error(`AuthVeil: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
