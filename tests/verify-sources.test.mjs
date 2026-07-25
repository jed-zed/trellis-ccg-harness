import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY_SCRIPT = path.join(ROOT, "scripts", "verify-sources.ps1");
const PERSONAL_REPO =
  "https://github.com/jed-zed/ccg-gptpro-worflow";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
  });
  if (options.allowFailure) return result;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return String(result.stdout).trim();
}

function git(root, ...args) {
  return run("git", ["-C", root, ...args]);
}

function write(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function commitAll(root, message) {
  git(root, "add", "--all");
  git(root, "commit", "-m", message);
  return {
    commit: git(root, "rev-parse", "HEAD"),
    tree: git(root, "rev-parse", "HEAD^{tree}"),
  };
}

function initializeRepo(root) {
  git(root, "init");
  git(root, "config", "user.email", "tests@example.invalid");
  git(root, "config", "user.name", "Harness Tests");
}

function writeSourceFiles(sourceRoot, marker = "initial") {
  write(
    path.join(sourceRoot, "package.json"),
    `${JSON.stringify({ name: "ccg-workflow", version: "3.3.0" }, null, 2)}\n`,
  );
  const required = [
    "plugins/ccg/.codex-plugin/plugin.json",
    "plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py",
    "plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/runner.mjs",
    "src/commands/doctor.ts",
    "templates/engine/tools/grok-intelligence/runner.mjs",
  ];
  for (const relative of required) {
    write(path.join(sourceRoot, relative), `${marker}:${relative}\n`);
  }
}

function writeHarnessManifest(harnessRoot, source) {
  write(
    path.join(harnessRoot, "harness.sources.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        trellis: { version: "0.6.8" },
        ccg: {
          package: "ccg-workflow",
          version: "3.3.0",
          authoritativeRepository: PERSONAL_REPO,
          authoritativeRemoteNameInSourceCheckout: "gptpro",
          commit: source.commit,
          gitTree: source.tree,
          snapshotPath: "components/ccg-workflow",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function copySourceSnapshot(sourceRoot, harnessRoot) {
  const component = path.join(harnessRoot, "components", "ccg-workflow");
  rmSync(component, { recursive: true, force: true });
  cpSync(sourceRoot, component, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".git",
  });
}

function fixture() {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), "harness-source-verification-"),
  );
  const sourceRoot = path.join(fixtureRoot, "personal-source");
  const harnessRoot = path.join(fixtureRoot, "harness");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(harnessRoot, { recursive: true });
  initializeRepo(sourceRoot);
  writeSourceFiles(sourceRoot);
  const source = commitAll(sourceRoot, "initial personal source");
  git(sourceRoot, "remote", "add", "gptpro", PERSONAL_REPO);

  initializeRepo(harnessRoot);
  write(path.join(harnessRoot, ".trellis", ".version"), "0.6.8\n");
  copySourceSnapshot(sourceRoot, harnessRoot);
  writeHarnessManifest(harnessRoot, source);
  commitAll(harnessRoot, "initial harness");

  return {
    fixtureRoot,
    sourceRoot,
    harnessRoot,
    source,
    cleanup: () =>
      rmSync(fixtureRoot, { recursive: true, force: true }),
  };
}

function verify(value, extra = []) {
  return run(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      VERIFY_SCRIPT,
      "-RepoRoot",
      value.harnessRoot,
      "-AuthoritativeCheckout",
      value.sourceRoot,
      ...extra,
    ],
    { allowFailure: true },
  );
}

test("source verifier binds clean authoritative commit, tree, and committed snapshot", () => {
  const value = fixture();
  try {
    const result = verify(value);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Source verification passed/);

    const manifestPath = path.join(value.harnessRoot, "harness.sources.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.ccg.commit = "f".repeat(40);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const wrongCommit = verify(value);
    assert.notEqual(wrongCommit.status, 0);
    assert.match(
      `${wrongCommit.stdout}\n${wrongCommit.stderr}`,
      /checkout HEAD mismatch|commit/i,
    );
  } finally {
    value.cleanup();
  }
});

test("source verifier rejects authoritative and component dirty state", () => {
  const value = fixture();
  try {
    write(path.join(value.sourceRoot, "untracked.txt"), "dirty\n");
    const dirtySource = verify(value);
    assert.notEqual(dirtySource.status, 0);
    assert.match(
      `${dirtySource.stdout}\n${dirtySource.stderr}`,
      /authoritative CCG checkout is dirty/i,
    );
    rmSync(path.join(value.sourceRoot, "untracked.txt"));

    write(
      path.join(value.harnessRoot, "components", "ccg-workflow", "untracked.txt"),
      "dirty\n",
    );
    const dirtyComponent = verify(value);
    assert.notEqual(dirtyComponent.status, 0);
    assert.match(
      `${dirtyComponent.stdout}\n${dirtyComponent.stderr}`,
      /component is dirty/i,
    );
  } finally {
    value.cleanup();
  }
});

test("index verification reads the staged tree and rejects untracked residue", () => {
  const value = fixture();
  try {
    writeSourceFiles(value.sourceRoot, "updated");
    const updated = commitAll(value.sourceRoot, "updated personal source");
    copySourceSnapshot(value.sourceRoot, value.harnessRoot);
    writeHarnessManifest(value.harnessRoot, updated);
    git(
      value.harnessRoot,
      "add",
      "harness.sources.json",
      "components/ccg-workflow",
    );

    const staged = verify(value, ["-Index"]);
    assert.equal(staged.status, 0, `${staged.stdout}\n${staged.stderr}`);

    write(
      path.join(
        value.harnessRoot,
        "components",
        "ccg-workflow",
        "src",
        "commands",
        "doctor.ts",
      ),
      "unstaged tracked worktree drift\n",
    );
    const manifestPath = path.join(value.harnessRoot, "harness.sources.json");
    const worktreeManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    worktreeManifest.ccg.commit = "f".repeat(40);
    writeFileSync(
      manifestPath,
      `${JSON.stringify(worktreeManifest, null, 2)}\n`,
    );
    const stagedWithTrackedDrift = verify(value, ["-Index"]);
    assert.equal(
      stagedWithTrackedDrift.status,
      0,
      `${stagedWithTrackedDrift.stdout}\n${stagedWithTrackedDrift.stderr}`,
    );

    write(
      path.join(value.harnessRoot, "components", "ccg-workflow", "residue.txt"),
      "untracked\n",
    );
    const residue = verify(value, ["-Index"]);
    assert.notEqual(residue.status, 0);
    assert.match(
      `${residue.stdout}\n${residue.stderr}`,
      /untracked/i,
    );
  } finally {
    value.cleanup();
  }
});
