import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function runCcgGates(
  checkout,
  execute,
  { platform = process.platform } = {},
) {
  execute("go", ["version"], { cwd: checkout, capture: true });
  const testArgs = platform === "win32"
    ? [
        "exec",
        "vitest",
        "run",
        "--testTimeout",
        "60000",
        "--no-file-parallelism",
        "--pool",
        "threads",
      ]
    : ["test"];
  const commands = [
    ["pnpm", ["install", "--frozen-lockfile"]],
    ["pnpm", ["lint"]],
    ["pnpm", ["typecheck"]],
    ["pnpm", testArgs],
    ["pnpm", ["build"]],
  ];
  for (const [command, commandArgs] of commands) {
    execute(command, commandArgs, { cwd: checkout });
  }
  const wrapperRoot = path.join(checkout, "codeagent-wrapper");
  execute("go", ["test", "./..."], { cwd: wrapperRoot });
  const buildOutputRoot = mkdtempSync(
    path.join(tmpdir(), "harness-go-build-"),
  );
  try {
    execute(
      "go",
      ["build", "-o", buildOutputRoot, "./..."],
      { cwd: wrapperRoot },
    );
  } finally {
    rmSync(buildOutputRoot, { recursive: true, force: true });
  }
  return [
    "go version",
    ...commands.map(
      ([command, commandArgs]) => `${command} ${commandArgs.join(" ")}`,
    ),
    "go test ./...",
    "go build -o <temporary-directory> ./...",
  ];
}

export async function runHarnessTests(repoRoot, execute) {
  const testsRoot = path.join(repoRoot, "tests");
  const testFiles = (await readdir(testsRoot))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(testsRoot, name));
  if (testFiles.length === 0) {
    throw new Error("No Harness test files were found.");
  }
  execute(process.execPath, ["--test", ...testFiles], { cwd: repoRoot });
}
