#!/usr/bin/env node

import process from "node:process";

import { runHarnessInitCli } from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";

runHarnessInitCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Harness Init failed: ${error.message}\n`);
  process.exitCode = 1;
});
