import { readdir } from "node:fs/promises";
import path from "node:path";

export function runCcgGates(checkout, execute) {
  const commands = [
    ["pnpm", ["install", "--frozen-lockfile"]],
    ["pnpm", ["lint"]],
    ["pnpm", ["typecheck"]],
    ["pnpm", ["test"]],
    ["pnpm", ["build"]],
  ];
  for (const [command, commandArgs] of commands) {
    execute(command, commandArgs, { cwd: checkout });
  }
  const wrapperRoot = path.join(checkout, "codeagent-wrapper");
  execute("go", ["test", "./..."], { cwd: wrapperRoot });
  execute("go", ["build", "./..."], { cwd: wrapperRoot });
  return commands.map(
    ([command, commandArgs]) => `${command} ${commandArgs.join(" ")}`,
  );
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
