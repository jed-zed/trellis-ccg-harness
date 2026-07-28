import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

function spawnOptions(options) {
  return {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    shell: false,
    windowsHide: true,
  };
}

function runWithFileBackedOutput(command, args, options) {
  const captureDirectory = mkdtempSync(
    path.join(tmpdir(), "harness-command-output-"),
  );
  const stdoutPath = path.join(captureDirectory, "stdout");
  const stderrPath = path.join(captureDirectory, "stderr");
  let stdoutDescriptor;
  let stderrDescriptor;
  try {
    stdoutDescriptor = openSync(stdoutPath, "wx", 0o600);
    stderrDescriptor = openSync(stderrPath, "wx", 0o600);
    const result = spawnSync(command, args, {
      ...spawnOptions(options),
      stdio: ["ignore", stdoutDescriptor, stderrDescriptor],
    });
    closeSync(stdoutDescriptor);
    stdoutDescriptor = undefined;
    closeSync(stderrDescriptor);
    stderrDescriptor = undefined;
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    if (stdoutDescriptor !== undefined) closeSync(stdoutDescriptor);
    if (stderrDescriptor !== undefined) closeSync(stderrDescriptor);
    rmSync(stdoutPath, { force: true });
    rmSync(stderrPath, { force: true });
    rmdirSync(captureDirectory);
  }
}

export function defaultRunner(command, args, options) {
  if (options.fileBackedStdio) {
    return runWithFileBackedOutput(command, args, options);
  }
  return spawnSync(command, args, spawnOptions(options));
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
    fileBackedStdio = false,
  },
) {
  return normalizeCommandResult(
    runner(command, args, {
      cwd: repoRoot,
      env: createSafeSubprocessEnv(env),
      fileBackedStdio,
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
