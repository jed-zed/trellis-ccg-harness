#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildBootstrapOwnership,
  buildRestoreAction,
  parseLifecycleArgs,
  resolvePackageManagerInvocation,
  validateUpdateSource,
} from "./lib/harness-lifecycle.mjs";
import { runCcgGates, runHarnessTests } from "./lib/harness-gates.mjs";
import {
  buildOwnedUninstallPlan,
  replaceComponentTransaction,
  rollbackLastTransaction,
} from "./lib/harness-transaction.mjs";

function run(command, args, options = {}) {
  const capture = options.capture === true;
  const invocation = resolvePackageManagerInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    shell: false,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  const allowed = options.allowedStatuses ?? [0];
  if (!allowed.includes(result.status)) {
    const details = capture
      ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
      : "";
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}` +
        (details ? `:\n${details}` : "."),
    );
  }
  return capture ? String(result.stdout ?? "").trim() : "";
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function atomicWrite(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function cachePath(repoRoot, name) {
  const target = path.resolve(repoRoot, ".harness-cache", name);
  const relative = path.relative(path.resolve(repoRoot), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Harness cache path escaped the repository: ${target}`);
  }
  return target;
}

function stateFromDependency(value) {
  if (!value) return null;
  return {
    ...(value.version ? { version: String(value.version) } : {}),
    ...(value.resolved ? { resolved: String(value.resolved) } : {}),
  };
}

function sourcePathFromResolved(resolved) {
  if (!resolved?.startsWith("file:")) return null;
  return path.resolve(decodeURIComponent(resolved.slice("file:".length)));
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value).replace(/\\/g, "/");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function statesEqual(left, right) {
  return (
    (left?.version ?? null) === (right?.version ?? null) &&
    (left?.resolved ?? null) === (right?.resolved ?? null)
  );
}

function observeGlobalPackages() {
  const output = run(
    "npm",
    [
      "ls",
      "-g",
      "ccg-workflow",
      "@mindfoldhq/trellis",
      "--depth=0",
      "--json",
    ],
    { capture: true, allowedStatuses: [0, 1] },
  );
  const parsed = output ? JSON.parse(output) : {};
  const dependencies = parsed.dependencies ?? {};
  return {
    trellis: stateFromDependency(dependencies["@mindfoldhq/trellis"]),
    ccg: stateFromDependency(dependencies["ccg-workflow"]),
  };
}

async function beginBootstrap(args) {
  const pendingPath = cachePath(args.repoRoot, "bootstrap-pending.json");
  const manifest = await readJson(
    path.join(args.repoRoot, "harness.sources.json"),
  );
  const pending = {
    schemaVersion: 1,
    repoRoot: args.repoRoot,
    createdAt: new Date().toISOString(),
    managed: {
      trellis: args.manageTrellis,
      ccg: args.manageCcg,
    },
    expected: {
      trellisVersion: String(manifest.trellis.version),
      ccgVersion: String(manifest.ccg.version),
    },
    ccgSourcePath: path.resolve(
      args.repoRoot,
      String(manifest.ccg.snapshotPath),
    ),
    before: observeGlobalPackages(),
  };
  await mkdir(path.dirname(pendingPath), { recursive: true, mode: 0o700 });
  await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`Bootstrap ownership transaction: ${pendingPath}\n`);
}

function assertBootstrapTransaction(pending, repoRoot) {
  if (!samePath(pending.repoRoot, repoRoot)) {
    throw new Error("Bootstrap ownership transaction belongs to another repo.");
  }
}

function assertManagedTrellis(pending, after) {
  if (
    pending.managed.trellis &&
    after.trellis?.version !== pending.expected.trellisVersion
  ) {
    throw new Error(
      `Managed Trellis version mismatch: expected `
      + `${pending.expected.trellisVersion}, got `
      + `${after.trellis?.version ?? "missing"}.`,
    );
  }
}

function assertManagedCcg(pending, after) {
  if (!pending.managed.ccg) return;
  if (after.ccg?.version !== pending.expected.ccgVersion) {
    throw new Error(
      `Managed CCG version mismatch: expected `
      + `${pending.expected.ccgVersion}, got `
      + `${after.ccg?.version ?? "missing"}.`,
    );
  }
  if (
    !samePath(
      sourcePathFromResolved(after.ccg.resolved),
      pending.ccgSourcePath,
    )
  ) {
    throw new Error(
      "Managed global CCG package is not linked to the Harness component.",
    );
  }
}

async function readExistingOwnership(ownershipPath) {
  try {
    return await readJson(ownershipPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { schemaVersion: 1, entries: [] };
    }
    throw error;
  }
}

function mergeOwnershipEntries(existing, recorded) {
  const managedIds = new Set(recorded.entries.map((entry) => entry.id));
  return [
    ...(existing.entries ?? []).filter((entry) => !managedIds.has(entry.id)),
    ...recorded.entries,
  ];
}

async function completeBootstrap(args) {
  const pendingPath = cachePath(args.repoRoot, "bootstrap-pending.json");
  const ownershipPath = cachePath(args.repoRoot, "ownership.json");
  const pending = await readJson(pendingPath);
  assertBootstrapTransaction(pending, args.repoRoot);
  const after = observeGlobalPackages();
  assertManagedTrellis(pending, after);
  assertManagedCcg(pending, after);

  const recorded = buildBootstrapOwnership({
    repoRoot: args.repoRoot,
    ccgSourcePath: pending.ccgSourcePath,
    managed: pending.managed,
    before: pending.before,
    after,
  });
  const existing = await readExistingOwnership(ownershipPath);
  recorded.entries = mergeOwnershipEntries(existing, recorded);
  await atomicWrite(
    ownershipPath,
    `${JSON.stringify(recorded, null, 2)}\n`,
  );
  await rm(pendingPath, { force: true });
  process.stdout.write(`Harness ownership manifest: ${ownershipPath}\n`);
}

function restoreGlobalEntry(entry) {
  const action = buildRestoreAction(entry);
  if (action.operation === "install") {
    run("npm", ["install", "-g", action.spec]);
  } else {
    run("npm", ["uninstall", "-g", action.spec]);
  }
}

async function abortBootstrap(args) {
  const pendingPath = cachePath(args.repoRoot, "bootstrap-pending.json");
  let pending;
  try {
    pending = await readJson(pendingPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const current = observeGlobalPackages();
  const candidates = [
    pending.managed.trellis
      ? {
          id: "trellis-global",
          package: "@mindfoldhq/trellis",
          before: pending.before.trellis,
          current: current.trellis,
        }
      : null,
    pending.managed.ccg
      ? {
          id: "ccg-link",
          package: "ccg-workflow",
          before: pending.before.ccg,
          current: current.ccg,
        }
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!statesEqual(candidate.before, candidate.current)) {
      restoreGlobalEntry({
        package: candidate.package,
        previous: candidate.before,
      });
    }
  }
  await rm(pendingPath, { force: true });
}

function git(repoRoot, args, options = {}) {
  return run("git", ["-C", repoRoot, ...args], {
    ...options,
    capture: options.capture ?? true,
  });
}

function assertCleanGit(repoRoot, label) {
  const dirty = git(
    repoRoot,
    ["status", "--porcelain", "--untracked-files=normal"],
    { capture: true },
  );
  if (dirty) {
    throw new Error(`${label} must be clean before the Harness transaction.`);
  }
}

async function resolveUpdateCheckout(args, manifest) {
  if (args.sourceCheckout) {
    assertCleanGit(args.sourceCheckout, "Authoritative CCG checkout");
    return {
      checkout: args.sourceCheckout,
      remoteName:
        String(manifest.ccg.authoritativeRemoteNameInSourceCheckout) ||
        "origin",
      cleanupRoot: null,
    };
  }

  const cleanupRoot = await mkdtemp(
    path.join(tmpdir(), "trellis-ccg-update-"),
  );
  run("git", ["init", cleanupRoot]);
  run("git", [
    "-C",
    cleanupRoot,
    "remote",
    "add",
    "origin",
    String(manifest.ccg.authoritativeRepository),
  ]);
  run("git", [
    "-C",
    cleanupRoot,
    "fetch",
    "--no-tags",
    "--depth=1",
    "origin",
    args.ccgCommit,
  ]);
  run("git", ["-C", cleanupRoot, "checkout", "--detach", "FETCH_HEAD"]);
  return { checkout: cleanupRoot, remoteName: "origin", cleanupRoot };
}

async function exportCommit(checkout, commit, temporaryRoot) {
  const archivePath = path.join(temporaryRoot, "ccg-source.tar");
  const exportRoot = path.join(temporaryRoot, "export");
  await mkdir(exportRoot, { recursive: true, mode: 0o700 });
  run("git", [
    "-C",
    checkout,
    "archive",
    "--format=tar",
    `--output=${archivePath}`,
    commit,
  ]);
  run("tar", ["-xf", archivePath, "-C", exportRoot]);
  return exportRoot;
}

function runHarnessDoctor(repoRoot) {
  run(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      path.join(repoRoot, "scripts", "doctor.ps1"),
      "-RepoRoot",
      repoRoot,
    ],
    { cwd: repoRoot },
  );
}

function validateResolvedUpdateSource(resolved, args, manifest) {
  const repository = git(
    resolved.checkout,
    ["remote", "get-url", resolved.remoteName],
    { capture: true },
  );
  const commit = git(resolved.checkout, ["rev-parse", "HEAD"], {
    capture: true,
  }).toLowerCase();
  const gitTree = git(
    resolved.checkout,
    ["rev-parse", `${args.ccgCommit}^{tree}`],
    { capture: true },
  ).toLowerCase();
  return validateUpdateSource({
    expected: {
      repository: String(manifest.ccg.authoritativeRepository),
      commit: args.ccgCommit,
      gitTree,
    },
    actual: { repository, commit, gitTree },
  });
}

async function prepareUpdateCandidate(args, manifest, resolved, temporaryRoot) {
  const source = validateResolvedUpdateSource(resolved, args, manifest);
  assertCleanGit(resolved.checkout, "Authoritative CCG checkout");
  const verificationCommands = runCcgGates(resolved.checkout, run);
  assertCleanGit(
    resolved.checkout,
    "Authoritative CCG checkout after quality gates",
  );
  const candidateDir = await exportCommit(
    resolved.checkout,
    source.commit,
    temporaryRoot,
  );
  return { source, verificationCommands, candidateDir };
}

function writeUpdateReceipt(source, record) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "updated",
        commit: source.commit,
        gitTree: source.gitTree,
        transaction: record.id,
        next: "Review the exact component/manifest diff, commit it, then run pnpm doctor.",
      },
      null,
      2,
    )}\n`,
  );
}

async function updateHarness(args) {
  assertCleanGit(args.repoRoot, "Harness repository");
  const manifest = await readJson(
    path.join(args.repoRoot, "harness.sources.json"),
  );

  runHarnessDoctor(args.repoRoot);
  const resolved = await resolveUpdateCheckout(args, manifest);
  const exportTemporary = await mkdtemp(
    path.join(tmpdir(), "trellis-ccg-export-"),
  );
  try {
    const prepared = await prepareUpdateCandidate(
      args,
      manifest,
      resolved,
      exportTemporary,
    );

    const record = await replaceComponentTransaction({
      repoRoot: args.repoRoot,
      candidateDir: prepared.candidateDir,
      commit: prepared.source.commit,
      gitTree: prepared.source.gitTree,
      verification: {
        repository: prepared.source.repository,
        commands: prepared.verificationCommands,
      },
      afterReplace: () => runHarnessTests(args.repoRoot, run),
    });
    writeUpdateReceipt(prepared.source, record);
  } finally {
    await rm(exportTemporary, { recursive: true, force: true });
    if (resolved.cleanupRoot) {
      await rm(resolved.cleanupRoot, { recursive: true, force: true });
    }
  }
}

async function rollbackHarness(args) {
  const record = await rollbackLastTransaction({
    repoRoot: args.repoRoot,
    afterRestore: () => runHarnessTests(args.repoRoot, run),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "rolled-back",
      transaction: record.id,
      next: "Review and commit the restored component/manifest state.",
    }, null, 2)}\n`,
  );
}

async function uninstallHarness(args) {
  const ownershipPath = cachePath(args.repoRoot, "ownership.json");
  let ownership;
  try {
    ownership = await readJson(ownershipPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stdout.write("No Harness-owned global state is recorded.\n");
      return;
    }
    throw error;
  }

  const current = observeGlobalPackages();
  const observations = {
    "trellis-global": { version: current.trellis?.version },
    "ccg-link": {
      sourcePath: sourcePathFromResolved(current.ccg?.resolved),
    },
  };
  const plan = buildOwnedUninstallPlan(ownership, observations);
  for (const entry of plan.remove) restoreGlobalEntry(entry);

  ownership.entries = plan.skip;
  ownership.updatedAt = new Date().toISOString();
  await atomicWrite(
    ownershipPath,
    `${JSON.stringify(ownership, null, 2)}\n`,
  );

  for (const entry of plan.skip) {
    process.stderr.write(
      `Preserved modified or replaced global state: ${entry.id}\n`,
    );
  }
  process.stdout.write(
    `Harness uninstall restored/removed ${plan.remove.length} owned `
    + `global item(s); preserved ${plan.skip.length} item(s).\n`,
  );
  if (plan.skip.length > 0) process.exitCode = 2;
}

async function main() {
  const args = parseLifecycleArgs(process.argv.slice(2));
  if (args.command === "bootstrap-begin") return beginBootstrap(args);
  if (args.command === "bootstrap-complete") return completeBootstrap(args);
  if (args.command === "bootstrap-abort") return abortBootstrap(args);
  if (args.command === "update") return updateHarness(args);
  if (args.command === "rollback") return rollbackHarness(args);
  return uninstallHarness(args);
}

main().catch((error) => {
  process.stderr.write(`Harness lifecycle failed: ${error.message}\n`);
  process.exitCode = 1;
});
