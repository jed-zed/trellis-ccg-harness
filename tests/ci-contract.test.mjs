import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("root CI owns the cross-platform Node, Go, PowerShell, and offline gates", async () => {
  const workflow = await readFile(
    path.join(ROOT, ".github", "workflows", "ci.yml"),
    "utf8",
  );

  for (const platform of [
    "ubuntu-latest",
    "windows-latest",
    "macos-latest",
  ]) {
    assert.match(workflow, new RegExp(platform));
  }
  assert.match(workflow, /node-version:\s*\[20,\s*22\]/)
  assert.match(workflow, /pnpm harness:test/)
  assert.match(workflow, /harness-adapter\.mjs conflicts --ci/)
  assert.match(workflow, /verify-sources\.ps1/)
  assert.match(workflow, /setup-go@v6/)
  assert.match(workflow, /go build \./)
  assert.match(workflow, /go test -short \.\/\.\.\./)
  assert.match(workflow, /bootstrap\.ps1.*-SkipInstall/)
  assert.match(workflow, /plugins\/ccg\/scripts\/doctor\.ps1/)
  assert.doesNotMatch(workflow, /pnpm --dir components\/ccg-workflow/)
  assert.match(workflow, /pnpm --dir \.\/components\/ccg-workflow exec vitest run/)
  assert.doesNotMatch(workflow, /grok-probe --live|doctor --grok-live/)
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./)
})
