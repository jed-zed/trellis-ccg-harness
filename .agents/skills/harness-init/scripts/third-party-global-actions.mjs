import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { validateThirdPartySourceManifest } from "./third-party-approval.mjs";

const execFile = promisify(execFileCallback);
const OWNER = "trellis-ccg-harness";
const ACTION_GROUPS = new Set(["global-plugins", "mcp-cli"]);
const APPROVAL_GROUPS = [
  ["global-skills", "globalSkills"],
  ["global-plugins", "globalPlugins"],
  ["project-skills", "projectSkills"],
  ["mcp-cli", "mcpCli"],
];
const HEX_64 = /^[a-f0-9]{64}$/i;

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(root, target, label) {
  if (!inside(root, target)) throw new Error(`${label} escapes its approved root.`);
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function durableWriteFile(target, bytes, { flag = "w", mode = 0o600 } = {}) {
  const handle = await open(target, flag, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function realDirectory(target, label) {
  const details = await lstat(target);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-linked directory.`);
  }
  return path.resolve(target);
}

async function readRegularJson(target, label) {
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-linked file.`);
  }
  return JSON.parse(await readFile(target, "utf8"));
}

async function ensureDirectory(homeDir, target) {
  assertInside(homeDir, target, "Managed third-party path");
  const segments = path.relative(path.resolve(homeDir), path.resolve(target)).split(path.sep).filter(Boolean);
  let current = path.resolve(homeDir);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Managed third-party path is unsafe: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

function managedPath(homeDir, relative, label) {
  const target = path.join(path.resolve(homeDir), ...relative.split("/"));
  assertInside(homeDir, target, label);
  return target;
}

function sourceManifestDigest(manifest) {
  return sha256(canonicalJson(manifest));
}

function sourceFor(manifest, candidate) {
  const source = manifest.sources.find((entry) => entry.id === candidate.sourceId);
  if (!source) throw new Error(`Approved candidate ${candidate.id} has no pinned source.`);
  return source;
}

function validateApprovalSelections(manifest, approvals, allCandidates) {
  if (!approvals.selections || typeof approvals.selections !== "object" || Array.isArray(approvals.selections)) {
    throw new Error("Third-party global actions require explicit selections for every approval group.");
  }
  const selectedByGroup = new Map();
  for (const [groupId, key] of APPROVAL_GROUPS) {
    const selection = approvals.selections[key];
    if (!Array.isArray(selection)) {
      throw new Error(`Third-party global actions require ${key} as an explicit array, including when empty.`);
    }
    const allowed = new Set(manifest.candidates.filter((candidate) => candidate.group === groupId).map((candidate) => candidate.id));
    const selected = new Set();
    for (const id of selection) {
      if (typeof id !== "string" || !allowed.has(id)) {
        throw new Error(`${key} contains an invalid third-party candidate for ${groupId}.`);
      }
      if (selected.has(id)) throw new Error(`${key} contains a duplicate third-party candidate.`);
      selected.add(id);
    }
    selectedByGroup.set(groupId, selected);
  }
  for (const id of approvals.approvedActionIds) {
    const candidate = allCandidates.get(id);
    if (!candidate) continue;
    if (!selectedByGroup.get(candidate.group)?.has(id)) {
      throw new Error(`Approved action ${id} was not explicitly selected in its approval group.`);
    }
  }
}

function isImmutableSelector(value) {
  return typeof value === "string" && !/(^|[/@_-])(main|latest)(?:$|[/@_-])/i.test(value);
}

function safeError(error) {
  return String(error?.message ?? error ?? "unknown error")
    .replace(/\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/ig, "Authorization=[redacted]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/ig, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|password|secret|credential)s?\s*[=:]\s*[^\s,;]+/ig, "$1=[redacted]")
    .slice(0, 320);
}

function assertJournalCredentialFree(journal) {
  const serialized = canonicalJson(journal);
  const forbidden = [
    /https?:\/\/[^\s/:"']+:[^\s/@"']+@/i,
    /\bauthorization\s*[:=]\s*(?!\[redacted\])/i,
    /\bbearer\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]+/i,
    /\b(api[_-]?key|password|credential|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?!\[redacted\])/i,
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw new Error("Third-party global action journal contains prohibited credential material.");
  }
}

async function readOwnership(ownershipPath) {
  if (!(await exists(ownershipPath))) {
    return { schemaVersion: 1, owner: OWNER, actions: {}, results: {} };
  }
  const details = await lstat(ownershipPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("Third-party global action ownership record is unsafe.");
  const record = JSON.parse(await readFile(ownershipPath, "utf8"));
  if (record?.schemaVersion !== 1 || record.owner !== OWNER || typeof record.actions !== "object" || (record.results !== undefined && typeof record.results !== "object")) {
    throw new Error("Third-party global action ownership record is invalid.");
  }
  return record;
}

function recordResult(ownership, action) {
  ownership.results ??= {};
  // Persist an intentionally small, secret-free execution receipt. Command
  // stdout/stderr and environment values are never ownership metadata.
  ownership.results[action.id] = {
    status: action.status,
    updatedAt: new Date().toISOString(),
    ...(action.reason ? { reason: action.reason } : {}),
    ...(action.asset ? { asset: action.asset } : {}),
    ...(action.platform ? { platform: action.platform } : {}),
  };
}

function transactionPaths(homeDir) {
  return {
    key: managedPath(homeDir, ".harness-init/third-party-global-actions.key", "Action journal key"),
    lock: managedPath(homeDir, ".agents/harness/third-party-global-actions.lock", "Action lock"),
    journal: managedPath(homeDir, ".agents/harness/third-party-global-actions.journal.json", "Action journal"),
  };
}

async function actionJournalKey(homeDir) {
  const { key } = transactionPaths(homeDir);
  await ensureDirectory(homeDir, path.dirname(key));
  try {
    const info = await lstat(key);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Third-party global action journal key is unsafe.");
    const bytes = await readFile(key);
    if (bytes.length !== 32) throw new Error("Third-party global action journal key is invalid.");
    return bytes;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const bytes = randomBytes(32);
    try {
      await durableWriteFile(key, bytes, { flag: "wx", mode: 0o600 });
      await chmod(key, 0o600);
      return bytes;
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      const info = await lstat(key);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Third-party global action journal key is unsafe.");
      const existing = await readFile(key);
      if (existing.length !== 32) throw new Error("Third-party global action journal key is invalid.");
      return existing;
    }
  }
}

function authenticatedDigest(record, key) {
  const copy = { ...record };
  delete copy.provenance;
  return createHmac("sha256", key).update(canonicalJson(copy)).digest("hex");
}

function authenticatedRecord(record, key) {
  return {
    ...record,
    provenance: {
      algorithm: "hmac-sha256",
      digest: authenticatedDigest(record, key),
    },
  };
}

async function readAuthenticatedRecord(target, key, label) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} is unsafe.`);
  const record = JSON.parse(await readFile(target, "utf8"));
  const actual = String(record?.provenance?.digest ?? "");
  const expected = authenticatedDigest(record, key);
  if (
    record?.provenance?.algorithm !== "hmac-sha256" ||
    !HEX_64.test(actual) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  ) {
    throw new Error(`${label} is unauthenticated or tampered; manual review is required.`);
  }
  return record;
}

async function writeAuthenticatedRecord(target, record, key, {
  expectedDigest = null,
  exclusive = false,
} = {}) {
  const signed = authenticatedRecord(record, key);
  if (exclusive) {
    await durableWriteFile(target, canonicalJson(signed), { flag: "wx", mode: 0o600 });
    await chmod(target, 0o600);
    return signed;
  }
  const stage = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}.stage`);
  try {
    await durableWriteFile(stage, canonicalJson(signed), { flag: "wx", mode: 0o600 });
    await chmod(stage, 0o600);
    const current = await readAuthenticatedRecord(target, key, "Third-party global action transaction record");
    if (expectedDigest !== null && current.provenance.digest !== expectedDigest) {
      throw new Error("Third-party global action transaction record changed before commit.");
    }
    await rename(stage, target);
    return signed;
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}

async function writeOwnership(homeDir, ownershipPath, ownership, expectedCanonical = null) {
  await ensureDirectory(homeDir, path.dirname(ownershipPath));
  const stage = path.join(
    path.dirname(ownershipPath),
    `.third-party-global-actions-${randomUUID()}.json`,
  );
  try {
    await writeFile(stage, canonicalJson(ownership), { flag: "wx", mode: 0o600 });
    await chmod(stage, 0o600);
    if (
      expectedCanonical !== null &&
      canonicalJson(await readOwnership(ownershipPath)) !== expectedCanonical
    ) {
      throw new Error("Third-party global action ownership changed before commit; refusing overwrite.");
    }
    // The exclusive action lock makes replacement a compare-and-swap at the
    // operation level; never stream partial JSON over the previous receipt.
    await rename(stage, ownershipPath);
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}

async function assertTargetStillAbsent(target, label) {
  if (await exists(target)) {
    throw new Error(`${label} appeared after preflight; refusing overwrite.`);
  }
}

let cachedSelfProcessInstance = null;

async function readProcessInstance(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid && cachedSelfProcessInstance) return cachedSelfProcessInstance;
  try {
    if (process.platform === "linux") {
      const [bootId, stat] = await Promise.all([
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readFile(`/proc/${pid}/stat`, "utf8"),
      ]);
      const close = stat.lastIndexOf(")");
      if (close < 0) return undefined;
      const fields = stat.slice(close + 1).trim().split(/\s+/);
      const startTicks = fields[19];
      const identity = startTicks ? `${bootId.trim()}:${startTicks}` : undefined;
      if (pid === process.pid && identity) cachedSelfProcessInstance = identity;
      return identity;
    }
    if (process.platform === "win32") {
      const result = await execFile(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "& { param([int]$targetPid) (Get-Process -Id $targetPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks }",
          String(pid),
        ],
        { windowsHide: true },
      );
      const ticks = String(result.stdout ?? "").trim();
      const identity = ticks ? `windows:${ticks}` : undefined;
      if (pid === process.pid && identity) cachedSelfProcessInstance = identity;
      return identity;
    }
    const result = await execFile("ps", ["-o", "lstart=", "-p", String(pid)], { windowsHide: true });
    const started = String(result.stdout ?? "").trim();
    const identity = started ? `${process.platform}:${started}` : null;
    if (pid === process.pid && identity) cachedSelfProcessInstance = identity;
    return identity;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH" || Number(error?.code) === 1) return null;
    return undefined;
  }
}

async function defaultProcessAlive(pid, expectedInstance) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code !== "EPERM") throw error;
  }
  const actualInstance = await readProcessInstance(pid);
  if (actualInstance === null) return false;
  if (actualInstance === undefined) return true;
  return actualInstance === expectedInstance;
}

function validateLock(lock) {
  if (
    lock?.schemaVersion !== 1 ||
    lock.owner !== OWNER ||
    typeof lock.transactionId !== "string" ||
    typeof lock.processInstance !== "string" ||
    typeof lock.token !== "string" ||
    !["preparing", "active"].includes(lock.phase) ||
    !Number.isSafeInteger(lock.pid) ||
    lock.pid <= 0
  ) {
    throw new Error("Third-party global action lock is invalid or tampered.");
  }
  return lock;
}

async function acquireActionTransaction({
  homeDir,
  key,
  manifestDigest,
  approvals,
  plannedActions,
  ownership,
  ownershipExisted,
  processAlive,
}) {
  const paths = transactionPaths(homeDir);
  await ensureDirectory(homeDir, path.dirname(paths.lock));
  const processInstance = await readProcessInstance(process.pid);
  if (!processInstance) {
    throw new Error("Cannot establish the current OS process instance for the third-party action lock.");
  }
  if (await exists(paths.lock)) {
    const stale = validateLock(await readAuthenticatedRecord(paths.lock, key, "Third-party global action lock"));
    if (await processAlive(stale.pid, stale.processInstance)) {
      throw new Error("A third-party global action lock belongs to a live process; refusing concurrent recovery.");
    }
    const staleClaim = `${paths.lock}.stale-${randomUUID()}`;
    try {
      await rename(paths.lock, staleClaim);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error("Another process claimed the stale third-party global action lock.");
      }
      throw error;
    }
    const claimedStale = validateLock(await readAuthenticatedRecord(staleClaim, key, "Claimed stale third-party global action lock"));
    if (claimedStale.provenance.digest !== stale.provenance.digest) {
      throw new Error("Third-party global action lock changed during stale-lock claim.");
    }
    if (!(await exists(paths.journal))) {
      if (stale.phase !== "preparing") {
        throw new Error("A stale third-party global action lock has no authenticated journal; manual review is required.");
      }
      await rm(staleClaim, { force: true });
      return acquireActionTransaction({
        homeDir,
        key,
        manifestDigest,
        approvals,
        plannedActions,
        ownership,
        ownershipExisted,
        processAlive,
      });
    }
    const journal = await readAuthenticatedRecord(paths.journal, key, "Third-party global action journal");
    validateJournal(journal, { manifestDigest, approvals, plannedActions, lock: stale });
    const claimed = await writeAuthenticatedRecord(paths.lock, {
      schemaVersion: 1,
      owner: OWNER,
      transactionId: stale.transactionId,
      pid: process.pid,
      processInstance,
      token: stale.token,
      claimedFromProcessInstance: stale.processInstance,
      phase: "active",
    }, key, { exclusive: true });
    journal.pid = process.pid;
    journal.processInstance = processInstance;
    const persisted = await writeAuthenticatedRecord(paths.journal, journal, key, {
      expectedDigest: journal.provenance.digest,
    });
    await rm(staleClaim, { force: true });
    return {
      key,
      paths,
      lock: claimed,
      journal: persisted,
      recovered: true,
    };
  }
  if (await exists(paths.journal)) {
    const orphan = await readAuthenticatedRecord(paths.journal, key, "Orphaned third-party global action journal");
    validateJournal(orphan, {
      manifestDigest,
      approvals,
      plannedActions,
      lock: {
        transactionId: orphan.transactionId,
        token: orphan.token,
      },
    });
    if (
      orphan.phase !== "ownership-committed" ||
      !orphan.finalOwnership ||
      canonicalJson(ownership) !== canonicalJson(orphan.finalOwnership)
    ) {
      throw new Error("An authenticated incomplete third-party global action journal exists without its lock; manual review is required.");
    }
    await rm(paths.journal, { force: true });
    return acquireActionTransaction({
      homeDir,
      key,
      manifestDigest,
      approvals,
      plannedActions,
      ownership,
      ownershipExisted,
      processAlive,
    });
  }
  const transactionId = randomUUID();
  const token = randomBytes(24).toString("hex");
  const lock = await writeAuthenticatedRecord(paths.lock, {
    schemaVersion: 1,
    owner: OWNER,
    transactionId,
    pid: process.pid,
    processInstance,
    token,
    phase: "preparing",
  }, key, { exclusive: true });
  const initialJournal = {
    schemaVersion: 1,
    owner: OWNER,
    transactionId,
    pid: process.pid,
    processInstance,
    token,
    sourceManifestSha256: manifestDigest,
    approvedActionIds: [...approvals.approvedActionIds],
    selections: Object.fromEntries(APPROVAL_GROUPS.map(([, groupKey]) => [groupKey, [...approvals.selections[groupKey]]])),
    initialOwnership: {
      existed: ownershipExisted,
      record: JSON.parse(JSON.stringify(ownership)),
      sha256: sha256(canonicalJson(ownership)),
    },
    plannedActions,
    steps: Object.fromEntries(plannedActions.map((action) => [action.id, {
      state: "planned",
      effects: {},
      result: null,
      ownershipAction: null,
    }])),
    phase: "applying",
    finalOwnership: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assertJournalCredentialFree(initialJournal);
  const journal = await writeAuthenticatedRecord(paths.journal, initialJournal, key, { exclusive: true });
  const activeLock = await writeAuthenticatedRecord(paths.lock, {
    schemaVersion: 1,
    owner: OWNER,
    transactionId,
    pid: process.pid,
    processInstance,
    token,
    phase: "active",
  }, key, { expectedDigest: lock.provenance.digest });
  return { key, paths, lock: activeLock, journal, recovered: false };
}

function validateJournal(journal, { manifestDigest, approvals, plannedActions, lock }) {
  const expectedIds = canonicalJson(approvals.approvedActionIds);
  const expectedSelections = canonicalJson(Object.fromEntries(APPROVAL_GROUPS.map(([, key]) => [key, approvals.selections[key]])));
  if (
    journal?.schemaVersion !== 1 ||
    journal.owner !== OWNER ||
    journal.transactionId !== lock.transactionId ||
    journal.token !== lock.token ||
    journal.sourceManifestSha256 !== manifestDigest ||
    canonicalJson(journal.approvedActionIds) !== expectedIds ||
    canonicalJson(journal.selections) !== expectedSelections ||
    canonicalJson(journal.plannedActions) !== canonicalJson(plannedActions) ||
    !journal.initialOwnership ||
    !journal.steps ||
    typeof journal.steps !== "object"
  ) {
    throw new Error("Third-party global action journal does not match the exact approved action transaction.");
  }
}

async function persistJournal(transaction) {
  transaction.journal.updatedAt = new Date().toISOString();
  assertJournalCredentialFree(transaction.journal);
  transaction.journal = await writeAuthenticatedRecord(
    transaction.paths.journal,
    transaction.journal,
    transaction.key,
    { expectedDigest: transaction.journal.provenance.digest },
  );
}

async function releaseActionTransaction(transaction) {
  const current = validateLock(await readAuthenticatedRecord(
    transaction.paths.lock,
    transaction.key,
    "Third-party global action lock",
  ));
  if (
    current.transactionId !== transaction.lock.transactionId ||
    current.processInstance !== transaction.lock.processInstance ||
    current.token !== transaction.lock.token
  ) {
    throw new Error("Third-party global action lock ownership changed; refusing cleanup.");
  }
  await rm(transaction.paths.lock, { force: true });
  await rm(transaction.paths.journal, { force: true });
}

function globalConfigPath({ homeDir, env, platform }) {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) {
    if (!path.isAbsolute(xdg)) throw new Error("XDG_CONFIG_HOME must be absolute for Ponytail configuration.");
    return path.join(xdg, "ponytail", "config.json");
  }
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    if (!path.isAbsolute(appData)) throw new Error("APPDATA must be absolute for Ponytail configuration.");
    return path.join(appData, "ponytail", "config.json");
  }
  return path.join(homeDir, ".config", "ponytail", "config.json");
}

async function casPonytailDefault({ homeDir, env, platform, ownership, manifestDigest, faultInjector, journalEffect }) {
  const configPath = globalConfigPath({ homeDir, env, platform });
  const expected = Buffer.from(canonicalJson({ defaultMode: "full" }));
  const expectedSha256 = sha256(expected);
  const existingOwnership = ownership.actions["ponytail.default-full"];
  if (await exists(configPath)) {
    const info = await lstat(configPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Ponytail configuration target is unsafe.");
    const bytes = await readFile(configPath);
    const current = sha256(bytes);
    if (current === expectedSha256 && existingOwnership?.sha256 === current) return { status: "unchanged", configPath };
    throw new Error("Ponytail global default was modified by the user or is not Harness-owned; refusing overwrite.");
  }
  await ensureDirectory(homeDir, path.dirname(configPath));
  const stage = `${configPath}.harness-stage-${randomUUID()}`;
  assertInside(platform === "win32" && !inside(homeDir, configPath) ? path.dirname(configPath) : homeDir, stage, "Ponytail staged configuration");
  await journalEffect(
    "ponytail.default-full",
    "config-stage",
    { stage, target: configPath, expectedSha256 },
    () => durableWriteFile(stage, expected, { flag: "wx", mode: 0o600 }),
  );
  await faultInjector?.("before-activate:ponytail.default-full");
  await assertTargetStillAbsent(configPath, "Ponytail global default");
  await journalEffect(
    "ponytail.default-full",
    "config-activate",
    { target: configPath, expectedSha256 },
    () => rename(stage, configPath),
  );
  ownership.actions["ponytail.default-full"] = {
    sourceManifestSha256: manifestDigest,
    target: configPath,
    sha256: expectedSha256,
    mode: "full",
    rollback: {
      operation: "remove-created-file-if-unchanged",
      previousExists: false,
      expectedSha256,
    },
  };
  return { status: "installed", configPath };
}

async function rollbackCreatedPonytailDefault({ target, expectedSha256 }) {
  if (!(await exists(target))) return;
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || sha256(await readFile(target)) !== expectedSha256) {
    throw new Error("Ponytail global default changed before rollback; refusing removal.");
  }
  await rm(target, { force: true });
}

async function invoke(runCommand, command, args, options) {
  const result = await runCommand(command, args, { windowsHide: true, ...options });
  const exitCode = Number(result?.exitCode ?? 0);
  if (!Number.isInteger(exitCode) || exitCode !== 0) {
    throw new Error(`${command} exited with status ${Number.isFinite(exitCode) ? exitCode : "unknown"}.`);
  }
  return result ?? { exitCode };
}

async function resolvePinnedSource({ sourceResolver, source, candidate, homeDir, allowNetwork }) {
  if (!allowNetwork) throw new Error(`${candidate.id} requires explicit allowNetwork=true.`);
  if (typeof sourceResolver !== "function") throw new Error(`No pinned source resolver was provided for ${candidate.id}.`);
  const sourceRoot = await sourceResolver({ source, candidate, homeDir });
  if (!sourceRoot || !(await exists(sourceRoot))) throw new Error(`Pinned source resolver did not provide ${candidate.id}.`);
  return await realDirectory(sourceRoot, "Pinned third-party source");
}

function packageTarget(homeDir, candidate, source) {
  const release = String(source.release ?? "");
  if (!release || !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(release)) {
    throw new Error(`${candidate.id} has no immutable package release.`);
  }
  return managedPath(homeDir, `.agents/harness/tools/${candidate.id}/${release}`, "Pinned npm tool target");
}

function parseExactPackageSelector(selector) {
  const match = /^(?<name>(?:@[^/@]+\/)?[^@/]+)@(?<version>\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?)$/.exec(selector);
  if (!match?.groups) throw new Error(`Package selector is not exact and immutable: ${selector}`);
  return match.groups;
}

async function assertSafeNpmTree(root) {
  const canonicalRoot = await realDirectory(root, "Pinned npm tool target");
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(canonicalRoot, target);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        // We do not execute npm's .bin shims, but accepting an in-tree shim
        // lets npm retain its normal layout while still rejecting all other
        // links/reparse points in a reusable tool installation.
        if (!relative.startsWith(`node_modules${path.sep}.bin${path.sep}`)) {
          throw new Error(`Pinned npm tool contains a symbolic link or reparse point: ${relative}`);
        }
        continue;
      }
      if (details.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!details.isFile() || details.nlink > 1) {
        throw new Error(`Pinned npm tool contains a special file or hard link: ${relative}`);
      }
    }
  }
  await visit(canonicalRoot);
  return canonicalRoot;
}

async function fingerprintPinnedNpmTool(root) {
  const canonicalRoot = await assertSafeNpmTree(root);
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(canonicalRoot, target).split(path.sep).join("/");
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        // assertSafeNpmTree already constrained these to unused .bin shims.
        continue;
      }
      if (details.isDirectory()) {
        await visit(target);
        continue;
      }
      const bytes = await readFile(target);
      files.push({ path: relative, size: bytes.length, sha256: sha256(bytes) });
    }
  }
  await visit(canonicalRoot);
  return sha256(canonicalJson(files));
}

async function verifyPinnedNpmTool({ target, candidate, source }) {
  const { name, version } = parseExactPackageSelector(candidate.packageSelector);
  const root = await assertSafeNpmTree(target);
  const lock = await readRegularJson(path.join(root, "package-lock.json"), "Pinned npm package lock");
  const packagePath = path.join(root, "node_modules", ...name.split("/"));
  assertInside(root, packagePath, "Pinned npm package path");
  const installed = await readRegularJson(path.join(packagePath, "package.json"), "Pinned installed package identity");
  if (installed.name !== name || installed.version !== version) {
    throw new Error(`${candidate.id} installed package identity does not match its exact selector.`);
  }
  const lockKey = `node_modules/${name}`;
  const locked = lock?.packages?.[lockKey];
  if (!locked || locked.version !== version || locked.integrity !== source.packageIntegrity) {
    throw new Error(`${candidate.id} package-lock identity or integrity does not match the approved manifest.`);
  }
  const bin = installed.bin;
  const binRelative = typeof bin === "string" ? bin : bin?.[candidate.entrypoint];
  if (typeof binRelative !== "string" || !binRelative) {
    throw new Error(`${candidate.id} installed package has no declared ${candidate.entrypoint} entrypoint.`);
  }
  const script = path.resolve(packagePath, binRelative);
  assertInside(packagePath, script, "Pinned npm entrypoint");
  const scriptDetails = await lstat(script);
  if (!scriptDetails.isFile() || scriptDetails.isSymbolicLink()) {
    throw new Error(`${candidate.id} installed entrypoint is not a regular file.`);
  }
  return { packagePath, script, treeSha256: await fingerprintPinnedNpmTool(root) };
}

async function installPinnedNpmTool({ candidate, source, homeDir, platform, runCommand, ownership, manifestDigest, allowNetwork, faultInjector, journalEffect }) {
  if (!allowNetwork) throw new Error(`${candidate.id} requires explicit allowNetwork=true.`);
  if (!isImmutableSelector(candidate.packageSelector) || !/^.+@\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(candidate.packageSelector)) {
    throw new Error(`${candidate.id} package selector is not exact and immutable.`);
  }
  if (typeof source.packageIntegrity !== "string" || !source.packageIntegrity.startsWith("sha512-")) {
    throw new Error(`${candidate.id} lacks a pinned npm integrity value.`);
  }
  const target = packageTarget(homeDir, candidate, source);
  const owned = ownership.actions[candidate.id];
  if (await exists(target)) {
    if (owned?.packageInstalled === true && owned?.sourceManifestSha256 === manifestDigest && owned?.packageSelector === candidate.packageSelector && owned?.packageIntegrity === source.packageIntegrity) {
      const verified = await verifyPinnedNpmTool({ target, candidate, source });
      if (verified.treeSha256 !== owned.treeSha256) {
        throw new Error(`${candidate.id} installed files drifted from the Harness-owned package fingerprint.`);
      }
      return {
        status: "unchanged",
        target,
        command: process.execPath,
        commandArgs: [verified.script],
        mcpConfigured: owned.mcpConfigured === true,
      };
    }
    throw new Error(`${candidate.id} target exists but is not owned at the approved revision; refusing overwrite.`);
  }
  await ensureDirectory(homeDir, path.dirname(target));
  const stage = `${target}.stage-${randomUUID()}`;
  try {
    // npm receives only an exact selector. Its generated lock binds the
    // package identity and tarball integrity to the files staged for adoption;
    // never trust a separate post-install registry lookup.
    await journalEffect(
      candidate.id,
      "npm-install",
      { stage, target, packageSelector: candidate.packageSelector },
      async () => {
        await mkdir(stage, { mode: 0o700 });
        return invoke(runCommand, "npm", ["install", "--prefix", stage, "--no-save", "--package-lock=true", "--ignore-scripts", candidate.packageSelector], { env: { ...process.env } });
      },
    );
    const verified = await verifyPinnedNpmTool({ target: stage, candidate, source });
    await faultInjector?.(`before-activate:${candidate.id}`);
    await assertTargetStillAbsent(target, `Pinned npm tool ${candidate.id}`);
    await journalEffect(
      candidate.id,
      "package-activate",
      { target },
      () => rename(stage, target),
    );
    ownership.actions[candidate.id] = {
      packageInstalled: true,
      mcpConfigured: false,
      sourceManifestSha256: manifestDigest,
      packageSelector: candidate.packageSelector,
      packageIntegrity: source.packageIntegrity,
      target,
      command: process.execPath,
      commandArgs: [verified.script.replace(stage, target)],
      treeSha256: verified.treeSha256,
    };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  const verified = await verifyPinnedNpmTool({ target, candidate, source });
  return {
    status: "installed",
    target,
    command: process.execPath,
    commandArgs: [verified.script],
    mcpConfigured: false,
  };
}

async function configureMcp({ candidate, command, commandArgs = [], runCommand, journalEffect }) {
  if (!path.isAbsolute(command)) throw new Error(`${candidate.id} MCP command must be absolute.`);
  // Do not use shell strings: this is a host-CLI configuration operation only.
  for (const item of commandArgs) {
    if (!path.isAbsolute(item)) throw new Error(`${candidate.id} MCP command argument must be absolute.`);
  }
  await journalEffect(
    candidate.id,
    "mcp-configure",
    { server: candidate.id, command, commandArgs },
    () => invoke(runCommand, "codex", ["mcp", "add", candidate.id, "--", command, ...commandArgs], {}),
  );
}

async function verifyPonytailSource({ candidate, source, sourceRoot, runCommand }) {
  const result = await invoke(
    runCommand,
    "git",
    ["-C", sourceRoot, "rev-parse", `${source.commit}:${candidate.sourcePath}`],
    {},
  );
  if (String(result.stdout ?? "").trim().toLowerCase() !== String(candidate.sourceGitTree ?? "").toLowerCase()) {
    throw new Error(`Ponytail ${candidate.sourcePath} does not match its pinned source Git tree.`);
  }
}

function ponytailListed(value) {
  if (Array.isArray(value)) return value.some(ponytailListed);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) =>
    (/(^|[.@/_-])ponytail(?:$|[.@/_-])/i.test(key) || (typeof entry === "string" && /(^|[.@/_-])ponytail(?:$|[.@/_-])/i.test(entry))) || ponytailListed(entry),
  );
}

async function inspectPonytailHost(runCommand) {
  try {
    const result = await invoke(runCommand, "codex", ["plugin", "list", "--json"], {});
    const text = String(result.stdout ?? "").trim();
    if (!text) return "unknown";
    return ponytailListed(JSON.parse(text)) ? "present" : "absent";
  } catch {
    return "unknown";
  }
}

function findMcpEntry(value, id) {
  if (Array.isArray(value)) {
    return value.map((entry) => findMcpEntry(entry, id)).find(Boolean) ?? null;
  }
  if (!value || typeof value !== "object") return null;
  if (
    value.name === id ||
    value.id === id ||
    value.server === id ||
    value.serverName === id
  ) return value;
  if (value[id] && typeof value[id] === "object") return value[id];
  for (const nested of Object.values(value)) {
    const found = findMcpEntry(nested, id);
    if (found) return found;
  }
  return null;
}

async function inspectMcpHost({ candidate, command, commandArgs, runCommand }) {
  try {
    const result = await invoke(runCommand, "codex", ["mcp", "list", "--json"], {});
    const text = String(result.stdout ?? "").trim();
    if (!text) return "unknown";
    const parsed = JSON.parse(text);
    const entry = findMcpEntry(parsed, candidate.id);
    if (!entry) return "absent";
    const actualCommand = entry.command ?? entry.transport?.command;
    const actualArgs = entry.args ?? entry.arguments ?? entry.transport?.args ?? [];
    return actualCommand === command && canonicalJson(actualArgs) === canonicalJson(commandArgs)
      ? "present"
      : "mismatch";
  } catch {
    return "unknown";
  }
}

async function installPonytail({ candidate, source, homeDir, sourceResolver, runCommand, allowNetwork, ownership, manifestDigest, journalEffect }) {
  const sourceRoot = await resolvePinnedSource({ sourceResolver, source, candidate, homeDir, allowNetwork });
  await verifyPonytailSource({ candidate, source, sourceRoot, runCommand });
  const inventory = await inspectPonytailHost(runCommand);
  if (ownership.actions[candidate.id]?.sourceManifestSha256 === manifestDigest) {
    if (inventory === "present") return { status: "unchanged" };
    return {
      status: "manual-pending",
      reason: "Codex host plugin JSON inventory cannot prove the owned Ponytail installation.",
    };
  }
  if (inventory === "present") {
    return {
      status: "manual-pending",
      reason: "Codex host already lists an unowned Ponytail plugin; refusing to add or claim it.",
    };
  }
  if (inventory === "unknown") {
    return {
      status: "manual-pending",
      reason: "Codex host plugin inventory is unavailable; refusing to mutate or claim Ponytail.",
    };
  }
  // The Codex host owns its plugin cache. Never copy plugin files into it.
  await journalEffect(
    candidate.id,
    "plugin-marketplace-add",
    { plugin: "ponytail", sourceId: source.id, commit: source.commit },
    () => invoke(runCommand, "codex", ["plugin", "marketplace", "add", sourceRoot], {}),
  );
  await journalEffect(
    candidate.id,
    "plugin-add",
    { plugin: "ponytail" },
    () => invoke(runCommand, "codex", ["plugin", "add", "ponytail"], {}),
  );
  ownership.actions[candidate.id] = {
    sourceManifestSha256: manifestDigest,
    sourceId: source.id,
    commit: source.commit,
    installedThrough: "codex-host-cli",
  };
  return { status: "installed" };
}

async function locateRipgrepBinary(root, executableName) {
  const canonicalRoot = await realDirectory(root, "Pinned ripgrep extraction");
  const matches = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) throw new Error("Pinned ripgrep extraction contains a symbolic link or reparse point.");
      if (details.isDirectory()) {
        await visit(target);
      } else if (details.isFile()) {
        if (entry.name === executableName) matches.push(target);
      } else {
        throw new Error("Pinned ripgrep extraction contains a special file.");
      }
    }
  }
  await visit(canonicalRoot);
  if (matches.length !== 1) throw new Error(`Pinned ripgrep extraction must contain exactly one ${executableName}.`);
  const details = await lstat(matches[0]);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink > 1) throw new Error("Pinned ripgrep executable is not a regular non-linked file.");
  return matches[0];
}

async function extractRipgrepArchive({ archive, unpacked, platform, runCommand }) {
  await mkdir(unpacked, { recursive: true, mode: 0o700 });
  if (platform === "win32-x64") {
    await invoke(
      runCommand,
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-Command", "& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }", archive, unpacked],
      {},
    );
    return;
  }
  if (platform === "linux-x64" || platform === "darwin-x64") {
    await invoke(runCommand, "tar", ["-xzf", archive, "-C", unpacked], {});
    return;
  }
  throw new Error(`No approved ripgrep extractor exists for ${platform}.`);
}

async function installRipgrep({ candidate, source, homeDir, platform, allowNetwork, ownership, manifestDigest, fetchImpl = globalThis.fetch, runCommand, faultInjector, journalEffect }) {
  const asset = source.assets?.find((item) => item.platform === platform);
  if (!asset) return { status: "skipped-unsupported-platform", platform };
  if (!allowNetwork) throw new Error(`${candidate.id} requires explicit allowNetwork=true.`);
  if (!HEX_64.test(asset.sha256)) throw new Error("ripgrep asset checksum is invalid.");
  const target = managedPath(homeDir, `.agents/harness/tools/ripgrep/${source.release}`, "Pinned ripgrep target");
  const executableName = platform === "win32-x64" ? "rg.exe" : "rg";
  const filePath = path.join(target, executableName);
  const owned = ownership.actions[candidate.id];
  if (await exists(target)) {
    await realDirectory(target, "Pinned ripgrep target");
    if (!(await exists(filePath))) {
      throw new Error("ripgrep target exists without the owned executable; refusing overwrite.");
    }
    const details = await lstat(filePath);
    const actual = details.isFile() && !details.isSymbolicLink() && details.nlink <= 1 ? sha256(await readFile(filePath)) : null;
    if (owned?.sourceManifestSha256 === manifestDigest && actual && actual === owned.executableSha256) return { status: "unchanged", executable: filePath };
    throw new Error("ripgrep executable was modified by the user or is not Harness-owned; refusing reuse.");
  }
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for pinned ripgrep release asset.");
  const releaseTag = `15.2.0` === String(source.release) ? `15.2.0` : String(source.release);
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${releaseTag}/${asset.name}`;
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`Pinned ripgrep release asset download failed (${response?.status ?? "unknown"}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== asset.sha256) throw new Error("Pinned ripgrep release asset checksum did not match.");
  await ensureDirectory(homeDir, path.dirname(target));
  const stage = `${target}.stage-${randomUUID()}`;
  try {
    const archive = path.join(stage, asset.name);
    const unpacked = path.join(stage, "unpacked");
    await journalEffect(
      candidate.id,
      "asset-stage",
      { stage, archive, asset: asset.name, assetSha256: asset.sha256 },
      async () => {
        await mkdir(stage, { mode: 0o700 });
        await durableWriteFile(archive, bytes, { flag: "wx", mode: 0o600 });
      },
    );
    await journalEffect(
      candidate.id,
      "archive-extract",
      { stage, archive, platform },
      () => extractRipgrepArchive({ archive, unpacked, platform, runCommand }),
    );
    const binary = await locateRipgrepBinary(unpacked, executableName);
    const finalExecutable = path.join(stage, executableName);
    await rename(binary, finalExecutable);
    await rm(unpacked, { recursive: true, force: true });
    await rm(archive, { force: true });
    const finalDetails = await lstat(finalExecutable);
    if (!finalDetails.isFile() || finalDetails.isSymbolicLink() || finalDetails.nlink > 1) throw new Error("Pinned ripgrep executable changed during staging.");
    const executableSha256 = sha256(await readFile(finalExecutable));
    await faultInjector?.(`before-activate:${candidate.id}`);
    await assertTargetStillAbsent(target, "Pinned ripgrep target");
    await journalEffect(
      candidate.id,
      "binary-activate",
      { target, executable: filePath, expectedSha256: executableSha256 },
      () => rename(stage, target),
    );
    ownership.actions[candidate.id] = {
      sourceManifestSha256: manifestDigest,
      release: source.release,
      asset: asset.name,
      assetSha256: asset.sha256,
      executable: filePath,
      executableSha256,
      target,
    };
    return { status: "installed", executable: filePath };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

function actionTargets({ candidate, source, homeDir, env, platform }) {
  if (candidate.id === "ponytail.install") {
    return ["codex:plugin-marketplace/ponytail", "codex:plugin/ponytail"];
  }
  if (candidate.id === "ponytail.hooks") return ["codex:hook-trust/ponytail"];
  if (candidate.id === "ponytail.default-full") {
    return [globalConfigPath({ homeDir, env, platform })];
  }
  if (candidate.id === "codegraph" || candidate.id === "fast-context") {
    return [
      packageTarget(homeDir, candidate, source),
      `codex:mcp/${candidate.id}`,
    ];
  }
  if (candidate.id === "ripgrep") {
    return [managedPath(homeDir, `.agents/harness/tools/ripgrep/${source.release}`, "Pinned ripgrep target")];
  }
  return [];
}

function buildPlannedActions({ approvedIds, candidates, manifest, homeDir, env, platform }) {
  return approvedIds.map((id) => {
    const candidate = candidates.get(id);
    const source = sourceFor(manifest, candidate);
    return {
      id,
      group: candidate.group,
      sourceId: source.id,
      dependencies: [...candidate.dependencies],
      targets: actionTargets({ candidate, source, homeDir, env, platform }),
    };
  });
}

function journalActionResult(action) {
  return {
    id: action.id,
    status: action.status,
    ...(action.reason ? { reason: action.reason } : {}),
    ...(action.target ? { target: action.target } : {}),
    ...(action.configPath ? { configPath: action.configPath } : {}),
    ...(action.executable ? { executable: action.executable } : {}),
    ...(action.platform ? { platform: action.platform } : {}),
    ...(action.mcpConfigured !== undefined ? { mcpConfigured: action.mcpConfigured } : {}),
    ...(action.error ? { error: safeError(action.error) } : {}),
  };
}

function hasAttemptedEffects(step) {
  return Object.values(step?.effects ?? {}).some((effect) =>
    effect?.state === "attempting" || effect?.state === "applied",
  );
}

async function reconcileInterruptedAction({
  candidate,
  source,
  step,
  homeDir,
  env,
  platform,
  runCommand,
  ownership,
  manifestDigest,
}) {
  if (!hasAttemptedEffects(step)) return null;
  if (candidate.id === "ponytail.install") {
    const inventory = await inspectPonytailHost(runCommand);
    return {
      id: candidate.id,
      status: "manual-pending",
      reason: inventory === "present"
        ? "Ponytail is present after an interrupted host mutation, but host inventory cannot prove its pinned source and commit."
        : inventory === "absent"
        ? "Interrupted Ponytail host mutation is not present in inventory; refusing to repeat it automatically."
        : "Ponytail host inventory is unavailable after an interrupted mutation.",
    };
  }
  if (candidate.id === "ponytail.default-full") {
    const configPath = globalConfigPath({ homeDir, env, platform });
    if (!(await exists(configPath))) {
      return {
        id: candidate.id,
        status: "manual-pending",
        reason: "Interrupted Ponytail configuration staging has no verified final target; refusing automatic replay.",
      };
    }
    const info = await lstat(configPath);
    const expected = Buffer.from(canonicalJson({ defaultMode: "full" }));
    const expectedSha256 = sha256(expected);
    if (!info.isFile() || info.isSymbolicLink() || sha256(await readFile(configPath)) !== expectedSha256) {
      return {
        id: candidate.id,
        status: "manual-pending",
        reason: "Ponytail configuration cannot be reconciled to the interrupted approved default.",
      };
    }
    ownership.actions[candidate.id] = {
      sourceManifestSha256: manifestDigest,
      target: configPath,
      sha256: expectedSha256,
      mode: "full",
      rollback: {
        operation: "remove-created-file-if-unchanged",
        previousExists: false,
        expectedSha256,
      },
    };
    return { id: candidate.id, status: "recovered", configPath };
  }
  if (candidate.id === "codegraph" || candidate.id === "fast-context") {
    const target = packageTarget(homeDir, candidate, source);
    if (!(await exists(target))) {
      if (step.effects["npm-install"] || step.effects["package-activate"]) {
        return {
          id: candidate.id,
          status: "manual-pending",
          reason: `Interrupted ${candidate.id} package operation has no verified final target; refusing automatic replay.`,
        };
      }
      return null;
    }
    const verified = await verifyPinnedNpmTool({ target, candidate, source });
    const command = process.execPath;
    const commandArgs = [verified.script];
    const inventory = await inspectMcpHost({ candidate, command, commandArgs, runCommand });
    ownership.actions[candidate.id] = {
      packageInstalled: true,
      mcpConfigured: inventory === "present",
      sourceManifestSha256: manifestDigest,
      packageSelector: candidate.packageSelector,
      packageIntegrity: source.packageIntegrity,
      target,
      command,
      commandArgs,
      treeSha256: verified.treeSha256,
    };
    if (inventory === "present") {
      return { id: candidate.id, status: "recovered", target, mcpConfigured: true };
    }
    if (inventory === "unknown" || inventory === "mismatch" || step.effects["mcp-configure"]) {
      return {
        id: candidate.id,
        status: "manual-pending",
        target,
        mcpConfigured: false,
        reason: inventory === "absent"
          ? `Interrupted ${candidate.id} MCP mutation is absent; refusing to repeat it automatically.`
          : `${candidate.id} MCP host inventory cannot prove the interrupted approved configuration.`,
      };
    }
    return null;
  }
  if (candidate.id === "ripgrep") {
    const target = managedPath(homeDir, `.agents/harness/tools/ripgrep/${source.release}`, "Pinned ripgrep target");
    const executableName = platform === "win32-x64" ? "rg.exe" : "rg";
    const executable = path.join(target, executableName);
    if (!(await exists(executable))) {
      return {
        id: candidate.id,
        status: "manual-pending",
        reason: "Interrupted ripgrep staging has no verified final target; refusing automatic replay.",
      };
    }
    const info = await lstat(executable);
    const asset = source.assets?.find((item) => item.platform === platform);
    const executableSha256 = info.isFile() && !info.isSymbolicLink() && info.nlink <= 1
      ? sha256(await readFile(executable))
      : null;
    const journalExpectedSha256 = step.effects["binary-activate"]?.details?.expectedSha256;
    if (!asset || !executableSha256 || executableSha256 !== journalExpectedSha256) {
      return { id: candidate.id, status: "manual-pending", reason: "Interrupted ripgrep installation inventory is unsafe." };
    }
    ownership.actions[candidate.id] = {
      sourceManifestSha256: manifestDigest,
      release: source.release,
      asset: asset.name,
      assetSha256: asset.sha256,
      executable,
      executableSha256,
      target,
    };
    return { id: candidate.id, status: "recovered", executable };
  }
  return null;
}

/**
 * Applies only already-approved global plugin and MCP/CLI actions.  A missing
 * approval is a no-op; this function never infers a default selection.
 */
export async function applyThirdPartyGlobalActions({
  manifest,
  approvals,
  homeDir = os.homedir(),
  allowNetwork = false,
  runCommand = execFile,
  sourceResolver,
  env = process.env,
  platform = process.platform,
  fetchImpl,
  faultInjector,
  processAlive = defaultProcessAlive,
} = {}) {
  validateThirdPartySourceManifest(manifest);
  await realDirectory(homeDir, "User home");
  const manifestDigest = sourceManifestDigest(manifest);
  if (!approvals || approvals.sourceManifestSha256 !== manifestDigest || !Array.isArray(approvals.approvedActionIds)) {
    throw new Error("Third-party global actions require approvals bound to the exact source manifest.");
  }
  if (
    approvals.approvedActionIds.some((id) => typeof id !== "string") ||
    new Set(approvals.approvedActionIds).size !== approvals.approvedActionIds.length
  ) {
    throw new Error("Third-party global actions require unique string approval ids.");
  }
  const allCandidates = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  validateApprovalSelections(manifest, approvals, allCandidates);
  for (const id of approvals.approvedActionIds) {
    if (!allCandidates.has(id)) {
      throw new Error(`Third-party global actions received unknown approved id ${id}.`);
    }
  }
  const candidates = new Map(manifest.candidates.filter((candidate) => ACTION_GROUPS.has(candidate.group)).map((candidate) => [candidate.id, candidate]));
  const approvedIds = approvals.approvedActionIds.filter((id) => candidates.has(id));
  if (approvedIds.length === 0) return { status: "skipped", actions: [], ownershipPath: managedPath(homeDir, ".agents/harness/third-party-global-actions.json", "Ownership path") };

  const ownershipPath = managedPath(homeDir, ".agents/harness/third-party-global-actions.json", "Ownership path");
  const approved = new Set(approvedIds);
  for (const id of approvedIds) {
    const candidate = candidates.get(id);
    const missingDependencies = candidate.dependencies.filter((dependency) => !approved.has(dependency));
    if (missingDependencies.length) {
      throw new Error(`${candidate.id} requires explicitly approved dependencies: ${missingDependencies.join(", ")}.`);
    }
  }
  const plannedActions = buildPlannedActions({
    approvedIds,
    candidates,
    manifest,
    homeDir,
    env,
    platform,
  });
  const ownershipExisted = await exists(ownershipPath);
  const ownership = await readOwnership(ownershipPath);
  const key = await actionJournalKey(homeDir);
  const transaction = await acquireActionTransaction({
    homeDir,
    key,
    manifestDigest,
    approvals,
    plannedActions,
    ownership,
    ownershipExisted,
    processAlive,
  });
  let preserveTransaction = false;
  try {
    const initialOwnershipCanonical = canonicalJson(transaction.journal.initialOwnership.record);
    const currentOwnershipCanonical = canonicalJson(ownership);
    if (transaction.journal.finalOwnership) {
      const finalOwnershipCanonical = canonicalJson(transaction.journal.finalOwnership);
      if (currentOwnershipCanonical === finalOwnershipCanonical) {
        transaction.journal.phase = "ownership-committed";
        await persistJournal(transaction);
        const recoveredActions = Object.values(transaction.journal.steps)
          .map((step) => step.result)
          .filter(Boolean);
        await releaseActionTransaction(transaction);
        return {
          status: recoveredActions.some((action) => action.status === "failed") ? "partial-failure" : "applied",
          actions: recoveredActions,
          ownershipPath,
          recovered: true,
        };
      }
    }
    if (currentOwnershipCanonical !== initialOwnershipCanonical) {
      throw new Error("Third-party global action ownership changed during an interrupted transaction; manual review is required.");
    }
    const actions = [];
    const rollbackEntries = [];
    const journalEffect = async (actionId, effectId, details, operation) => {
      const step = transaction.journal.steps[actionId];
      if (!step || step.state === "completed") {
        throw new Error(`Third-party global action journal cannot start ${actionId}:${effectId}.`);
      }
      const previous = step.effects[effectId];
      if (previous?.state === "attempting") {
        throw new Error(`Third-party global action ${actionId}:${effectId} is unresolved; refusing automatic replay.`);
      }
      step.state = "applying";
      step.effects[effectId] = {
        state: "attempting",
        details,
        updatedAt: new Date().toISOString(),
      };
      await persistJournal(transaction);
      await faultInjector?.(`after-intent:${actionId}:${effectId}`);
      const result = await operation();
      await faultInjector?.(`after-side-effect:${actionId}:${effectId}`);
      step.effects[effectId] = {
        state: "applied",
        details,
        updatedAt: new Date().toISOString(),
      };
      await persistJournal(transaction);
      return result;
    };
    for (const id of approvedIds) {
      const candidate = candidates.get(id);
      const source = sourceFor(manifest, candidate);
      const step = transaction.journal.steps[id];
      try {
        let result;
        if (step.state === "completed" && step.result) {
          if (step.ownershipAction) ownership.actions[id] = step.ownershipAction;
          result = { ...step.result };
          delete result.id;
        } else {
          const reconciled = transaction.recovered
            ? await reconcileInterruptedAction({
              candidate,
              source,
              step,
              homeDir,
              env,
              platform,
              runCommand,
              ownership,
              manifestDigest,
            })
            : null;
          if (reconciled) {
            result = { ...reconciled };
            delete result.id;
          } else if (id === "ponytail.install") {
            result = await installPonytail({ candidate, source, homeDir, sourceResolver, runCommand, allowNetwork, ownership, manifestDigest, journalEffect });
          } else if (id === "ponytail.hooks") {
            // Codex does not expose a stable noninteractive trust command. Keep an
            // approved hook request visible, but never guess or mutate trust state.
            result = { status: "manual-pending", reason: "Review and trust Ponytail hooks in the Codex host UI." };
          } else if (id === "ponytail.default-full") {
            result = await casPonytailDefault({ homeDir, env, platform, ownership, manifestDigest, faultInjector, journalEffect });
            if (result.status === "installed") {
              rollbackEntries.push({
                target: result.configPath,
                expectedSha256: ownership.actions[id].sha256,
              });
            }
          } else if (id === "codegraph" || id === "fast-context") {
            const installed = await installPinnedNpmTool({ candidate, source, homeDir, platform, runCommand, ownership, manifestDigest, allowNetwork, faultInjector, journalEffect });
            if (!installed.mcpConfigured) {
              await configureMcp({ candidate, command: installed.command, commandArgs: installed.commandArgs, runCommand, journalEffect });
              ownership.actions[id].mcpConfigured = true;
              result = { ...installed, status: installed.status === "unchanged" ? "configured" : installed.status, mcpConfigured: true };
            } else {
              result = installed;
            }
          } else if (id === "ripgrep") {
            result = await installRipgrep({ candidate, source, homeDir, platform, allowNetwork, ownership, manifestDigest, fetchImpl, runCommand, faultInjector, journalEffect });
          } else {
            result = { status: "skipped-unsupported-action" };
          }
        }
        const action = { id, ...result };
        actions.push(action);
        recordResult(ownership, action);
        step.state = "completed";
        step.result = journalActionResult(action);
        step.ownershipAction = ownership.actions[id] ?? null;
        await persistJournal(transaction);
        if (id === "ponytail.install" && action.status === "manual-pending") break;
      } catch (error) {
        if (error?.code === "HARNESS_SIMULATED_HARD_KILL") {
          preserveTransaction = true;
          throw error;
        }
        const action = { id, status: "failed", error: safeError(error) };
        actions.push(action);
        recordResult(ownership, action);
        step.state = "completed";
        step.result = journalActionResult(action);
        step.ownershipAction = ownership.actions[id] ?? null;
        await persistJournal(transaction);
        // Do not continue into dependent/other host mutations after a failure.
        break;
      }
    }
    ownership.updatedAt = new Date().toISOString();
    ownership.sourceManifestSha256 = manifestDigest;
    transaction.journal.phase = "ownership-pending";
    transaction.journal.finalOwnership = ownership;
    await persistJournal(transaction);
    try {
      await faultInjector?.("before-ownership");
      await writeOwnership(homeDir, ownershipPath, ownership, initialOwnershipCanonical);
      await faultInjector?.("after-side-effect:ownership");
      transaction.journal.phase = "ownership-committed";
      await persistJournal(transaction);
    } catch (error) {
      if (error?.code === "HARNESS_SIMULATED_HARD_KILL") {
        preserveTransaction = true;
        throw error;
      }
      try {
        for (const entry of rollbackEntries.reverse()) {
          await rollbackCreatedPonytailDefault(entry);
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Third-party global action ownership failed and Ponytail rollback also failed.",
        );
      }
      throw error;
    }
    await releaseActionTransaction(transaction);
    return {
      status: actions.some((action) => action.status === "failed") ? "partial-failure" : "applied",
      actions,
      ownershipPath,
      recovered: transaction.recovered,
    };
  } catch (error) {
    if (error?.code === "HARNESS_SIMULATED_HARD_KILL") preserveTransaction = true;
    throw error;
  } finally {
    if (!preserveTransaction && await exists(transaction.paths.lock)) {
      const journalPhase = transaction.journal.phase;
      if (journalPhase === "ownership-committed") {
        await releaseActionTransaction(transaction);
      }
    }
  }
}
