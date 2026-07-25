import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBootstrapOwnership,
  buildRestoreAction,
  assertSparseExclusionsUnchanged,
  compareSemanticVersions,
  parseSparseArchiveExclusions,
  parseLifecycleArgs,
  resolvePackageManagerInvocation,
  updateTrellisProvenanceText,
  validateUpdateSource,
} from "../scripts/lib/harness-lifecycle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("update parsing accepts exactly one explicit CCG or Trellis target", () => {
  const parsed = parseLifecycleArgs([
    "update",
    "--ccg-commit",
    "a".repeat(40),
    "--source-checkout",
    "C:/personal/ccg",
  ]);
  assert.equal(parsed.command, "update");
  assert.equal(parsed.ccgCommit, "a".repeat(40));
  assert.equal(parsed.sourceCheckout, path.resolve("C:/personal/ccg"));

  const trellis = parseLifecycleArgs([
    "update",
    "--trellis-version",
    "0.7.0",
  ]);
  assert.equal(trellis.trellisVersion, "0.7.0");
  assert.equal(trellis.ccgCommit, null);

  assert.throws(
    () => parseLifecycleArgs(["update", "--ccg-commit", "main"]),
    /40-character/i,
  );
  assert.throws(
    () => parseLifecycleArgs(["update"]),
    /ccg-commit|trellis-version/i,
  );
  assert.throws(
    () =>
      parseLifecycleArgs([
        "update",
        "--ccg-commit",
        "a".repeat(40),
        "--trellis-version",
        "0.7.0",
      ]),
    /one source|one target|separate transaction/i,
  );
  assert.throws(
    () =>
      parseLifecycleArgs([
        "update",
        "--trellis-version",
        "latest",
      ]),
    /semantic version/i,
  );
  assert.throws(
    () =>
      parseLifecycleArgs([
        "update",
        "--trellis-version",
        "01.2.3",
      ]),
    /semantic version/i,
  );
  assert.throws(
    () =>
      parseLifecycleArgs([
        "update",
        "--trellis-version",
        "1.2.3-alpha..1",
      ]),
    /semantic version/i,
  );
});

test("semantic version comparison follows prerelease precedence", () => {
  assert.equal(compareSemanticVersions("0.6.9", "0.7.0"), -1);
  assert.equal(compareSemanticVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareSemanticVersions("1.0.0-rc.10", "1.0.0-rc.2"), 1);
  assert.equal(compareSemanticVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareSemanticVersions("1.0.0-beta", "1.0.0-beta"), 0);
});

test("Trellis provenance replacement is exact and refuses stale README text", () => {
  assert.equal(
    updateTrellisProvenanceText(
      "Use @mindfoldhq/trellis@0.6.9 here.\n",
      "0.6.9",
      "0.7.0",
    ),
    "Use @mindfoldhq/trellis@0.7.0 here.\n",
  );
  assert.throws(
    () =>
      updateTrellisProvenanceText(
        "No version marker.\n",
        "0.6.9",
        "0.7.0",
      ),
    /exactly once/i,
  );
});

test("source validation binds credential-free personal repo, commit, and tree", () => {
  const expected = {
    repository: "https://github.com/jed-zed/ccg-gptpro-worflow",
    commit: "a".repeat(40),
    gitTree: "b".repeat(40),
  };
  assert.deepEqual(
    validateUpdateSource({
      expected,
      actual: {
        repository: "https://github.com/jed-zed/ccg-gptpro-worflow.git",
        commit: "a".repeat(40),
        gitTree: "b".repeat(40),
      },
    }),
    expected,
  );

  assert.throws(
    () =>
      validateUpdateSource({
        expected,
        actual: { ...expected, repository: "https://token@github.com/jed-zed/ccg-gptpro-worflow" },
      }),
    /credential-free/i,
  );
  assert.throws(
    () =>
      validateUpdateSource({
        expected,
        actual: { ...expected, gitTree: "c".repeat(40) },
      }),
    /tree mismatch/i,
  );
});

test("sparse source exclusions are literal, bounded, and unchanged across the update", () => {
  const exclusions = parseSparseArchiveExclusions([
    "/*",
    "!/templates/skills/domains/security/pentest.md",
    "!/templates/skills/domains/security/red-team.md",
  ].join("\n"));
  assert.deepEqual(exclusions, [
    "templates/skills/domains/security/pentest.md",
    "templates/skills/domains/security/red-team.md",
  ]);
  assert.deepEqual(
    assertSparseExclusionsUnchanged(exclusions, ["package.json"]),
    exclusions,
  );
  assert.throws(
    () =>
      assertSparseExclusionsUnchanged(exclusions, [
        "templates/skills/domains/security/red-team.md",
      ]),
    /changed in the target commit/i,
  );
  assert.throws(
    () => parseSparseArchiveExclusions("!/templates/**/secret.md"),
    /literal paths/i,
  );
  assert.throws(
    () => parseSparseArchiveExclusions("!/../outside.txt"),
    /escape/i,
  );
});

test("recovery is an explicit lifecycle command without update arguments", () => {
  const parsed = parseLifecycleArgs(["recover", "--repo-root", "C:/harness"]);
  assert.equal(parsed.command, "recover");
  assert.equal(parsed.repoRoot, path.resolve("C:/harness"));
  assert.equal(parsed.ccgCommit, null);
});

test("bootstrap ownership records only globals actually changed by Harness", () => {
  const ownership = buildBootstrapOwnership({
    repoRoot: "C:/harness",
    ccgSourcePath: "C:/harness/components/ccg-workflow",
    managed: { trellis: true, ccg: false },
    before: {
      trellis: { version: "0.6.7" },
      ccg: { version: "3.3.0", resolved: "file:C:/personal/ccg" },
    },
    after: {
      trellis: { version: "0.6.8" },
      ccg: {
        version: "3.3.0",
        resolved: "file:C:/harness/components/ccg-workflow",
      },
    },
  });

  assert.deepEqual(ownership.entries.map((entry) => entry.id), [
    "trellis-global",
  ]);
  assert.equal(ownership.entries[0].version, "0.6.8");
  assert.equal(ownership.entries[0].previous.version, "0.6.7");
});

test("restore actions preserve a previous package or remove a new owned install", () => {
  assert.deepEqual(
    buildRestoreAction({
      package: "@mindfoldhq/trellis",
      previous: { version: "0.6.7" },
    }),
    {
      operation: "install",
      spec: "@mindfoldhq/trellis@0.6.7",
    },
  );
  assert.deepEqual(
    buildRestoreAction({
      package: "ccg-workflow",
      previous: {
        version: "3.3.0",
        resolved: "file:C:/personal/ccg",
      },
    }),
    {
      operation: "install",
      spec: "C:/personal/ccg",
    },
  );
  assert.deepEqual(
    buildRestoreAction({ package: "ccg-workflow", previous: null }),
    {
      operation: "uninstall",
      spec: "ccg-workflow",
    },
  );
});

test("Windows package-manager shims run through their Node.js entry points", () => {
  const execPath = String.raw`C:\hostedtoolcache\windows\node\22\x64\node.exe`;
  const observed = [];
  const fileExists = (candidate) => {
    observed.push(candidate);
    return true;
  };

  assert.deepEqual(
    resolvePackageManagerInvocation("npm", ["ls", "-g"], {
      platform: "win32",
      execPath,
      fileExists,
    }),
    {
      command: execPath,
      args: [
        String.raw`C:\hostedtoolcache\windows\node\22\x64\node_modules\npm\bin\npm-cli.js`,
        "ls",
        "-g",
      ],
    },
  );
  assert.deepEqual(
    resolvePackageManagerInvocation("pnpm", ["test"], {
      platform: "win32",
      execPath,
      fileExists,
    }),
    {
      command: execPath,
      args: [
        String.raw`C:\hostedtoolcache\windows\node\22\x64\node_modules\corepack\dist\pnpm.js`,
        "test",
      ],
    },
  );
  assert.equal(observed.length, 2);
  assert.deepEqual(
    resolvePackageManagerInvocation("git", ["status"], {
      platform: "win32",
      execPath,
      fileExists,
    }),
    { command: "git", args: ["status"] },
  );
});

test("Windows package-manager resolution fails closed when a CLI is missing", () => {
  assert.throws(
    () =>
      resolvePackageManagerInvocation("npm", ["--version"], {
        platform: "win32",
        execPath: String.raw`C:\node\node.exe`,
        fileExists: () => false,
      }),
    /Could not locate the Windows npm CLI/i,
  );
});

test("root package exposes all Harness lifecycle and aggregate test commands", async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["harness:update"], "node ./scripts/harness-lifecycle.mjs update");
  assert.equal(pkg.scripts["harness:rollback"], "node ./scripts/harness-lifecycle.mjs rollback");
  assert.equal(pkg.scripts["harness:recover"], "node ./scripts/harness-lifecycle.mjs recover");
  assert.equal(pkg.scripts["harness:init"], "node ./scripts/harness-init.mjs");
  assert.equal(pkg.scripts["harness:uninstall"], "node ./scripts/harness-lifecycle.mjs uninstall");
  assert.equal(pkg.scripts["harness:test"], "node ./scripts/run-tests.mjs");
});
