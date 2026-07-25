#!/usr/bin/env node

import { resolvePythonFromSystem } from "./lib/python-resolver.mjs";

try {
  process.stdout.write(`${JSON.stringify(resolvePythonFromSystem())}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
