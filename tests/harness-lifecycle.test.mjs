import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBootstrapOwnershipContinuity,
  buildBootstrapOwnership,
  buildRestoreAction,
  assertSparseExclusionsUnchanged,
  compareSemanticVersions,
  globalPackageRootFromNpmPrefix,
  globalPackageSnapshotsEqual,
  inspectGlobalPackage,
  parseSparseArchiveExclusions,
  parseLifecycleArgs,
  resolvePackageManagerInvocation,
  updateTrellisProvenanceText,
  validateBootstrapOwnership,
  validateUpdateSource,
} from "../scripts/lib/harness-lifecycle.mjs";
import { buildHarnessDoctorArguments } from "../scripts/harness-lifecycle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function filesystemEntryIdentity(target) {
  const details = statSync(target, { bigint: true });
  return {
    dev: String(details.dev),
    ino: String(details.ino),
  };
}

function packageSnapshot(overrides = {}) {
  const snapshot = {
    version: "1.0.0",
    entryPath: path.resolve("C:/npm/root/example"),
    entryIdentity: {
      dev: "1",
      ino: "2",
      birthtimeNs: "3",
    },
    packageJsonSha256: "a".repeat(64),
    contentIdentity: {
      algorithm: "sha256-tree-v1",
      digest: "b".repeat(64),
      entryCount: 2,
    },
    ...overrides,
  };
  if (snapshot.sourcePath !== undefined) {
    delete snapshot.contentIdentity;
  }
  return snapshot;
}

function runPackageManager(command, args) {
  const invocation = resolvePackageManagerInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  return String(result.stdout ?? "").trim();
}

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

test("CCG update doctor mode is explicit and target-version bound", () => {
  const repoRoot = path.resolve("C:/harness");
  assert.deepEqual(buildHarnessDoctorArguments(repoRoot), [
    "-NoProfile",
    "-File",
    path.join(repoRoot, "scripts", "doctor.ps1"),
    "-RepoRoot",
    repoRoot,
  ]);
  assert.deepEqual(
    buildHarnessDoctorArguments(repoRoot, {
      ccgUpdateTargetVersion: "3.3.1",
    }),
    [
      "-NoProfile",
      "-File",
      path.join(repoRoot, "scripts", "doctor.ps1"),
      "-RepoRoot",
      repoRoot,
      "-CcgUpdateTargetVersion",
      "3.3.1",
    ],
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

test("sparse source exclusions are literal, bounded, and fail closed for replacement", () => {
  const exclusions = parseSparseArchiveExclusions([
    "/*",
    "!/templates/skills/domains/security/pentest.md",
    "!/templates/skills/domains/security/red-team.md",
  ].join("\n"));
  assert.deepEqual(exclusions, [
    "templates/skills/domains/security/pentest.md",
    "templates/skills/domains/security/red-team.md",
  ]);
  assert.throws(
    () => assertSparseExclusionsUnchanged(exclusions, ["package.json"]),
    /cannot preserve|full component replacement|refusing/i,
  );
  assert.throws(
    () =>
      assertSparseExclusionsUnchanged(exclusions, [
        "templates/skills/domains/security/red-team.md",
      ]),
    /cannot preserve|full component replacement|refusing/i,
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

test("CCG replacement refuses any ignored live component state", async () => {
  const lifecycle = await import("../scripts/lib/harness-lifecycle.mjs");
  assert.equal(
    typeof lifecycle.assertNoIgnoredComponentState,
    "function",
  );
  assert.throws(
    () =>
      lifecycle.assertNoIgnoredComponentState([
        "components/ccg-workflow/node_modules/tool/index.js",
      ]),
    /ignored.*component|refusing/i,
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
      trellis: null,
      ccg: packageSnapshot({
        version: "3.3.0",
        sourcePath: path.resolve("C:/personal/ccg"),
      }),
    },
    after: {
      trellis: packageSnapshot({
        version: "0.6.8",
        entryIdentity: { dev: "1", ino: "4", birthtimeNs: "5" },
      }),
      ccg: packageSnapshot({
        version: "3.3.0",
        sourcePath: path.resolve("C:/harness/components/ccg-workflow"),
      }),
    },
  });

  assert.deepEqual(ownership.entries.map((entry) => entry.id), [
    "trellis-global",
  ]);
  assert.equal(
    ownership.entries[0].installedByHarness.version,
    "0.6.8",
  );
  assert.equal(
    ownership.entries[0].originalBeforeFirstManagement,
    null,
  );
});

test("first bootstrap refuses a pre-existing ordinary global package", () => {
  const repoRoot = path.resolve("C:/harness");
  const emptyOwnership = {
    schemaVersion: 2,
    repoRoot,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  };
  assert.throws(
    () =>
      assertBootstrapOwnershipContinuity(
        emptyOwnership,
        {
          trellis: packageSnapshot({ version: "0.6.7" }),
          ccg: null,
        },
        { trellis: true, ccg: false },
        repoRoot,
      ),
    /pre-existing|exactly restore|refusing/i,
  );
});

test("restore actions preserve a previous package or remove a new owned install", () => {
  assert.throws(
    () =>
      buildRestoreAction({
        id: "trellis-global",
        kind: "npm-global-package",
        package: "@mindfoldhq/trellis",
        originalBeforeFirstManagement: packageSnapshot({
          version: "0.6.7",
        }),
        installedByHarness: packageSnapshot({ version: "0.6.8" }),
      }),
    /cannot exactly restore|refusing/i,
  );
  assert.deepEqual(
    buildRestoreAction({
      id: "ccg-link",
      kind: "npm-global-link",
      package: "ccg-workflow",
      originalBeforeFirstManagement: packageSnapshot({
        version: "3.3.0",
        sourcePath: path.resolve("C:/personal/ccg"),
      }),
      installedByHarness: packageSnapshot({
        version: "3.3.0",
        sourcePath: path.resolve(
          "C:/harness/components/ccg-workflow",
        ),
      }),
    }),
    {
      operation: "install",
      spec: path.resolve("C:/personal/ccg"),
    },
  );
  assert.deepEqual(
    buildRestoreAction({
      id: "ccg-link",
      kind: "npm-global-link",
      package: "ccg-workflow",
      originalBeforeFirstManagement: null,
      installedByHarness: packageSnapshot({
        version: "3.3.0",
        sourcePath: path.resolve(
          "C:/harness/components/ccg-workflow",
        ),
      }),
    }),
    {
      operation: "uninstall",
      spec: "ccg-workflow",
    },
  );
});

test("global package identity resolves the real npm entry target with spaces", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "npm prefix with spaces-"));
  const globalRoot = path.join(root, "lib", "node_modules");
  const source = path.join(root, "package source with spaces");
  try {
    mkdirSync(globalRoot, { recursive: true });
    mkdirSync(source);
    writeFileSync(
      path.join(source, "package.json"),
      `${JSON.stringify({ name: "ccg-workflow", version: "3.3.0" })}\n`,
    );
    symlinkSync(
      source,
      path.join(globalRoot, "ccg-workflow"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const observed = await inspectGlobalPackage(
      globalRoot,
      "ccg-workflow",
    );
    assert.equal(observed.version, "3.3.0");
    assert.equal(path.isAbsolute(observed.sourcePath), true);
    assert.deepEqual(
      filesystemEntryIdentity(observed.sourcePath),
      filesystemEntryIdentity(source),
    );
    assert.match(observed.packageJsonSha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit npm prefixes resolve global package roots without querying npm", () => {
  const prefix = path.join(ROOT, "isolated npm prefix with spaces");
  assert.equal(
    globalPackageRootFromNpmPrefix(prefix, { platform: "win32" }),
    path.join(path.resolve(prefix), "node_modules"),
  );
  assert.equal(
    globalPackageRootFromNpmPrefix(prefix, { platform: "linux" }),
    path.join(path.resolve(prefix), "lib", "node_modules"),
  );
  assert.equal(globalPackageRootFromNpmPrefix("   "), null);
  assert.equal(
    globalPackageRootFromNpmPrefix("relative npm prefix", { platform: "win32" }),
    path.join(path.resolve("relative npm prefix"), "node_modules"),
  );
  assert.throws(
    () => globalPackageRootFromNpmPrefix("invalid\0prefix"),
    /NUL/i,
  );
});

test("ordinary global package identity detects non-manifest file changes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "npm package identity-"));
  const globalRoot = path.join(root, "lib", "node_modules");
  const packageRoot = path.join(
    globalRoot,
    "@mindfoldhq",
    "trellis",
  );
  try {
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@mindfoldhq/trellis",
        version: "0.6.9",
      })}\n`,
    );
    writeFileSync(path.join(packageRoot, "runtime.mjs"), "old-runtime\n");
    const before = await inspectGlobalPackage(
      globalRoot,
      "@mindfoldhq/trellis",
    );
    writeFileSync(path.join(packageRoot, "runtime.mjs"), "new-runtime\n");
    const after = await inspectGlobalPackage(
      globalRoot,
      "@mindfoldhq/trellis",
    );
    assert.equal(globalPackageSnapshotsEqual(before, after), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary global package stays content-bound beneath a canonicalized parent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "npm canonical parent-"));
  const actualGlobalRoot = path.join(root, "actual", "node_modules");
  const linkedGlobalRoot = path.join(root, "linked-node-modules");
  const packageRoot = path.join(
    actualGlobalRoot,
    "@mindfoldhq",
    "trellis",
  );
  try {
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@mindfoldhq/trellis",
        version: "0.6.9",
      })}\n`,
    );
    writeFileSync(path.join(packageRoot, "runtime.mjs"), "old-runtime\n");
    symlinkSync(
      actualGlobalRoot,
      linkedGlobalRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    const before = await inspectGlobalPackage(
      linkedGlobalRoot,
      "@mindfoldhq/trellis",
    );
    assert.equal(before.sourcePath, undefined);
    assert.match(before.contentIdentity.digest, /^[a-f0-9]{64}$/);

    writeFileSync(path.join(packageRoot, "runtime.mjs"), "new-runtime\n");
    const after = await inspectGlobalPackage(
      linkedGlobalRoot,
      "@mindfoldhq/trellis",
    );
    assert.equal(globalPackageSnapshotsEqual(before, after), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an isolated npm prefix keeps a local global link and CLI working with spaces", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "isolated npm prefix-"));
  const prefix = path.join(root, "global prefix with spaces");
  const source = path.join(root, "ccg source with spaces");
  try {
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, "package.json"),
      `${JSON.stringify({
        name: "ccg-workflow",
        version: "3.3.0",
        bin: { ccg: "./bin/ccg.mjs" },
      })}\n`,
    );
    mkdirSync(path.join(source, "bin"));
    writeFileSync(
      path.join(source, "bin", "ccg.mjs"),
      "#!/usr/bin/env node\nconsole.log('3.3.0');\n",
    );
    if (process.platform !== "win32") {
      const { chmodSync } = await import("node:fs");
      chmodSync(path.join(source, "bin", "ccg.mjs"), 0o755);
    }

    runPackageManager("npm", [
      "install",
      "-g",
      source,
      "--prefix",
      prefix,
      "--ignore-scripts",
    ]);
    const globalRoot = runPackageManager("npm", [
      "root",
      "-g",
      "--prefix",
      prefix,
    ]);
    const observed = await inspectGlobalPackage(
      globalRoot,
      "ccg-workflow",
    );
    assert.equal(path.isAbsolute(observed.sourcePath), true);
    assert.deepEqual(
      filesystemEntryIdentity(observed.sourcePath),
      filesystemEntryIdentity(source),
    );

    const command =
      process.platform === "win32"
        ? path.join(prefix, "ccg.cmd")
        : path.join(prefix, "bin", "ccg");
    const smoke =
      process.platform === "win32"
        ? spawnSync(`"${command}" --version`, {
            encoding: "utf8",
            shell: true,
          })
        : spawnSync(command, ["--version"], {
            encoding: "utf8",
            shell: false,
          });
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.equal(smoke.stdout.trim(), "3.3.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repeated bootstrap keeps the first original and rejects same-version replacement", () => {
  const original = packageSnapshot({
    version: "3.2.2",
    sourcePath: path.resolve("C:/original with spaces/ccg"),
  });
  const firstInstalled = packageSnapshot({
    version: "3.3.0",
    sourcePath: path.resolve("C:/harness/components/ccg-workflow"),
    entryIdentity: { dev: "1", ino: "10", birthtimeNs: "11" },
  });
  const first = buildBootstrapOwnership({
    repoRoot: "C:/harness",
    ccgSourcePath: "C:/harness/components/ccg-workflow",
    managed: { trellis: false, ccg: true },
    before: { trellis: null, ccg: original },
    after: { trellis: null, ccg: firstInstalled },
  });
  const secondInstalled = packageSnapshot({
    version: "3.3.0",
    sourcePath: path.resolve("C:/harness/components/ccg-workflow"),
    entryIdentity: { dev: "1", ino: "12", birthtimeNs: "13" },
  });
  const second = buildBootstrapOwnership({
    repoRoot: "C:/harness",
    ccgSourcePath: "C:/harness/components/ccg-workflow",
    managed: { trellis: false, ccg: true },
    before: { trellis: null, ccg: firstInstalled },
    after: { trellis: null, ccg: secondInstalled },
    existingOwnership: first,
  });
  assert.equal(
    second.entries[0].originalBeforeFirstManagement.sourcePath,
    original.sourcePath,
  );
  assert.deepEqual(
    buildRestoreAction(second.entries[0]),
    { operation: "install", spec: original.sourcePath },
  );

  const userReplacement = {
    ...firstInstalled,
    entryIdentity: { dev: "1", ino: "99", birthtimeNs: "100" },
  };
  assert.equal(
    globalPackageSnapshotsEqual(userReplacement, firstInstalled),
    false,
  );
  assert.throws(
    () =>
      buildBootstrapOwnership({
        repoRoot: "C:/harness",
        ccgSourcePath: "C:/harness/components/ccg-workflow",
        managed: { trellis: false, ccg: true },
        before: { trellis: null, ccg: userReplacement },
        after: { trellis: null, ccg: secondInstalled },
        existingOwnership: first,
      }),
    /changed|refusing/i,
  );
});

test("ownership schema rejects extra fields, wrong targets, and redirected roots", () => {
  const repoRoot = path.resolve("C:/harness");
  const installed = packageSnapshot({
    version: "3.3.0",
    sourcePath: path.resolve("C:/harness/components/ccg-workflow"),
  });
  const valid = {
    schemaVersion: 2,
    repoRoot,
    updatedAt: new Date().toISOString(),
    entries: [
      {
        id: "ccg-link",
        kind: "npm-global-link",
        package: "ccg-workflow",
        originalBeforeFirstManagement: null,
        installedByHarness: installed,
      },
    ],
  };
  assert.equal(validateBootstrapOwnership(valid, repoRoot), valid);
  assert.throws(
    () => validateBootstrapOwnership({ ...valid, unexpected: true }, repoRoot),
    /schema|unexpected/i,
  );
  assert.throws(
    () =>
      validateBootstrapOwnership(
        {
          ...valid,
          repoRoot: path.resolve("C:/outside"),
        },
        repoRoot,
      ),
    /invalid|unsupported/i,
  );
  assert.throws(
    () =>
      validateBootstrapOwnership(
        {
          ...valid,
          entries: [
            {
              ...valid.entries[0],
              package: "user-package",
            },
          ],
        },
        repoRoot,
      ),
    /target|invalid/i,
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
