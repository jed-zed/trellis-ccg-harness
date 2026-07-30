import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolvePython } from "../scripts/lib/python-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = resolvePython();

function fixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "trellis-developer-init-"));
  const trellisRoot = path.join(repoRoot, ".trellis");
  const scriptsRoot = path.join(trellisRoot, "scripts");
  mkdirSync(trellisRoot, { recursive: true });
  cpSync(path.join(ROOT, ".trellis", "scripts"), scriptsRoot, {
    recursive: true,
  });
  return {
    repoRoot,
    trellisRoot,
    scriptsRoot,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function runPython(repoRoot, args) {
  return spawnSync(PYTHON.command, [...PYTHON.argsPrefix, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
}

function runInit(value, args) {
  return runPython(value.repoRoot, [
    path.join(value.scriptsRoot, "init_developer.py"),
    ...args,
  ]);
}

function assertNoIdentityState(value) {
  assert.equal(existsSync(path.join(value.trellisRoot, ".developer")), false);
  assert.equal(existsSync(path.join(value.trellisRoot, "workspace")), false);
}

test("developer init help is side-effect free", (t) => {
  for (const helpArg of ["-h", "--help"]) {
    const value = fixture();
    t.after(value.cleanup);

    const result = runInit(value, [helpArg]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /usage:/i);
    assertNoIdentityState(value);
  }
});

test("developer init rejects malformed arguments before writing state", (t) => {
  const cases = [
    [],
    ["valid-name", "extra"],
    ["-operator"],
    [".."],
    ["../escape"],
    ["a/b"],
    ["a\\b"],
    ["bad:name"],
    ["trailing."],
    ["trailing "],
    ["CON"],
  ];

  for (const args of cases) {
    const value = fixture();
    t.after(value.cleanup);

    const result = runInit(value, args);

    assert.notEqual(result.status, 0, `unexpected success for ${JSON.stringify(args)}`);
    assertNoIdentityState(value);
  }
});

test("shared developer initializer rejects invalid path components", (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const program = [
    "import sys",
    "from pathlib import Path",
    `sys.path.insert(0, ${JSON.stringify(value.scriptsRoot)})`,
    "from common.developer import init_developer",
    `ok = init_developer("../escape", Path(${JSON.stringify(value.repoRoot)}))`,
    "raise SystemExit(1 if ok else 0)",
  ].join("\n");

  const result = runPython(value.repoRoot, ["-c", program]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /invalid developer name/i);
  assertNoIdentityState(value);
});

test("developer init accepts a portable Unicode name and remains idempotent", (t) => {
  const value = fixture();
  t.after(value.cleanup);
  const name = "Boss 用户";

  const first = runInit(value, [name]);
  const second = runInit(value, [name]);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already initialized/i);
  assert.match(
    readFileSync(path.join(value.trellisRoot, ".developer"), "utf8"),
    /^name=Boss 用户$/m,
  );
  assert.equal(
    existsSync(
      path.join(value.trellisRoot, "workspace", name, "journal-1.md"),
    ),
    true,
  );
  assert.equal(
    existsSync(path.join(value.trellisRoot, "workspace", name, "index.md")),
    true,
  );
});
