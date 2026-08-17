import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testsDirectory = path.join(repoRoot, "tests");
const testFiles = readdirSync(testsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join(testsDirectory, entry.name))
  .sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  console.error("No Harness test files were found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...testFiles],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`Unable to start the Harness test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
