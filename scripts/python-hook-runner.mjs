#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { resolvePythonFromSystem } from "./lib/python-resolver.mjs";

const scriptArgument = process.argv[2];
if (!scriptArgument || process.argv.length !== 3) {
  process.stderr.write("Expected exactly one project-relative Python hook.\n");
  process.exitCode = 1;
} else {
  try {
    const root = process.cwd();
    const script = path.resolve(root, scriptArgument);
    const relative = path.relative(root, script);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !relative.split(path.sep).includes(".codex")
    ) {
      throw new Error("Python hook path escapes the project .codex directory.");
    }

    const python = resolvePythonFromSystem();
    const child = spawn(
      python.command,
      [...python.argsPrefix, "-X", "utf8", script],
      {
        cwd: root,
        env: process.env,
        shell: false,
        stdio: ["inherit", "inherit", "inherit"],
        windowsHide: true,
      },
    );
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        if (!child.killed) child.kill(signal);
      });
    }
    child.once("error", (error) => {
      process.stderr.write(`Python hook failed to start: ${error.message}\n`);
      process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
