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

export async function acquireTransactionLock(repoRoot) {
  const root = path.resolve(repoRoot);
  const stateDir = path.join(root, ".harness-cache");
  const lockPath = path.join(stateDir, "transaction.lock");
  assertInside(root, lockPath, "Transaction lock");
  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
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
      await unlink(lockPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
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
  };
}

async function stageReplacement(context) {
  await mkdir(context.snapshotDir, { recursive: true, mode: 0o700 });
  await mkdir(context.stagingDir, { recursive: true, mode: 0o700 });
  await cp(context.candidateDir, context.stagedComponent, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  await writeFile(
    path.join(context.snapshotDir, "harness.sources.json"),
    context.manifestBytes,
    { mode: 0o600 },
  );
}

async function activateReplacement(context, state) {
  await rename(context.componentDir, context.snapshotComponent);
  state.componentMoved = true;
  await rename(context.stagedComponent, context.componentDir);
  state.candidateActivated = true;
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
}

async function performReplacement(context, options) {
  const state = { componentMoved: false, candidateActivated: false };
  try {
    await stageReplacement(context);
    await activateReplacement(context, state);
    const previous = await writeReplacementManifest(context, options);
    if (options.afterReplace) await options.afterReplace();
    const record = buildReplacementRecord(context, options, previous);
    await atomicWrite(
      path.join(
        context.repoRoot,
        ".harness-cache",
        "last-transaction.json",
      ),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    await rm(context.stagingDir, { recursive: true, force: true });
    return record;
  } catch (error) {
    await restoreFailedReplacement(context, state);
    throw error;
  }
}

export async function replaceComponentTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const candidateDir = path.resolve(options.candidateDir);
  assertReplacementIdentity(options);
  await assertReplacementCandidate(candidateDir);

  const lock = await acquireTransactionLock(repoRoot);
  try {
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
  const discardDir = path.join(
    repoRoot,
    ".harness-cache",
    "discard",
    record.id,
  );
  assertInside(repoRoot, snapshotDir, "Rollback snapshot");
  assertInside(repoRoot, componentDir, "CCG component");
  assertInside(repoRoot, discardDir, "Rollback discard");

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
    discardDir,
    currentManifestBytes,
  };
}

async function restoreInterruptedRollback(context, state) {
  if (state.snapshotActivated && (await exists(context.componentDir))) {
    await rename(context.componentDir, context.snapshotComponent);
  }
  if (state.currentMoved && (await exists(context.discardDir))) {
    await rename(context.discardDir, context.componentDir);
  }
  await atomicWrite(context.manifestPath, context.currentManifestBytes);
}

async function activateRollback(context, afterRestore) {
  await mkdir(path.dirname(context.discardDir), {
    recursive: true,
    mode: 0o700,
  });
  const state = { currentMoved: false, snapshotActivated: false };
  try {
    await rename(context.componentDir, context.discardDir);
    state.currentMoved = true;
    await rename(context.snapshotComponent, context.componentDir);
    state.snapshotActivated = true;
    await atomicWrite(
      context.manifestPath,
      await readFile(context.snapshotManifest),
    );
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
  await rm(context.discardDir, { recursive: true, force: true });
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
    const context = await loadRollbackContext(repoRoot, recordPath);
    await activateRollback(context, options.afterRestore);
    return await finalizeRollback(context);
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
