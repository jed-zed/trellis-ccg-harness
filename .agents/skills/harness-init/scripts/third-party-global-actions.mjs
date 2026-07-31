import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readlink, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  thirdPartySubprocessEnvironment,
  validateThirdPartySourceManifest,
  verifyThirdPartyApprovalPlanForOperation,
} from "./third-party-approval.mjs";
import {
  bindPlannedTrustedCommands,
  minimalCommandEnvironment,
} from "./trusted-command-resolver.mjs";
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

export function normalizeAssetPlatform(platform, arch) {
  if (typeof platform !== "string" || !platform || typeof arch !== "string" || !arch) {
    throw new Error("Asset platform requires explicit operating-system and architecture values.");
  }
  return `${platform}-${arch}`;
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

function planHasExactCandidate(plan, id) {
  return plan.groups
    .flatMap((group) => group.candidates)
    .some(
      (candidate) =>
        candidate.id === id && candidate.installed?.status === "exact",
    );
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
  if (pid === process.pid) {
    cachedSelfProcessInstance = `process:${process.pid}:${randomUUID()}`;
    return cachedSelfProcessInstance;
  }
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
    // Node has no portable API for another process' start identity. On hosts
    // without /proc, a live PID is therefore treated conservatively as live
    // instead of spawning an environment-influenced helper command.
    return undefined;
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
  return {
    status: "manual-pending",
    configPath,
    reason: "Ponytail global default requires an atomic create-only host configuration operation; automatic rename could overwrite a concurrent user configuration.",
  };
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
  const result = await runCommand(command, args, {
    windowsHide: true,
    ...options,
    env: minimalCommandEnvironment(options?.env ?? {}),
    shell: false,
  });
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
  void source;
  return managedPath(homeDir, `.agents/harness/tools/${candidate.id}/latest`, "Latest npm tool target");
}

function parseLatestPackageSelector(selector) {
  const match = /^(?<name>(?:@[^/@]+\/)?[^@/]+)@latest$/.exec(selector);
  if (!match?.groups) throw new Error(`Package selector is not an approved latest channel: ${selector}`);
  return match.groups;
}

async function assertSafeNpmTree(root) {
  const canonicalRoot = await realDirectory(root, "Pinned npm tool target");
  const validateBinShim = async (target, relative) => {
    const normalized = relative.replaceAll("\\", "/").split("/");
    if (
      normalized.length !== 3 ||
      normalized[0] !== "node_modules" ||
      normalized[1] !== ".bin" ||
      !normalized[2]
    ) {
      throw new Error(`Pinned npm tool contains a symbolic link or reparse point: ${relative}`);
    }
    const linkTarget = await readlink(target);
    if (!linkTarget || path.isAbsolute(linkTarget)) {
      throw new Error(`Pinned npm .bin shim must use a non-empty relative link target: ${relative}`);
    }
    const resolvedTarget = path.resolve(path.dirname(target), linkTarget);
    assertInside(canonicalRoot, resolvedTarget, "Pinned npm .bin shim target");
    const targetDetails = await lstat(resolvedTarget);
    if (
      !targetDetails.isFile() ||
      targetDetails.isSymbolicLink() ||
      targetDetails.nlink > 1
    ) {
      throw new Error(`Pinned npm .bin shim target is not a regular in-tree file: ${relative}`);
    }
    return {
      linkTarget: linkTarget.split(path.sep).join("/"),
      resolvedTarget: path.relative(canonicalRoot, resolvedTarget).split(path.sep).join("/"),
    };
  };
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(canonicalRoot, target);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        await validateBinShim(target, relative);
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
  return { canonicalRoot, validateBinShim };
}

export async function fingerprintPinnedNpmTool(root) {
  const { canonicalRoot, validateBinShim } = await assertSafeNpmTree(root);
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(canonicalRoot, target).split(path.sep).join("/");
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        const link = await validateBinShim(target, relative);
        files.push({
          path: relative,
          type: "symlink",
          linkTarget: link.linkTarget,
          resolvedTarget: link.resolvedTarget,
        });
        continue;
      }
      if (details.isDirectory()) {
        await visit(target);
        continue;
      }
      const bytes = await readFile(target);
      files.push({ path: relative, type: "file", size: bytes.length, sha256: sha256(bytes) });
    }
  }
  await visit(canonicalRoot);
  return sha256(canonicalJson(files));
}

async function verifyPinnedNpmTool({ target, candidate, source }) {
  const { name } = parseLatestPackageSelector(candidate.packageSelector);
  const { canonicalRoot: root } = await assertSafeNpmTree(target);
  const lockPath = path.join(root, "package-lock.json");
  const lockDetails = await lstat(lockPath);
  if (!lockDetails.isFile() || lockDetails.isSymbolicLink() || lockDetails.nlink > 1) {
    throw new Error("Pinned npm package lock must be a regular non-linked file.");
  }
  const lockBytes = await readFile(lockPath);
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const packagePath = path.join(root, "node_modules", ...name.split("/"));
  assertInside(root, packagePath, "Pinned npm package path");
  const installed = await readRegularJson(path.join(packagePath, "package.json"), "Pinned installed package identity");
  if (
    installed.name !== name ||
    typeof installed.version !== "string" ||
    !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(installed.version)
  ) {
    throw new Error(`${candidate.id} installed package identity is invalid.`);
  }
  const lockKey = `node_modules/${name}`;
  const locked = lock?.packages?.[lockKey];
  if (
    !locked ||
    locked.version !== installed.version ||
    typeof locked.integrity !== "string" ||
    !locked.integrity.startsWith("sha512-")
  ) {
    throw new Error(`${candidate.id} generated package-lock identity or integrity is invalid.`);
  }
  source.release = installed.version;
  source.packageIntegrity = locked.integrity;
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
  return {
    packagePath,
    script,
    packageVersion: installed.version,
    packageIntegrity: locked.integrity,
    packageLockSha256: sha256(lockBytes),
    treeSha256: await fingerprintPinnedNpmTool(root),
  };
}

async function installPinnedNpmTool({ candidate, source, homeDir, platform, runCommand, ownership, manifestDigest, allowNetwork, faultInjector, journalEffect }) {
  if (!allowNetwork) throw new Error(`${candidate.id} requires explicit allowNetwork=true.`);
  const { name } = parseLatestPackageSelector(candidate.packageSelector);
  if (source.channel !== "latest" || source.package !== name) {
    throw new Error(`${candidate.id} source does not match its approved latest npm channel.`);
  }
  const target = packageTarget(homeDir, candidate, source);
  const owned = ownership.actions[candidate.id];
  if (await exists(target)) {
    if (
      owned?.packageInstalled === true &&
      owned?.sourceManifestSha256 === manifestDigest &&
      owned?.packageSelector === candidate.packageSelector
    ) {
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
    const packageJsonBytes = Buffer.from(canonicalJson({
      private: true,
      dependencies: { [name]: "latest" },
    }));
    await journalEffect(
      candidate.id,
      "npm-ci",
      {
        stage,
        target,
        packageSelector: candidate.packageSelector,
        packageChannel: "latest",
      },
      async () => {
        await mkdir(stage, { mode: 0o700 });
        await durableWriteFile(path.join(stage, "package.json"), packageJsonBytes, { flag: "wx", mode: 0o600 });
        return invoke(
          runCommand,
          "npm",
          ["install", "--prefix", stage, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=true"],
          {},
        );
      },
    );
    const verified = await verifyPinnedNpmTool({ target: stage, candidate, source });
    await faultInjector?.(`before-activate:${candidate.id}`);
    await assertTargetStillAbsent(target, `Pinned npm tool ${candidate.id}`);
    await rm(stage, { recursive: true, force: true });
    return {
      status: "manual-pending",
      target,
      reason: `${candidate.id} resolved and verified the latest npm package but requires an atomic create-only tool-directory publish operation.`,
      mcpConfigured: false,
    };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function configureMcp({ candidate, command, commandArgs = [], runCommand }) {
  if (!path.isAbsolute(command)) throw new Error(`${candidate.id} MCP command must be absolute.`);
  if (
    commandArgs.length !== 5 ||
    !path.isAbsolute(commandArgs[0]) ||
    commandArgs[1] !== "--home" ||
    !path.isAbsolute(commandArgs[2]) ||
    commandArgs[3] !== "--candidate" ||
    commandArgs[4] !== candidate.id
  ) {
    throw new Error(`${candidate.id} MCP command must use the owned Harness runtime launcher.`);
  }
  const before = await inspectMcpHost({ candidate, command, commandArgs, runCommand });
  if (before !== "absent") {
    return {
      status: "manual-pending",
      reason: before === "present"
        ? `${candidate.id} already has the exact launcher but is not Harness-owned; refusing takeover.`
        : before === "mismatch"
          ? `${candidate.id} already has a conflicting MCP host configuration; refusing overwrite.`
          : `${candidate.id} MCP host inventory is unavailable; refusing mutation.`,
    };
  }
  const immediatelyBeforeAdd = await inspectMcpHost({
    candidate,
    command,
    commandArgs,
    runCommand,
  });
  if (immediatelyBeforeAdd !== "absent") {
    return {
      status: "manual-pending",
      reason: immediatelyBeforeAdd === "present"
        ? `${candidate.id} appeared with the exact launcher during MCP preflight; refusing takeover.`
        : immediatelyBeforeAdd === "mismatch"
          ? `${candidate.id} was configured concurrently with a conflicting MCP launcher; refusing overwrite.`
          : `${candidate.id} MCP host inventory became unavailable during preflight; refusing mutation.`,
    };
  }
  // Current Codex `mcp add` has no atomic create-only/no-overwrite mode. A
  // second read cannot close the race between inspection and mutation, so an
  // absent entry stays manual until the host exposes a proven create-only API.
  return {
    status: "manual-pending",
    reason: `${candidate.id} requires a host MCP create-only operation; Codex mcp add can overwrite a concurrent user configuration.`,
  };
}

function mcpLauncherInvocation({ candidate, homeDir }) {
  const launcher = managedPath(
    homeDir,
    ".agents/skills/harness-init/scripts/third-party-mcp-launcher.mjs",
    "Harness third-party MCP launcher",
  );
  return {
    command: process.execPath,
    commandArgs: [
      launcher,
      "--home",
      path.resolve(homeDir),
      "--candidate",
      candidate.id,
    ],
  };
}

async function verifyPonytailSource({ candidate, source, sourceRoot, runCommand }) {
  const headResult = await invoke(
    runCommand,
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    {},
  );
  const resolvedCommit = String(headResult.stdout ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(resolvedCommit)) {
    throw new Error("Latest Ponytail source did not resolve to a Git commit.");
  }
  source.commit = resolvedCommit;
  const result = await invoke(
    runCommand,
    "git",
    ["-C", sourceRoot, "rev-parse", `${resolvedCommit}:${candidate.sourcePath}`],
    {},
  );
  const resolvedTree = String(result.stdout ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(resolvedTree)) {
    throw new Error(`Ponytail ${candidate.sourcePath} did not resolve to a Git tree.`);
  }
  candidate.sourceGitTree = resolvedTree;
  const plugin = await readRegularJson(
    path.join(sourceRoot, ".codex-plugin", "plugin.json"),
    "Pinned Ponytail plugin identity",
  );
  if (
    plugin?.name !== "ponytail" ||
    typeof plugin.version !== "string" ||
    !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(plugin.version) ||
    plugin.license !== source.license
  ) {
    throw new Error("Latest Ponytail plugin metadata is invalid.");
  }
  source.release = plugin.version;
  return plugin;
}

function ponytailMarketplaceIdentity({ source, homeDir }) {
  void source;
  const marketplaceName = "harness-ponytail-latest";
  const marketplaceRoot = managedPath(
    homeDir,
    ".agents/harness/marketplaces/ponytail/latest",
    "Latest Ponytail marketplace",
  );
  return {
    marketplaceName,
    marketplaceRoot,
    pluginId: `ponytail@${marketplaceName}`,
  };
}

function comparableHostPath(value) {
  if (typeof value !== "string" || !value) return null;
  const normalized = process.platform === "win32" && value.startsWith("\\\\?\\")
    ? value.slice(4)
    : value;
  return path.resolve(normalized);
}

async function inspectPonytailHost({
  source,
  sourceRoot,
  marketplaceName,
  marketplaceRoot,
  pluginId,
  runCommand,
}) {
  try {
    const [marketplaceResult, pluginResult] = await Promise.all([
      invoke(runCommand, "codex", ["plugin", "marketplace", "list", "--json"], {}),
      invoke(runCommand, "codex", ["plugin", "list", "--available", "--json"], {}),
    ]);
    const marketplaceText = String(marketplaceResult.stdout ?? "").trim();
    const pluginText = String(pluginResult.stdout ?? "").trim();
    if (!marketplaceText || !pluginText) return { status: "unknown" };
    const marketplaces = JSON.parse(marketplaceText)?.marketplaces;
    const pluginInventory = JSON.parse(pluginText);
    if (!Array.isArray(marketplaces) || !Array.isArray(pluginInventory?.installed)) {
      return { status: "unknown" };
    }
    const namedMarketplaces = marketplaces.filter((entry) => entry?.name === marketplaceName);
    const installedNamed = pluginInventory.installed.filter((entry) => entry?.name === "ponytail");
    const exactMarketplace = namedMarketplaces.length === 1 &&
      comparableHostPath(namedMarketplaces[0]?.root) === comparableHostPath(marketplaceRoot);
    const exactPlugins = installedNamed.filter((entry) =>
      entry?.pluginId === pluginId &&
      entry?.marketplaceName === marketplaceName &&
      entry?.version === source.release &&
      entry?.installed === true &&
      entry?.source?.source === "local" &&
      comparableHostPath(entry?.source?.path) === comparableHostPath(sourceRoot),
    );
    if (
      namedMarketplaces.length > 1 ||
      installedNamed.length > 1 ||
      (namedMarketplaces.length === 1 && !exactMarketplace) ||
      (installedNamed.length === 1 && exactPlugins.length !== 1)
    ) {
      return { status: "mismatch", marketplacePresent: exactMarketplace, pluginInstalled: false };
    }
    if (exactPlugins.length === 1 && !exactMarketplace) {
      return { status: "mismatch", marketplacePresent: false, pluginInstalled: true };
    }
    if (exactMarketplace && exactPlugins.length === 1) {
      return { status: "exact", marketplacePresent: true, pluginInstalled: true };
    }
    return { status: "absent", marketplacePresent: exactMarketplace, pluginInstalled: false };
  } catch {
    return { status: "unknown" };
  }
}

function findMcpEntries(value, id) {
  const matches = [];
  const seen = new Set();
  const visit = (entry) => {
    if (!entry || typeof entry !== "object" || seen.has(entry)) return;
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (
      entry.name === id ||
      entry.id === id ||
      entry.server === id ||
      entry.serverName === id
    ) {
      matches.push(entry);
      return;
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (key === id && nested && typeof nested === "object") {
        matches.push(nested);
      } else {
        visit(nested);
      }
    }
  };
  visit(value);
  return matches;
}

async function inspectMcpHost({ candidate, command, commandArgs, runCommand }) {
  try {
    const result = await invoke(runCommand, "codex", ["mcp", "list", "--json"], {});
    const text = String(result.stdout ?? "").trim();
    if (!text) return "unknown";
    const parsed = JSON.parse(text);
    const entries = findMcpEntries(parsed, candidate.id);
    if (entries.length === 0) return "absent";
    if (entries.length !== 1) return "mismatch";
    const entry = entries[0];
    const actualCommand = entry.command ?? entry.transport?.command;
    const actualArgs = entry.args ?? entry.arguments ?? entry.transport?.args ?? [];
    const transportType = entry.transport?.type;
    return (
      entry.enabled === true &&
      transportType === "stdio" &&
      actualCommand === command &&
      canonicalJson(actualArgs) === canonicalJson(commandArgs)
    )
      ? "present"
      : "mismatch";
  } catch {
    return "unknown";
  }
}

async function materializePonytailMarketplace({
  homeDir,
  source,
  sourceRoot,
  identity,
  existingOwnership,
  journalEffect,
}) {
  const manifestPath = path.join(identity.marketplaceRoot, ".agents", "plugins", "marketplace.json");
  const bytes = Buffer.from(canonicalJson({
    name: identity.marketplaceName,
    interface: { displayName: `Pinned Ponytail ${source.release}` },
    plugins: [
      {
        name: "ponytail",
        source: { source: "local", path: path.resolve(sourceRoot) },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  }));
  const expectedSha256 = sha256(bytes);
  if (await exists(identity.marketplaceRoot)) {
    if (
      existingOwnership?.marketplaceManifestSha256 !== expectedSha256 ||
      existingOwnership?.marketplaceRoot !== identity.marketplaceRoot
    ) {
      throw new Error("Pinned Ponytail marketplace target exists without matching Harness ownership.");
    }
    const info = await lstat(manifestPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink > 1 ||
      sha256(await readFile(manifestPath)) !== expectedSha256
    ) {
      throw new Error("Pinned Ponytail marketplace files drifted from Harness ownership.");
    }
    return { manifestPath, sha256: expectedSha256 };
  }
  await ensureDirectory(homeDir, path.dirname(identity.marketplaceRoot));
  await journalEffect(
    "ponytail.install",
    "marketplace-materialize",
    {
      marketplaceRoot: identity.marketplaceRoot,
      manifestPath,
      expectedSha256,
    },
    async () => {
      await mkdir(identity.marketplaceRoot, { mode: 0o700 });
      await ensureDirectory(homeDir, path.dirname(manifestPath));
      await durableWriteFile(manifestPath, bytes, { flag: "wx", mode: 0o600 });
    },
  );
  return { manifestPath, sha256: expectedSha256 };
}

async function installPonytail({ candidate, source, homeDir, sourceResolver, runCommand, allowNetwork, ownership, manifestDigest, journalEffect }) {
  const sourceRoot = await resolvePinnedSource({ sourceResolver, source, candidate, homeDir, allowNetwork });
  await verifyPonytailSource({ candidate, source, sourceRoot, runCommand });
  const identity = ponytailMarketplaceIdentity({ source, homeDir });
  const existingOwnership = ownership.actions[candidate.id];
  let marketplace = existingOwnership
    ? await materializePonytailMarketplace({
        homeDir,
        source,
        sourceRoot,
        identity,
        existingOwnership,
        journalEffect,
      })
    : null;
  let inventory = await inspectPonytailHost({
    source,
    sourceRoot,
    ...identity,
    runCommand,
  });
  if (existingOwnership?.sourceManifestSha256 === manifestDigest) {
    if (
      existingOwnership.sourceRoot === sourceRoot &&
      existingOwnership.marketplaceName === identity.marketplaceName &&
      existingOwnership.pluginId === identity.pluginId &&
      existingOwnership.version === source.release &&
      inventory.status === "exact"
    ) {
      return { status: "unchanged" };
    }
    return {
      status: "manual-pending",
      reason: "Codex host inventory cannot prove the exact owned Ponytail marketplace, source, and version.",
    };
  }
  if (inventory.status === "mismatch") {
    return {
      status: "manual-pending",
      reason: "Codex host already has a conflicting Ponytail marketplace or plugin identity.",
    };
  }
  if (inventory.status === "exact") {
    return {
      status: "manual-pending",
      reason: "Codex host already has the exact Ponytail plugin but no matching Harness ownership; refusing takeover.",
    };
  }
  if (inventory.status === "unknown") {
    return {
      status: "manual-pending",
      reason: "Codex host plugin inventory is unavailable; refusing to mutate or claim Ponytail.",
    };
  }
  return {
    status: "manual-pending",
    reason: "Ponytail requires atomic create-only marketplace and plugin host operations; Codex plugin add semantics are not proven non-overwriting.",
  };
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

function assertSafeArchiveMember(name, label) {
  if (typeof name !== "string" || !name || name.includes("\0")) {
    throw new Error(`${label} contains an invalid archive member name.`);
  }
  const normalized = name.replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} contains an unsafe archive member: ${name}`);
  }
  return normalized;
}

async function extractRipgrepArchive({ archive, unpacked, assetPlatform, executableName, runCommand }) {
  await mkdir(unpacked, { recursive: true, mode: 0o700 });
  if (assetPlatform === "win32-x64") {
    const destination = path.join(unpacked, executableName);
    assertInside(unpacked, destination, "Pinned ripgrep extracted executable");
    await invoke(
      runCommand,
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "& { param($archive, $destination, $expectedName)",
          "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
          "$zip = [System.IO.Compression.ZipFile]::OpenRead($archive);",
          "try {",
          "  $selected = $null;",
          "  foreach ($entry in $zip.Entries) {",
          "    $name = $entry.FullName.Replace('\\', '/').TrimEnd('/');",
          "    if (-not $name -or $name.StartsWith('/') -or $name -match '^[A-Za-z]:' -or @($name.Split('/') | Where-Object { -not $_ -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) { throw 'unsafe zip member'; }",
          "    $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000);",
          "    $dosAttributes = ($entry.ExternalAttributes -band 0xFFFF);",
          "    $isDirectory = $entry.FullName.EndsWith('/');",
          "    if (($unixType -ne 0 -and $unixType -ne 0x8000 -and -not ($isDirectory -and $unixType -eq 0x4000)) -or (($dosAttributes -band 0x400) -ne 0)) { throw 'zip link or reparse member'; }",
          "    if (-not $isDirectory -and [IO.Path]::GetFileName($name) -eq $expectedName) { if ($selected) { throw 'duplicate executable'; }; $selected = $entry; }",
          "  }",
          "  if (-not $selected) { throw 'missing executable'; }",
          "  $parent = [IO.Path]::GetDirectoryName($destination); [IO.Directory]::CreateDirectory($parent) | Out-Null;",
          "  $input = $selected.Open();",
          "  try { $output = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None); try { $input.CopyTo($output); } finally { $output.Dispose(); } } finally { $input.Dispose(); }",
          "} finally { $zip.Dispose(); }",
          "}",
        ].join(" "),
        archive,
        destination,
        executableName,
      ],
      {},
    );
    return;
  }
  if (assetPlatform === "linux-x64" || assetPlatform === "darwin-x64") {
    const namesResult = await invoke(runCommand, "tar", ["-tzf", archive], {});
    const verboseResult = await invoke(runCommand, "tar", ["-tvzf", archive], {});
    const names = String(namesResult.stdout ?? "").split(/\r?\n/).filter(Boolean);
    const types = String(verboseResult.stdout ?? "").split(/\r?\n/).filter(Boolean);
    if (!names.length || names.length !== types.length) {
      throw new Error("Pinned ripgrep tar inventory is incomplete.");
    }
    const candidates = [];
    for (let index = 0; index < names.length; index += 1) {
      const normalized = assertSafeArchiveMember(names[index], "Pinned ripgrep tar");
      const type = types[index][0];
      if (type !== "-" && type !== "d") {
        throw new Error(`Pinned ripgrep tar contains a link or special member: ${normalized}`);
      }
      if (type === "-" && path.posix.basename(normalized) === executableName) {
        candidates.push(normalized);
      }
    }
    if (candidates.length !== 1) {
      throw new Error(`Pinned ripgrep tar must contain exactly one regular ${executableName}.`);
    }
    await invoke(runCommand, "tar", ["-xzf", archive, "-C", unpacked, "--", candidates[0]], {});
    return;
  }
  throw new Error(`No approved ripgrep extractor exists for ${assetPlatform}.`);
}

async function installRipgrep({ candidate, source, homeDir, assetPlatform, allowNetwork, ownership, manifestDigest, fetchImpl = globalThis.fetch, runCommand, faultInjector, journalEffect }) {
  if (!allowNetwork) throw new Error(`${candidate.id} requires explicit allowNetwork=true.`);
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available for the latest ripgrep release.");
  const suffixes = {
    "win32-x64": "x86_64-pc-windows-msvc.zip",
    "linux-x64": "x86_64-unknown-linux-musl.tar.gz",
    "darwin-x64": "x86_64-apple-darwin.tar.gz",
  };
  const suffix = suffixes[assetPlatform];
  if (!suffix) return { status: "skipped-unsupported-platform", platform: assetPlatform };
  const releaseResponse = await fetchImpl("https://api.github.com/repos/BurntSushi/ripgrep/releases/latest");
  if (!releaseResponse?.ok) throw new Error(`Latest ripgrep release lookup failed (${releaseResponse?.status ?? "unknown"}).`);
  const release = await releaseResponse.json();
  if (typeof release?.tag_name !== "string" || !/^\d+(?:\.\d+){1,3}$/.test(release.tag_name)) {
    throw new Error("Latest ripgrep release returned an invalid tag.");
  }
  const releaseAsset = Array.isArray(release.assets)
    ? release.assets.find((item) => typeof item?.name === "string" && item.name.endsWith(suffix))
    : null;
  if (
    !releaseAsset ||
    typeof releaseAsset.browser_download_url !== "string" ||
    !releaseAsset.browser_download_url.startsWith(`https://github.com/BurntSushi/ripgrep/releases/download/${release.tag_name}/`)
  ) {
    throw new Error(`Latest ripgrep release has no approved ${assetPlatform} asset.`);
  }
  const asset = { platform: assetPlatform, name: releaseAsset.name, sha256: null };
  source.release = release.tag_name;
  if (
    typeof asset.name !== "string" ||
    !asset.name ||
    path.basename(asset.name) !== asset.name ||
    asset.name === "." ||
    asset.name === ".."
  ) {
    throw new Error("ripgrep asset name is not a safe basename.");
  }
  const target = managedPath(homeDir, ".agents/harness/tools/ripgrep/latest", "Latest ripgrep target");
  const executableName = assetPlatform === "win32-x64" ? "rg.exe" : "rg";
  const filePath = path.join(target, executableName);
  const owned = ownership.actions[candidate.id];
  if (await exists(target)) {
    await realDirectory(target, "Pinned ripgrep target");
    if (!(await exists(filePath))) {
      throw new Error("ripgrep target exists without the owned executable; refusing overwrite.");
    }
    const details = await lstat(filePath);
    const actual = details.isFile() && !details.isSymbolicLink() && details.nlink <= 1 ? sha256(await readFile(filePath)) : null;
    if (
      owned?.sourceManifestSha256 === manifestDigest &&
      owned?.assetPlatform === assetPlatform &&
      owned?.asset === asset.name &&
      actual &&
      actual === owned.executableSha256
    ) {
      return { status: "unchanged", executable: filePath, platform: assetPlatform };
    }
    throw new Error("ripgrep executable was modified by the user or is not Harness-owned; refusing reuse.");
  }
  const response = await fetchImpl(releaseAsset.browser_download_url);
  if (!response?.ok) throw new Error(`Latest ripgrep release asset download failed (${response?.status ?? "unknown"}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  asset.sha256 = sha256(bytes);
  source.assets = [asset];
  await ensureDirectory(homeDir, path.dirname(target));
  const stage = `${target}.stage-${randomUUID()}`;
  try {
    const archive = path.join(stage, asset.name);
    assertInside(stage, archive, "Pinned ripgrep staged archive");
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
      { stage, archive, platform: assetPlatform },
      () => extractRipgrepArchive({ archive, unpacked, assetPlatform, executableName, runCommand }),
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
    await rm(stage, { recursive: true, force: true });
    return {
      status: "manual-pending",
      assetPlatform,
      platform: assetPlatform,
      reason: "ripgrep resolved and verified the latest release but requires an atomic create-only tool-directory publish operation.",
    };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

function actionTargets({ candidate, source, homeDir, env, platform }) {
  if (candidate.id === "ponytail.install") {
    const identity = ponytailMarketplaceIdentity({ source, homeDir });
    return [
      identity.marketplaceRoot,
      `codex:plugin-marketplace/${identity.marketplaceName}`,
      `codex:plugin/${identity.pluginId}`,
    ];
  }
  if (candidate.id === "ponytail.hooks") return ["codex:hook-trust/ponytail"];
  if (candidate.id === "ponytail.default-full") {
    return [globalConfigPath({ homeDir, env, platform })];
  }
  if (candidate.kind === "ccg-managed-mcp") return [];
  if (candidate.kind === "mcp-cli") {
    return [
      packageTarget(homeDir, candidate, source),
      `codex:mcp/${candidate.id}`,
    ];
  }
  if (candidate.id === "ripgrep") {
    return [managedPath(homeDir, ".agents/harness/tools/ripgrep/latest", "Latest ripgrep target")];
  }
  return [];
}

function buildPlannedActions({
  approvedIds,
  candidates,
  manifest,
  homeDir,
  env,
  platform,
  assetPlatform,
  commandIdentities = {},
}) {
  return approvedIds.map((id) => {
    const candidate = candidates.get(id);
    const source = sourceFor(manifest, candidate);
    const requiredCommands = requiredCommandsForAction(candidate, assetPlatform);
    return {
      id,
      group: candidate.group,
      sourceId: source.id,
      dependencies: [...candidate.dependencies],
      targets: actionTargets({ candidate, source, homeDir, env, platform }),
      ...(candidate.kind === "ccg-managed-mcp"
        ? {
            handoff: structuredClone(candidate.action),
            source: ccgManagedMcpSource(candidate, source),
          }
        : {}),
      ...(candidate.id === "ripgrep" ? { assetPlatform } : {}),
      ...(requiredCommands.length
        ? {
            commandIdentities: Object.fromEntries(
              requiredCommands
                .filter((name) => commandIdentities[name])
                .map((name) => [name, commandIdentities[name]]),
            ),
          }
        : {}),
    };
  });
}

function requiredCommandsForAction(candidate, assetPlatform) {
  if (candidate.kind === "mcp-cli") return ["npm", "codex"];
  if (candidate.id === "ponytail.install") return ["codex", "git"];
  if (candidate.id === "ripgrep" && assetPlatform === "win32-x64") return ["powershell"];
  if (
    candidate.id === "ripgrep" &&
    (assetPlatform === "linux-x64" || assetPlatform === "darwin-x64")
  ) {
    return ["tar"];
  }
  return [];
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
    ...(action.handoff ? { handoff: structuredClone(action.handoff) } : {}),
    ...(action.source ? { source: structuredClone(action.source) } : {}),
    ...(action.error ? { error: safeError(action.error) } : {}),
  };
}

function ccgManagedMcpSource(candidate, source) {
  return {
    repository: source.repository,
    channel: source.channel,
    ...(source.commit ? { commit: source.commit } : {}),
    ...(source.gitTree ? { gitTree: source.gitTree } : {}),
    ...(source.release ? { release: source.release } : {}),
    ...(candidate.packageSelector
      ? { packageSelector: candidate.packageSelector }
      : {}),
    ...(source.packageIntegrity
      ? { packageIntegrity: source.packageIntegrity }
      : {}),
    ...(source.endpoint ? { endpoint: source.endpoint } : {}),
    ...(source.documentation ? { documentation: source.documentation } : {}),
    ...(source.accessGuide ? { accessGuide: source.accessGuide } : {}),
    ...(source.artifactPolicy
      ? { artifactPolicy: source.artifactPolicy }
      : {}),
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
  assetPlatform,
  runCommand,
  ownership,
  manifestDigest,
}) {
  if (!hasAttemptedEffects(step)) return null;
  if (candidate.id === "ponytail.install") {
    const identity = ponytailMarketplaceIdentity({ source, homeDir });
    const sourceRoot =
      step.effects["plugin-add"]?.details?.sourceRoot ??
      ownership.actions[candidate.id]?.sourceRoot;
    const inventory = sourceRoot
      ? await inspectPonytailHost({ source, sourceRoot, ...identity, runCommand })
      : { status: "unknown" };
    return {
      id: candidate.id,
      status: "manual-pending",
      reason: inventory.status === "exact"
        ? "Exact Ponytail host state is present after an interrupted mutation; manual ownership reconciliation is required."
        : inventory.status === "absent"
        ? "Interrupted Ponytail host mutation is absent; refusing to repeat it automatically."
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
  if (candidate.kind === "mcp-cli") {
    const target = packageTarget(homeDir, candidate, source);
    if (!(await exists(target))) {
      if (step.effects["npm-ci"] || step.effects["package-activate"]) {
        return {
          id: candidate.id,
          status: "manual-pending",
          reason: `Interrupted ${candidate.id} package operation has no verified final target; refusing automatic replay.`,
        };
      }
      return null;
    }
    const verified = await verifyPinnedNpmTool({ target, candidate, source });
    const ownedCommand = process.execPath;
    const ownedCommandArgs = [verified.script];
    const { command, commandArgs } = mcpLauncherInvocation({
      candidate,
      homeDir,
    });
    const inventory = await inspectMcpHost({ candidate, command, commandArgs, runCommand });
    ownership.actions[candidate.id] = {
      packageInstalled: true,
      mcpConfigured: inventory === "present",
      sourceManifestSha256: manifestDigest,
      packageSelector: candidate.packageSelector,
      packageVersion: verified.packageVersion,
      packageIntegrity: source.packageIntegrity,
      packageLockSha256: verified.packageLockSha256,
      target,
      command: ownedCommand,
      commandArgs: ownedCommandArgs,
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
    const target = managedPath(homeDir, ".agents/harness/tools/ripgrep/latest", "Latest ripgrep target");
    const executableName = assetPlatform === "win32-x64" ? "rg.exe" : "rg";
    const executable = path.join(target, executableName);
    if (!(await exists(executable))) {
      return {
        id: candidate.id,
        status: "manual-pending",
        reason: "Interrupted ripgrep staging has no verified final target; refusing automatic replay.",
      };
    }
    const info = await lstat(executable);
    const assetDetails = step.effects["asset-stage"]?.details;
    const executableSha256 = info.isFile() && !info.isSymbolicLink() && info.nlink <= 1
      ? sha256(await readFile(executable))
      : null;
    const journalExpectedSha256 = step.effects["binary-activate"]?.details?.expectedSha256;
    if (!assetDetails?.asset || !HEX_64.test(String(assetDetails.assetSha256 ?? "")) || !executableSha256 || executableSha256 !== journalExpectedSha256) {
      return { id: candidate.id, status: "manual-pending", reason: "Interrupted ripgrep installation inventory is unsafe." };
    }
    ownership.actions[candidate.id] = {
      sourceManifestSha256: manifestDigest,
      assetPlatform,
      asset: assetDetails.asset,
      assetSha256: assetDetails.assetSha256,
      executable,
      executableSha256,
      target,
    };
    return { id: candidate.id, status: "recovered", executable, platform: assetPlatform };
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
  approvalPlan,
  homeDir = os.homedir(),
  repoRoot,
  strictDataBoundary = false,
  allowNetwork = false,
  runCommand,
  sourceResolver,
  env = process.env,
  approvedPackageRoots,
  approvedCommandRoots,
  platform = process.platform,
  arch = process.arch,
  assetPlatform = normalizeAssetPlatform(platform, arch),
  fetchImpl,
  faultInjector,
  processAlive = defaultProcessAlive,
} = {}) {
  if (
    approvedPackageRoots !== undefined ||
    approvedCommandRoots !== undefined
  ) {
    throw new Error("Post-approval command or package root injection is forbidden.");
  }
  validateThirdPartySourceManifest(manifest);
  await realDirectory(homeDir, "User home");
  const manifestDigest = sourceManifestDigest(manifest);
  await verifyThirdPartyApprovalPlanForOperation({
    approvalPlan,
    homeDir,
    manifest,
    manifestSha256: manifestDigest,
    repoRoot,
    strictDataBoundary,
    env,
    platform,
    arch,
    assetPlatform,
  });
  if (!approvals || approvals.sourceManifestSha256 !== manifestDigest || !Array.isArray(approvals.approvedActionIds)) {
    throw new Error("Third-party global actions require approvals bound to the exact source manifest.");
  }
  if (
    approvals.planSha256 !== approvalPlan.planSha256 ||
    !approvals.planEvidence ||
    sha256(Buffer.from(canonicalJson(approvals.planEvidence), "utf8")) !==
      approvalPlan.planSha256
  ) {
    throw new Error("Third-party global actions require approvals bound to the exact displayed approval plan.");
  }
  if (
    approvals.approvedActionIds.some((id) => typeof id !== "string") ||
    new Set(approvals.approvedActionIds).size !== approvals.approvedActionIds.length
  ) {
    throw new Error("Third-party global actions require unique string approval ids.");
  }
  manifest = structuredClone(manifest);
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
    const missingDependencies = candidate.dependencies.filter(
      (dependency) =>
        !approved.has(dependency) &&
        !planHasExactCandidate(approvalPlan, dependency),
    );
    if (missingDependencies.length) {
      throw new Error(`${candidate.id} requires explicitly approved dependencies: ${missingDependencies.join(", ")}.`);
    }
  }
  const trustedCommandNames = new Set();
  for (const id of approvedIds) {
    const candidate = candidates.get(id);
    for (const command of requiredCommandsForAction(candidate, assetPlatform)) {
      trustedCommandNames.add(command);
    }
  }
  const baseCommandEnvironment = thirdPartySubprocessEnvironment(
    approvalPlan,
    env,
  );
  const trustedCommands = await bindPlannedTrustedCommands(
    approvalPlan.execution.commandPlan,
    { env: baseCommandEnvironment, platform },
  );
  const commandIdentities = trustedCommands.identities;
  const unavailableCommands = new Map(
    Object.entries(trustedCommands.unavailable),
  );
  const rawRunCommand = runCommand ?? (async (command, args, options = {}) => {
    if (!trustedCommands.bindings[command]) {
      throw new Error(`Command ${command} was not resolved inside an approved installation root.`);
    }
    return trustedCommands.run(command, args, options);
  });
  const effectiveRunCommand = async (command, args, options = {}) => {
    if (!trustedCommandNames.has(command)) {
      throw new Error(`Command ${command} was not part of the bound third-party action plan.`);
    }
    const requestedEnvironment = minimalCommandEnvironment(options.env ?? {});
    return rawRunCommand(command, args, {
      ...options,
      env: {
        ...baseCommandEnvironment,
        ...requestedEnvironment,
      },
      shell: false,
    });
  };
  const plannedActions = buildPlannedActions({
    approvedIds,
    candidates,
    manifest,
    homeDir,
    env: baseCommandEnvironment,
    platform,
    assetPlatform,
    commandIdentities,
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
        const unavailableForAction = requiredCommandsForAction(candidate, assetPlatform)
          .filter((command) => unavailableCommands.has(command));
        if (unavailableForAction.length > 0) {
          result = {
            status: "manual-pending",
            reason: unavailableForAction
              .map((command) => `${command}: ${unavailableCommands.get(command)}`)
              .join("; "),
          };
        } else if (step.state === "completed" && step.result) {
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
              env: baseCommandEnvironment,
              platform,
              assetPlatform,
              runCommand: effectiveRunCommand,
              ownership,
              manifestDigest,
            })
            : null;
          if (reconciled) {
            result = { ...reconciled };
            delete result.id;
          } else if (id === "ponytail.install") {
            result = await installPonytail({ candidate, source, homeDir, sourceResolver, runCommand: effectiveRunCommand, allowNetwork, ownership, manifestDigest, journalEffect });
          } else if (id === "ponytail.hooks") {
            // Codex does not expose a stable noninteractive trust command. Keep an
            // approved hook request visible, but never guess or mutate trust state.
            result = { status: "manual-pending", reason: "Review and trust Ponytail hooks in the Codex host UI." };
          } else if (id === "ponytail.default-full") {
            result = await casPonytailDefault({
              homeDir,
              env: baseCommandEnvironment,
              platform,
              ownership,
              manifestDigest,
              faultInjector,
              journalEffect,
            });
            if (result.status === "installed") {
              rollbackEntries.push({
                target: result.configPath,
                expectedSha256: ownership.actions[id].sha256,
              });
            }
          } else if (candidate.kind === "ccg-managed-mcp") {
            result = {
              status: "manual-pending",
              reason:
                "Approved MCP configuration is delegated to the reviewed CCG workflow; Harness performed no install, host mutation, credential read, or provider call.",
              handoff: structuredClone(candidate.action),
              source: ccgManagedMcpSource(candidate, source),
            };
          } else if (candidate.kind === "mcp-cli") {
            const installed = await installPinnedNpmTool({ candidate, source, homeDir, platform, runCommand: effectiveRunCommand, ownership, manifestDigest, allowNetwork, faultInjector, journalEffect });
            const launcher = mcpLauncherInvocation({ candidate, homeDir });
            if (installed.status === "manual-pending") {
              result = installed;
            } else if (!installed.mcpConfigured) {
              const configured = await configureMcp({
                candidate,
                command: launcher.command,
                commandArgs: launcher.commandArgs,
                runCommand: effectiveRunCommand,
              });
              if (configured.status === "configured") {
                ownership.actions[id].mcpConfigured = true;
                result = {
                  ...installed,
                  status: installed.status === "unchanged" ? "configured" : installed.status,
                  mcpConfigured: true,
                };
              } else {
                result = {
                  ...installed,
                  ...configured,
                  mcpConfigured: false,
                };
              }
            } else {
              const inventory = await inspectMcpHost({
                candidate,
                command: launcher.command,
                commandArgs: launcher.commandArgs,
                runCommand: effectiveRunCommand,
              });
              if (inventory !== "present") {
                throw new Error(
                  `${candidate.id} owned MCP host inventory drifted from the exact launcher (${inventory}).`,
                );
              }
              result = installed;
            }
          } else if (id === "ripgrep") {
            result = await installRipgrep({ candidate, source, homeDir, assetPlatform, allowNetwork, ownership, manifestDigest, fetchImpl, runCommand: effectiveRunCommand, faultInjector, journalEffect });
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
