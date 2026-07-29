import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

import {
  createSafeSubprocessEnv,
  redactString,
} from "./redaction.mjs";

const DEFAULT_ASYNC_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CAPTURE_BYTES = 1024 * 1024;

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

export function defaultRunner(command, args, options) {
  return spawnSync(command, args, spawnOptions(options));
}

export function defaultAsyncRunner(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...spawnOptions(options),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const maxCaptureBytes =
      options.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES;
    let capturedBytes = 0;
    let terminalError = null;
    let settled = false;
    const timer = setTimeout(() => {
      if (terminalError === null) {
        terminalError = new Error("Command timed out.");
        child.kill();
      }
    }, options.timeoutMs ?? DEFAULT_ASYNC_TIMEOUT_MS);
    timer.unref();
    const capture = (chunks, chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes <= maxCaptureBytes) {
        chunks.push(chunk);
        return;
      }
      if (terminalError === null) {
        terminalError = new Error("Command output exceeded the capture limit.");
        child.kill();
      }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
    child.once("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error:
          terminalError ??
          (status === null
            ? new Error(`Command terminated by signal ${signal ?? "unknown"}.`)
            : null),
      });
    });
  });
}

function normalizeCommandResult(result) {
  return {
    status:
      result?.error
        ? null
        : typeof result?.status === "number"
          ? result.status
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

export async function runCommandAsync(
  command,
  args,
  {
    repoRoot,
    runner = defaultAsyncRunner,
    env = process.env,
    maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
    timeoutMs = DEFAULT_ASYNC_TIMEOUT_MS,
  },
) {
  return normalizeCommandResult(
    await runner(command, args, {
      cwd: repoRoot,
      env: createSafeSubprocessEnv(env),
      maxCaptureBytes,
      timeoutMs,
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
