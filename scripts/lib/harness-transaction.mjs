import {
  cp,
  lstat,
  open,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  assertSafeRegularFileOrAbsent,
  buildContentIdentity,
  contentIdentitiesEqual,
  ensureSafeDirectoryChain,
  fingerprintRegularFile,
  fingerprintsEqual,
  safeAtomicWrite,
  safeCreateDirectory,
  safeRemove,
  safeRename,
} from "./harness-fs.mjs";

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
  const pending = [candidateDir];
  while (pending.length > 0) {
    const current = pending.pop();
    const details = await lstat(current);
    const relative = path
      .relative(candidateDir, current)
      .split(path.sep)
      .join("/") || ".";
    if (details.isSymbolicLink()) {
      throw new Error(
        `Candidate symbolic link, junction, or reparse point is forbidden: ${relative}.`,
      );
    }
    if (details.isDirectory()) {
      const children = await readdir(current);
      for (const child of children) {
        pending.push(path.join(current, child));
      }
    } else if (!details.isFile()) {
      throw new Error(
        `Candidate contains a non-regular filesystem entry: ${relative}.`,
      );
    }
  }
  for (const relativePath of FORBIDDEN_CANDIDATE_PATHS) {
    if (await exists(path.join(candidateDir, relativePath))) {
      throw new Error(
        `Forbidden candidate path is present: ${relativePath.replace(/\\/g, "/")}.`,
      );
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(root, target, value, label = "Harness state") {
  await safeAtomicWrite(root, target, value, label);
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
    context.repoRoot,
    context.journalPath,
    `${JSON.stringify(context.journal, null, 2)}\n`,
    "Transaction journal",
  );
}

async function notifyTransactionBoundary(options, name, context) {
  if (options.onTransactionBoundary === undefined) return;
  if (typeof options.onTransactionBoundary !== "function") {
    throw new Error("Transaction boundary observer must be a function.");
  }
  await options.onTransactionBoundary(name, {
    transaction: context.id,
    componentDir: context.componentDir,
    snapshotDir: context.snapshotDir,
    stagingDir: context.stagingDir,
    stagedComponent: context.stagedComponent,
  });
}

async function removeJournal(repoRoot, journalPath) {
  await safeRemove(repoRoot, journalPath, "Transaction journal");
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
  await safeCreateDirectory(root, stateDir, "Transaction state");
  await assertSafeRegularFileOrAbsent(root, lockPath, "Transaction lock");

  const token = randomUUID();
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        schemaVersion: 2,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token,
        repoRoot: root,
      })}\n`,
    );
    await handle.sync();
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
        await safeRemove(root, lockPath, "Transaction lock");
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
  await ensureSafeDirectoryChain(
    repoRoot,
    componentDir,
    "CCG component",
  );
  const previousContentIdentity = await buildContentIdentity(componentDir);
  return {
    ...paths,
    repoRoot,
    candidateDir,
    manifestPath,
    manifestBytes,
    manifest,
    candidatePackage,
    componentDir,
    previousContentIdentity,
    previousManifestSha256: sha256(manifestBytes),
    snapshotComponent: path.join(paths.snapshotDir, "component"),
    snapshotManifest: path.join(
      paths.snapshotDir,
      "harness.sources.json",
    ),
    journalPath,
    journal: {
      schemaVersion: 2,
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
      previousContentIdentity,
      previousManifestSha256: sha256(manifestBytes),
    },
  };
}

async function stageReplacement(context, options) {
  await safeCreateDirectory(
    context.repoRoot,
    context.snapshotDir,
    "Replacement snapshot",
  );
  await safeCreateDirectory(
    context.repoRoot,
    context.stagingDir,
    "Replacement staging",
  );
  await atomicWrite(
    context.repoRoot,
    context.snapshotManifest,
    context.manifestBytes,
    "Replacement snapshot manifest",
  );
  await writeJournal(context, "preparing");
  await notifyTransactionBoundary(options, "copy-in-progress", context);
  await cp(context.candidateDir, context.stagedComponent, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  await writeJournal(context, "staged");
}

async function activateReplacement(context, state, options) {
  await writeJournal(context, "moving-current");
  await notifyTransactionBoundary(
    options,
    "before-current-rename",
    context,
  );
  await safeRename(
    context.repoRoot,
    context.componentDir,
    context.snapshotComponent,
    "Replacement current component",
  );
  state.componentMoved = true;
  await writeJournal(context, "current-moved");
  await safeRename(
    context.repoRoot,
    context.stagedComponent,
    context.componentDir,
    "Replacement candidate",
  );
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
  for (const staleComparisonField of [
    "mergeBaseWithOriginalAtCapture",
    "personalOnlyCommitsAtCapture",
    "originalOnlyCommitsAtCapture",
  ]) {
    delete context.manifest.ccg[staleComparisonField];
  }
  context.manifest.capturedAt = new Date().toISOString();
  await atomicWrite(
    context.repoRoot,
    context.manifestPath,
    `${JSON.stringify(context.manifest, null, 2)}\n`,
    "Source manifest",
  );
  await writeJournal(context, "manifest-written");
  return previous;
}

async function buildReplacementRecord(context, options, previous) {
  const currentContentIdentity = await buildContentIdentity(
    context.componentDir,
  );
  const currentManifestBytes = await readFile(context.manifestPath);
  return {
    schemaVersion: 2,
    id: context.id,
    operation: "component",
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
    previous: {
      ...previous,
      contentIdentity: context.previousContentIdentity,
      manifestSha256: context.previousManifestSha256,
    },
    current: {
      commit: options.commit,
      gitTree: options.gitTree,
      contentIdentity: currentContentIdentity,
      manifestSha256: sha256(currentManifestBytes),
    },
    verification: options.verification ?? null,
  };
}

async function restoreFailedReplacement(context, state) {
  if (state.candidateActivated && (await exists(context.componentDir))) {
    await safeRemove(
      context.repoRoot,
      context.componentDir,
      "Failed replacement candidate",
      { recursive: true },
    );
  }
  if (state.componentMoved && (await exists(context.snapshotComponent))) {
    await safeRename(
      context.repoRoot,
      context.snapshotComponent,
      context.componentDir,
      "Failed replacement restore",
    );
  }
  await atomicWrite(
    context.repoRoot,
    context.manifestPath,
    context.manifestBytes,
    "Source manifest",
  );
  await safeRemove(
    context.repoRoot,
    context.stagingDir,
    "Failed replacement staging",
    { recursive: true },
  );
  await safeRemove(
    context.repoRoot,
    context.snapshotDir,
    "Failed replacement snapshot",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
}

async function performReplacement(context, options) {
  const state = { componentMoved: false, candidateActivated: false };
  let record;
  try {
    await stageReplacement(context, options);
    await activateReplacement(context, state, options);
    const previous = await writeReplacementManifest(context, options);
    if (options.afterReplace) await options.afterReplace();
    record = await buildReplacementRecord(context, options, previous);
    await atomicWrite(
      context.repoRoot,
      path.join(
        context.repoRoot,
        ".harness-cache",
        "last-transaction.json",
      ),
      `${JSON.stringify(record, null, 2)}\n`,
      "Last transaction record",
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
  await safeRemove(
    context.repoRoot,
    context.stagingDir,
    "Committed replacement staging",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
  return record;
}

async function readLastTransactionIfPresent(repoRoot) {
  const recordPath = path.join(
    repoRoot,
    ".harness-cache",
    "last-transaction.json",
  );
  const present = await assertSafeRegularFileOrAbsent(
    repoRoot,
    recordPath,
    "Last transaction record",
  );
  if (!present) return null;
  return validateTransactionRecord(
    JSON.parse(await readFile(recordPath, "utf8")),
  );
}

async function pruneSupersededSnapshot(
  repoRoot,
  previousRecord,
  currentRecord,
) {
  if (
    !previousRecord ||
    previousRecord.id === currentRecord.id ||
    previousRecord.snapshotPath === currentRecord.snapshotPath
  ) {
    return;
  }
  const snapshot = resolveJournalPath(
    repoRoot,
    previousRecord.snapshotPath,
    "Superseded rollback snapshot",
  );
  const family = previousRecord.operation === "component"
    ? "snapshots"
    : "file-snapshots";
  assertExpectedCachePath(
    snapshot.relative,
    family,
    previousRecord.id,
    "Superseded rollback snapshot",
  );
  await safeRemove(
    repoRoot,
    snapshot.target,
    "Superseded rollback snapshot",
    { recursive: true },
  );
}

export async function replaceComponentTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const candidateDir = path.resolve(options.candidateDir);
  assertReplacementIdentity(options);
  await assertReplacementCandidate(candidateDir);

  const lock = await acquireTransactionLock(repoRoot);
  try {
    await assertNoPendingJournal(repoRoot);
    const previousRecord = await readLastTransactionIfPresent(repoRoot);
    const id = transactionId();
    const context = await loadReplacementContext(
      options,
      repoRoot,
      candidateDir,
      id,
    );
    context.id = id;
    await notifyTransactionBoundary(options, "before-journal", context);
    await writeJournal(context, "created");
    const record = await performReplacement(context, options);
    await pruneSupersededSnapshot(repoRoot, previousRecord, record);
    return record;
  } finally {
    await lock.release();
  }
}

function normalizeManagedPath(value) {
  const relative = String(value ?? "").replaceAll("\\", "/");
  if (
    !relative ||
    relative.startsWith("/") ||
    /^[A-Za-z]:/.test(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative === ".." ||
    relative.startsWith("../")
  ) {
    throw new Error(`Managed file path is unsafe: ${value}.`);
  }
  return relative;
}

function isTrellisManagedPath(relative) {
  if (
    relative === "AGENTS.md" ||
    relative === "README.md" ||
    relative === ".gitattributes" ||
    relative === "harness.sources.json"
  ) {
    return true;
  }
  if (relative.startsWith(".trellis/")) {
    return ![
      ".trellis/tasks/",
      ".trellis/spec/",
      ".trellis/workspace/",
      ".trellis/.backup/",
    ].some((prefix) => relative.startsWith(prefix));
  }
  return [
    ".agents/skills/trellis-",
    ".claude/agents/trellis-",
    ".claude/commands/trellis/",
    ".claude/skills/trellis-",
    ".claude/hooks/",
    ".claude/settings.json",
    ".codex/agents/trellis-",
    ".codex/hooks/",
    ".codex/hooks.json",
    ".codex/config.toml",
    ".gemini/agents/trellis-",
    ".gemini/commands/trellis/",
    ".gemini/hooks/",
    ".gemini/settings.json",
  ].some((prefix) =>
    prefix.endsWith(".json") || prefix.endsWith(".toml")
      ? relative === prefix
      : relative.startsWith(prefix),
  );
}

function normalizeManagedPaths(values, kind) {
  if (kind !== "trellis") {
    throw new Error(`Unsupported managed file transaction kind: ${kind}.`);
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Managed file transaction requires at least one path.");
  }
  const paths = [...new Set(values.map(normalizeManagedPath))].sort();
  const disallowed = paths.filter((relative) =>
    !isTrellisManagedPath(relative),
  );
  if (disallowed.length > 0) {
    throw new Error(
      `Paths are outside the allowed Trellis-managed surface: ${disallowed.join(", ")}.`,
    );
  }
  return paths;
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value, required, optional, label) {
  assertPlainObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} has an invalid schema`
      + `${missing.length ? `; missing ${missing.join(", ")}` : ""}`
      + `${extra.length ? `; unexpected ${extra.join(", ")}` : ""}.`,
    );
  }
}

function assertString(value, label, pattern = null) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`${label} is invalid.`);
  }
}

function validateContentIdentity(value, label) {
  assertExactKeys(
    value,
    ["algorithm", "digest", "entryCount"],
    [],
    label,
  );
  if (
    value.algorithm !== "sha256-tree-v1" ||
    !/^[a-f0-9]{64}$/.test(value.digest) ||
    !Number.isSafeInteger(value.entryCount) ||
    value.entryCount < 0
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateFileFingerprint(value, label) {
  assertPlainObject(value, label);
  if (value.kind === "absent") {
    assertExactKeys(value, ["kind"], [], label);
    return value;
  }
  assertExactKeys(
    value,
    ["kind", "sha256", "size", "mode"],
    [],
    label,
  );
  if (
    value.kind !== "file" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !/^[0-7]{3}$/.test(value.mode)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateComponentState(value, label) {
  assertExactKeys(
    value,
    ["commit", "gitTree", "contentIdentity", "manifestSha256"],
    [],
    label,
  );
  assertString(value.commit, `${label} commit`, /^[a-f0-9]{40}$/);
  assertString(value.gitTree, `${label} Git tree`, /^[a-f0-9]{40}$/);
  assertString(value.manifestSha256, `${label} manifest`, /^[a-f0-9]{64}$/);
  validateContentIdentity(value.contentIdentity, `${label} content identity`);
  return value;
}

function validateSourceMetadata(value, label) {
  if (value === null) return value;
  assertExactKeys(value, ["version"], ["integrity"], label);
  assertString(value.version, `${label} version`);
  if (value.integrity !== undefined) {
    assertString(value.integrity, `${label} integrity`);
  }
  return value;
}

function validateVerification(value, operation) {
  if (value === null) return value;
  if (operation === "component") {
    assertExactKeys(
      value,
      ["repository", "commands", "preservedSparsePaths"],
      ["candidateManifestSha256", "finalCommands"],
      "Component verification",
    );
    assertString(value.repository, "Component verification repository");
    if (
      !Array.isArray(value.commands) ||
      !value.commands.every((entry) => typeof entry === "string") ||
      !Array.isArray(value.preservedSparsePaths) ||
      !value.preservedSparsePaths.every(
        (entry) => typeof entry === "string",
      )
    ) {
      throw new Error("Component verification commands are invalid.");
    }
    if (
      value.candidateManifestSha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(value.candidateManifestSha256)
    ) {
      throw new Error("Component verification manifest digest is invalid.");
    }
    if (
      value.finalCommands !== undefined &&
      (!Array.isArray(value.finalCommands) ||
        !value.finalCommands.every((entry) => typeof entry === "string"))
    ) {
      throw new Error("Component final verification commands are invalid.");
    }
    return value;
  }
  assertExactKeys(
    value,
    ["command", "strategy", "changedPaths", "updateOutput"],
    [],
    "Managed file verification",
  );
  assertString(value.command, "Managed file verification command");
  assertString(value.strategy, "Managed file verification strategy");
  if (
    !Number.isSafeInteger(value.changedPaths) ||
    value.changedPaths < 0 ||
    !Array.isArray(value.updateOutput) ||
    !value.updateOutput.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Managed file verification is invalid.");
  }
  return value;
}

function validateTransactionRecord(record) {
  assertPlainObject(record, "Transaction record");
  const common = [
    "schemaVersion",
    "id",
    "operation",
    "status",
    "createdAt",
    "snapshotPath",
    "previous",
    "current",
    "verification",
  ];
  if (record.operation === "component") {
    assertExactKeys(
      record,
      [...common, "componentPath"],
      ["rolledBackAt"],
      "Component transaction record",
    );
  } else if (record.operation === "managed-files") {
    assertExactKeys(
      record,
      [...common, "kind", "paths"],
      ["rolledBackAt"],
      "Managed file transaction record",
    );
  } else {
    throw new Error("Transaction record operation is invalid.");
  }
  if (
    record.schemaVersion !== 2 ||
    !/^[A-Za-z0-9-]+$/.test(String(record.id ?? "")) ||
    !["committed", "rolled-back"].includes(record.status)
  ) {
    throw new Error("Transaction record is invalid or unsupported.");
  }
  assertString(record.createdAt, "Transaction record creation time");
  if (record.rolledBackAt !== undefined) {
    assertString(record.rolledBackAt, "Transaction rollback time");
  }
  assertString(record.snapshotPath, "Transaction snapshot path");
  validateVerification(record.verification, record.operation);
  if (record.operation === "component") {
    assertString(record.componentPath, "Transaction component path");
    validateComponentState(record.previous, "Previous component state");
    validateComponentState(record.current, "Current component state");
  } else {
    if (record.kind !== "trellis" || !Array.isArray(record.paths)) {
      throw new Error("Managed file transaction metadata is invalid.");
    }
    validateSourceMetadata(record.previous, "Previous managed source");
    validateSourceMetadata(record.current, "Current managed source");
    for (const entry of record.paths) {
      assertExactKeys(
        entry,
        [
          "path",
          "existed",
          "originalFingerprint",
          "installedFingerprint",
        ],
        [],
        "Managed file transaction path",
      );
      assertString(entry.path, "Managed file transaction path");
      if (typeof entry.existed !== "boolean") {
        throw new Error("Managed file transaction existence flag is invalid.");
      }
      validateFileFingerprint(
        entry.originalFingerprint,
        "Managed original fingerprint",
      );
      validateFileFingerprint(
        entry.installedFingerprint,
        "Managed installed fingerprint",
      );
    }
  }
  return record;
}

async function assertRegularFileOrAbsent(target, label) {
  try {
    const details = await lstat(target);
    if (!details.isFile()) {
      throw new Error(`${label} must be a regular file: ${target}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertManagedRegularFileOrAbsent(root, target, label) {
  const parentsExist = await ensureSafeDirectoryChain(
    root,
    path.dirname(target),
    label,
  );
  if (!parentsExist) return false;
  return assertRegularFileOrAbsent(target, label);
}

async function removeManagedRegularFile(root, target, label) {
  const fileExists = await assertManagedRegularFileOrAbsent(
    root,
    target,
    label,
  );
  if (fileExists) await rm(target, { force: true });
}

function managedSnapshotPath(snapshotFiles, relative) {
  return path.join(snapshotFiles, ...relative.split("/"));
}

async function copyRegularFile(sourceRoot, source, targetRoot, target, label) {
  if (
    !(await assertManagedRegularFileOrAbsent(
      sourceRoot,
      source,
      `${label} source`,
    ))
  ) {
    throw new Error(`${label} source is missing: ${source}`);
  }
  await ensureSafeDirectoryChain(
    targetRoot,
    path.dirname(target),
    `${label} destination`,
    { create: true },
  );
  if (
    await assertManagedRegularFileOrAbsent(
      targetRoot,
      target,
      `${label} destination`,
    )
  ) {
    throw new Error(`${label} destination already exists: ${target}`);
  }
  await cp(source, target, {
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
}

async function restoreManagedFileSet(repoRoot, storageRoot, entries) {
  for (const entry of entries) {
    const destination = path.join(repoRoot, ...entry.path.split("/"));
    assertInside(repoRoot, destination, "Managed file destination");
    await removeManagedRegularFile(
      repoRoot,
      destination,
      "Managed file destination",
    );
    if (entry.existed) {
      const source = managedSnapshotPath(storageRoot, entry.path);
      await copyRegularFile(
        repoRoot,
        source,
        repoRoot,
        destination,
        "Managed file restore",
      );
    }
  }
}

async function buildManagedFileEntries(repoRoot, candidateRoot, paths) {
  const entries = [];
  for (const relative of paths) {
    const live = path.join(repoRoot, ...relative.split("/"));
    const candidate = path.join(candidateRoot, ...relative.split("/"));
    assertInside(repoRoot, live, "Managed file destination");
    const existed = await assertManagedRegularFileOrAbsent(
      repoRoot,
      live,
      "Managed live path",
    );
    const candidateExists = await assertManagedRegularFileOrAbsent(
      candidateRoot,
      candidate,
      "Managed candidate path",
    );
    if (!existed && !candidateExists) {
      throw new Error(`Managed path has no live or candidate file: ${relative}.`);
    }
    entries.push({
      path: relative,
      existed,
      candidateExists,
      originalFingerprint: await fingerprintRegularFile(
        repoRoot,
        live,
        "Managed live path",
      ),
      installedFingerprint: await fingerprintRegularFile(
        candidateRoot,
        candidate,
        "Managed candidate path",
      ),
    });
  }
  return entries;
}

function buildManagedFilesJournal(repoRoot, id, kind, snapshotDir, entries) {
  return {
    schemaVersion: 2,
    id,
    operation: "managed-files",
    phase: "created",
    createdAt: new Date().toISOString(),
    kind,
    snapshotPath: path
      .relative(repoRoot, snapshotDir)
      .split(path.sep)
      .join("/"),
    paths: entries,
    appliedCount: 0,
  };
}

async function buildManagedFilesContext(options, repoRoot, id) {
  const candidateRoot = path.resolve(options.candidateRoot);
  const paths = normalizeManagedPaths(options.paths, options.kind);
  const snapshotDir = path.join(
    repoRoot,
    ".harness-cache",
    "file-snapshots",
    id,
  );
  const snapshotFiles = path.join(snapshotDir, "files");
  const { journalPath } = transactionStatePaths(repoRoot);
  assertInside(repoRoot, snapshotDir, "Managed file snapshot");
  const entries = await buildManagedFileEntries(
    repoRoot,
    candidateRoot,
    paths,
  );
  return {
    repoRoot,
    id,
    kind: options.kind,
    candidateRoot,
    paths,
    entries,
    snapshotDir,
    snapshotFiles,
    journalPath,
    journal: buildManagedFilesJournal(
      repoRoot,
      id,
      options.kind,
      snapshotDir,
      entries,
    ),
  };
}

async function stageManagedFileSnapshots(context) {
  await ensureSafeDirectoryChain(
    context.repoRoot,
    context.snapshotFiles,
    "Managed file snapshot",
    { create: true },
  );
  await writeJournal(context, "preparing");
  for (const entry of context.entries) {
    if (!entry.existed) continue;
    const source = path.join(
      context.repoRoot,
      ...entry.path.split("/"),
    );
    await copyRegularFile(
      context.repoRoot,
      source,
      context.repoRoot,
      managedSnapshotPath(context.snapshotFiles, entry.path),
      "Managed file snapshot",
    );
  }
  await writeJournal(context, "prepared");
}

async function applyManagedCandidate(context) {
  for (let index = 0; index < context.entries.length; index++) {
    const entry = context.entries[index];
    const destination = path.join(
      context.repoRoot,
      ...entry.path.split("/"),
    );
    await removeManagedRegularFile(
      context.repoRoot,
      destination,
      "Managed file destination",
    );
    if (entry.candidateExists) {
      const source = path.join(
        context.candidateRoot,
        ...entry.path.split("/"),
      );
      await copyRegularFile(
        context.candidateRoot,
        source,
        context.repoRoot,
        destination,
        "Managed candidate activation",
      );
    }
    context.journal.appliedCount = index + 1;
    await writeJournal(context, "applying");
  }
  await writeJournal(context, "applied");
}

function buildManagedFilesRecord(context, options) {
  return {
    schemaVersion: 2,
    id: context.id,
    operation: "managed-files",
    kind: context.kind,
    status: "committed",
    createdAt: new Date().toISOString(),
    snapshotPath: path
      .relative(context.repoRoot, context.snapshotDir)
      .split(path.sep)
      .join("/"),
    paths: context.entries.map(
      ({
        path: relative,
        existed,
        originalFingerprint,
        installedFingerprint,
      }) => ({
        path: relative,
        existed,
        originalFingerprint,
        installedFingerprint,
      }),
    ),
    previous: options.previous ?? null,
    current: options.current ?? null,
    verification: options.verification ?? null,
  };
}

export async function replaceManagedFilesTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const lock = await acquireTransactionLock(repoRoot);
  try {
    await assertNoPendingJournal(repoRoot);
    const previousRecord = await readLastTransactionIfPresent(repoRoot);
    const id = transactionId();
    const context = await buildManagedFilesContext(options, repoRoot, id);
    let record;
    try {
      await stageManagedFileSnapshots(context);
      await applyManagedCandidate(context);
      if (options.afterApply) await options.afterApply();
      record = buildManagedFilesRecord(context, options);
      await atomicWrite(
        context.repoRoot,
        path.join(
          context.repoRoot,
          ".harness-cache",
          "last-transaction.json",
        ),
        `${JSON.stringify(record, null, 2)}\n`,
        "Last transaction record",
      );
    } catch (error) {
      try {
        await restoreManagedFileSet(
          context.repoRoot,
          context.snapshotFiles,
          context.entries,
        );
        await safeRemove(
          context.repoRoot,
          context.snapshotDir,
          "Failed managed snapshot",
          { recursive: true },
        );
        await removeJournal(context.repoRoot, context.journalPath);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Managed file update failed and restoring its files also failed.",
        );
      }
      throw error;
    }
    await writeJournal(context, "committed");
    await removeJournal(context.repoRoot, context.journalPath);
    await pruneSupersededSnapshot(repoRoot, previousRecord, record);
    return record;
  } finally {
    await lock.release();
  }
}

async function loadRollbackContext(repoRoot, recordPath) {
  assertInside(repoRoot, recordPath, "Transaction record");
  await assertSafeRegularFileOrAbsent(
    repoRoot,
    recordPath,
    "Transaction record",
  );
  const record = validateTransactionRecord(
    JSON.parse(await readFile(recordPath, "utf8")),
  );
  if (record.status !== "committed") {
    throw new Error("The last Harness transaction is not rollback-eligible.");
  }

  const manifestPath = path.join(repoRoot, "harness.sources.json");
  const currentManifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(currentManifestBytes.toString("utf8"));
  const componentDir = path.resolve(
    repoRoot,
    String(manifest.ccg?.snapshotPath ?? ""),
  );
  const componentPath = path
    .relative(repoRoot, componentDir)
    .split(path.sep)
    .join("/");
  if (
    componentPath !== "components/ccg-workflow" ||
    record.componentPath !== componentPath
  ) {
    throw new Error("Transaction component path does not match Harness ownership.");
  }
  const snapshotDir = path.join(
    repoRoot,
    ".harness-cache",
    "snapshots",
    record.id,
  );
  const expectedSnapshotPath = path
    .relative(repoRoot, snapshotDir)
    .split(path.sep)
    .join("/");
  if (record.snapshotPath !== expectedSnapshotPath) {
    throw new Error("Transaction snapshot path does not match its transaction ID.");
  }
  const snapshotComponent = path.join(snapshotDir, "component");
  const snapshotManifest = path.join(snapshotDir, "harness.sources.json");
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
  if (
    manifest.ccg?.commit !== record.current.commit ||
    manifest.ccg?.gitTree !== record.current.gitTree ||
    sha256(currentManifestBytes) !== record.current.manifestSha256
  ) {
    throw new Error(
      "Current Harness manifest changed after the update; refusing rollback.",
    );
  }
  if (!(await exists(snapshotComponent)))
    throw new Error("Rollback component snapshot is missing.");
  await ensureSafeDirectoryChain(
    repoRoot,
    componentDir,
    "Rollback current component",
  );
  await ensureSafeDirectoryChain(
    repoRoot,
    snapshotComponent,
    "Rollback component snapshot",
  );
  const currentContentIdentity = await buildContentIdentity(componentDir);
  if (
    !contentIdentitiesEqual(
      currentContentIdentity,
      record.current.contentIdentity,
    )
  ) {
    throw new Error(
      "Current CCG component changed after the update; refusing rollback.",
    );
  }
  const snapshotContentIdentity = await buildContentIdentity(snapshotComponent);
  if (
    !contentIdentitiesEqual(
      snapshotContentIdentity,
      record.previous.contentIdentity,
    )
  ) {
    throw new Error("Rollback component snapshot identity is invalid.");
  }
  const snapshotManifestBytes = await readFile(snapshotManifest);
  if (sha256(snapshotManifestBytes) !== record.previous.manifestSha256) {
    throw new Error("Rollback source manifest snapshot identity is invalid.");
  }

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
    currentContentIdentity,
    journalPath,
    journal: {
      schemaVersion: 2,
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
      currentContentIdentity,
      currentManifestSha256: sha256(currentManifestBytes),
    },
  };
}

async function restoreInterruptedRollback(context, state) {
  if (state.snapshotActivated && (await exists(context.componentDir))) {
    await safeRename(
      context.repoRoot,
      context.componentDir,
      context.snapshotComponent,
      "Interrupted rollback snapshot restore",
    );
  }
  if (state.currentMoved && (await exists(context.discardComponent))) {
    await safeRename(
      context.repoRoot,
      context.discardComponent,
      context.componentDir,
      "Interrupted rollback current restore",
    );
  }
  await atomicWrite(
    context.repoRoot,
    context.manifestPath,
    context.currentManifestBytes,
    "Source manifest",
  );
  await safeRemove(
    context.repoRoot,
    context.discardRoot,
    "Interrupted rollback discard",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
}

async function activateRollback(context, afterRestore) {
  await safeCreateDirectory(
    context.repoRoot,
    context.discardRoot,
    "Rollback discard",
  );
  await atomicWrite(
    context.repoRoot,
    context.discardManifest,
    context.currentManifestBytes,
    "Rollback discard manifest",
  );
  await writeJournal(context, "prepared");
  const state = { currentMoved: false, snapshotActivated: false };
  try {
    await writeJournal(context, "moving-current");
    await safeRename(
      context.repoRoot,
      context.componentDir,
      context.discardComponent,
      "Rollback current component",
    );
    state.currentMoved = true;
    await writeJournal(context, "current-moved");
    await safeRename(
      context.repoRoot,
      context.snapshotComponent,
      context.componentDir,
      "Rollback snapshot activation",
    );
    state.snapshotActivated = true;
    await writeJournal(context, "snapshot-activated");
    await atomicWrite(
      context.repoRoot,
      context.manifestPath,
      await readFile(context.snapshotManifest),
      "Source manifest",
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
    context.repoRoot,
    context.recordPath,
    `${JSON.stringify(context.record, null, 2)}\n`,
    "Last transaction record",
  );
  await writeJournal(context, "committed");
  await safeRemove(
    context.repoRoot,
    context.discardRoot,
    "Committed rollback discard",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
  return context.record;
}

async function loadManagedFilesRollbackContext(
  repoRoot,
  recordPath,
  record,
) {
  if (
    record.status !== "committed" ||
    record.operation !== "managed-files"
  ) {
    throw new Error("The managed file transaction is not rollback-eligible.");
  }
  const paths = normalizeManagedPaths(
    record.paths?.map((entry) => entry.path),
    record.kind,
  );
  if (paths.length !== record.paths.length) {
    throw new Error("Managed file rollback record contains duplicate paths.");
  }
  const snapshot = resolveJournalPath(
    repoRoot,
    record.snapshotPath,
    "Managed file rollback snapshot",
  );
  assertExpectedCachePath(
    snapshot.relative,
    "file-snapshots",
    record.id,
    "Managed file rollback snapshot",
  );
  const snapshotFiles = path.join(snapshot.target, "files");
  const discardRoot = path.join(
    repoRoot,
    ".harness-cache",
    "file-discard",
    record.id,
  );
  const discardFiles = path.join(discardRoot, "files");
  const { journalPath } = transactionStatePaths(repoRoot);
  assertInside(repoRoot, discardRoot, "Managed file rollback discard");

  const currentEntries = [];
  const recordByPath = new Map(
    record.paths.map((entry) => [entry.path, entry]),
  );
  for (const relative of paths) {
    const live = path.join(repoRoot, ...relative.split("/"));
    const currentFingerprint = await fingerprintRegularFile(
      repoRoot,
      live,
      "Managed rollback live path",
    );
    if (
      !fingerprintsEqual(
        currentFingerprint,
        recordByPath.get(relative).installedFingerprint,
      )
    ) {
      throw new Error(
        `Managed path changed after the update; refusing rollback: ${relative}.`,
      );
    }
    currentEntries.push({
      path: relative,
      existed: currentFingerprint.kind === "file",
      fingerprint: currentFingerprint,
    });
  }
  return {
    repoRoot,
    recordPath,
    record,
    snapshotDir: snapshot.target,
    snapshotFiles,
    discardRoot,
    discardFiles,
    currentEntries,
    journalPath,
    journal: {
      schemaVersion: 2,
      id: record.id,
      operation: "managed-files-rollback",
      phase: "created",
      createdAt: new Date().toISOString(),
      kind: record.kind,
      snapshotPath: record.snapshotPath,
      discardPath: path
        .relative(repoRoot, discardRoot)
        .split(path.sep)
        .join("/"),
      paths: record.paths,
      currentPaths: currentEntries,
    },
  };
}

async function stageManagedRollback(context) {
  await ensureSafeDirectoryChain(
    context.repoRoot,
    context.discardFiles,
    "Managed file rollback discard",
    { create: true },
  );
  await writeJournal(context, "preparing");
  for (const entry of context.currentEntries) {
    if (!entry.existed) continue;
    const live = path.join(
      context.repoRoot,
      ...entry.path.split("/"),
    );
    await copyRegularFile(
      context.repoRoot,
      live,
      context.repoRoot,
      managedSnapshotPath(context.discardFiles, entry.path),
      "Managed rollback discard",
    );
  }
  await writeJournal(context, "prepared");
}

async function performManagedFilesRollback(context, afterRestore) {
  try {
    await stageManagedRollback(context);
    await restoreManagedFileSet(
      context.repoRoot,
      context.snapshotFiles,
      context.record.paths,
    );
    await writeJournal(context, "files-restored");
    if (afterRestore) await afterRestore();
  } catch (error) {
    try {
      await restoreManagedFileSet(
        context.repoRoot,
        context.discardFiles,
        context.currentEntries,
      );
      await safeRemove(
        context.repoRoot,
        context.discardRoot,
        "Failed managed rollback discard",
        { recursive: true },
      );
      await removeJournal(context.repoRoot, context.journalPath);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "Managed file rollback failed and restoring current files also failed.",
      );
    }
    throw error;
  }

  context.record.status = "rolled-back";
  context.record.rolledBackAt = new Date().toISOString();
  await atomicWrite(
    context.repoRoot,
    context.recordPath,
    `${JSON.stringify(context.record, null, 2)}\n`,
    "Last transaction record",
  );
  await writeJournal(context, "committed");
  await safeRemove(
    context.repoRoot,
    context.discardRoot,
    "Committed managed rollback discard",
    { recursive: true },
  );
  await safeRemove(
    context.repoRoot,
    context.snapshotDir,
    "Committed managed rollback snapshot",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
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
    await assertSafeRegularFileOrAbsent(
      repoRoot,
      recordPath,
      "Transaction record",
    );
    const record = validateTransactionRecord(
      JSON.parse(await readFile(recordPath, "utf8")),
    );
    if (record.operation === "managed-files") {
      const context = await loadManagedFilesRollbackContext(
        repoRoot,
        recordPath,
        record,
      );
      return await performManagedFilesRollback(
        context,
        options.afterRestore,
      );
    }
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

function loadManagedRecoveryContext(repoRoot, journal, baseContext) {
  const normalizedPaths = normalizeManagedPaths(
    journal.paths?.map((entry) => entry.path),
    journal.kind,
  );
  if (normalizedPaths.length !== journal.paths?.length) {
    throw new Error("Managed file journal contains duplicate paths.");
  }
  const entryByPath = new Map(
    journal.paths.map((entry) => [entry.path, entry]),
  );
  const entries = normalizedPaths.map((relative) => {
    const entry = entryByPath.get(relative);
    if (typeof entry?.existed !== "boolean") {
      throw new Error("Managed file journal has an invalid path entry.");
    }
    return {
      path: relative,
      existed: entry.existed,
      ...(typeof entry.candidateExists === "boolean"
        ? { candidateExists: entry.candidateExists }
        : {}),
    };
  });
  const snapshot = resolveJournalPath(
    repoRoot,
    journal.snapshotPath,
    "Managed file journal snapshot",
  );
  assertExpectedCachePath(
    snapshot.relative,
    "file-snapshots",
    journal.id,
    "Managed file journal snapshot",
  );
  const context = {
    ...baseContext,
    entries,
    snapshotDir: snapshot.target,
    snapshotFiles: path.join(snapshot.target, "files"),
  };
  if (journal.operation !== "managed-files-rollback") return context;

  const currentPaths = normalizeManagedPaths(
    journal.currentPaths?.map((entry) => entry.path),
    journal.kind,
  );
  if (
    currentPaths.length !== journal.currentPaths?.length ||
    currentPaths.join("\0") !== normalizedPaths.join("\0")
  ) {
    throw new Error("Managed file rollback journal paths do not match.");
  }
  const currentByPath = new Map(
    journal.currentPaths.map((entry) => [entry.path, entry]),
  );
  context.currentEntries = currentPaths.map((relative) => {
    const entry = currentByPath.get(relative);
    if (typeof entry?.existed !== "boolean") {
      throw new Error(
        "Managed file rollback journal has an invalid current path entry.",
      );
    }
    return { path: relative, existed: entry.existed };
  });
  const discard = resolveJournalPath(
    repoRoot,
    journal.discardPath,
    "Managed file rollback discard",
  );
  assertExpectedCachePath(
    discard.relative,
    "file-discard",
    journal.id,
    "Managed file rollback discard",
  );
  context.discardRoot = discard.target;
  context.discardFiles = path.join(discard.target, "files");
  return context;
}

function loadComponentRecoveryContext(repoRoot, journal, baseContext) {
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
    ...baseContext,
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

function validateJournalPathEntry(entry, operation) {
  const replacement = operation === "managed-files";
  assertExactKeys(
    entry,
    replacement
      ? [
          "path",
          "existed",
          "candidateExists",
          "originalFingerprint",
          "installedFingerprint",
        ]
      : [
          "path",
          "existed",
          "originalFingerprint",
          "installedFingerprint",
        ],
    [],
    "Managed journal path",
  );
  assertString(entry.path, "Managed journal path");
  if (
    typeof entry.existed !== "boolean" ||
    (replacement && typeof entry.candidateExists !== "boolean")
  ) {
    throw new Error("Managed journal path flags are invalid.");
  }
  validateFileFingerprint(
    entry.originalFingerprint,
    "Managed journal original fingerprint",
  );
  validateFileFingerprint(
    entry.installedFingerprint,
    "Managed journal installed fingerprint",
  );
}

function validateTransactionJournal(journal) {
  assertPlainObject(journal, "Transaction journal");
  const common = [
    "schemaVersion",
    "id",
    "operation",
    "phase",
    "createdAt",
    "updatedAt",
  ];
  const operation = journal.operation;
  if (operation === "replacement") {
    assertExactKeys(
      journal,
      [
        ...common,
        "componentPath",
        "snapshotPath",
        "stagingPath",
        "previousContentIdentity",
        "previousManifestSha256",
      ],
      [],
      "Replacement journal",
    );
    validateContentIdentity(
      journal.previousContentIdentity,
      "Replacement previous identity",
    );
    assertString(
      journal.previousManifestSha256,
      "Replacement previous manifest",
      /^[a-f0-9]{64}$/,
    );
  } else if (operation === "rollback") {
    assertExactKeys(
      journal,
      [
        ...common,
        "componentPath",
        "snapshotPath",
        "discardPath",
        "currentContentIdentity",
        "currentManifestSha256",
      ],
      [],
      "Rollback journal",
    );
    validateContentIdentity(
      journal.currentContentIdentity,
      "Rollback current identity",
    );
    assertString(
      journal.currentManifestSha256,
      "Rollback current manifest",
      /^[a-f0-9]{64}$/,
    );
  } else if (operation === "managed-files") {
    assertExactKeys(
      journal,
      [
        ...common,
        "kind",
        "snapshotPath",
        "paths",
        "appliedCount",
      ],
      [],
      "Managed file journal",
    );
  } else if (operation === "managed-files-rollback") {
    assertExactKeys(
      journal,
      [
        ...common,
        "kind",
        "snapshotPath",
        "discardPath",
        "paths",
        "currentPaths",
      ],
      [],
      "Managed rollback journal",
    );
  } else {
    throw new Error("Transaction journal operation is invalid.");
  }
  if (
    journal.schemaVersion !== 2 ||
    !/^[A-Za-z0-9-]+$/.test(String(journal.id ?? "")) ||
    typeof journal.phase !== "string" ||
    typeof journal.createdAt !== "string" ||
    typeof journal.updatedAt !== "string"
  ) {
    throw new Error("Transaction journal is invalid or unsupported.");
  }
  if (operation.startsWith("managed-files")) {
    if (
      journal.kind !== "trellis" ||
      !Array.isArray(journal.paths) ||
      journal.paths.length === 0
    ) {
      throw new Error("Managed transaction journal is invalid.");
    }
    for (const entry of journal.paths) {
      validateJournalPathEntry(
        entry,
        operation === "managed-files" ? "managed-files" : "rollback",
      );
    }
    if (
      operation === "managed-files" &&
      (!Number.isSafeInteger(journal.appliedCount) ||
        journal.appliedCount < 0 ||
        journal.appliedCount > journal.paths.length)
    ) {
      throw new Error("Managed journal applied count is invalid.");
    }
    if (operation === "managed-files-rollback") {
      if (!Array.isArray(journal.currentPaths)) {
        throw new Error("Managed rollback current paths are invalid.");
      }
      for (const entry of journal.currentPaths) {
        assertExactKeys(
          entry,
          ["path", "existed", "fingerprint"],
          [],
          "Managed rollback current path",
        );
        assertString(entry.path, "Managed rollback current path");
        if (typeof entry.existed !== "boolean") {
          throw new Error("Managed rollback current existence flag is invalid.");
        }
        validateFileFingerprint(
          entry.fingerprint,
          "Managed rollback current fingerprint",
        );
      }
    }
  }
  return journal;
}

function loadRecoveryContext(repoRoot, journal) {
  validateTransactionJournal(journal);
  const baseContext = {
    repoRoot,
    journal,
    journalPath: transactionStatePaths(repoRoot).journalPath,
    recordPath: path.join(
      repoRoot,
      ".harness-cache",
      "last-transaction.json",
    ),
  };
  return journal.operation.startsWith("managed-files")
    ? loadManagedRecoveryContext(repoRoot, journal, baseContext)
    : loadComponentRecoveryContext(repoRoot, journal, baseContext);
}

async function matchingLastTransaction(context, status) {
  const record = await readJsonIfPresent(context.recordPath);
  if (!record) return false;
  validateTransactionRecord(record);
  return record.id === context.journal.id && record.status === status;
}

async function recoverReplacement(context) {
  if (await matchingLastTransaction(context, "committed")) {
    await safeRemove(
      context.repoRoot,
      context.stagingDir,
      "Committed recovery staging",
      { recursive: true },
    );
    await removeJournal(context.repoRoot, context.journalPath);
    return {
      operation: "replacement",
      outcome: "committed-cleanup-completed",
      transaction: context.journal.id,
    };
  }

  const snapshotExists = await exists(context.snapshotComponent);
  const liveExists = await exists(context.componentDir);
  if (!snapshotExists) {
    if (
      !liveExists ||
      !contentIdentitiesEqual(
        await buildContentIdentity(context.componentDir),
        context.journal.previousContentIdentity,
      ) ||
      sha256(await readFile(context.manifestPath)) !==
        context.journal.previousManifestSha256
    ) {
      throw new Error(
        "Replacement recovery live component identity is invalid.",
      );
    }
    await safeRemove(
      context.repoRoot,
      context.stagingDir,
      "Replacement recovery staging",
      { recursive: true },
    );
    await safeRemove(
      context.repoRoot,
      context.snapshotDir,
      "Replacement recovery snapshot",
      { recursive: true },
    );
    await removeJournal(context.repoRoot, context.journalPath);
    return {
      operation: "replacement",
      outcome: "rolled-back",
      transaction: context.journal.id,
    };
  }

  if (
    !(await exists(context.snapshotManifest)) ||
    !contentIdentitiesEqual(
      await buildContentIdentity(context.snapshotComponent),
      context.journal.previousContentIdentity,
    ) ||
    sha256(await readFile(context.snapshotManifest)) !==
      context.journal.previousManifestSha256
  ) {
    throw new Error("Replacement recovery snapshot identity is invalid.");
  }
  let preservedCandidate = null;
  if (liveExists) {
    const recoveryDiscard = path.join(
      context.repoRoot,
      ".harness-cache",
      "recovery-discard",
      context.journal.id,
    );
    const preserved = path.join(recoveryDiscard, "component");
    await safeCreateDirectory(
      context.repoRoot,
      recoveryDiscard,
      "Replacement recovery discard",
    );
    await safeRename(
      context.repoRoot,
      context.componentDir,
      preserved,
      "Replacement recovery candidate preservation",
    );
    preservedCandidate = path
      .relative(context.repoRoot, preserved)
      .split(path.sep)
      .join("/");
  }
  await safeRename(
    context.repoRoot,
    context.snapshotComponent,
    context.componentDir,
    "Replacement recovery snapshot activation",
  );

  await atomicWrite(
    context.repoRoot,
    context.manifestPath,
    await readFile(context.snapshotManifest),
    "Source manifest",
  );
  await safeRemove(
    context.repoRoot,
    context.stagingDir,
    "Replacement recovery staging",
    { recursive: true },
  );
  await safeRemove(
    context.repoRoot,
    context.snapshotDir,
    "Replacement recovery snapshot",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
  return {
    operation: "replacement",
    outcome: "rolled-back",
    transaction: context.journal.id,
    ...(preservedCandidate ? { preservedCandidate } : {}),
  };
}

async function recoverRollback(context) {
  if (await matchingLastTransaction(context, "rolled-back")) {
    await safeRemove(
      context.repoRoot,
      context.discardRoot,
      "Committed rollback recovery discard",
      { recursive: true },
    );
    await removeJournal(context.repoRoot, context.journalPath);
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
      await safeRename(
        context.repoRoot,
        context.componentDir,
        context.snapshotComponent,
        "Rollback recovery snapshot reconstruction",
      );
    } else if (componentExists) {
      throw new Error(
        "Rollback recovery found an ambiguous live component state.",
      );
    }
    await safeRename(
      context.repoRoot,
      context.discardComponent,
      context.componentDir,
      "Rollback recovery current restore",
    );
  } else if (!componentExists || !snapshotExists) {
    throw new Error(
      "Rollback recovery is missing the current component or rollback snapshot.",
    );
  }

  await atomicWrite(
    context.repoRoot,
    context.manifestPath,
    await readFile(context.discardManifest),
    "Source manifest",
  );
  await safeRemove(
    context.repoRoot,
    context.discardRoot,
    "Rollback recovery discard",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
  return {
    operation: "rollback",
    outcome: "rolled-back",
    transaction: context.journal.id,
  };
}

async function recoverManagedFiles(context) {
  if (await matchingLastTransaction(context, "committed")) {
    await removeJournal(context.repoRoot, context.journalPath);
    return {
      operation: "managed-files",
      outcome: "committed-cleanup-completed",
      transaction: context.journal.id,
    };
  }
  if (context.journal.phase !== "preparing") {
    await restoreManagedFileSet(
      context.repoRoot,
      context.snapshotFiles,
      context.entries,
    );
  }
  await safeRemove(
    context.repoRoot,
    context.snapshotDir,
    "Managed recovery snapshot",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
  return {
    operation: "managed-files",
    outcome: "rolled-back",
    transaction: context.journal.id,
  };
}

async function recoverManagedFilesRollback(context) {
  if (await matchingLastTransaction(context, "rolled-back")) {
    await safeRemove(
      context.repoRoot,
      context.discardRoot,
      "Committed managed rollback recovery discard",
      { recursive: true },
    );
    await safeRemove(
      context.repoRoot,
      context.snapshotDir,
      "Committed managed rollback recovery snapshot",
      { recursive: true },
    );
    await removeJournal(context.repoRoot, context.journalPath);
    return {
      operation: "managed-files-rollback",
      outcome: "committed-cleanup-completed",
      transaction: context.journal.id,
    };
  }
  if (context.journal.phase !== "preparing") {
    await restoreManagedFileSet(
      context.repoRoot,
      context.discardFiles,
      context.currentEntries,
    );
  }
  await safeRemove(
    context.repoRoot,
    context.discardRoot,
    "Managed rollback recovery discard",
    { recursive: true },
  );
  await removeJournal(context.repoRoot, context.journalPath);
  return {
    operation: "managed-files-rollback",
    outcome: "rolled-back",
    transaction: context.journal.id,
  };
}

async function readRecoveryLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function validateRecoveryLock(lock, repoRoot) {
  assertExactKeys(
    lock,
    ["schemaVersion", "pid", "createdAt", "token", "repoRoot"],
    [],
    "Transaction lock",
  );
  if (
    lock.schemaVersion !== 2 ||
    !Number.isSafeInteger(lock.pid) ||
    lock.pid <= 0 ||
    typeof lock.createdAt !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(String(lock.token ?? "")) ||
    normalizePath(lock.repoRoot) !== normalizePath(repoRoot)
  ) {
    throw new Error("Transaction lock is invalid or belongs to another repo.");
  }
  return lock;
}

export async function recoverInterruptedTransaction(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const { lockPath, journalPath } = transactionStatePaths(repoRoot);
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  await ensureSafeDirectoryChain(
    repoRoot,
    path.dirname(lockPath),
    "Transaction recovery state",
    { create: true },
  );
  await assertSafeRegularFileOrAbsent(
    repoRoot,
    lockPath,
    "Transaction lock",
  );
  const rawLock = await readRecoveryLock(lockPath);
  const existingLock = rawLock
    ? validateRecoveryLock(rawLock, repoRoot)
    : null;
  if (
    existingLock?.pid &&
    isProcessAlive(Number(existingLock.pid))
  ) {
    throw new Error(
      `Harness transaction owner PID ${existingLock.pid} is still running.`,
    );
  }
  if (existingLock) {
    await safeRemove(repoRoot, lockPath, "Stale transaction lock");
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
    let result;
    if (journal.operation === "replacement") {
      result = await recoverReplacement(context);
    } else if (journal.operation === "rollback") {
      result = await recoverRollback(context);
    } else if (journal.operation === "managed-files") {
      result = await recoverManagedFiles(context);
    } else {
      result = await recoverManagedFilesRollback(context);
    }
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
