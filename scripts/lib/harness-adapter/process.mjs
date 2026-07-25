import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  createSafeSubprocessEnv,
  redactString,
} from "./redaction.mjs";

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function readTextIfPresent(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function relativePosix(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}

export function assertInside(rootPath, targetPath, label) {
  const relative = path.relative(rootPath, targetPath);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(`${label} resolves outside its allowed root.`);
}

export function defaultRunner(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    shell: false,
    windowsHide: true,
  });
}

function normalizeCommandResult(result) {
  return {
    status:
      typeof result?.status === "number"
        ? result.status
        : result?.error
          ? null
          : 0,
    stdout: String(result?.stdout ?? "").trim(),
    stderr: String(result?.stderr ?? "").trim(),
    error: result?.error ?? null,
  };
}

export function runCommand(
  command,
  args,
  {
    repoRoot,
    runner = defaultRunner,
    env = process.env,
  },
) {
  return normalizeCommandResult(
    runner(command, args, {
      cwd: repoRoot,
      env: createSafeSubprocessEnv(env),
    }),
  );
}

export function commandError(command, args, result) {
  const detail =
    result.stderr ||
    result.stdout ||
    result.error?.message ||
    `exit ${result.status ?? "unknown"}`;
  return redactString(`${command} ${args.join(" ")} failed: ${detail}`);
}
