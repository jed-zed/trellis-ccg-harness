import {
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const JOURNAL_FILE = "transaction-journal.json";
const LOCK_FILE = "transaction.lock";

function assertInside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must stay inside the Harness repository.`);
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const FORBIDDEN_CANDIDATE_PATHS = [
  ".git",
  ".ccg",
  path.join(".codex", "ccg"),
  "node_modules",
  "output",
  "tmp",
];

async function assertCandidateSurface(candidateDir) {
  for (const relativePath of FORBIDDEN_CANDIDATE_PATHS) {
    if (await exists(path.join(candidateDir, relativePath))) {
      throw new Error(
        `Forbidden candidate path is present: ${relativePath.replace(/\\/g, "/")}.`,
      );
    }
  }
}

async function atomicWrite(target, value) {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function transactionId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
}

function transactionStatePaths(repoRoot) {
  const stateDir = path.join(path.resolve(repoRoot), ".harness-cache");
  const lockPath = path.join(stateDir, LOCK_FILE);
  const journalPath = path.join(stateDir, JOURNAL_FILE);
  assertInside(repoRoot, stateDir, "Transaction state");
  assertInside(repoRoot, lockPath, "Transaction lock");
  assertInside(repoRoot, journalPath, "Transaction journal");
  return { stateDir, lockPath, journalPath };
}

async function readJsonIfPresent(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJournal(context, phase) {
  context.journal.phase = phase;
  context.journal.updatedAt = new Date().toISOString();
  await atomicWrite(
    context.journalPath,
    `${JSON.stringify(context.journal, null, 2)}\n`,
  );
}

async function removeJournal(journalPath) {
  await unlink(journalPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function assertNoPendingJournal(repoRoot) {
  const { journalPath } = transactionStatePaths(repoRoot);
  if (await exists(journalPath)) {
    throw new Error(
      `An interrupted Harness transaction requires recovery at ${journalPath}. `
      + "Run pnpm harness:recover before starting another lifecycle operation.",
    );
  }
}

export async function acquireTransactionLock(repoRoot) {
  const root = path.resolve(repoRoot);
  const { stateDir, lockPath } = transactionStatePaths(root);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  const token = randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token,
      })}\n`,
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another Harness transaction is running or left a lock at ${lockPath}.`,
      );
    }
    throw error;
  }

  let released = false;
  return {
    path: lockPath,
    async release() {
      if (released) return;
      released = true;
      await handle.close();
      const current = await readJsonIfPresent(lockPath);
      if (current?.token === token) {
        await unlink(lockPath).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      }
    },
  };
}

function assertReplacementIdentity(options) {
  if (!/^[a-f0-9]{40}$/.test(options.commit))
    throw new Error("Replacement commit must be a full 40-character SHA-1.");
  if (!/^[a-f0-9]{40}$/.test(options.gitTree))
    throw new Error("Replacement Git tree must be a full 40-character SHA-1.");
}

async function assertReplacementCandidate(candidateDir) {
  if (!(await exists(candidateDir)))
    throw new Error(`Candidate component does not exist: ${candidateDir}`);
  await assertCandidateSurface(candidateDir);
}

function buildReplacementPaths(repoRoot, id) {
  const snapshotDir = path.join(
    repoRoot,
    ".harness-cache",
    "snapshots",
    id,
  );
  const stagingDir = path.join(
    repoRoot,
    ".harness-cache",
    "staging",
    id,
  );
  const stagedComponent = path.join(stagingDir, "component");
  assertInside(repoRoot, snapshotDir, "Snapshot");
  assertInside(repoRoot, stagingDir, "Staging directory");
  return { snapshotDir, stagingDir, stagedComponent };
}

async function loadReplacementContext(options, repoRoot, candidateDir, id) {
  const manifestPath = path.join(repoRoot, "harness.sources.json");
  const { journalPath } = transactionStatePaths(repoRoot);
  assertInside(repoRoot, manifestPath, "Source manifest");
  const paths = buildReplacementPaths(repoRoot, id);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const candidatePackage = JSON.parse(
    await readFile(path.join(candidateDir, "package.json"), "utf8"),
  );
  if (candidatePackage.name !== manifest.ccg?.package) {
    throw new Error(
      `Candidate package mismatch: expected ${manifest.ccg?.package}, got ${candidatePackage.name}.`,
    );
  }
  const componentDir = path.resolve(
    repoRoot,
    String(manifest.ccg?.snapshotPath ?? ""),
  );
  assertInside(repoRoot, componentDir, "CCG component");
  if (componentDir === candidateDir)
    throw new Error("Candidate directory cannot be the live CCG component.");
  return {
    ...paths,
    repoRoot,
    candidateDir,
    manifestPath,
    manifestBytes,
    manifest,
    candidatePackage,
    componentDir,
    snapshotComponent: path.join(paths.snapshotDir, "component"),
    snapshotManifest: path.join(
      paths.snapshotDir,
      "harness.sources.json",
    ),
    journalPath,
    journal: {
      schemaVersion: 1,
      id,
      operation: "replacement",
      phase: "created",
      createdAt: new Date().toISOString(),
      componentPath: path
        .relative(repoRoot, componentDir)
        .split(path.sep)
        .join("/"),
      snapshotPath: path
        .relative(repoRoot, paths.snapshotDir)
        .split(path.sep)
        .join("/"),
      stagingPath: path
        .relative(repoRoot, paths.stagingDir)
        .split(path.sep)
        .join("/"),
    },
  };
}

async function stageReplacement(context) {
  await mkdir(context.snapshotDir, { recursive: true, mode: 0o700 });
  await mkdir(context.stagingDir, { recursive: true, mode: 0o700 });
  await writeFile(context.snapshotManifest, context.manifestBytes, {
    mode: 0o600,
  });
  await writeJournal(context, "preparing");
  await cp(context.candidateDir, context.stagedComponent, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  await writeJournal(context, "staged");
}

async function activateReplacement(context, state) {
  await writeJournal(context, "moving-current");
  await rename(context.componentDir, context.snapshotComponent);
  state.componentMoved = true;
  await writeJournal(context, "current-moved");
  await rename(context.stagedComponent, context.componentDir);
  state.candidateActivated = true;
  await writeJournal(context, "candidate-activated");
}

async function writeReplacementManifest(context, options) {
  const previous = {
    commit: context.manifest.ccg.commit,
    gitTree: context.manifest.ccg.gitTree,
  };
  context.manifest.ccg.commit = options.commit;
  context.manifest.ccg.gitTree = options.gitTree;
  context.manifest.ccg.version = context.candidatePackage.version;
  context.manifest.ccg.sourceMode =
    "tracked-tree-from-explicit-personal-commit";
  context.manifest.capturedAt = new Date().toISOString();
  await atomicWrite(
    context.manifestPath,
    `${JSON.stringify(context.manifest, null, 2)}\n`,
  );
  await writeJournal(context, "manifest-written");
  return previous;
}

function buildReplacementRecord(context, options, previous) {
  return {
    schemaVersion: 1,
    id: context.id,
    status: "committed",
    createdAt: new Date().toISOString(),
    snapshotPath: path
      .relative(context.repoRoot, context.snapshotDir)
      .split(path.sep)
      .join("/"),
    componentPath: path
      .relative(context.repoRoot, context.componentDir)
      .split(path.sep)
      .join("/"),
    previous,
    current: {
      commit: options.commit,
      gitTree: options.gitTree,
    },
    verification: options.verification ?? null,
  };
}

async function restoreFailedReplacement(context, state) {
  if (state.candidateActivated && (await exists(context.componentDir))) {
    await rm(context.componentDir, { recursive: true, force: true });
  }
  if (state.componentMoved && (await exists(context.snapshotComponent))) {
    await rename(context.snapshotComponent, context.componentDir);
  }
  await atomicWrite(context.manifestPath, context.manifestBytes);
  await rm(context.stagingDir, { recursive: true, force: true });
  await rm(context.snapshotDir, { recursive: true, force: true });
  await removeJournal(context.journalPath);
}

async function performReplacement(context, options) {
  const state = { componentMoved: false, candidateActivated: false };
  let record;
  try {
    await stageReplacement(context);
    await activateReplacement(context, state);
    const previous = await writeReplacementManifest(context, options);
    if (options.afterReplace) await options.afterReplace();
    record = buildReplacementRecord(context, options, previous);
    await atomicWrite(
      path.join(
        context.repoRoot,
        ".harness-cache",
        "last-transaction.json",
      ),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  } catch (error) {
    try {
      await restoreFailedReplacement(context, state);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Harness update failed and restoring the previous component also failed.",
      );
    }
    throw error;
  }

  await writeJournal(context, "committed");
  await rm(context.stagingDir, { recursive: true, force: true });
  await removeJournal(context.journalPath);
  return record;
}

export async function replaceComponentTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const candidateDir = path.resolve(options.candidateDir);
  assertReplacementIdentity(options);
  await assertReplacementCandidate(candidateDir);

  const lock = await acquireTransactionLock(repoRoot);
  try {
    await assertNoPendingJournal(repoRoot);
    const id = transactionId();
    const context = await loadReplacementContext(
      options,
      repoRoot,
      candidateDir,
      id,
    );
    context.id = id;
    return await performReplacement(context, options);
  } finally {
    await lock.release();
  }
}

async function loadRollbackContext(repoRoot, recordPath) {
  assertInside(repoRoot, recordPath, "Transaction record");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  if (record.status !== "committed") {
    throw new Error("The last Harness transaction is not rollback-eligible.");
  }

  const snapshotDir = path.resolve(repoRoot, record.snapshotPath);
  const componentDir = path.resolve(repoRoot, record.componentPath);
  const snapshotComponent = path.join(snapshotDir, "component");
  const snapshotManifest = path.join(snapshotDir, "harness.sources.json");
  const manifestPath = path.join(repoRoot, "harness.sources.json");
  const discardRoot = path.join(
    repoRoot,
    ".harness-cache",
    "discard",
    record.id,
  );
  const discardComponent = path.join(discardRoot, "component");
  const discardManifest = path.join(
    discardRoot,
    "harness.sources.json",
  );
  const { journalPath } = transactionStatePaths(repoRoot);
  assertInside(repoRoot, snapshotDir, "Rollback snapshot");
  assertInside(repoRoot, componentDir, "CCG component");
  assertInside(repoRoot, discardRoot, "Rollback discard");

  const currentManifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(currentManifestBytes.toString("utf8"));
  if (
    manifest.ccg?.commit !== record.current.commit ||
    manifest.ccg?.gitTree !== record.current.gitTree
  ) {
    throw new Error(
      "Current Harness manifest changed after the update; refusing rollback.",
    );
  }
  if (!(await exists(snapshotComponent)))
    throw new Error("Rollback component snapshot is missing.");

  return {
    repoRoot,
    recordPath,
    record,
    snapshotDir,
    componentDir,
    snapshotComponent,
    snapshotManifest,
    manifestPath,
    discardRoot,
    discardComponent,
    discardManifest,
    currentManifestBytes,
    journalPath,
    journal: {
      schemaVersion: 1,
      id: record.id,
      operation: "rollback",
      phase: "created",
      createdAt: new Date().toISOString(),
      componentPath: record.componentPath,
      snapshotPath: record.snapshotPath,
      discardPath: path
        .relative(repoRoot, discardRoot)
        .split(path.sep)
        .join("/"),
    },
  };
}

async function restoreInterruptedRollback(context, state) {
  if (state.snapshotActivated && (await exists(context.componentDir))) {
    await rename(context.componentDir, context.snapshotComponent);
  }
  if (state.currentMoved && (await exists(context.discardComponent))) {
    await rename(context.discardComponent, context.componentDir);
  }
  await atomicWrite(context.manifestPath, context.currentManifestBytes);
  await rm(context.discardRoot, { recursive: true, force: true });
  await removeJournal(context.journalPath);
}

async function activateRollback(context, afterRestore) {
  await mkdir(context.discardRoot, {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(context.discardManifest, context.currentManifestBytes, {
    mode: 0o600,
  });
  await writeJournal(context, "prepared");
  const state = { currentMoved: false, snapshotActivated: false };
  try {
    await writeJournal(context, "moving-current");
    await rename(context.componentDir, context.discardComponent);
    state.currentMoved = true;
    await writeJournal(context, "current-moved");
    await rename(context.snapshotComponent, context.componentDir);
    state.snapshotActivated = true;
    await writeJournal(context, "snapshot-activated");
    await atomicWrite(
      context.manifestPath,
      await readFile(context.snapshotManifest),
    );
    await writeJournal(context, "manifest-restored");
    if (afterRestore) await afterRestore();
  } catch (error) {
    try {
      await restoreInterruptedRollback(context, state);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Rollback failed and restoring the current Harness also failed.",
      );
    }
    throw error;
  }
}

async function finalizeRollback(context) {
  context.record.status = "rolled-back";
  context.record.rolledBackAt = new Date().toISOString();
  await atomicWrite(
    context.recordPath,
    `${JSON.stringify(context.record, null, 2)}\n`,
  );
  await writeJournal(context, "committed");
  await rm(context.discardRoot, { recursive: true, force: true });
  await removeJournal(context.journalPath);
  return context.record;
}

export async function rollbackLastTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const recordPath = path.join(
    repoRoot,
    ".harness-cache",
    "last-transaction.json",
  );
  const lock = await acquireTransactionLock(repoRoot);
  try {
    await assertNoPendingJournal(repoRoot);
    const context = await loadRollbackContext(repoRoot, recordPath);
    await activateRollback(context, options.afterRestore);
    return await finalizeRollback(context);
  } finally {
    await lock.release();
  }
}

function defaultIsProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function normalizeJournalRelative(value, label) {
  const relative = String(value ?? "");
  if (
    !relative ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative === ".." ||
    relative.startsWith("../")
  ) {
    throw new Error(`${label} is not a safe repository-relative path.`);
  }
  return relative;
}

function resolveJournalPath(repoRoot, value, label) {
  const relative = normalizeJournalRelative(value, label);
  const target = path.resolve(repoRoot, ...relative.split("/"));
  assertInside(repoRoot, target, label);
  return { relative, target };
}

function assertExpectedCachePath(relative, category, id, label) {
  const expected = `.harness-cache/${category}/${id}`;
  if (relative !== expected) {
    throw new Error(`${label} must be ${expected}.`);
  }
}

function loadRecoveryContext(repoRoot, journal) {
  if (
    journal?.schemaVersion !== 1 ||
    !/^[A-Za-z0-9-]+$/.test(String(journal?.id ?? "")) ||
    !["replacement", "rollback"].includes(journal?.operation)
  ) {
    throw new Error("Transaction journal is invalid or unsupported.");
  }

  const component = resolveJournalPath(
    repoRoot,
    journal.componentPath,
    "Journal component",
  );
  if (component.relative !== "components/ccg-workflow") {
    throw new Error(
      "Journal component must be the owned components/ccg-workflow path.",
    );
  }
  const snapshot = resolveJournalPath(
    repoRoot,
    journal.snapshotPath,
    "Journal snapshot",
  );
  assertExpectedCachePath(
    snapshot.relative,
    "snapshots",
    journal.id,
    "Journal snapshot",
  );

  const context = {
    repoRoot,
    journal,
    journalPath: transactionStatePaths(repoRoot).journalPath,
    recordPath: path.join(
      repoRoot,
      ".harness-cache",
      "last-transaction.json",
    ),
    componentDir: component.target,
    snapshotDir: snapshot.target,
    snapshotComponent: path.join(snapshot.target, "component"),
    snapshotManifest: path.join(snapshot.target, "harness.sources.json"),
    manifestPath: path.join(repoRoot, "harness.sources.json"),
  };

  if (journal.operation === "replacement") {
    const staging = resolveJournalPath(
      repoRoot,
      journal.stagingPath,
      "Journal staging directory",
    );
    assertExpectedCachePath(
      staging.relative,
      "staging",
      journal.id,
      "Journal staging directory",
    );
    context.stagingDir = staging.target;
  } else {
    const discard = resolveJournalPath(
      repoRoot,
      journal.discardPath,
      "Journal discard directory",
    );
    assertExpectedCachePath(
      discard.relative,
      "discard",
      journal.id,
      "Journal discard directory",
    );
    context.discardRoot = discard.target;
    context.discardComponent = path.join(discard.target, "component");
    context.discardManifest = path.join(
      discard.target,
      "harness.sources.json",
    );
  }
  return context;
}

async function matchingLastTransaction(context, status) {
  const record = await readJsonIfPresent(context.recordPath);
  return record?.id === context.journal.id && record?.status === status;
}

async function recoverReplacement(context) {
  if (await matchingLastTransaction(context, "committed")) {
    await rm(context.stagingDir, { recursive: true, force: true });
    await removeJournal(context.journalPath);
    return {
      operation: "replacement",
      outcome: "committed-cleanup-completed",
      transaction: context.journal.id,
    };
  }

  if (!(await exists(context.snapshotManifest))) {
    throw new Error(
      "Replacement recovery cannot find the preserved source manifest.",
    );
  }
  if (await exists(context.snapshotComponent)) {
    if (await exists(context.componentDir)) {
      await rm(context.componentDir, { recursive: true, force: true });
    }
    await mkdir(path.dirname(context.componentDir), { recursive: true });
    await rename(context.snapshotComponent, context.componentDir);
  } else if (!(await exists(context.componentDir))) {
    throw new Error(
      "Replacement recovery found neither the live nor preserved component.",
    );
  }

  await atomicWrite(
    context.manifestPath,
    await readFile(context.snapshotManifest),
  );
  await rm(context.stagingDir, { recursive: true, force: true });
  await rm(context.snapshotDir, { recursive: true, force: true });
  await removeJournal(context.journalPath);
  return {
    operation: "replacement",
    outcome: "rolled-back",
    transaction: context.journal.id,
  };
}

async function recoverRollback(context) {
  if (await matchingLastTransaction(context, "rolled-back")) {
    await rm(context.discardRoot, { recursive: true, force: true });
    await removeJournal(context.journalPath);
    return {
      operation: "rollback",
      outcome: "committed-cleanup-completed",
      transaction: context.journal.id,
    };
  }

  if (!(await exists(context.discardManifest))) {
    throw new Error(
      "Rollback recovery cannot find the preserved current manifest.",
    );
  }

  const discardExists = await exists(context.discardComponent);
  const snapshotExists = await exists(context.snapshotComponent);
  const componentExists = await exists(context.componentDir);
  if (discardExists) {
    if (!snapshotExists) {
      if (!componentExists) {
        throw new Error(
          "Rollback recovery cannot reconstruct the previous snapshot.",
        );
      }
      await mkdir(path.dirname(context.snapshotComponent), {
        recursive: true,
      });
      await rename(context.componentDir, context.snapshotComponent);
    } else if (componentExists) {
      throw new Error(
        "Rollback recovery found an ambiguous live component state.",
      );
    }
    await mkdir(path.dirname(context.componentDir), { recursive: true });
    await rename(context.discardComponent, context.componentDir);
  } else if (!componentExists || !snapshotExists) {
    throw new Error(
      "Rollback recovery is missing the current component or rollback snapshot.",
    );
  }

  await atomicWrite(
    context.manifestPath,
    await readFile(context.discardManifest),
  );
  await rm(context.discardRoot, { recursive: true, force: true });
  await removeJournal(context.journalPath);
  return {
    operation: "rollback",
    outcome: "rolled-back",
    transaction: context.journal.id,
  };
}

async function readRecoveryLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return { invalid: true };
    throw error;
  }
}

export async function recoverInterruptedTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const { lockPath, journalPath } = transactionStatePaths(repoRoot);
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const existingLock = await readRecoveryLock(lockPath);
  if (
    existingLock?.pid &&
    isProcessAlive(Number(existingLock.pid))
  ) {
    throw new Error(
      `Harness transaction owner PID ${existingLock.pid} is still running.`,
    );
  }
  if (existingLock) {
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  const lock = await acquireTransactionLock(repoRoot);
  try {
    const journal = await readJsonIfPresent(journalPath);
    if (!journal) {
      return {
        operation: null,
        outcome: existingLock ? "stale-lock-cleared" : "clean",
        transaction: null,
      };
    }
    const context = loadRecoveryContext(repoRoot, journal);
    const result = journal.operation === "replacement"
      ? await recoverReplacement(context)
      : await recoverRollback(context);
    if (options.afterRecover) await options.afterRecover(result);
    return result;
  } finally {
    await lock.release();
  }
}

function normalizePath(value) {
  const normalized = path.resolve(String(value)).replace(/\\/g, "/");
  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

export function buildOwnedUninstallPlan(ownership, observations) {
  const remove = [];
  const skip = [];
  for (const entry of ownership?.entries ?? []) {
    const observed = observations?.[entry.id];
    let matches = false;
    if (entry.kind === "npm-global-link") {
      matches =
        observed?.sourcePath &&
        normalizePath(observed.sourcePath) ===
          normalizePath(entry.sourcePath);
    } else if (entry.kind === "npm-global-package") {
      matches = observed?.version === entry.version;
    }
    (matches ? remove : skip).push(entry);
  }
  return { remove, skip };
}
