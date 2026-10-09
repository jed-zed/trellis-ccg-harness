#!/usr/bin/env node

import { assertCodexMutationHost } from "../.agents/skills/harness-init/scripts/codex-host-boundary.mjs";
import { createHash } from "node:crypto";

import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  lstat,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertManagedCcgRuntimePackage,
  buildBootstrapOwnership,
  buildOwnedUninstallPlan,
  buildRestoreAction,
  assertBootstrapOwnershipContinuity,
  assertNoIgnoredComponentState,
  assertSparseExclusionsUnchanged,
  compareSemanticVersions,
  globalPackageRootFromNpmPrefix,
  globalPackageSnapshotsEqual,
  inspectCcgCommandFiles,
  ccgCommandFilesEqual,
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
import { resolveCcgRuntimePackage, validateCcgRuntimePackage } from "./ccg-runtime.mjs";
import {
  acquireTransactionLock,
  recoverInterruptedTransaction,
  replaceComponentTransaction,
  replaceManagedFilesTransaction,
  rollbackLastTransaction,
} from "./lib/harness-transaction.mjs";
import { assertLegacyClaimMutationAllowed } from "./lib/ccg-legacy-claim-guard.mjs";
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

async function observeGlobalPackages(ccgPackage = "ccg-workflow") {
  // npm 11 redacts UUID path segments in `npm root -g` output. An explicit
  // prefix is already the authoritative install location, so derive it here.
  const globalRoot = globalPackageRootFromNpmPrefix(
    process.env.NPM_CONFIG_PREFIX,
    { platform: process.platform },
  ) ?? run("npm", ["root", "-g"], { capture: true });
  const [trellis, ccg] = await Promise.all([
    inspectGlobalPackage(globalRoot, "@mindfoldhq/trellis"),
    inspectGlobalPackage(globalRoot, resolveCcgRuntimePackage(ccgPackage).packageName),
  ]);
  return {
    trellis,
    ccg,
  };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function boundedRegularBytes(filename, label) {
  const details = await lstat(filename);
  if (!details.isFile() || details.isSymbolicLink() || details.size > 4 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file.`);
  return readFile(filename);
}

function migrationPrefix() {
  const prefix = process.env.NPM_CONFIG_PREFIX;
  if (!prefix || !path.isAbsolute(prefix)) throw new Error("CCG namespace migration requires an explicit absolute NPM_CONFIG_PREFIX.");
  return path.resolve(prefix);
}

async function inspectRetainedSlot(ownership, { requireRetained = false } = {}) {
  const slot = ownership.entries.find(entry => entry.id === "ccg-legacy-retained");
  if (!slot || (slot.disposition !== "retained" && !requireRetained)) return null;
  if (slot.disposition !== "retained") throw new Error("Legacy CCG slot has already been released.");
  const globalRoot = globalPackageRootFromNpmPrefix(migrationPrefix(), { platform: process.platform });
  const observed = await inspectGlobalPackage(globalRoot, "ccg-workflow");
  if (!globalPackageSnapshotsEqual(observed, slot.installedByHarness) ||
      !ccgCommandFilesEqual(await inspectCcgCommandFiles(slot.installedByHarness.entryPath, slot.package), slot.commandFiles)) throw new Error("Retained legacy CCG package or command changed; refusing ownership handoff.");
  return slot;
}

async function buildNamespaceMigrationPlan(repoRoot) {
  const prefix = migrationPrefix();
  const globalRoot = globalPackageRootFromNpmPrefix(prefix, { platform: process.platform });
  const manifestBytes = await boundedRegularBytes(path.join(repoRoot, "harness.sources.json"), "Harness source manifest");
  const manifest = JSON.parse(manifestBytes);
  const runtime = resolveCcgRuntimePackage(manifest.ccg.package);
  if (runtime.packageName !== "@jed-zed/ccg-codex-workflow") throw new Error("Namespace migration only accepts the personal scoped Codex runtime.");
  const componentRoot = path.resolve(repoRoot, String(manifest.ccg.snapshotPath));
  await ensureSafeDirectoryChain(repoRoot, componentRoot, "CCG migration source");
  const packageBytes = await boundedRegularBytes(path.join(componentRoot, "package.json"), "CCG source package");
  validateCcgRuntimePackage(JSON.parse(packageBytes), manifest);
  const ownershipPath = cachePath(repoRoot, "ownership.json");
  await assertSafeRegularFileOrAbsent(repoRoot, ownershipPath, "CCG migration ownership");
  const ownershipBytes = await boundedRegularBytes(ownershipPath, "CCG migration ownership");
  const ownership = validateBootstrapOwnership(JSON.parse(ownershipBytes), repoRoot);
  const entry = ownership.entries.find(item => item.id === "ccg-link");
  if (!entry || entry.package !== "ccg-workflow" || entry.kind !== "npm-global-package" || ownership.entries.some(item => item.id === "ccg-legacy-retained")) throw new Error("Namespace migration requires an intact, packaged legacy CCG owned entry.");
  const legacyRuntime = await inspectGlobalPackage(globalRoot, "ccg-workflow");
  if (!globalPackageSnapshotsEqual(legacyRuntime, entry.installedByHarness)) throw new Error("Legacy CCG package changed after Harness management; refusing namespace migration.");
  const legacyCommandFiles = await inspectCcgCommandFiles(entry.installedByHarness.entryPath, entry.package);
  if (legacyCommandFiles.some(file => file.kind === "absent") || (entry.commandFiles && !ccgCommandFilesEqual(entry.commandFiles, legacyCommandFiles))) throw new Error("Legacy owned CCG commands are missing or changed.");
  const targetPath = path.join(globalRoot, ...runtime.packageName.split("/"));
  const targetRuntime = await inspectGlobalPackage(globalRoot, runtime.packageName);
  const targetCommandFiles = await inspectCcgCommandFiles(targetPath, runtime.packageName);
  if (targetRuntime || targetCommandFiles.some(file => file.kind !== "absent")) throw new Error("Scoped CCG runtime or command already exists; refusing foreign namespace adoption.");
  return { schemaVersion: 1, kind: "ccg-owned-runtime-namespace-migration", repoRoot: path.resolve(repoRoot), prefix,
    fromPackage: entry.package, toPackage: runtime.packageName, targetVersion: manifest.ccg.version,
    manifestSha256: sha256(manifestBytes), sourcePackageSha256: sha256(packageBytes), ownershipSha256: sha256(ownershipBytes),
    legacyRuntime, legacyCommandFiles, targetRuntime, targetCommandFiles };
}

async function readPinnedPlan(args) {
  const bytes = await boundedRegularBytes(args.ccgMigrationPlan, "CCG migration plan");
  if (sha256(bytes) !== args.ccgMigrationPlanSha256) throw new Error("CCG migration plan SHA-256 mismatch.");
  return JSON.parse(bytes);
}

async function assertScopedCommandContinuity(ownership, observed) {
  const entry = ownership.entries.find(item => item.id === "ccg-link");
  if (entry?.commandFiles && (!observed || !ccgCommandFilesEqual(await inspectCcgCommandFiles(entry.installedByHarness.entryPath, entry.package), entry.commandFiles))) throw new Error("Owned CCG command changed after Harness management; refusing bootstrap.");
}

async function buildLegacyDispositionPlan(repoRoot, recipientPath, recipientSha256) {
  const recipientBytes = await boundedRegularBytes(recipientPath, "Stock Claude recipient plan");
  if (sha256(recipientBytes) !== recipientSha256) throw new Error("Stock Claude recipient plan SHA-256 mismatch.");
  const recipient = JSON.parse(recipientBytes);
  const prefix = migrationPrefix();
  if (recipient.kind !== "ccg-stock-npm-prefix-file-plan" || !samePath(recipient.prefix, prefix) ||
      ![recipient.stageReceiptSha256, recipient.baselineManifestSha256].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      !Array.isArray(recipient.rows) || recipient.rows.length === 0) throw new Error("Legacy handoff requires the exact stock npm file plan for this prefix.");
  const ownershipPath = cachePath(repoRoot, "ownership.json");
  await assertSafeRegularFileOrAbsent(repoRoot, ownershipPath, "Legacy disposition ownership");
  const ownershipBytes = await boundedRegularBytes(ownershipPath, "Legacy disposition ownership");
  const ownership = validateBootstrapOwnership(JSON.parse(ownershipBytes), repoRoot);
  const slot = await inspectRetainedSlot(ownership, { requireRetained: true });
  if (!slot) throw new Error("No retained legacy CCG owner is available for stock handoff.");
  const scoped = ownership.entries.find(entry => entry.id === "ccg-link");
  if (!scoped || scoped.package !== "@jed-zed/ccg-codex-workflow") throw new Error("Stock handoff requires the installed owned Codex namespace.");
  const observed = await observeGlobalPackages(scoped.package);
  assertBootstrapOwnershipContinuity(ownership, observed, { ccg: true, ccgPackage: scoped.package }, repoRoot);
  await assertScopedCommandContinuity(ownership, observed.ccg);
  return { schemaVersion: 1, kind: "ccg-legacy-runtime-disposition", repoRoot: path.resolve(repoRoot), prefix,
    disposition: "released-for-stock-claude", ownershipSha256: sha256(ownershipBytes), legacyEntry: slot,
    scopedRuntime: observed.ccg, recipientPlan: path.resolve(recipientPath), recipientPlanSha256: recipientSha256,
    recipientKind: recipient.kind, stageReceiptSha256: recipient.stageReceiptSha256, baselineManifestSha256: recipient.baselineManifestSha256 };
}

async function releaseLegacyRuntime(args) {
  const plan = await readPinnedPlan(args);
  if (plan.kind !== "ccg-legacy-runtime-disposition" || plan.disposition !== "released-for-stock-claude" ||
      !samePath(plan.repoRoot, args.repoRoot) || !samePath(plan.prefix, migrationPrefix())) throw new Error("Legacy disposition plan has an invalid identity.");
  const ownershipPath = cachePath(args.repoRoot, "ownership.json");
  const ownership = await readExistingOwnership(ownershipPath, args.repoRoot);
  const slot = ownership.entries.find(entry => entry.id === "ccg-legacy-retained");
  if (slot?.disposition === "released-for-stock-claude" && slot.release.dispositionPlanSha256 === args.ccgMigrationPlanSha256 &&
      slot.release.recipientPlanSha256 === plan.recipientPlanSha256) {
    process.stdout.write(`${jsonBytes({ status: "unchanged", disposition: slot.disposition })}`);
    return;
  }
  const rebuilt = await buildLegacyDispositionPlan(args.repoRoot, plan.recipientPlan, plan.recipientPlanSha256);
  if (jsonBytes(plan) !== jsonBytes(rebuilt)) throw new Error("Legacy disposition plan is stale; ownership, runtime or stock recipient changed.");
  slot.disposition = "released-for-stock-claude";
  slot.release = { recipientPlanSha256: plan.recipientPlanSha256, dispositionPlanSha256: args.ccgMigrationPlanSha256, releasedAt: new Date().toISOString() };
  ownership.updatedAt = new Date().toISOString();
  validateBootstrapOwnership(ownership, args.repoRoot);
  await atomicWrite(args.repoRoot, ownershipPath, jsonBytes(ownership), "Legacy CCG owner disposition");
  process.stdout.write(jsonBytes({ status: "released", disposition: slot.disposition, recipientPlanSha256: plan.recipientPlanSha256, runtimeBytesChanged: false }));
}

async function beginBootstrap(args) {
  const pendingPath = cachePath(args.repoRoot, "bootstrap-pending.json");
  const ownershipPath = cachePath(args.repoRoot, "ownership.json");
  const manifest = await readJson(
    path.join(args.repoRoot, "harness.sources.json"),
  );
  const ccgPackage = resolveCcgRuntimePackage(manifest.ccg.package).packageName;
  const before = await observeGlobalPackages(ccgPackage);
  const existing = await readExistingOwnership(
    ownershipPath,
    args.repoRoot,
  );
  let ccgMigrationPlan;
  let legacyCcg;
  if (args.ccgMigrationPlan) {
    ccgMigrationPlan = await readPinnedPlan(args);
    const rebuilt = await buildNamespaceMigrationPlan(args.repoRoot);
    if (jsonBytes(ccgMigrationPlan) !== jsonBytes(rebuilt)) throw new Error("CCG migration plan is stale; runtime, ownership or source changed.");
    legacyCcg = rebuilt.legacyRuntime;
  } else {
    await assertScopedCommandContinuity(existing, before.ccg);
    await inspectRetainedSlot(existing);
  }
  assertBootstrapOwnershipContinuity(
    existing,
    before,
    {
      trellis: args.manageTrellis,
      ccg: args.manageCcg,
      ccgPackage,
      ccgMigrationPlan,
      legacyCcg,
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
      ccgPackage,
    },
    ccgSourcePath: path.resolve(
      args.repoRoot,
      String(manifest.ccg.snapshotPath),
    ),
    before,
    ...(ccgMigrationPlan ? { ccgMigration: { plan: ccgMigrationPlan, planSha256: args.ccgMigrationPlanSha256 } } : {}),
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
  const optional = ["ccgMigration", "installedCcg"];
  if (
    pending?.schemaVersion !== 2 ||
    keys.some(key => !required.includes(key) && !optional.includes(key)) ||
    required.some((key) => !keys.includes(key)) ||
    typeof pending.createdAt !== "string" ||
    typeof pending.managed?.trellis !== "boolean" ||
    typeof pending.managed?.ccg !== "boolean" ||
    Object.keys(pending.managed).sort().join(",") !== "ccg,trellis" ||
    typeof pending.expected?.trellisVersion !== "string" ||
    typeof pending.expected?.ccgVersion !== "string" ||
    !["ccgVersion,trellisVersion", "ccgPackage,ccgVersion,trellisVersion"].includes(
      Object.keys(pending.expected).sort().join(",")
    ) ||
    typeof pending.ccgSourcePath !== "string" ||
    !path.isAbsolute(pending.ccgSourcePath) ||
    Object.keys(pending.before ?? {}).sort().join(",") !== "ccg,trellis"
  ) {
    throw new Error("Bootstrap ownership transaction has an invalid schema.");
  }
  resolveCcgRuntimePackage(pending.expected.ccgPackage ?? "ccg-workflow");
  if (pending.ccgMigration !== undefined) {
    const migration = pending.ccgMigration;
    if (Object.keys(migration).sort().join(",") !== "plan,planSha256" ||
        !/^[a-f0-9]{64}$/.test(migration.planSha256) ||
        migration.plan?.kind !== "ccg-owned-runtime-namespace-migration" ||
        migration.plan?.fromPackage !== "ccg-workflow" ||
        migration.plan?.toPackage !== pending.expected.ccgPackage ||
        migration.plan?.targetVersion !== pending.expected.ccgVersion ||
        !samePath(migration.plan?.repoRoot, repoRoot) ||
        !samePath(migration.plan?.prefix, migrationPrefix())) throw new Error("Bootstrap CCG namespace migration binding is invalid.");
    validateGlobalPackageSnapshot(migration.plan.legacyRuntime, "Migration legacy CCG");
  }
  if (pending.installedCcg !== undefined) {
    if (Object.keys(pending.installedCcg).sort().join(",") !== "commandFiles,runtime") throw new Error("Bootstrap installed CCG checkpoint is invalid.");
    validateGlobalPackageSnapshot(pending.installedCcg.runtime, "Bootstrap installed CCG checkpoint");
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

async function assertPendingMigrationInputs(pending, repoRoot) {
  const plan = pending.ccgMigration?.plan;
  if (!plan) return;
  const ownershipBytes = await boundedRegularBytes(cachePath(repoRoot, "ownership.json"), "Migration baseline ownership");
  if (sha256(ownershipBytes) !== plan.ownershipSha256) throw new Error("CCG migration baseline ownership changed during bootstrap.");
  const ownership = validateBootstrapOwnership(JSON.parse(ownershipBytes), repoRoot);
  const entry = ownership.entries.find(item => item.id === "ccg-link");
  if (!entry || entry.package !== plan.fromPackage || !globalPackageSnapshotsEqual(entry.installedByHarness, plan.legacyRuntime)) throw new Error("CCG migration old owner changed during bootstrap.");
  const manifestBytes = await boundedRegularBytes(path.join(repoRoot, "harness.sources.json"), "Migration source manifest");
  const packageBytes = await boundedRegularBytes(path.join(pending.ccgSourcePath, "package.json"), "Migration source package");
  if (sha256(manifestBytes) !== plan.manifestSha256 || sha256(packageBytes) !== plan.sourcePackageSha256) throw new Error("CCG migration source identity changed during bootstrap.");
  const legacy = await observeGlobalPackages(plan.fromPackage);
  if (!globalPackageSnapshotsEqual(legacy.ccg, plan.legacyRuntime) ||
      !ccgCommandFilesEqual(await inspectCcgCommandFiles(plan.legacyRuntime.entryPath, plan.fromPackage), plan.legacyCommandFiles)) throw new Error("Legacy CCG runtime changed during scoped bootstrap.");
}

async function checkpointBootstrapRuntime(args) {
  const pendingPath = cachePath(args.repoRoot, "bootstrap-pending.json");
  await assertSafeRegularFileOrAbsent(args.repoRoot, pendingPath, "Bootstrap pending record");
  const pending = await readJson(pendingPath);
  assertBootstrapTransaction(pending, args.repoRoot);
  if (!pending.managed.ccg) return;
  await assertPendingMigrationInputs(pending, args.repoRoot);
  const after = await observeGlobalPackages(pending.expected.ccgPackage ?? "ccg-workflow");
  assertManagedCcg(pending, after);
  validateCcgRuntimePackage(await readJson(path.join(after.ccg.entryPath, "package.json")), { ccg: { package: pending.expected.ccgPackage ?? "ccg-workflow", version: pending.expected.ccgVersion } });
  const commandFiles = await inspectCcgCommandFiles(after.ccg.entryPath, pending.expected.ccgPackage ?? "ccg-workflow");
  if (commandFiles.some(file => file.kind === "absent")) throw new Error("Installed CCG checkpoint has a missing command.");
  if (pending.installedCcg && (!globalPackageSnapshotsEqual(pending.installedCcg.runtime, after.ccg) ||
      !ccgCommandFilesEqual(pending.installedCcg.commandFiles, commandFiles))) throw new Error("Installed CCG changed after its bootstrap checkpoint.");
  pending.installedCcg = { runtime: after.ccg, commandFiles };
  await atomicWrite(args.repoRoot, pendingPath, jsonBytes(pending), "Bootstrap runtime checkpoint");
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
  if (after.ccg.sourcePath !== undefined) {
    throw new Error(
      "Managed global CCG package must not link back to the Harness component.",
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
  await assertPendingMigrationInputs(pending, args.repoRoot);
  const after = await observeGlobalPackages(pending.expected.ccgPackage ?? "ccg-workflow");
  assertManagedTrellis(pending, after);
  assertManagedCcg(pending, after);
  if ((pending.ccgMigration || pending.installedCcg) && (!pending.installedCcg ||
      !globalPackageSnapshotsEqual(pending.installedCcg.runtime, after.ccg) ||
      !ccgCommandFilesEqual(pending.installedCcg.commandFiles, await inspectCcgCommandFiles(after.ccg.entryPath, pending.expected.ccgPackage)))) throw new Error("Scoped namespace migration requires an unchanged installed-runtime checkpoint.");

  const recorded = buildBootstrapOwnership({
    repoRoot: args.repoRoot,
    ccgSourcePath: pending.ccgSourcePath,
    ccgPackage: pending.expected.ccgPackage ?? "ccg-workflow",
    managed: pending.managed,
    before: pending.before,
    after,
    ccgMigrationPlan: pending.ccgMigration?.plan,
    beforeLegacyCcg: pending.ccgMigration?.plan.legacyRuntime,
    ccgCommandFiles: pending.installedCcg?.commandFiles,
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
  validateBootstrapOwnership(recorded, args.repoRoot);
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
  const current = await observeGlobalPackages(pending.expected.ccgPackage ?? "ccg-workflow");
  if (pending.ccgMigration) {
    await assertPendingMigrationInputs(pending, args.repoRoot);
    if (current.ccg && (!pending.installedCcg ||
        !globalPackageSnapshotsEqual(current.ccg, pending.installedCcg.runtime) ||
        !ccgCommandFilesEqual(await inspectCcgCommandFiles(current.ccg.entryPath, pending.expected.ccgPackage), pending.installedCcg.commandFiles))) throw new Error("Scoped migration rollback holds uncheckpointed or user-modified runtime; no files changed.");
    if (!current.ccg && !ccgCommandFilesEqual(await inspectCcgCommandFiles(path.join(globalPackageRootFromNpmPrefix(migrationPrefix(), { platform: process.platform }), ...pending.expected.ccgPackage.split("/")), pending.expected.ccgPackage), pending.ccgMigration.plan.targetCommandFiles)) throw new Error("Scoped migration rollback holds command files without an installed package; no files changed.");
  }
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
          package: pending.expected.ccgPackage ?? "ccg-workflow",
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
            ? candidate.current?.sourcePath !== undefined
              ? "npm-global-link"
              : "npm-global-package"
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

async function exportCommit(
  checkout,
  commit,
  temporaryRoot,
  exclusions = [],
  preserveFrom = null,
) {
  const exportRoot = path.join(temporaryRoot, "export");
  const materialized = await materializeGitTree({
    checkout,
    commit,
    destination: exportRoot,
    exclusions,
    preserveFrom,
    execute: run,
  });
  return {
    candidateDir: exportRoot,
    treeEntries: materialized.entries,
    manifestSha256: materialized.manifestSha256,
  };
}

export function buildHarnessDoctorArguments(repoRoot) {
  return [
    "-NoProfile",
    "-File",
    path.join(repoRoot, "scripts", "doctor.ps1"),
    "-RepoRoot",
    repoRoot,
  ];
}

function runHarnessDoctor(repoRoot) {
  run(
    "pwsh",
    buildHarnessDoctorArguments(repoRoot),
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
  const selectedCommit = args.ccgCommit ?? commit;
  const gitTree = git(
    resolved.checkout,
    ["rev-parse", `${selectedCommit}^{tree}`],
    { capture: true },
  ).toLowerCase();
  return validateUpdateSource({
    expected: {
      repository: String(manifest.ccg.authoritativeRepository),
      commit: selectedCommit,
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
  validateCcgRuntimePackage(targetPackage, { ccg: { ...manifest.ccg, version: targetPackage.version } });
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
    path.resolve(args.repoRoot, String(manifest.ccg.snapshotPath)),
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
    ...(await runActivatedCcgCliSmokes(args.repoRoot, componentRoot, {
      verifyManagedRuntime: false,
    })),
  );

  await runHarnessTests(args.repoRoot, run);
  finalCommands.push("node --test tests/*.test.mjs");
  return finalCommands;
}

async function runActivatedCcgCliSmokes(
  repoRoot,
  componentRoot,
  { verifyManagedRuntime = true } = {},
) {
  const commands = [];
  const packageManifest = await readJson(
    path.join(componentRoot, "package.json"),
  );
  const runtime = validateCcgRuntimePackage(packageManifest, { ccg: { package: packageManifest.name, version: packageManifest.version } });
  const localVersion = run(
    process.execPath,
    [path.join(componentRoot, runtime.entrypoint), "--version"],
    { cwd: componentRoot, capture: true },
  );
  assertVersionOutput(
    localVersion,
    String(packageManifest.version),
    "Final-path CCG CLI",
  );
  commands.push("node bin/ccg.mjs --version");
  if (!verifyManagedRuntime) return commands;

  const ownership = await readOwnershipIfPresent(repoRoot);
  const ccgOwnership = ownership?.entries.find(
    (entry) => entry.id === "ccg-link",
  );
  if (ccgOwnership) {
    if (ccgOwnership.package !== runtime.packageName) throw new Error("Managed CCG package identity differs from the source snapshot.");
    const globalPackages = await observeGlobalPackages(runtime.packageName);
    assertManagedCcgRuntimePackage(ccgOwnership, globalPackages.ccg);
    const globalVersion =
      process.platform === "win32"
        ? run(
            process.env.ComSpec || "cmd.exe",
            ["/d", "/s", "/c", `${runtime.command} --version`],
            { cwd: repoRoot, capture: true },
          )
        : run(runtime.command, ["--version"], {
            cwd: repoRoot,
            capture: true,
          });
    assertVersionOutput(
      globalVersion,
      String(packageManifest.version),
      "Harness-managed global CCG CLI",
    );
    commands.push(`${runtime.command} --version`);
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
  await runHarnessTests(worktree, run);
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
    readTargetCcgVersion(resolved, source, manifest);
    runHarnessDoctor(args.repoRoot);
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

  const ccgPackage = ownership.entries.find((entry) => entry.id === "ccg-link")?.package ?? "ccg-workflow";
  const current = await observeGlobalPackages(ccgPackage);
  const observations = {
    "trellis-global": current.trellis,
    "ccg-link": current.ccg,
    commandFiles: {
      "ccg-link": current.ccg ? await inspectCcgCommandFiles(current.ccg.entryPath, ccgPackage) : null,
    },
  };
  const plan = buildOwnedUninstallPlan(
    ownership,
    observations,
    args.repoRoot,
  );
  for (const entry of plan.remove) restoreGlobalEntry(entry);

  ownership.entries = [...plan.skip, ...ownership.entries.filter(entry => entry.id === "ccg-legacy-retained")];
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
  assertCodexMutationHost();
  const args = parseLifecycleArgs(process.argv.slice(2));
  if (args.command === "ccg-runtime-migration-plan") {
    process.stdout.write(jsonBytes(await buildNamespaceMigrationPlan(args.repoRoot)));
    return;
  }
  if (args.command === "ccg-legacy-disposition-plan") {
    process.stdout.write(jsonBytes(await buildLegacyDispositionPlan(args.repoRoot, args.recipientPlan, args.recipientPlanSha256)));
    return;
  }
  await assertLegacyClaimMutationAllowed(args.repoRoot);
  if (args.command === "update") return updateHarness(args);
  if (args.command === "rollback") return rollbackHarness(args);
  if (args.command === "recover") return recoverHarness(args);
  const pendingOperation = ["bootstrap-complete", "bootstrap-abort", "bootstrap-runtime-checkpoint"].includes(args.command) ? "bootstrap-resume" : null;
  const lock = await acquireTransactionLock(args.repoRoot, { pendingOperation });
  try {
    if (args.command === "ccg-legacy-disposition") return await releaseLegacyRuntime(args);
    if (args.command === "bootstrap-begin") return await beginBootstrap(args);
    if (args.command === "bootstrap-complete") return await completeBootstrap(args);
    if (args.command === "bootstrap-abort") return await abortBootstrap(args);
    if (args.command === "bootstrap-runtime-checkpoint") return await checkpointBootstrapRuntime(args);
    return await uninstallHarness(args);
  } finally {
    await lock.release();
  }
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
