#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBootstrapOwnership,
  buildOwnedUninstallPlan,
  buildRestoreAction,
  assertBootstrapOwnershipContinuity,
  assertNoIgnoredComponentState,
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
  validateGlobalPackageSnapshot,
  validateUpdateSource,
} from "./lib/harness-lifecycle.mjs";
import { runCcgGates, runHarnessTests } from "./lib/harness-gates.mjs";
import {
  recoverInterruptedTransaction,
  replaceComponentTransaction,
  replaceManagedFilesTransaction,
  rollbackLastTransaction,
} from "./lib/harness-transaction.mjs";
import {
  assertSafeRegularFileOrAbsent,
  ensureSafeDirectoryChain,
  safeAtomicWrite,
  safeRemove,
} from "./lib/harness-fs.mjs";
import {
  materializeGitTree,
  verifyMaterializedGitTree,
} from "./lib/git-tree-materializer.mjs";

function run(command, args, options = {}) {
  const capture = options.capture === true;
  const encoding = options.encoding === null ? null : "utf8";
  const invocation = resolvePackageManagerInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding,
    shell: false,
    input: options.input,
    maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
    stdio: capture
      ? [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
      : options.input === undefined
        ? "inherit"
        : ["pipe", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  const allowed = options.allowedStatuses ?? [0];
  if (!allowed.includes(result.status)) {
    const details = capture
      ? [result.stdout, result.stderr]
          .filter(Boolean)
          .map((value) =>
            Buffer.isBuffer(value) ? value.toString("utf8") : value,
          )
          .join("\n")
          .trim()
      : "";
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}` +
        (details ? `:\n${details}` : "."),
    );
  }
  if (!capture) return "";
  return encoding === null
    ? Buffer.from(result.stdout ?? [])
    : String(result.stdout ?? "").trim();
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(repoRoot, filePath, value, label) {
  await safeAtomicWrite(repoRoot, filePath, value, label);
}

function cachePath(repoRoot, name) {
  const target = path.resolve(repoRoot, ".harness-cache", name);
  const relative = path.relative(path.resolve(repoRoot), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Harness cache path escaped the repository: ${target}`);
  }
  return target;
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value).replace(/\\/g, "/");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

async function observeGlobalPackages() {
  // npm 11 redacts UUID path segments in `npm root -g` output. An explicit
  // prefix is already the authoritative install location, so derive it here.
  const globalRoot = globalPackageRootFromNpmPrefix(
    process.env.NPM_CONFIG_PREFIX,
    { platform: process.platform },
  ) ?? run("npm", ["root", "-g"], { capture: true });
  const [trellis, ccg] = await Promise.all([
    inspectGlobalPackage(globalRoot, "@mindfoldhq/trellis"),
    inspectGlobalPackage(globalRoot, "ccg-workflow"),
  ]);
  return {
    trellis,
    ccg,
  };
}

async function beginBootstrap(args) {
  const pendingPath = cachePath(args.repoRoot, "bootstrap-pending.json");
  const ownershipPath = cachePath(args.repoRoot, "ownership.json");
  const manifest = await readJson(
    path.join(args.repoRoot, "harness.sources.json"),
  );
  const before = await observeGlobalPackages();
  const existing = await readExistingOwnership(
    ownershipPath,
    args.repoRoot,
  );
  assertBootstrapOwnershipContinuity(
    existing,
    before,
    {
      trellis: args.manageTrellis,
      ccg: args.manageCcg,
    },
    args.repoRoot,
  );
  const pending = {
    schemaVersion: 2,
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
    before,
  };
  await ensureSafeDirectoryChain(
    args.repoRoot,
    pending.ccgSourcePath,
    "Harness CCG component",
  );
  await ensureSafeDirectoryChain(
    args.repoRoot,
    path.dirname(pendingPath),
    "Bootstrap transaction state",
    { create: true },
  );
  await assertSafeRegularFileOrAbsent(
    args.repoRoot,
    pendingPath,
    "Bootstrap pending record",
  );
  await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`Bootstrap ownership transaction: ${pendingPath}\n`);
}

function assertBootstrapTransaction(pending, repoRoot) {
  const required = [
    "schemaVersion",
    "repoRoot",
    "createdAt",
    "managed",
    "expected",
    "ccgSourcePath",
    "before",
  ];
  const keys = Object.keys(pending ?? {});
  if (
    pending?.schemaVersion !== 2 ||
    keys.length !== required.length ||
    required.some((key) => !keys.includes(key)) ||
    typeof pending.createdAt !== "string" ||
    typeof pending.managed?.trellis !== "boolean" ||
    typeof pending.managed?.ccg !== "boolean" ||
    Object.keys(pending.managed).sort().join(",") !== "ccg,trellis" ||
    typeof pending.expected?.trellisVersion !== "string" ||
    typeof pending.expected?.ccgVersion !== "string" ||
    Object.keys(pending.expected).sort().join(",") !==
      "ccgVersion,trellisVersion" ||
    typeof pending.ccgSourcePath !== "string" ||
    !path.isAbsolute(pending.ccgSourcePath) ||
    Object.keys(pending.before ?? {}).sort().join(",") !== "ccg,trellis"
  ) {
    throw new Error("Bootstrap ownership transaction has an invalid schema.");
  }
  validateGlobalPackageSnapshot(
    pending.before.trellis,
    "Bootstrap previous Trellis",
  );
  validateGlobalPackageSnapshot(
    pending.before.ccg,
    "Bootstrap previous CCG",
  );
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
      after.ccg.sourcePath,
      pending.ccgSourcePath,
    )
  ) {
    throw new Error(
      "Managed global CCG package is not linked to the Harness component.",
    );
  }
}

async function readExistingOwnership(ownershipPath, repoRoot) {
  await assertSafeRegularFileOrAbsent(
    repoRoot,
    ownershipPath,
    "Bootstrap ownership record",
  );
  try {
    return validateBootstrapOwnership(
      await readJson(ownershipPath),
      repoRoot,
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        schemaVersion: 2,
        repoRoot: path.resolve(repoRoot),
        updatedAt: new Date(0).toISOString(),
        entries: [],
      };
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
  await assertSafeRegularFileOrAbsent(
    args.repoRoot,
    pendingPath,
    "Bootstrap pending record",
  );
  const pending = await readJson(pendingPath);
  assertBootstrapTransaction(pending, args.repoRoot);
  const after = await observeGlobalPackages();
  assertManagedTrellis(pending, after);
  assertManagedCcg(pending, after);

  const recorded = buildBootstrapOwnership({
    repoRoot: args.repoRoot,
    ccgSourcePath: pending.ccgSourcePath,
    managed: pending.managed,
    before: pending.before,
    after,
    existingOwnership: await readExistingOwnership(
      ownershipPath,
      args.repoRoot,
    ),
  });
  const existing = await readExistingOwnership(
    ownershipPath,
    args.repoRoot,
  );
  recorded.entries = mergeOwnershipEntries(existing, recorded);
  await atomicWrite(
    args.repoRoot,
    ownershipPath,
    `${JSON.stringify(recorded, null, 2)}\n`,
    "Bootstrap ownership record",
  );
  await safeRemove(
    args.repoRoot,
    pendingPath,
    "Bootstrap pending record",
  );
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
    await assertSafeRegularFileOrAbsent(
      args.repoRoot,
      pendingPath,
      "Bootstrap pending record",
    );
    pending = await readJson(pendingPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  assertBootstrapTransaction(pending, args.repoRoot);
  const current = await observeGlobalPackages();
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
    if (!globalPackageSnapshotsEqual(candidate.before, candidate.current)) {
      restoreGlobalEntry({
        id: candidate.id,
        kind:
          candidate.id === "ccg-link"
            ? "npm-global-link"
            : "npm-global-package",
        package: candidate.package,
        originalBeforeFirstManagement: candidate.before,
        installedByHarness: candidate.current ?? candidate.before,
      });
    }
  }
  await safeRemove(
    args.repoRoot,
    pendingPath,
    "Bootstrap pending record",
  );
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

function resolveSparseArchiveExclusions(checkout, previousCommit, targetCommit) {
  const sparseOutput = run("git", ["-C", checkout, "sparse-checkout", "list"], {
    capture: true,
    allowedStatuses: [0, 1, 128],
  });
  const exclusions = parseSparseArchiveExclusions(sparseOutput);
  if (exclusions.length === 0) return [];
  const changedOutput = run(
    "git",
    [
      "-C",
      checkout,
      "diff",
      "--name-only",
      previousCommit,
      targetCommit,
      "--",
      ...exclusions,
    ],
    { capture: true },
  );
  const changedPaths = changedOutput.split(/\r?\n/).filter(Boolean);
  return assertSparseExclusionsUnchanged(exclusions, changedPaths);
}

async function exportCommit(checkout, commit, temporaryRoot, exclusions = []) {
  const exportRoot = path.join(temporaryRoot, "export");
  const materialized = await materializeGitTree({
    checkout,
    commit,
    destination: exportRoot,
    exclusions,
    execute: run,
  });
  return {
    candidateDir: exportRoot,
    treeEntries: materialized.entries,
    manifestSha256: materialized.manifestSha256,
  };
}

export function buildHarnessDoctorArguments(
  repoRoot,
  { ccgUpdateTargetVersion = null } = {},
) {
  const doctorArguments = [
    "-NoProfile",
    "-File",
    path.join(repoRoot, "scripts", "doctor.ps1"),
    "-RepoRoot",
    repoRoot,
  ];
  if (ccgUpdateTargetVersion) {
    doctorArguments.push(
      "-CcgUpdateTargetVersion",
      ccgUpdateTargetVersion,
    );
  }
  return doctorArguments;
}

function runHarnessDoctor(repoRoot, options = {}) {
  run(
    "pwsh",
    buildHarnessDoctorArguments(repoRoot, options),
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

function readTargetCcgVersion(resolved, source, manifest) {
  let targetPackage;
  try {
    targetPackage = JSON.parse(
      git(
        resolved.checkout,
        ["show", `${source.commit}:package.json`],
        { capture: true },
      ),
    );
  } catch (error) {
    throw new Error(
      `Target CCG package manifest is missing or invalid: ${error.message}`,
    );
  }
  if (targetPackage.name !== manifest.ccg.package) {
    throw new Error(
      `Target CCG package mismatch: expected ${manifest.ccg.package}, `
      + `got ${targetPackage.name ?? "missing"}.`,
    );
  }
  const version = String(targetPackage.version ?? "");
  compareSemanticVersions(version, version);
  return version;
}

async function prepareUpdateCandidate(args, manifest, resolved, temporaryRoot) {
  const source = validateResolvedUpdateSource(resolved, args, manifest);
  assertCleanGit(resolved.checkout, "Authoritative CCG checkout");
  const verificationCommands = runCcgGates(resolved.checkout, run);
  assertCleanGit(
    resolved.checkout,
    "Authoritative CCG checkout after quality gates",
  );
  const archiveExclusions = resolveSparseArchiveExclusions(
    resolved.checkout,
    String(manifest.ccg.commit),
    source.commit,
  );
  const materialized = await exportCommit(
    resolved.checkout,
    source.commit,
    temporaryRoot,
    archiveExclusions,
  );
  return {
    source,
    verificationCommands,
    ...materialized,
    archiveExclusions,
  };
}

async function readOwnershipIfPresent(repoRoot) {
  const ownershipPath = cachePath(repoRoot, "ownership.json");
  const present = await assertSafeRegularFileOrAbsent(
    repoRoot,
    ownershipPath,
    "Bootstrap ownership record",
  );
  if (!present) return null;
  return validateBootstrapOwnership(
    await readJson(ownershipPath),
    repoRoot,
  );
}

function assertVersionOutput(output, expected, label) {
  const lines = String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionPattern = new RegExp(
    `(?:^|[/@])${escaped}(?:$|\\s)`,
  );
  if (!lines.some((line) => line === expected || versionPattern.test(line))) {
    throw new Error(
      `${label} version mismatch: expected ${expected}, got `
      + `${lines.join(" | ") || "no output"}.`,
    );
  }
}

function assertNoIgnoredCcgComponentState(repoRoot, manifest) {
  const componentPath = String(manifest.ccg?.snapshotPath ?? "");
  if (componentPath !== "components/ccg-workflow") {
    throw new Error(
      "CCG component path must be components/ccg-workflow before update.",
    );
  }
  const output = git(
    repoRoot,
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      componentPath,
    ],
    { capture: true },
  );
  return assertNoIgnoredComponentState(output.split("\0"));
}

async function runFinalCcgVerification(args, manifest, prepared) {
  const componentRoot = path.resolve(
    args.repoRoot,
    String(manifest.ccg.snapshotPath),
  );
  const finalCommands = runCcgGates(componentRoot, run);
  const materialized = await verifyMaterializedGitTree(
    componentRoot,
    prepared.treeEntries,
    { allowedExtraRoots: ["dist", "node_modules"] },
  );
  if (materialized.manifestSha256 !== prepared.manifestSha256) {
    throw new Error("Final CCG tracked-tree manifest digest changed.");
  }

  finalCommands.push(
    ...(await runActivatedCcgCliSmokes(args.repoRoot, componentRoot)),
  );

  await runHarnessTests(args.repoRoot, run);
  finalCommands.push("node --test tests/*.test.mjs");
  return finalCommands;
}

async function runActivatedCcgCliSmokes(repoRoot, componentRoot) {
  const commands = [];
  const packageManifest = await readJson(
    path.join(componentRoot, "package.json"),
  );
  const localVersion = run(
    process.execPath,
    [path.join(componentRoot, "bin", "ccg.mjs"), "--version"],
    { cwd: componentRoot, capture: true },
  );
  assertVersionOutput(
    localVersion,
    String(packageManifest.version),
    "Final-path CCG CLI",
  );
  commands.push("node bin/ccg.mjs --version");

  const ownership = await readOwnershipIfPresent(repoRoot);
  const ccgOwnership = ownership?.entries.find(
    (entry) => entry.id === "ccg-link",
  );
  if (ccgOwnership) {
    const globalPackages = await observeGlobalPackages();
    if (
      !globalPackages.ccg?.sourcePath ||
      !samePath(globalPackages.ccg.sourcePath, componentRoot) ||
      !globalPackageSnapshotsEqual(
        globalPackages.ccg,
        ccgOwnership.installedByHarness,
      )
    ) {
      throw new Error(
        "Harness-owned global CCG link no longer matches its ownership fingerprint.",
      );
    }
    const globalVersion =
      process.platform === "win32"
        ? run(
            process.env.ComSpec || "cmd.exe",
            ["/d", "/s", "/c", "ccg --version"],
            { cwd: repoRoot, capture: true },
          )
        : run("ccg", ["--version"], {
            cwd: repoRoot,
            capture: true,
          });
    assertVersionOutput(
      globalVersion,
      String(packageManifest.version),
      "Harness-managed global CCG CLI",
    );
    commands.push("ccg --version");
  }
  return commands;
}

const PROTECTED_CCG_PATHS = [
  "components/ccg-workflow/templates/skills/domains/security/pentest.md",
  "components/ccg-workflow/templates/skills/domains/security/red-team.md",
];

function splitNullList(value) {
  return String(value ?? "")
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveTrellisIntegrity(version) {
  const output = run(
    "npm",
    [
      "view",
      `@mindfoldhq/trellis@${version}`,
      "dist.integrity",
      "--json",
    ],
    { capture: true },
  );
  const integrity = JSON.parse(output);
  if (
    typeof integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)
  ) {
    throw new Error(
      `npm returned an invalid integrity for Trellis ${version}.`,
    );
  }
  return integrity;
}

async function assertProtectedPathsAbsent(worktree) {
  for (const relative of PROTECTED_CCG_PATHS) {
    if (await exists(path.join(worktree, ...relative.split("/")))) {
      throw new Error(
        `Protected path was materialized in the Trellis candidate: ${relative}.`,
      );
    }
  }
}

function collectWorktreeChanges(worktree) {
  const tracked = splitNullList(
    git(worktree, ["diff", "--name-only", "-z", "HEAD"], {
      capture: true,
    }),
  );
  const untracked = splitNullList(
    git(
      worktree,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { capture: true },
    ),
  );
  const changed = [...new Set([...tracked, ...untracked])].sort();
  const claudeChanges = changed.filter(
    (relative) =>
      relative === ".claude" || relative.startsWith(".claude/"),
  );
  if (claudeChanges.length > 0) {
    throw new Error(
      `Trellis candidate retained forbidden Claude runtime changes: ${claudeChanges.join(", ")}.`,
    );
  }
  const conflicts = changed.filter((relative) =>
    relative.endsWith(".new"),
  );
  if (conflicts.length > 0) {
    throw new Error(
      `Trellis produced unresolved conflict copies: ${conflicts.join(", ")}.`,
    );
  }
  return changed.filter(
    (relative) =>
      !relative.startsWith(".trellis/.backup/") &&
      !relative.startsWith(".trellis/tasks/") &&
      !relative.startsWith(".trellis/spec/") &&
      !relative.startsWith(".trellis/workspace/"),
  );
}

function restoreProjectClaudeBaseline(worktree) {
  const tracked = splitNullList(
    git(
      worktree,
      ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ".claude"],
      { capture: true },
    ),
  );
  if (tracked.length > 0) {
    git(worktree, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ".claude",
    ]);
  }
  git(worktree, ["clean", "-fd", "--", ".claude"], { capture: true });
}

async function addSparseTrellisWorktree(repoRoot, worktree) {
  git(repoRoot, [
    "worktree",
    "add",
    "--detach",
    "--no-checkout",
    worktree,
    "HEAD",
  ]);
  git(worktree, ["sparse-checkout", "init", "--no-cone"]);
  git(worktree, [
    "sparse-checkout",
    "set",
    "--no-cone",
    "/*",
    ...PROTECTED_CCG_PATHS.map((relative) => `!/${relative}`),
  ]);
  git(worktree, ["checkout", "--detach", "HEAD"]);
  await assertProtectedPathsAbsent(worktree);
}

async function runTrellisCandidateUpdate(worktree, version) {
  const updateOutput = run(
    "pnpm",
    [
      "dlx",
      `@mindfoldhq/trellis@${version}`,
      "update",
      "--skip-all",
      "--migrate",
    ],
    { cwd: worktree, capture: true },
  );
  const actualVersion = (
    await readFile(path.join(worktree, ".trellis", ".version"), "utf8")
  ).trim();
  if (actualVersion !== version) {
    throw new Error(
      `Trellis candidate version mismatch: expected ${version}, got ${actualVersion}.`,
    );
  }
  await assertProtectedPathsAbsent(worktree);
  return updateOutput;
}

async function updateTrellisCandidateProvenance(
  worktree,
  manifest,
  version,
  integrity,
) {
  const previousVersion = String(manifest.trellis.version);
  const manifestPath = path.join(worktree, "harness.sources.json");
  const candidateManifest = await readJson(manifestPath);
  candidateManifest.trellis = {
    ...candidateManifest.trellis,
    version,
    integrity,
    sourceMode: "generated-project-assets-from-explicit-version",
  };
  candidateManifest.capturedAt = new Date().toISOString();
  await atomicWrite(
    worktree,
    manifestPath,
    `${JSON.stringify(candidateManifest, null, 2)}\n`,
    "Trellis candidate source manifest",
  );

  const readmePath = path.join(worktree, "README.md");
  await atomicWrite(
    worktree,
    readmePath,
    updateTrellisProvenanceText(
      await readFile(readmePath, "utf8"),
      previousVersion,
      version,
    ),
    "Trellis candidate README",
  );
  return integrity;
}

function summarizeTrellisUpdate(version, updateOutput, changedPaths) {
  return {
    command:
      `pnpm dlx @mindfoldhq/trellis@${version} `
      + "update --skip-all --migrate",
    strategy: "preserve-modified-project-overlays",
    changedPaths: changedPaths.length,
    updateOutput: updateOutput
      .split(/\r?\n/)
      .filter((line) => /modified|unchanged|updated|skipped/i.test(line))
      .slice(0, 20),
  };
}

async function prepareTrellisWorktree(
  args,
  manifest,
  worktree,
  temporaryRoot,
  previousVersion,
) {
  const integrity = resolveTrellisIntegrity(args.trellisVersion);
  const updateOutput = await runTrellisCandidateUpdate(
    worktree,
    args.trellisVersion,
  );
  restoreProjectClaudeBaseline(worktree);
  await updateTrellisCandidateProvenance(
    worktree,
    manifest,
    args.trellisVersion,
    integrity,
  );
  const changedPaths = collectWorktreeChanges(worktree);
  runHarnessTests(worktree, run);
  await assertProtectedPathsAbsent(worktree);
  return {
    candidateRoot: worktree,
    temporaryRoot,
    worktreeAdded: true,
    changedPaths,
    previous: {
      version: previousVersion,
      integrity: String(manifest.trellis.integrity ?? ""),
    },
    current: {
      version: args.trellisVersion,
      integrity,
    },
    verification: summarizeTrellisUpdate(
      args.trellisVersion,
      updateOutput,
      changedPaths,
    ),
  };
}

export async function createTrellisCandidate(args, manifest) {
  const previousVersion = String(manifest.trellis?.version ?? "");
  if (compareSemanticVersions(args.trellisVersion, previousVersion) < 0) {
    throw new Error(
      `Refusing Trellis downgrade from ${previousVersion} to ${args.trellisVersion}.`,
    );
  }
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "trellis-harness-update-"),
  );
  const worktree = path.join(temporaryRoot, "worktree");
  let worktreeAdded = false;
  try {
    worktreeAdded = true;
    await addSparseTrellisWorktree(args.repoRoot, worktree);
    return await prepareTrellisWorktree(
      args,
      manifest,
      worktree,
      temporaryRoot,
      previousVersion,
    );
  } catch (error) {
    if (worktreeAdded) {
      git(
        args.repoRoot,
        ["worktree", "remove", "--force", worktree],
        { allowedStatuses: [0, 128] },
      );
    }
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupTrellisCandidate(repoRoot, prepared) {
  if (prepared.worktreeAdded) {
    git(
      repoRoot,
      ["worktree", "remove", "--force", prepared.candidateRoot],
      { allowedStatuses: [0, 128] },
    );
    git(repoRoot, ["worktree", "prune"], { allowedStatuses: [0] });
  }
  await rm(prepared.temporaryRoot, { recursive: true, force: true });
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

async function updateCcgHarness(args, manifest) {
  assertNoIgnoredCcgComponentState(args.repoRoot, manifest);
  const resolved = await resolveUpdateCheckout(args, manifest);
  const exportTemporary = await mkdtemp(
    path.join(tmpdir(), "trellis-ccg-export-"),
  );
  try {
    const source = validateResolvedUpdateSource(resolved, args, manifest);
    const targetVersion = readTargetCcgVersion(resolved, source, manifest);
    runHarnessDoctor(args.repoRoot, {
      ccgUpdateTargetVersion: targetVersion,
    });
    const prepared = await prepareUpdateCandidate(
      args,
      manifest,
      resolved,
      exportTemporary,
    );
    const verification = {
      repository: prepared.source.repository,
      commands: prepared.verificationCommands,
      preservedSparsePaths: prepared.archiveExclusions,
      candidateManifestSha256: prepared.manifestSha256,
      finalCommands: [],
    };

    const record = await replaceComponentTransaction({
      repoRoot: args.repoRoot,
      candidateDir: prepared.candidateDir,
      commit: prepared.source.commit,
      gitTree: prepared.source.gitTree,
      verification,
      afterReplace: async () => {
        verification.finalCommands = await runFinalCcgVerification(
          args,
          manifest,
          prepared,
        );
      },
    });
    writeUpdateReceipt(prepared.source, record);
  } finally {
    await rm(exportTemporary, { recursive: true, force: true });
    if (resolved.cleanupRoot) {
      await rm(resolved.cleanupRoot, { recursive: true, force: true });
    }
  }
}

async function updateTrellisHarness(args, manifest) {
  const previousVersion = String(manifest.trellis?.version ?? "");
  if (args.trellisVersion === previousVersion) {
    process.stdout.write(
      `${JSON.stringify({
        status: "unchanged",
        source: "trellis",
        version: previousVersion,
      }, null, 2)}\n`,
    );
    return;
  }

  const prepared = await createTrellisCandidate(args, manifest);
  try {
    const record = await replaceManagedFilesTransaction({
      repoRoot: args.repoRoot,
      candidateRoot: prepared.candidateRoot,
      paths: prepared.changedPaths,
      kind: "trellis",
      previous: prepared.previous,
      current: prepared.current,
      verification: prepared.verification,
      afterApply: () => runHarnessTests(args.repoRoot, run),
    });
    process.stdout.write(
      `${JSON.stringify({
        status: "updated",
        source: "trellis",
        version: prepared.current.version,
        integrity: prepared.current.integrity,
        transaction: record.id,
        changedPaths: prepared.changedPaths.length,
        next:
          "Run pnpm bootstrap to align the global Trellis CLI, then review, "
          + "commit, and run pnpm doctor.",
      }, null, 2)}\n`,
    );
  } finally {
    await cleanupTrellisCandidate(args.repoRoot, prepared);
  }
}

async function updateHarness(args) {
  assertCleanGit(args.repoRoot, "Harness repository");
  const manifest = await readJson(
    path.join(args.repoRoot, "harness.sources.json"),
  );
  if (args.trellisVersion) {
    runHarnessDoctor(args.repoRoot);
    return updateTrellisHarness(args, manifest);
  }
  return updateCcgHarness(args, manifest);
}

async function rollbackHarness(args) {
  const record = await rollbackLastTransaction({
    repoRoot: args.repoRoot,
    afterRestore: async () => {
      const manifest = await readJson(
        path.join(args.repoRoot, "harness.sources.json"),
      );
      const componentRoot = path.resolve(
        args.repoRoot,
        String(manifest.ccg.snapshotPath),
      );
      await runActivatedCcgCliSmokes(args.repoRoot, componentRoot);
      await runHarnessTests(args.repoRoot, run);
    },
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "rolled-back",
      transaction: record.id,
      next: "Review and commit the restored component/manifest state.",
    }, null, 2)}\n`,
  );
}

async function recoverHarness(args) {
  const result = await recoverInterruptedTransaction({
    repoRoot: args.repoRoot,
    afterRecover: () => runHarnessTests(args.repoRoot, run),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "recovered",
      operation: result.operation,
      outcome: result.outcome,
      transaction: result.transaction,
      next: "Review Git state, then run pnpm doctor.",
    }, null, 2)}\n`,
  );
}

async function uninstallHarness(args) {
  const ownershipPath = cachePath(args.repoRoot, "ownership.json");
  let ownership;
  try {
    await assertSafeRegularFileOrAbsent(
      args.repoRoot,
      ownershipPath,
      "Bootstrap ownership record",
    );
    ownership = validateBootstrapOwnership(
      await readJson(ownershipPath),
      args.repoRoot,
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stdout.write("No Harness-owned global state is recorded.\n");
      return;
    }
    throw error;
  }

  const current = await observeGlobalPackages();
  const observations = {
    "trellis-global": current.trellis,
    "ccg-link": current.ccg,
  };
  const plan = buildOwnedUninstallPlan(
    ownership,
    observations,
    args.repoRoot,
  );
  for (const entry of plan.remove) restoreGlobalEntry(entry);

  ownership.entries = plan.skip;
  ownership.updatedAt = new Date().toISOString();
  await atomicWrite(
    args.repoRoot,
    ownershipPath,
    `${JSON.stringify(ownership, null, 2)}\n`,
    "Bootstrap ownership record",
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
  if (args.command === "recover") return recoverHarness(args);
  return uninstallHarness(args);
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`Harness lifecycle failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
