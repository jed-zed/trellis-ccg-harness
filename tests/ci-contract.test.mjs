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
  assert.match(workflow, /actions\/setup-go@[a-f0-9]{40}/i)
  assert.match(workflow, /go-version:\s*"1\.26\.5"/)
  assert.match(workflow, /go build \./)
  assert.match(workflow, /go test -short \.\/\.\.\./)
  assert.match(workflow, /bootstrap\.ps1.*-LinkCcg/)
  assert.match(workflow, /ccg --version/)
  assert.match(workflow, /harness:uninstall/)
  assert.match(workflow, /plugins\/ccg\/scripts\/doctor\.ps1/)
  assert.doesNotMatch(workflow, /pnpm --dir components\/ccg-workflow/)
  assert.match(workflow, /pnpm --dir \.\/components\/ccg-workflow exec vitest run/)
  assert.match(workflow, /Test personal CCG \(Windows ACL-safe\)/)
  assert.match(workflow, /runner\.os == 'Windows'/)
  assert.match(workflow, /vitest run --no-file-parallelism --retry 1/)
  assert.match(workflow, /pnpm --dir \.\/components\/ccg-workflow audit:prod/)
  assert.doesNotMatch(workflow, /grok-probe --live|doctor --grok-live/)
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./)
  const actionUses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map(
    (match) => match[1],
  )
  assert.ok(actionUses.length > 0)
  for (const action of actionUses) {
    assert.match(action, /@[a-f0-9]{40}$/i, `Action must be commit-pinned: ${action}`)
  }
})

test("doctor blocks on interrupted transaction residue", async () => {
  const doctor = await readFile(
    path.join(ROOT, "scripts", "doctor.ps1"),
    "utf8",
  )
  assert.match(doctor, /transaction-journal\.json/)
  assert.match(doctor, /transaction\.lock/)
  assert.match(doctor, /harness:recover/)
})

test("doctor verifies the repository visibility recorded by the source manifest", async () => {
  const [doctor, manifestBytes] = await Promise.all([
    readFile(path.join(ROOT, "scripts", "doctor.ps1"), "utf8"),
    readFile(path.join(ROOT, "harness.sources.json"), "utf8"),
  ])
  const manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.harness.visibility, "public")
  assert.match(doctor, /manifest\.harness\.visibility/)
  assert.doesNotMatch(doctor, /repository is not private/i)
})

test("Dependabot covers Actions, the CCG package, and the Go wrapper", async () => {
  const config = await readFile(
    path.join(ROOT, ".github", "dependabot.yml"),
    "utf8",
  )
  assert.match(config, /package-ecosystem:\s*"github-actions"/)
  assert.match(config, /package-ecosystem:\s*"npm"[\s\S]*directory:\s*"\/components\/ccg-workflow"/)
  assert.match(config, /package-ecosystem:\s*"gomod"[\s\S]*directory:\s*"\/components\/ccg-workflow\/codeagent-wrapper"/)
})
