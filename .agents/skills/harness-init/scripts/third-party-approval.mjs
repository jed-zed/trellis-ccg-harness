import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const OWNER = "trellis-ccg-harness";
const GROUPS = Object.freeze([
  ["global-skills", "globalSkills"],
  ["global-plugins", "globalPlugins"],
  ["project-skills", "projectSkills"],
  ["mcp-cli", "mcpCli"],
]);
const IGNORED_DIRECTORIES = new Set([".git", ".venv", "__pycache__", "node_modules"]);
const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const SOURCE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(root, target, label) {
  if (!isInside(root, target)) throw new Error(`${label} escapes its approved root: ${target}`);
}

function assertSafeIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a single safe path identifier.`);
  }
}

function safeSkillTarget(root, relative, label) {
  if (typeof relative !== "string") throw new Error(`${label} must be a string.`);
  const normalized = relative.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    !normalized.startsWith(".agents/skills/") ||
    segments.length < 3 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized child of .agents/skills/.`);
  }
  const skillsRoot = path.join(path.resolve(root), ".agents", "skills");
  const target = path.join(path.resolve(root), ...segments);
  assertInside(root, skillsRoot, `${label} root`);
  assertInside(skillsRoot, target, label);
  return target;
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

async function assertRealDirectory(target, label) {
  const details = await lstat(target);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-linked directory: ${target}`);
  }
  return realpath(target);
}

async function ensureDirectory(root, target) {
  const canonicalRoot = await assertRealDirectory(root, "User home");
  assertInside(canonicalRoot, target, "Managed directory");
  const parts = path.relative(canonicalRoot, path.resolve(target)).split(path.sep).filter(Boolean);
  let current = canonicalRoot;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Managed directory contains a link or non-directory: ${current}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  return canonicalRoot;
}

function homePath(homeDir, relative, label) {
  const target = path.join(path.resolve(homeDir), ...relative.split("/"));
  assertInside(homeDir, target, label);
  return target;
}

/** Stable, symlink-safe tree fingerprint used for sources and installed Skills. */
export async function snapshotThirdPartyTree(sourceRoot, { copyTo = null } = {}) {
  const root = await assertRealDirectory(sourceRoot, "Third-party tree");
  const files = [];
  let totalBytes = 0;
  if (copyTo) {
    assertInside(path.dirname(path.resolve(copyTo)), path.resolve(copyTo), "Staging directory");
    await mkdir(copyTo, { recursive: true, mode: 0o700 });
  }
  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const source = path.join(directory, entry.name);
      const relative = relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Third-party tree contains a symbolic link or reparse point: ${source}`);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        await assertRealDirectory(source, "Third-party subtree");
        if (copyTo) await mkdir(path.join(copyTo, ...relative.split("/")), { recursive: true, mode: 0o700 });
        await visit(source, relative);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Third-party tree contains a special file: ${source}`);
      const details = await lstat(source);
      if (!details.isFile() || details.isSymbolicLink() || details.nlink > 1) {
        throw new Error(`Third-party tree changed or contains a hard link: ${source}`);
      }
      const bytes = await readFile(source);
      const record = { path: relative, size: bytes.length, sha256: sha256(bytes) };
      files.push(record);
      totalBytes += bytes.length;
      if (copyTo) {
        const destination = path.join(copyTo, ...relative.split("/"));
        await writeFile(destination, bytes, { flag: "wx", mode: details.mode & 0o777 });
      }
    }
  }
  await visit(root, "");
  return { treeSha256: sha256(canonicalJson(files)), fileCount: files.length, totalBytes, files };
}

function immutable(value, label) {
  if (typeof value !== "string" || !HEX_40.test(value)) {
    throw new Error(`${label} must be a full immutable 40-character commit/tree id.`);
  }
}

/** Reject malformed and mutable public source records before presenting approvals. */
export function validateThirdPartySourceManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.owner !== OWNER) {
    throw new Error("Third-party source manifest has an unsupported schema or owner.");
  }
  if (manifest.approvalDefaults?.selected !== false) {
    throw new Error("Third-party source manifest must pin approvalDefaults.selected to false.");
  }
  if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.candidates) || !Array.isArray(manifest.exclusions)) {
    throw new Error("Third-party source manifest has invalid collections.");
  }
  const sourceIds = new Set();
  for (const source of manifest.sources) {
    if (!source?.id || sourceIds.has(source.id)) throw new Error("Third-party source ids must be unique.");
    assertSafeIdentifier(source.id, "Third-party source id");
    sourceIds.add(source.id);
    if (typeof source.repository !== "string" || !/^https:\/\//.test(source.repository)) throw new Error(`Source ${source.id} has an invalid repository.`);
    immutable(source.commit, `Source ${source.id} commit`);
    immutable(source.gitTree, `Source ${source.id} gitTree`);
    if (typeof source.license !== "string" || !source.license.trim()) throw new Error(`Source ${source.id} lacks a license.`);
    for (const [field, value] of Object.entries(source)) {
      if (typeof value === "string" && /(^|[\/@_-])(main|latest)(?:$|[\/@_-])/i.test(value) && !["repository"].includes(field)) {
        throw new Error(`Source ${source.id} ${field} uses a mutable selector.`);
      }
    }
  }
  const candidateIds = new Set();
  const groups = new Set(GROUPS.map(([id]) => id));
  for (const candidate of manifest.candidates) {
    if (!candidate?.id || candidateIds.has(candidate.id)) throw new Error("Third-party candidate ids must be unique.");
    assertSafeIdentifier(candidate.id, "Third-party candidate id");
    candidateIds.add(candidate.id);
    if (!groups.has(candidate.group)) throw new Error(`Candidate ${candidate.id} has an invalid approval group.`);
    if (!sourceIds.has(candidate.sourceId)) throw new Error(`Candidate ${candidate.id} references an unknown source.`);
    if (candidate.approvalDefaults?.selected !== false) {
      throw new Error(`Candidate ${candidate.id} must pin approvalDefaults.selected to false.`);
    }
    if (candidate.recommended !== undefined && typeof candidate.recommended !== "boolean") {
      throw new Error(`Candidate ${candidate.id} recommended must be a boolean when present.`);
    }
    if (candidate.sourceId === "ponytail") {
      immutable(candidate.sourceGitTree, `Ponytail candidate ${candidate.id} sourceGitTree`);
    }
    if (!Array.isArray(candidate.dependencies)) throw new Error(`Candidate ${candidate.id} has invalid dependencies.`);
    if (candidate.paths !== undefined) {
      if (!Array.isArray(candidate.paths) || !candidate.paths.length) throw new Error(`Candidate ${candidate.id} has invalid Skill paths.`);
      for (const item of candidate.paths) {
        if (!item?.name || typeof item.sourcePath !== "string" || typeof item.targetPath !== "string" || !HEX_64.test(String(item.treeSha256))) throw new Error(`Candidate ${candidate.id} has an invalid pinned Skill path.`);
        assertSafeIdentifier(item.name, `Candidate ${candidate.id} Skill name`);
        const sourceSegments = item.sourcePath.replaceAll("\\", "/").split("/");
        if (!sourceSegments.length || sourceSegments.some((segment) => !segment || segment === "." || segment === "..")) {
          throw new Error(`Candidate ${candidate.id} has an unsafe source Skill path.`);
        }
        const targetSegments = item.targetPath.replaceAll("\\", "/").split("/");
        if (!item.targetPath.replaceAll("\\", "/").startsWith(".agents/skills/") || targetSegments.length < 3 || targetSegments.some((segment) => !segment || segment === "." || segment === "..")) {
          throw new Error(`Candidate ${candidate.id} must target only .agents/skills as a normalized child.`);
        }
      }
    }
  }
  for (const candidate of manifest.candidates) {
    for (const dependency of candidate.dependencies) {
      if (!candidateIds.has(dependency)) throw new Error(`Candidate ${candidate.id} references unknown dependency ${dependency}.`);
    }
  }
  return manifest;
}

export async function loadThirdPartySourceManifest({ manifestPath }) {
  if (!manifestPath) throw new Error("manifestPath is required.");
  const details = await lstat(manifestPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("Third-party source manifest must be a regular non-linked file.");
  const manifest = validateThirdPartySourceManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  return { manifest, manifestPath: path.resolve(manifestPath), manifestSha256: sha256(canonicalJson(manifest)) };
}

async function runGit(execFileImpl, args, cwd) {
  const result = await execFileImpl("git", args, { cwd, windowsHide: true });
  return String(result?.stdout ?? "").trim();
}

async function verifyPinnedGitCheckout(directory, source, execFileImpl) {
  const head = await runGit(execFileImpl, ["rev-parse", "HEAD"], directory);
  if (head.toLowerCase() !== source.commit.toLowerCase()) {
    throw new Error(`Pinned source ${source.id} HEAD does not match its approved commit.`);
  }
  const tree = await runGit(execFileImpl, ["rev-parse", "HEAD^{tree}"], directory);
  if (tree.toLowerCase() !== source.gitTree.toLowerCase()) {
    throw new Error(`Pinned source ${source.id} tree does not match its approved gitTree.`);
  }
  const porcelain = await runGit(execFileImpl, ["status", "--porcelain"], directory);
  if (porcelain) throw new Error(`Pinned source ${source.id} checkout is not clean.`);
}

/**
 * Acquire exactly one immutable Git object into the private Harness cache.
 * The ref passed to Git is the 40-character approved commit, never a branch
 * or mutable npm/Git selector. Existing cache entries are verified again.
 */
export async function acquirePinnedGitSource({ homeDir, source, execFileImpl = execFile }) {
  await assertRealDirectory(homeDir, "User home");
  if (!source || !SOURCE_ID.test(String(source.id ?? ""))) throw new Error("Pinned source has an unsafe id.");
  if (typeof source.repository !== "string" || !/^https:\/\//.test(source.repository)) throw new Error("Pinned source has an invalid repository.");
  immutable(source.commit, `Pinned source ${source.id} commit`);
  immutable(source.gitTree, `Pinned source ${source.id} gitTree`);
  const root = homePath(homeDir, ".agents/harness/sources", "Pinned source cache");
  await ensureDirectory(homeDir, root);
  const sourceRoot = path.join(root, source.id);
  assertInside(root, sourceRoot, "Pinned source cache");
  await ensureDirectory(homeDir, sourceRoot);
  const target = path.join(sourceRoot, source.commit);
  assertInside(sourceRoot, target, "Pinned source checkout");
  if (await exists(target)) {
    await assertRealDirectory(target, "Pinned source checkout");
    await verifyPinnedGitCheckout(target, source, execFileImpl);
    return target;
  }
  const stage = path.join(sourceRoot, `.stage-${source.commit}-${randomUUID()}`);
  assertInside(sourceRoot, stage, "Pinned source staging directory");
  try {
    await mkdir(stage, { mode: 0o700 });
    await runGit(execFileImpl, ["init"], stage);
    await runGit(execFileImpl, ["remote", "add", "origin", source.repository], stage);
    await runGit(execFileImpl, ["fetch", "--depth=1", "origin", source.commit], stage);
    await runGit(execFileImpl, ["checkout", "--detach", source.commit], stage);
    await verifyPinnedGitCheckout(stage, source, execFileImpl);
    await rename(stage, target);
    return target;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function installedPathStatus(homeDir, candidate) {
  if (!candidate.paths) return { status: "not-applicable" };
  const paths = [];
  for (const item of candidate.paths) {
    const target = safeSkillTarget(homeDir, item.targetPath, "Third-party global Skill target");
    if (!(await exists(target))) { paths.push({ name: item.name, status: "absent" }); continue; }
    const snapshot = await snapshotThirdPartyTree(target);
    paths.push({ name: item.name, status: snapshot.treeSha256 === item.treeSha256 ? "exact" : "drifted", treeSha256: snapshot.treeSha256 });
  }
  return { status: paths.every((entry) => entry.status === "exact") ? "exact" : paths.some((entry) => entry.status === "drifted") ? "drifted" : "absent", paths };
}

/** A read-only plan: third parties are never pre-selected. */
export async function buildThirdPartyApprovalPlan({ manifestPath, manifest: suppliedManifest, homeDir, repoRoot, strictDataBoundary = false }) {
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestPath: manifestPath ?? null, manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  if (!homeDir) throw new Error("homeDir is required.");
  await assertRealDirectory(homeDir, "User home");
  if (repoRoot) await assertRealDirectory(repoRoot, "Project root");
  const sources = new Map(loaded.manifest.sources.map((source) => [source.id, source]));
  const groupRecords = [];
  for (const [groupId] of GROUPS) {
    const candidates = [];
    for (const candidate of loaded.manifest.candidates.filter((entry) => entry.group === groupId)) {
      const source = sources.get(candidate.sourceId);
      // Global candidates are observed under the user profile; project Skills
      // must be observed at their actual project target and never under home.
      const installationRoot = groupId === "project-skills" && repoRoot ? repoRoot : homeDir;
      const unavailableReason = strictDataBoundary && candidate.strictDataBoundaryAllowed === false
        ? "Blocked by strict data boundary."
        : null;
      candidates.push({
        ...candidate,
        repository: source.repository,
        commit: source.commit,
        release: source.release ?? null,
        license: source.license,
        dataEgress: candidate.effects?.dataEgress ?? "None.",
        scripts: Boolean(candidate.effects?.scripts),
        hooks: Boolean(candidate.effects?.hooks),
        executables: Boolean(candidate.effects?.executables),
        selected: false,
        recommended: unavailableReason ? false : candidate.recommended === true,
        installed: await installedPathStatus(installationRoot, candidate),
        unavailableReason,
        blocked: Boolean(unavailableReason),
      });
    }
    groupRecords.push({ id: groupId, candidates });
  }
  return {
    schemaVersion: 1,
    owner: OWNER,
    manifestPath: loaded.manifestPath,
    sourceManifestSha256: loaded.manifestSha256,
    strictDataBoundary: Boolean(strictDataBoundary),
    groups: groupRecords,
    detected: { codegraph: { indexPresent: Boolean(repoRoot && await exists(path.join(path.resolve(repoRoot), ".codegraph"))) } },
  };
}

/** Resolve only explicit choices; dependency choices are never inferred. */
export function resolveThirdPartyApprovals({ plan, selections }) {
  if (!plan || !Array.isArray(plan.groups) || !selections || typeof selections !== "object") throw new Error("An approval plan and explicit selections are required.");
  const byId = new Map(plan.groups.flatMap((group) => group.candidates).map((entry) => [entry.id, entry]));
  const selected = new Set();
  for (const [groupId, key] of GROUPS) {
    if (!Array.isArray(selections[key])) throw new Error(`${key} must be an explicit array, including when empty.`);
    const valid = new Set((plan.groups.find((group) => group.id === groupId)?.candidates ?? []).map((entry) => entry.id));
    for (const id of selections[key]) {
      if (!valid.has(id)) throw new Error(`${id} is not a selectable ${groupId} candidate.`);
      selected.add(id);
    }
  }
  const approvedActionIds = [];
  const skipped = [];
  for (const group of plan.groups) {
    for (const candidate of group.candidates) {
      if (!selected.has(candidate.id)) continue;
      if (candidate.unavailableReason) { skipped.push({ id: candidate.id, reason: candidate.unavailableReason }); continue; }
      const missingDependencies = candidate.dependencies.filter((id) => !selected.has(id) && byId.get(id)?.installed?.status !== "exact").sort();
      if (missingDependencies.length) { skipped.push({ id: candidate.id, reason: "Required dependency was not explicitly approved.", missingDependencies }); continue; }
      approvedActionIds.push(candidate.id);
    }
  }
  return {
    schemaVersion: 1,
    owner: OWNER,
    sourceManifestSha256: plan.sourceManifestSha256,
    approvedActionIds,
    approvedByGroup: Object.fromEntries(GROUPS.map(([groupId, key]) => [key, approvedActionIds.filter((id) => byId.get(id)?.group === groupId)])),
    skipped,
    selections: Object.fromEntries(GROUPS.map(([, key]) => [key, [...selections[key]]])),
  };
}

function transactionPaths(homeDir, id) {
  const root = homePath(homeDir, ".agents/harness/third-party-transactions", "Third-party transaction root");
  return { root, directory: path.join(root, id), journal: path.join(root, id, "journal.json"), stage: path.join(root, id, "stage"), backup: path.join(root, id, "backup"), lock: homePath(homeDir, ".agents/harness/third-party.lock", "Third-party lock"), key: homePath(homeDir, ".agents/harness/third-party-transaction.key", "Third-party transaction key"), ownership: homePath(homeDir, ".agents/harness/third-party-installations.json", "Third-party ownership") };
}

async function keyFor(homeDir) {
  const { key } = transactionPaths(homeDir, "placeholder");
  await ensureDirectory(homeDir, path.dirname(key));
  try {
    const info = await lstat(key);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Third-party transaction key is unsafe.");
    return readFile(key);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const bytes = randomBytes(32);
    await writeFile(key, bytes, { flag: "wx", mode: 0o600 });
    await chmod(key, 0o600);
    return bytes;
  }
}

function journalDigest(journal, key) {
  const copy = { ...journal };
  delete copy.provenance;
  return createHmac("sha256", key).update(canonicalJson(copy)).digest("hex");
}

async function writeJournal(journalPath, journal, key) {
  journal.provenance = { algorithm: "hmac-sha256", digest: journalDigest(journal, key) };
  await writeFile(journalPath, canonicalJson(journal), { mode: 0o600 });
}

async function readJournal(journalPath, key) {
  const info = await lstat(journalPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Third-party transaction journal is unsafe.");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const expected = journalDigest(journal, key);
  const actual = String(journal.provenance?.digest ?? "");
  if (!HEX_64.test(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) throw new Error("Third-party transaction journal is unauthenticated; manual review is required.");
  return journal;
}

async function acquireLock(homeDir, transactionId) {
  const { lock } = transactionPaths(homeDir, transactionId);
  await ensureDirectory(homeDir, path.dirname(lock));
  const token = randomUUID();
  try { await writeFile(lock, canonicalJson({ owner: OWNER, transactionId, pid: process.pid, token }), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error?.code === "EEXIST") throw new Error("A third-party transaction is already in progress; recover it first."); throw error; }
  return { path: lock, transactionId, token };
}

async function readOwnedLock(lockPath, label) {
  const details = await lstat(lockPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} is unsafe.`);
  const value = JSON.parse(await readFile(lockPath, "utf8"));
  if (value?.owner !== OWNER || typeof value.transactionId !== "string" || !SAFE_IDENTIFIER.test(value.transactionId) || typeof value.token !== "string" || !SAFE_IDENTIFIER.test(value.token)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

async function releaseLock(lock, label) {
  const current = await readOwnedLock(lock.path, label);
  if (current.transactionId !== lock.transactionId || current.token !== lock.token) {
    throw new Error(`${label} ownership changed; refusing cleanup.`);
  }
  await rm(lock.path, { force: true });
}

async function removeIfSafe(target, expectedTree) {
  if (!(await exists(target))) return;
  const snapshot = await snapshotThirdPartyTree(target);
  if (snapshot.treeSha256 !== expectedTree) throw new Error(`Third-party target drifted; refusing rollback: ${target}`);
  await rm(target, { recursive: true, force: true });
}

/** Recover interrupted atomic global-skill bundle installations. */
export async function recoverThirdPartyTransactions({ homeDir }) {
  await assertRealDirectory(homeDir, "User home");
  const probe = transactionPaths(homeDir, "placeholder");
  if (!(await exists(probe.root))) return { status: "unchanged" };
  const heldLock = await exists(probe.lock)
    ? await readOwnedLock(probe.lock, "Third-party transaction lock")
    : null;
  if (heldLock && heldLock.pid !== process.pid) {
    try {
      process.kill(heldLock.pid, 0);
      throw new Error("A third-party transaction lock belongs to a live process; refusing concurrent recovery.");
    } catch (error) {
      if (error?.message?.includes("live process")) throw error;
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const key = await keyFor(homeDir);
  const entries = await readdir(probe.root, { withFileTypes: true });
  let recovered = false;
  const recoveredIds = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Third-party transaction root contains unsafe residue.");
    const locations = transactionPaths(homeDir, entry.name);
    const journal = await readJournal(locations.journal, key);
    if (journal.owner !== OWNER || !Array.isArray(journal.targets)) throw new Error("Third-party transaction journal is invalid.");
    if (journal.state === "committed") {
      await rm(locations.directory, { recursive: true, force: true });
      recovered = true;
      recoveredIds.add(entry.name);
      continue;
    }
    for (const target of [...journal.targets].reverse()) {
      assertInside(homeDir, target.path, "Third-party transaction target");
      if (target.installed) await removeIfSafe(target.path, target.next.treeSha256);
      if (target.backup && await exists(target.backup)) {
        if (await exists(target.path)) throw new Error(`Cannot restore third-party backup over existing target: ${target.path}`);
        await mkdir(path.dirname(target.path), { recursive: true, mode: 0o700 });
        await rename(target.backup, target.path);
      }
    }
    await rm(locations.directory, { recursive: true, force: true });
    recovered = true;
    recoveredIds.add(entry.name);
  }
  if (heldLock && recoveredIds.has(heldLock.transactionId)) {
    const current = await readOwnedLock(probe.lock, "Third-party transaction lock");
    if (current.token !== heldLock.token) throw new Error("Third-party transaction lock ownership changed during recovery; refusing cleanup.");
    await rm(probe.lock, { force: true });
  }
  return { status: recovered ? "rolled-back" : "unchanged" };
}

async function readOwnership(target) {
  if (!(await exists(target))) return { schemaVersion: 1, owner: OWNER, installations: {} };
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Third-party ownership record is unsafe.");
  const parsed = JSON.parse(await readFile(target, "utf8"));
  if (parsed?.schemaVersion !== 1 || parsed.owner !== OWNER || typeof parsed.installations !== "object") throw new Error("Third-party ownership record is invalid.");
  return parsed;
}

async function assertActivationCas(targetInfo, root, label) {
  for (const item of targetInfo) {
    assertInside(root, item.target, `${label} target`);
    const current = await exists(item.target)
      ? await snapshotThirdPartyTree(item.target)
      : null;
    if (
      Boolean(current) !== Boolean(item.existing) ||
      current?.treeSha256 !== item.existing?.treeSha256
    ) {
      throw new Error(`${label} target changed after preflight; refusing overwrite: ${item.target}`);
    }
  }
}

function assertSecretFree(value, label = "approval record") {
  if (Array.isArray(value)) {
    for (const item of value) assertSecretFree(item, label);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/(secret|token|password|credential|authorization|bearer|api[_-]?key)/i.test(key)) {
      throw new Error(`${label} contains a prohibited secret-like field: ${key}`);
    }
    assertSecretFree(nested, label);
  }
}

async function readCanonicalPinnedJson(target, label, validator) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-linked file.`);
  const bytes = await readFile(target, "utf8");
  let parsed;
  try {
    parsed = validator(JSON.parse(bytes));
  } catch (error) {
    throw new Error(`${label} is user-modified or invalid; refusing overwrite.`, { cause: error });
  }
  if (bytes !== canonicalJson(parsed)) throw new Error(`${label} is user-modified or not canonical; refusing overwrite.`);
  return parsed;
}

async function createAtomicFile(target, contents) {
  const parent = path.dirname(target);
  const stage = path.join(parent, `.${path.basename(target)}.${randomUUID()}.stage`);
  assertInside(parent, stage, "Atomic approval staging file");
  await writeFile(stage, contents, { flag: "wx", mode: 0o600 });
  try {
    await rename(stage, target);
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}

function normalizeApprovalRecord(approvals, manifest, sourceManifestSha256) {
  if (!approvals || approvals.sourceManifestSha256 !== sourceManifestSha256) {
    throw new Error("Third-party approvals do not match the pinned source manifest.");
  }
  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  const selections = {};
  for (const [groupId, key] of GROUPS) {
    if (!Array.isArray(approvals.selections?.[key])) {
      throw new Error(`${key} must be explicitly recorded, including an empty rejection.`);
    }
    const valid = new Set(manifest.candidates.filter((candidate) => candidate.group === groupId).map((candidate) => candidate.id));
    selections[key] = [...new Set(approvals.selections[key])];
    for (const id of selections[key]) {
      if (typeof id !== "string" || !valid.has(id)) throw new Error(`${key} contains an invalid third-party candidate.`);
    }
  }
  const approvedActionIds = [...new Set(approvals.approvedActionIds ?? [])];
  for (const id of approvedActionIds) {
    if (typeof id !== "string" || !candidates.has(id)) throw new Error("approvedActionIds contains an invalid third-party candidate.");
    const groupKey = GROUPS.find(([groupId]) => candidates.get(id).group === groupId)?.[1];
    if (!selections[groupKey].includes(id)) throw new Error(`Approved action ${id} was not explicitly selected.`);
  }
  const skipped = (approvals.skipped ?? []).map((entry) => {
    if (!entry || typeof entry.id !== "string" || !candidates.has(entry.id) || typeof entry.reason !== "string") {
      throw new Error("skipped contains an invalid third-party decision.");
    }
    const result = { id: entry.id, reason: entry.reason };
    if (entry.missingDependencies !== undefined) {
      if (!Array.isArray(entry.missingDependencies) || !entry.missingDependencies.every((id) => candidates.has(id))) {
        throw new Error("skipped contains invalid dependency evidence.");
      }
      result.missingDependencies = [...entry.missingDependencies];
    }
    return result;
  });
  const record = {
    schemaVersion: 1,
    owner: OWNER,
    sourceManifestSha256,
    selections,
    approvedActionIds,
    skipped,
  };
  assertSecretFree(record);
  return record;
}

async function inspectApprovalReceipts(directory, currentReceiptPath, currentBytes) {
  if (!(await exists(directory))) return { unchanged: false };
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Third-party approval receipt directory is unsafe.");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  let currentFound = false;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/i.test(entry.name)) {
      throw new Error("Third-party approval receipt directory contains unsafe or unknown content.");
    }
    const target = path.join(directory, entry.name);
    const existing = await readCanonicalPinnedJson(target, "Pinned third-party approval receipt", (value) => value);
    assertSecretFree(existing, "Pinned third-party approval receipt");
    const expectedName = `${sha256(canonicalJson(existing))}.json`;
    if (entry.name.toLowerCase() !== expectedName) {
      throw new Error("Pinned third-party approval receipt filename does not match its canonical content digest; refusing unsafe audit history.");
    }
    if (path.resolve(target) === path.resolve(currentReceiptPath)) {
      if (canonicalJson(existing) !== currentBytes) {
        throw new Error("Pinned third-party approval receipt is user-modified or differs from its digest; refusing overwrite.");
      }
      currentFound = true;
    }
  }
  return { unchanged: currentFound };
}

async function acquireApprovalReceiptLock(homeDir) {
  const lock = homePath(homeDir, ".agents/harness/third-party-approvals.lock", "Third-party approval receipt lock");
  await ensureDirectory(homeDir, path.dirname(lock));
  const token = randomUUID();
  try {
    await writeFile(lock, canonicalJson({ owner: OWNER, transactionId: "approval-receipts", pid: process.pid, token }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("A third-party approval receipt is being recorded; retry after it completes.");
    throw error;
  }
  return { path: lock, transactionId: "approval-receipts", token };
}

/**
 * Read-only conflict check for a global third-party decision. Call this before
 * any source acquisition, host CLI command, or managed Skill mutation.
 */
export async function preflightThirdPartyGlobalApproval({ homeDir, manifest: suppliedManifest, manifestPath, approvals }) {
  await assertRealDirectory(homeDir, "User home");
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  const record = normalizeApprovalRecord(approvals, loaded.manifest, loaded.manifestSha256);
  const directory = homePath(homeDir, ".agents/harness", "Third-party approval directory");
  const sourceTarget = path.join(directory, "third-party-sources.json");
  const legacyApprovalTarget = path.join(directory, "third-party-approvals.json");
  const approvalDirectory = path.join(directory, "third-party-approvals");
  const sourceBytes = canonicalJson(loaded.manifest);
  const approvalBytes = canonicalJson(record);
  const approvalTarget = path.join(approvalDirectory, `${sha256(approvalBytes)}.json`);
  let sourceUnchanged = false;
  if (await exists(sourceTarget)) {
    const existing = await readCanonicalPinnedJson(sourceTarget, "Pinned third-party source manifest", validateThirdPartySourceManifest);
    if (sha256(canonicalJson(existing)) !== loaded.manifestSha256) {
      throw new Error("Pinned third-party source manifest has a different source digest; refusing overwrite.");
    }
    sourceUnchanged = true;
  }
  if (await exists(legacyApprovalTarget)) {
    const legacy = await readCanonicalPinnedJson(legacyApprovalTarget, "Legacy third-party approval record", (value) => value);
    assertSecretFree(legacy, "Legacy third-party approval record");
  }
  const { unchanged: approvalUnchanged } = await inspectApprovalReceipts(approvalDirectory, approvalTarget, approvalBytes);
  return {
    loaded,
    record,
    sourceTarget,
    approvalTarget,
    approvalDirectory,
    sourceBytes,
    approvalBytes,
    sourceUnchanged,
    approvalUnchanged,
  };
}

/**
 * Persist an explicit global third-party decision, including a complete reject
 * decision. This records only candidate ids and public source fingerprints;
 * credentials and provider configuration are intentionally out of scope.
 */
export async function recordThirdPartyGlobalApproval(input) {
  await preflightThirdPartyGlobalApproval(input);
  const lock = await acquireApprovalReceiptLock(input.homeDir);
  try {
    const preflight = await preflightThirdPartyGlobalApproval(input);
    const {
      loaded,
      sourceTarget,
      approvalTarget,
      approvalDirectory,
      sourceBytes,
      approvalBytes,
      sourceUnchanged,
      approvalUnchanged,
    } = preflight;
    await ensureDirectory(input.homeDir, path.dirname(sourceTarget));
    await ensureDirectory(input.homeDir, approvalDirectory);
    if (!sourceUnchanged) await createAtomicFile(sourceTarget, sourceBytes);
    if (!approvalUnchanged) await createAtomicFile(approvalTarget, approvalBytes);
    return {
      status: sourceUnchanged && approvalUnchanged ? "unchanged" : "recorded",
      sourceManifestPath: sourceTarget,
      approvalPath: approvalTarget,
      sourceManifestSha256: loaded.manifestSha256,
    };
  } finally {
    await releaseLock(lock, "Third-party approval receipt lock");
  }
}

/** Install all explicitly approved global Skill bundles in one verified transaction. */
export async function applyThirdPartyGlobalSkills({ approved, approvals, homeDir, manifest: suppliedManifest, manifestPath, sourceResolver, faultInjector }) {
  if (!approved) throw new Error("Third-party installation requires explicit approval.");
  await assertRealDirectory(homeDir, "User home");
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  const normalizedApprovals = normalizeApprovalRecord(approvals, loaded.manifest, loaded.manifestSha256);
  const approvedIds = new Set(normalizedApprovals.approvedActionIds);
  const candidates = loaded.manifest.candidates.filter(
    (candidate) => candidate.group === "global-skills" && approvedIds.has(candidate.id),
  );
  if (!candidates.length) return { status: "skipped", installedSkills: [], approvedSkillIds: [] };
  for (const candidate of candidates) {
    const missing = candidate.dependencies.filter((dependency) => !approvedIds.has(dependency));
    if (missing.length) throw new Error(`Global Skill ${candidate.id} has dependencies absent from explicit approvals: ${missing.sort().join(", ")}.`);
  }
  await recoverThirdPartyTransactions({ homeDir });
  const sources = new Map(loaded.manifest.sources.map((source) => [source.id, source]));
  const sourceRoots = new Map();
  try {
    for (const sourceId of new Set(candidates.map((candidate) => candidate.sourceId))) {
      const source = sources.get(sourceId);
      const sourceRoot = sourceResolver
        ? await sourceResolver({ source, candidates: candidates.filter((candidate) => candidate.sourceId === sourceId), homeDir })
        : null;
      if (!sourceRoot) throw new Error(`No pinned source resolver is available for ${sourceId}.`);
      await assertRealDirectory(sourceRoot, `Pinned source ${sourceId}`);
      sourceRoots.set(sourceId, sourceRoot);
    }
  } catch (error) {
    return { status: "source-unavailable", error: error.message, installedSkills: [], approvedSkillIds: candidates.map((candidate) => candidate.id) };
  }
  const desired = [];
  try {
    for (const candidate of candidates) {
      const sourceRoot = sourceRoots.get(candidate.sourceId);
      for (const item of candidate.paths ?? []) {
        const sourcePath = path.join(path.resolve(sourceRoot), ...item.sourcePath.split("/"));
        assertInside(sourceRoot, sourcePath, "Third-party source Skill");
        const snapshot = await snapshotThirdPartyTree(sourcePath);
        if (snapshot.treeSha256 !== item.treeSha256 || snapshot.fileCount !== item.fileCount || snapshot.totalBytes !== item.totalBytes) {
          throw new Error(`Pinned source digest mismatch for ${candidate.id}/${item.name}.`);
        }
        desired.push({ candidate, source: sources.get(candidate.sourceId), ...item, sourcePath });
      }
    }
  } catch (error) {
    return { status: "source-unavailable", error: error.message, installedSkills: [], approvedSkillIds: candidates.map((candidate) => candidate.id) };
  }
  const duplicateTargets = desired.map((item) => item.targetPath).filter((target, index, values) => values.indexOf(target) !== index);
  if (duplicateTargets.length) throw new Error(`Approved global Skills share a target path: ${duplicateTargets[0]}.`);
  const locations = transactionPaths(homeDir, randomUUID());
  const initialOwnership = await readOwnership(locations.ownership);
  const initialOwnershipCanonical = canonicalJson(initialOwnership);
  const targetInfo = [];
  for (const item of desired) {
    const target = homePath(homeDir, item.targetPath, "Third-party Skill target");
    const existing = await exists(target) ? await snapshotThirdPartyTree(target) : null;
    const ownershipEntry = initialOwnership.installations[item.candidate.id];
    const acceptedLegacy = item.candidate.id === "matt-grilling" && item.name === "grill-me" && item.candidate.migration?.acceptedLegacyTreeSha256?.includes(existing?.treeSha256);
    const exact = existing?.treeSha256 === item.treeSha256;
    const owned = ownershipEntry?.paths?.[item.name]?.treeSha256 === existing?.treeSha256;
    if (existing && !acceptedLegacy && !exact && !owned) {
      throw new Error(`Existing ${item.name} is user drift or an unrecognized legacy Skill; refusing overwrite.`);
    }
    targetInfo.push({ ...item, target, existing, owned });
  }
  const unchanged = targetInfo.every((item) =>
    item.existing?.treeSha256 === item.treeSha256 &&
    initialOwnership.installations[item.candidate.id]?.sourceManifestSha256 === loaded.manifestSha256,
  );
  if (unchanged) return { status: "unchanged", installedSkills: desired.map((item) => item.name), approvedSkillIds: candidates.map((candidate) => candidate.id) };
  await faultInjector?.("before-lock");
  const lock = await acquireLock(homeDir, path.basename(locations.directory));
  let ownership;
  try {
    ownership = await readOwnership(locations.ownership);
    if (canonicalJson(ownership) !== initialOwnershipCanonical) {
      throw new Error("Third-party ownership changed after preflight; refusing overwrite.");
    }
    await assertActivationCas(targetInfo, homeDir, "Third-party global Skill");
  } catch (error) {
    await releaseLock(lock, "Third-party transaction lock");
    throw error;
  }
  const key = await keyFor(homeDir);
  await ensureDirectory(homeDir, locations.stage);
  await mkdir(locations.backup, { recursive: true, mode: 0o700 });
  const journal = { schemaVersion: 1, owner: OWNER, id: path.basename(locations.directory), state: "prepared", targets: [] };
  try {
    for (const item of targetInfo) {
      const staged = path.join(locations.stage, item.candidate.id, item.name);
      await mkdir(path.dirname(staged), { recursive: true, mode: 0o700 });
      const copied = await snapshotThirdPartyTree(item.sourcePath, { copyTo: staged });
      if (copied.treeSha256 !== item.treeSha256) throw new Error(`Staged source drifted for ${item.name}.`);
      const backup = item.existing ? path.join(locations.backup, item.candidate.id, item.name) : null;
      if (backup) await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
      journal.targets.push({ path: item.target, next: { treeSha256: item.treeSha256 }, backup, installed: false });
    }
    await writeJournal(locations.journal, journal, key);
    for (let index = 0; index < journal.targets.length; index += 1) {
      const record = journal.targets[index];
      const item = targetInfo[index];
      await faultInjector?.(`before-activate:${item.candidate.id}:${item.name}`);
      await assertActivationCas([item], homeDir, "Third-party global Skill");
      await ensureDirectory(homeDir, path.dirname(record.path));
      if (record.backup) await rename(record.path, record.backup);
      await rename(path.join(locations.stage, item.candidate.id, item.name), record.path);
      record.installed = true;
      await writeJournal(locations.journal, journal, key);
      await faultInjector?.(`installed:${item.name}`);
    }
    for (const candidate of candidates) {
      const source = sources.get(candidate.sourceId);
      ownership.installations[candidate.id] = {
        sourceManifestSha256: loaded.manifestSha256,
        sourceId: source.id,
        commit: source.commit,
        paths: Object.fromEntries(targetInfo.filter((item) => item.candidate.id === candidate.id).map((item) => [item.name, { treeSha256: item.treeSha256 }])),
      };
    }
    await faultInjector?.("before-ownership");
    if (canonicalJson(await readOwnership(locations.ownership)) !== initialOwnershipCanonical) {
      throw new Error("Third-party ownership changed before commit; refusing overwrite.");
    }
    await writeFile(locations.ownership, canonicalJson(ownership), { mode: 0o600 });
    journal.state = "committed";
    await writeJournal(locations.journal, journal, key);
    await rm(locations.directory, { recursive: true, force: true });
    await releaseLock(lock, "Third-party transaction lock");
    return { status: "installed", installedSkills: desired.map((item) => item.name), approvedSkillIds: candidates.map((candidate) => candidate.id) };
  } catch (error) {
    if (error?.leaveTransactionForRecovery) throw error;
    try { await recoverThirdPartyTransactions({ homeDir }); } catch (recoveryError) { throw new Error(`Third-party installation failed and recovery also failed: ${recoveryError.message}`, { cause: error }); }
    throw error;
  }
}

function projectTransactionPaths(repoRoot, id) {
  const harness = path.join(path.resolve(repoRoot), ".harness");
  assertInside(repoRoot, harness, "Project Harness directory");
  const root = path.join(harness, "third-party-transactions");
  assertInside(harness, root, "Project third-party transaction root");
  const directory = path.join(root, id);
  assertInside(root, directory, "Project third-party transaction directory");
  return {
    harness,
    root,
    directory,
    journal: path.join(directory, "journal.json"),
    stage: path.join(directory, "stage"),
    backup: path.join(directory, "backup"),
    key: path.join(harness, "third-party-transaction.key"),
    lock: path.join(harness, "third-party.lock"),
    ownership: path.join(harness, "third-party-installations.json"),
  };
}

async function projectKeyFor(repoRoot) {
  const locations = projectTransactionPaths(repoRoot, "placeholder");
  await ensureDirectory(repoRoot, locations.harness);
  try {
    const info = await lstat(locations.key);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Project third-party transaction key is unsafe.");
    return readFile(locations.key);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const bytes = randomBytes(32);
    await writeFile(locations.key, bytes, { flag: "wx", mode: 0o600 });
    await chmod(locations.key, 0o600);
    return bytes;
  }
}

async function acquireProjectLock(repoRoot, transactionId) {
  const locations = projectTransactionPaths(repoRoot, transactionId);
  await ensureDirectory(repoRoot, locations.harness);
  const token = randomUUID();
  try {
    await writeFile(locations.lock, canonicalJson({ owner: OWNER, transactionId, pid: process.pid, token }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("A project third-party transaction is already in progress; recover it first.");
    throw error;
  }
  return { path: locations.lock, transactionId, token };
}

/** Recover an interrupted project-local Skill transaction without touching `.claude`. */
export async function recoverThirdPartyProjectTransactions({ repoRoot }) {
  await assertRealDirectory(repoRoot, "Project root");
  const probe = projectTransactionPaths(repoRoot, "placeholder");
  if (!(await exists(probe.root))) return { status: "unchanged" };
  const heldLock = await exists(probe.lock)
    ? await readOwnedLock(probe.lock, "Project third-party transaction lock")
    : null;
  if (heldLock && heldLock.pid !== process.pid) {
    try {
      process.kill(heldLock.pid, 0);
      throw new Error("A project third-party transaction lock belongs to a live process; refusing concurrent recovery.");
    } catch (error) {
      if (error?.message?.includes("live process")) throw error;
      if (error?.code !== "ESRCH") throw error;
    }
  }
  const key = await projectKeyFor(repoRoot);
  const entries = await readdir(probe.root, { withFileTypes: true });
  let recovered = false;
  const recoveredIds = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Project third-party transaction root contains unsafe residue.");
    const locations = projectTransactionPaths(repoRoot, entry.name);
    const journal = await readJournal(locations.journal, key);
    if (journal.owner !== OWNER || !Array.isArray(journal.targets)) throw new Error("Project third-party transaction journal is invalid.");
    if (journal.state === "committed") {
      await rm(locations.directory, { recursive: true, force: true });
      recovered = true;
      recoveredIds.add(entry.name);
      continue;
    }
    for (const target of [...journal.targets].reverse()) {
      assertInside(repoRoot, target.path, "Project third-party transaction target");
      if (target.installed) await removeIfSafe(target.path, target.next.treeSha256);
      if (target.backup && await exists(target.backup)) {
        if (await exists(target.path)) throw new Error(`Cannot restore project third-party backup over existing target: ${target.path}`);
        await mkdir(path.dirname(target.path), { recursive: true, mode: 0o700 });
        await rename(target.backup, target.path);
      }
    }
    await rm(locations.directory, { recursive: true, force: true });
    recovered = true;
    recoveredIds.add(entry.name);
  }
  if (heldLock && recoveredIds.has(heldLock.transactionId)) {
    const current = await readOwnedLock(probe.lock, "Project third-party transaction lock");
    if (current.token !== heldLock.token) throw new Error("Project third-party transaction lock ownership changed during recovery; refusing cleanup.");
    await rm(probe.lock, { force: true });
  }
  return { status: recovered ? "rolled-back" : "unchanged" };
}

function projectSkillTarget(repoRoot, item) {
  return safeSkillTarget(repoRoot, item.targetPath, `Project third-party Skill ${item.name} target`);
}

async function readProjectOwnership(repoRoot) {
  const { ownership } = projectTransactionPaths(repoRoot, "placeholder");
  return readOwnership(ownership);
}

/**
 * Copy explicitly-approved project Skills from their pinned source checkouts.
 * Every replacement is journaled; ownership is written only after all paths
 * are in place, and `.claude` is deliberately never a target.
 */
export async function applyThirdPartyProjectSkills({
  approved,
  approvals,
  homeDir,
  repoRoot,
  manifest: suppliedManifest,
  manifestPath,
  sourceResolver,
  faultInjector,
}) {
  if (!approved) throw new Error("Project third-party installation requires explicit approval.");
  await assertRealDirectory(repoRoot, "Project root");
  await assertRealDirectory(homeDir, "User home");
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  const normalizedApprovals = normalizeApprovalRecord(approvals, loaded.manifest, loaded.manifestSha256);
  const approvedIds = new Set(normalizedApprovals.approvedActionIds);
  const candidates = loaded.manifest.candidates.filter((entry) => entry.group === "project-skills" && approvedIds.has(entry.id));
  if (!candidates.length) return { status: "skipped", installedSkills: [] };
  for (const candidate of candidates) {
    const missing = candidate.dependencies.filter((dependency) => !approvedIds.has(dependency));
    if (missing.length) throw new Error(`Project Skill ${candidate.id} has dependencies absent from explicit approvals: ${missing.sort().join(", ")}.`);
  }
  await recoverThirdPartyProjectTransactions({ repoRoot });
  const sources = new Map(loaded.manifest.sources.map((source) => [source.id, source]));
  const sourceRoots = new Map();
  try {
    for (const sourceId of new Set(candidates.map((candidate) => candidate.sourceId))) {
      const source = sources.get(sourceId);
      const sourceRoot = sourceResolver
        ? await sourceResolver({ source, candidates: candidates.filter((candidate) => candidate.sourceId === sourceId), homeDir, repoRoot })
        : await acquirePinnedGitSource({ homeDir, source });
      if (!sourceRoot) throw new Error(`No source checkout was returned for ${sourceId}.`);
      await assertRealDirectory(sourceRoot, `Pinned source ${sourceId}`);
      sourceRoots.set(sourceId, sourceRoot);
    }
  } catch (error) {
    return { status: "source-unavailable", error: error.message, installedSkills: [] };
  }
  const desired = [];
  for (const candidate of candidates) {
    const sourceRoot = sourceRoots.get(candidate.sourceId);
    for (const item of candidate.paths ?? []) {
      const sourcePath = path.join(path.resolve(sourceRoot), ...item.sourcePath.split("/"));
      assertInside(sourceRoot, sourcePath, "Pinned project Skill source");
      const snapshot = await snapshotThirdPartyTree(sourcePath);
      if (snapshot.treeSha256 !== item.treeSha256 || snapshot.fileCount !== item.fileCount || snapshot.totalBytes !== item.totalBytes) {
        throw new Error(`Pinned source digest mismatch for project Skill ${item.name}.`);
      }
      desired.push({ candidate, ...item, sourcePath, target: projectSkillTarget(repoRoot, item) });
    }
  }
  const initialOwnership = await readProjectOwnership(repoRoot);
  const initialOwnershipCanonical = canonicalJson(initialOwnership);
  const targetInfo = [];
  for (const item of desired) {
    const existing = await exists(item.target) ? await snapshotThirdPartyTree(item.target) : null;
    const owned = initialOwnership.installations[item.candidate.id]?.paths?.[item.name]?.treeSha256 === existing?.treeSha256;
    if (existing && !owned) {
      throw new Error(`Existing project Skill ${item.name} is a user collision or drift; refusing overwrite.`);
    }
    targetInfo.push({ ...item, existing, owned });
  }
  const exact = targetInfo.every((item) => item.existing?.treeSha256 === item.treeSha256 && item.owned);
  if (exact) return { status: "unchanged", installedSkills: targetInfo.map((item) => item.name) };
  const locations = projectTransactionPaths(repoRoot, randomUUID());
  await faultInjector?.("before-lock");
  const lock = await acquireProjectLock(repoRoot, path.basename(locations.directory));
  let ownership;
  try {
    ownership = await readProjectOwnership(repoRoot);
    if (canonicalJson(ownership) !== initialOwnershipCanonical) {
      throw new Error("Project third-party ownership changed after preflight; refusing overwrite.");
    }
    await assertActivationCas(targetInfo, repoRoot, "Project third-party Skill");
  } catch (error) {
    await releaseLock(lock, "Project third-party transaction lock");
    throw error;
  }
  const key = await projectKeyFor(repoRoot);
  await ensureDirectory(repoRoot, locations.stage);
  await mkdir(locations.backup, { recursive: true, mode: 0o700 });
  const journal = { schemaVersion: 1, owner: OWNER, id: path.basename(locations.directory), state: "prepared", targets: [] };
  try {
    for (const item of targetInfo) {
      const staged = path.join(locations.stage, item.candidate.id, item.name);
      await mkdir(path.dirname(staged), { recursive: true, mode: 0o700 });
      const copied = await snapshotThirdPartyTree(item.sourcePath, { copyTo: staged });
      if (copied.treeSha256 !== item.treeSha256) throw new Error(`Staged project Skill drifted for ${item.name}.`);
      const backup = item.existing ? path.join(locations.backup, item.candidate.id, item.name) : null;
      if (backup) await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
      journal.targets.push({ path: item.target, next: { treeSha256: item.treeSha256 }, backup, installed: false });
    }
    await writeJournal(locations.journal, journal, key);
    for (let index = 0; index < journal.targets.length; index += 1) {
      const record = journal.targets[index];
      const item = targetInfo[index];
      await faultInjector?.(`before-activate:${item.candidate.id}:${item.name}`);
      await assertActivationCas([item], repoRoot, "Project third-party Skill");
      await ensureDirectory(repoRoot, path.dirname(record.path));
      if (record.backup) await rename(record.path, record.backup);
      await rename(path.join(locations.stage, item.candidate.id, item.name), record.path);
      record.installed = true;
      await writeJournal(locations.journal, journal, key);
      await faultInjector?.(`installed:${item.candidate.id}:${item.name}`);
    }
    for (const candidate of candidates) {
      const source = sources.get(candidate.sourceId);
      ownership.installations[candidate.id] = {
        sourceManifestSha256: loaded.manifestSha256,
        sourceId: source.id,
        commit: source.commit,
        paths: Object.fromEntries(targetInfo.filter((item) => item.candidate.id === candidate.id).map((item) => [item.name, { treeSha256: item.treeSha256 }])),
      };
    }
    await faultInjector?.("before-ownership");
    if (canonicalJson(await readProjectOwnership(repoRoot)) !== initialOwnershipCanonical) {
      throw new Error("Project third-party ownership changed before commit; refusing overwrite.");
    }
    await writeFile(locations.ownership, canonicalJson(ownership), { mode: 0o600 });
    journal.state = "committed";
    await writeJournal(locations.journal, journal, key);
    await rm(locations.directory, { recursive: true, force: true });
    await releaseLock(lock, "Project third-party transaction lock");
    return { status: "installed", installedSkills: targetInfo.map((item) => item.name) };
  } catch (error) {
    if (error?.leaveTransactionForRecovery) throw error;
    try { await recoverThirdPartyProjectTransactions({ repoRoot }); }
    catch (recoveryError) { throw new Error(`Project third-party installation failed and recovery also failed: ${recoveryError.message}`, { cause: error }); }
    throw error;
  }
}
