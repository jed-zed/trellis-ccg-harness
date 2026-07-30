import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertTrustedCommandUnchanged,
  bindPlannedTrustedCommands,
  discoverTrustedCommandRoots,
  minimalCommandEnvironment,
  planTrustedCommands,
} from "./trusted-command-resolver.mjs";

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
const EXACT_RELEASE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const LOCK_CLAIM_DIRECTORY_REMOVE_RETRIES = 5;
const LOCK_CLAIM_DIRECTORY_REMOVE_RETRY_DELAY_MS = 100;
const TARGET_TRANSACTION_PHASES = new Set([
  "prepared",
  "claiming-previous",
  "previous-claimed",
  "reserving",
  "reserved",
  "populating",
  "content-verified",
  "published",
  "restoring-previous",
  "restored",
]);
const MANIFEST_FIELDS = new Set([
  "schemaVersion",
  "owner",
  "generatedAt",
  "approvalDefaults",
  "sources",
  "candidates",
  "exclusions",
]);
const SOURCE_FIELDS = new Set([
  "id",
  "repository",
  "commit",
  "gitTree",
  "release",
  "package",
  "packageIntegrity",
  "packageLock",
  "endpoint",
  "documentation",
  "accessGuide",
  "artifactPolicy",
  "license",
  "assets",
]);
const CANDIDATE_FIELDS = new Set([
  "id",
  "name",
  "kind",
  "group",
  "purpose",
  "sourceId",
  "sourcePath",
  "sourceGitTree",
  "packageSelector",
  "entrypoint",
  "scope",
  "approvalDefaults",
  "recommended",
  "writePaths",
  "dependencies",
  "effects",
  "lifecycle",
  "migration",
  "paths",
  "prohibitedActions",
  "strictDataBoundaryAllowed",
  "unsupportedPlatformBehavior",
  "action",
]);
const CANDIDATE_PATH_FIELDS = new Set([
  "name",
  "sourcePath",
  "targetPath",
  "treeSha256",
  "fileCount",
  "totalBytes",
]);
const CANDIDATE_EFFECT_FIELDS = new Set([
  "scripts",
  "hooks",
  "executables",
  "network",
  "dataEgress",
]);
const CANDIDATE_LIFECYCLE_FIELDS = new Set([
  "update",
  "rollback",
  "uninstall",
]);
const CANDIDATE_MIGRATION_FIELDS = new Set([
  "acceptedLegacyTreeSha256",
]);
const CANDIDATE_ACTION_FIELDS = new Set([
  "status",
  "command",
  "guidance",
]);
const PUBLIC_CANDIDATE_FIELDS = Object.freeze([
  "id",
  "name",
  "kind",
  "group",
  "purpose",
  "sourceId",
  "sourcePath",
  "sourceGitTree",
  "packageSelector",
  "entrypoint",
  "scope",
  "approvalDefaults",
  "recommended",
  "writePaths",
  "dependencies",
  "effects",
  "lifecycle",
  "migration",
  "paths",
  "prohibitedActions",
  "strictDataBoundaryAllowed",
  "unsupportedPlatformBehavior",
  "action",
]);
let cachedSelfProcessInstance = null;

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertExactFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length) {
    throw new Error(`${label} contains unsupported fields: ${unknown.sort().join(", ")}.`);
  }
}

async function readProcessInstance(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (pid === process.pid && cachedSelfProcessInstance) return cachedSelfProcessInstance;
  try {
    let identity;
    if (process.platform === "linux") {
      const [bootId, stat] = await Promise.all([
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readFile(`/proc/${pid}/stat`, "utf8"),
      ]);
      const close = stat.lastIndexOf(")");
      if (close < 0) return undefined;
      const fields = stat.slice(close + 1).trim().split(/\s+/);
      identity = fields[19] ? `linux:${bootId.trim()}:${fields[19]}` : undefined;
    } else if (process.platform === "win32") {
      const result = await execFile(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "& { param([int]$targetPid) (Get-Process -Id $targetPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks }",
          String(pid),
        ],
        { windowsHide: true, timeout: 5_000, maxBuffer: 4_096 },
      );
      const ticks = String(result.stdout ?? "").trim();
      identity = /^\d+$/.test(ticks) ? `win32:${pid}:${ticks}` : undefined;
    } else {
      const result = await execFile(
        "/bin/ps",
        ["-p", String(pid), "-o", "lstart="],
        { windowsHide: true, timeout: 5_000, maxBuffer: 4_096 },
      );
      const started = String(result.stdout ?? "").trim().replace(/\s+/g, " ");
      identity = started ? `${process.platform}:${pid}:${started}` : undefined;
    }
    if (pid === process.pid && identity) cachedSelfProcessInstance = identity;
    return identity;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH" || Number(error?.code) === 1) {
      return null;
    }
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
  const requestedRoot = path.resolve(root);
  const requestedTarget = path.resolve(target);
  assertInside(requestedRoot, requestedTarget, "Managed directory");
  const parts = path.relative(requestedRoot, requestedTarget).split(path.sep).filter(Boolean);
  const canonicalRoot = await assertRealDirectory(requestedRoot, "User home");
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
export async function snapshotThirdPartyTree(
  sourceRoot,
  {
    copyTo = null,
    ignoreDefaultDirectories = true,
    ignoreRelativePaths = [],
  } = {},
) {
  const root = await assertRealDirectory(sourceRoot, "Third-party tree");
  const files = [];
  const directories = [];
  let totalBytes = 0;
  const ignoredPaths = new Set(ignoreRelativePaths);
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
      if (ignoredPaths.has(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Third-party tree contains a symbolic link or reparse point: ${source}`);
      if (entry.isDirectory()) {
        if (
          ignoreDefaultDirectories &&
          IGNORED_DIRECTORIES.has(entry.name.toLowerCase())
        ) {
          continue;
        }
        await assertRealDirectory(source, "Third-party subtree");
        directories.push(relative);
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
  return {
    treeSha256: sha256(canonicalJson(files)),
    inventorySha256: sha256(canonicalJson({ directories, files })),
    directoryCount: directories.length,
    fileCount: files.length,
    totalBytes,
    directories,
    files,
  };
}

function snapshotManagedThirdPartyTree(sourceRoot, options = {}) {
  return snapshotThirdPartyTree(sourceRoot, {
    ...options,
    ignoreDefaultDirectories: false,
  });
}

function sameTreeInventory(actual, expected) {
  return (
    actual.treeSha256 === expected.treeSha256 &&
    actual.inventorySha256 === expected.inventorySha256
  );
}

function journalTreeSnapshot(snapshot) {
  return {
    treeSha256: snapshot.treeSha256,
    inventorySha256: snapshot.inventorySha256,
    directories: snapshot.directories,
    files: snapshot.files,
  };
}

function treeInventoryIsSubset(actual, expected) {
  const expectedDirectories = new Set(expected.directories);
  if (!actual.directories.every((entry) => expectedDirectories.has(entry))) {
    return false;
  }
  const expectedFiles = new Map(
    expected.files.map((entry) => [entry.path, entry]),
  );
  return actual.files.every((entry) => {
    const pinned = expectedFiles.get(entry.path);
    return (
      pinned?.size === entry.size &&
      pinned.sha256 === entry.sha256
    );
  });
}

function immutable(value, label) {
  if (typeof value !== "string" || !HEX_40.test(value)) {
    throw new Error(`${label} must be a full immutable 40-character commit/tree id.`);
  }
}

function assertCredentialFreeHttpsRepository(value, label) {
  let repository;
  try {
    repository = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (
    repository.protocol !== "https:" ||
    repository.username ||
    repository.password ||
    repository.search ||
    repository.hash
  ) {
    throw new Error(`${label} must be credential-free HTTPS without query or fragment data.`);
  }
}

function validateServiceSourceMetadata(source) {
  for (const field of ["endpoint", "documentation", "accessGuide"]) {
    if (source[field] !== undefined) {
      assertCredentialFreeHttpsRepository(source[field], `Source ${source.id} ${field}`);
    }
  }
  if (source.endpoint !== undefined && source.documentation === undefined) {
    throw new Error(`Source ${source.id} service endpoint requires official documentation.`);
  }
  if (
    source.artifactPolicy !== undefined &&
    source.artifactPolicy !== "remote-service-no-local-sri"
  ) {
    throw new Error(`Source ${source.id} has an unsupported artifact policy.`);
  }
  if (
    source.endpoint !== undefined &&
    source.package === undefined &&
    source.artifactPolicy !== "remote-service-no-local-sri"
  ) {
    throw new Error(
      `Source ${source.id} remote service without a local package must declare remote-service-no-local-sri.`,
    );
  }
}

function validateSourceAssets(source) {
  const packageFields = [
    source.package,
    source.packageIntegrity,
    source.packageLock,
  ];
  const hasPackage = packageFields.some((value) => value !== undefined);
  if (hasPackage && packageFields.some((value) => value === undefined)) {
    throw new Error(`Source ${source.id} npm metadata must include package, packageIntegrity, and packageLock together.`);
  }
  if (hasPackage) {
    if (
      typeof source.package !== "string" ||
      !NPM_PACKAGE.test(source.package) ||
      typeof source.release !== "string" ||
      !EXACT_RELEASE.test(source.release) ||
      typeof source.packageIntegrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(source.packageIntegrity)
    ) {
      throw new Error(`Source ${source.id} has invalid exact npm package metadata.`);
    }
    assertExactFields(
      source.packageLock,
      new Set(["path", "sha256", "lockfileVersion", "packageCount"]),
      `Source ${source.id} packageLock`,
    );
    const lockPath = String(source.packageLock.path ?? "").replaceAll("\\", "/");
    if (
      !/^npm-locks\/[A-Za-z0-9][A-Za-z0-9._-]*\.package-lock\.json$/.test(lockPath) ||
      lockPath !== source.packageLock.path ||
      !HEX_64.test(String(source.packageLock.sha256 ?? "")) ||
      !Number.isSafeInteger(source.packageLock.lockfileVersion) ||
      source.packageLock.lockfileVersion < 2 ||
      source.packageLock.lockfileVersion > 3 ||
      !Number.isSafeInteger(source.packageLock.packageCount) ||
      source.packageLock.packageCount <= 0
    ) {
      throw new Error(`Source ${source.id} has invalid Harness-owned packageLock metadata.`);
    }
  }
  if (
    source.release !== undefined &&
    (typeof source.release !== "string" || !EXACT_RELEASE.test(source.release))
  ) {
    throw new Error(`Source ${source.id} release must be an exact immutable version.`);
  }
  if (source.assets === undefined) return;
  if (
    typeof source.release !== "string" ||
    !source.release.trim() ||
    !Array.isArray(source.assets) ||
    !source.assets.length
  ) {
    throw new Error(`Source ${source.id} assets require a fixed release and a non-empty asset list.`);
  }
  const platforms = new Set();
  const names = new Set();
  for (const asset of source.assets) {
    if (
      !asset ||
      Object.keys(asset).sort().join(",") !== "name,platform,sha256" ||
      typeof asset.platform !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(asset.platform) ||
      platforms.has(asset.platform) ||
      typeof asset.name !== "string" ||
      !asset.name ||
      names.has(asset.name) ||
      !HEX_64.test(String(asset.sha256 ?? ""))
    ) {
      throw new Error(`Source ${source.id} has an invalid or duplicate asset record.`);
    }
    const normalizedName = asset.name.replaceAll("\\", "/");
    if (
      normalizedName !== path.posix.basename(normalizedName) ||
      normalizedName === "." ||
      normalizedName === ".."
    ) {
      throw new Error(`Source ${source.id} asset name must be a safe basename.`);
    }
    platforms.add(asset.platform);
    names.add(asset.name);
  }
}

/** Reject malformed and mutable public source records before presenting approvals. */
export function validateThirdPartySourceManifest(manifest) {
  assertExactFields(manifest, MANIFEST_FIELDS, "Third-party source manifest");
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
  const sourcesById = new Map();
  for (const source of manifest.sources) {
    assertExactFields(source, SOURCE_FIELDS, "Third-party source");
    if (!source?.id || sourceIds.has(source.id)) throw new Error("Third-party source ids must be unique.");
    assertSafeIdentifier(source.id, "Third-party source id");
    sourceIds.add(source.id);
    assertCredentialFreeHttpsRepository(source.repository, `Source ${source.id} repository`);
    immutable(source.commit, `Source ${source.id} commit`);
    immutable(source.gitTree, `Source ${source.id} gitTree`);
    if (typeof source.license !== "string" || !source.license.trim()) throw new Error(`Source ${source.id} lacks a license.`);
    validateSourceAssets(source);
    validateServiceSourceMetadata(source);
    sourcesById.set(source.id, source);
    for (const [field, value] of Object.entries(source)) {
      if (typeof value === "string" && /(^|[\/@_-])(main|latest)(?:$|[\/@_-])/i.test(value) && !["repository"].includes(field)) {
        throw new Error(`Source ${source.id} ${field} uses a mutable selector.`);
      }
    }
  }
  const candidateIds = new Set();
  const groups = new Set(GROUPS.map(([id]) => id));
  for (const candidate of manifest.candidates) {
    assertExactFields(candidate, CANDIDATE_FIELDS, "Third-party candidate");
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
    const candidateSource = sourcesById.get(candidate.sourceId);
    if (candidate.packageSelector !== undefined) {
      const expectedSelector = candidateSource?.package && candidateSource?.release
        ? `${candidateSource.package}@${candidateSource.release}`
        : null;
      if (
        typeof candidate.packageSelector !== "string" ||
        candidate.packageSelector !== expectedSelector
      ) {
        throw new Error(`Candidate ${candidate.id} packageSelector must exactly match its pinned npm source and version.`);
      }
    } else if (candidateSource?.package && candidate.group === "mcp-cli") {
      throw new Error(`Candidate ${candidate.id} lacks its exact pinned npm packageSelector.`);
    }
    if (
      candidate.entrypoint !== undefined &&
      (typeof candidate.entrypoint !== "string" || !SAFE_IDENTIFIER.test(candidate.entrypoint))
    ) {
      throw new Error(`Candidate ${candidate.id} has an unsafe entrypoint.`);
    }
    if (!Array.isArray(candidate.dependencies)) throw new Error(`Candidate ${candidate.id} has invalid dependencies.`);
    assertExactFields(
      candidate.approvalDefaults,
      new Set(["selected"]),
      `Candidate ${candidate.id} approvalDefaults`,
    );
    if (candidate.effects !== undefined) {
      assertExactFields(candidate.effects, CANDIDATE_EFFECT_FIELDS, `Candidate ${candidate.id} effects`);
    }
    if (candidate.lifecycle !== undefined) {
      assertExactFields(candidate.lifecycle, CANDIDATE_LIFECYCLE_FIELDS, `Candidate ${candidate.id} lifecycle`);
    }
    if (candidate.migration !== undefined) {
      assertExactFields(candidate.migration, CANDIDATE_MIGRATION_FIELDS, `Candidate ${candidate.id} migration`);
    }
    if (candidate.kind === "ccg-managed-mcp") {
      assertExactFields(
        candidate.action,
        CANDIDATE_ACTION_FIELDS,
        `CCG-managed MCP candidate ${candidate.id} action`,
      );
      if (
        candidate.action.status !== "ccg-managed" ||
        candidate.action.command !== "ccg config mcp" ||
        typeof candidate.action.guidance !== "string" ||
        !candidate.action.guidance.trim() ||
        candidate.action.guidance.length > 500
      ) {
        throw new Error(
          `CCG-managed MCP candidate ${candidate.id} action must use the fixed ccg config mcp command and bounded guidance.`,
        );
      }
      if (candidate.effects?.network !== true) {
        throw new Error(`CCG-managed MCP candidate ${candidate.id} must disclose network effects.`);
      }
    } else if (candidate.action !== undefined) {
      throw new Error(`Candidate ${candidate.id} cannot declare a CCG-managed action.`);
    }
    if (candidate.paths !== undefined) {
      if (!Array.isArray(candidate.paths) || !candidate.paths.length) throw new Error(`Candidate ${candidate.id} has invalid Skill paths.`);
      for (const item of candidate.paths) {
        assertExactFields(item, CANDIDATE_PATH_FIELDS, `Candidate ${candidate.id} Skill path`);
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

function validateGitBinding(binding) {
  if (
    !binding ||
    binding.logicalName !== "git" ||
    typeof binding.command !== "string" ||
    !path.isAbsolute(binding.command) ||
    !Array.isArray(binding.argsPrefix) ||
    !binding.identity
  ) {
    throw new Error("Pinned source acquisition requires a trusted absolute Git command binding.");
  }
  return binding;
}

function gitSubprocessEnvironment(approvalPlan, env) {
  const clean = thirdPartySubprocessEnvironment(approvalPlan, env);
  for (const name of Object.keys(clean)) {
    if (name.toUpperCase().startsWith("GIT_")) delete clean[name];
  }
  return {
    ...clean,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function runGit(execFileImpl, binding, verifyBinding, args, cwd, env) {
  await verifyBinding(binding);
  const result = await execFileImpl(
    binding.command,
    [...binding.argsPrefix, ...args],
    { cwd, env, windowsHide: true, shell: false },
  );
  return String(result?.stdout ?? "").trim();
}

async function verifyPinnedGitCheckout(directory, source, execFileImpl, binding, verifyBinding, env) {
  const head = await runGit(execFileImpl, binding, verifyBinding, ["rev-parse", "HEAD"], directory, env);
  if (head.toLowerCase() !== source.commit.toLowerCase()) {
    throw new Error(`Pinned source ${source.id} HEAD does not match its approved commit.`);
  }
  const tree = await runGit(execFileImpl, binding, verifyBinding, ["rev-parse", "HEAD^{tree}"], directory, env);
  if (tree.toLowerCase() !== source.gitTree.toLowerCase()) {
    throw new Error(`Pinned source ${source.id} tree does not match its approved gitTree.`);
  }
  const porcelain = await runGit(execFileImpl, binding, verifyBinding, ["status", "--porcelain"], directory, env);
  if (porcelain) throw new Error(`Pinned source ${source.id} checkout is not clean.`);
}

/**
 * Acquire exactly one immutable Git object into the private Harness cache.
 * The ref passed to Git is the 40-character approved commit, never a branch
 * or mutable npm/Git selector. Existing cache entries are verified again.
 */
export async function acquirePinnedGitSource({
  homeDir,
  source,
  execFileImpl = execFile,
  approvalPlan,
  env = process.env,
}) {
  const canonicalHome = await assertRealDirectory(homeDir, "User home");
  if (!source || !SOURCE_ID.test(String(source.id ?? ""))) throw new Error("Pinned source has an unsafe id.");
  assertCredentialFreeHttpsRepository(source.repository, "Pinned source repository");
  immutable(source.commit, `Pinned source ${source.id} commit`);
  immutable(source.gitTree, `Pinned source ${source.id} gitTree`);
  if (!approvalPlan) {
    throw new Error("Pinned source acquisition requires the displayed third-party approval plan.");
  }
  validateApprovalPlanDigest(approvalPlan);
  assertCanonicalEqual(
    approvalPlan.execution?.subprocessConfigRoots,
    subprocessConfigRoots(canonicalHome),
    "Pinned source subprocess configuration roots",
  );
  const displayedSources = approvalPlan.groups
    .flatMap((group) => group.candidates)
    .map((candidate) => candidate.source);
  if (!displayedSources.some((displayed) =>
    displayed?.id === source.id &&
    displayed.repository === source.repository &&
    displayed.commit === source.commit &&
    displayed.gitTree === source.gitTree
  )) {
    throw new Error(`Pinned source ${source.id} was not bound by the displayed approval plan.`);
  }
  const trustedCommands = await bindPlannedTrustedCommands(
    approvalPlan.execution?.commandPlan,
    {
      env: thirdPartySubprocessEnvironment(approvalPlan, env),
      platform: approvalPlan.execution?.platform,
    },
  );
  const binding = validateGitBinding(trustedCommands.bindings.git);
  const gitEnvironment = gitSubprocessEnvironment(approvalPlan, env);
  const root = homePath(canonicalHome, ".agents/harness/sources", "Pinned source cache");
  await ensureDirectory(canonicalHome, root);
  const sourceRoot = path.join(root, source.id);
  assertInside(root, sourceRoot, "Pinned source cache");
  await ensureDirectory(canonicalHome, sourceRoot);
  const target = path.join(sourceRoot, source.commit);
  assertInside(sourceRoot, target, "Pinned source checkout");
  if (await exists(target)) {
    await assertRealDirectory(target, "Pinned source checkout");
    await verifyPinnedGitCheckout(
      target,
      source,
      execFileImpl,
      binding,
      assertTrustedCommandUnchanged,
      gitEnvironment,
    );
    return target;
  }
  const stage = path.join(sourceRoot, `.stage-${source.commit}-${randomUUID()}`);
  assertInside(sourceRoot, stage, "Pinned source staging directory");
  try {
    await mkdir(stage, { mode: 0o700 });
    await runGit(execFileImpl, binding, assertTrustedCommandUnchanged, ["init"], stage, gitEnvironment);
    await runGit(
      execFileImpl,
      binding,
      assertTrustedCommandUnchanged,
      ["remote", "add", "origin", source.repository],
      stage,
      gitEnvironment,
    );
    await runGit(
      execFileImpl,
      binding,
      assertTrustedCommandUnchanged,
      ["fetch", "--depth=1", "origin", source.commit],
      stage,
      gitEnvironment,
    );
    await runGit(
      execFileImpl,
      binding,
      assertTrustedCommandUnchanged,
      ["checkout", "--detach", source.commit],
      stage,
      gitEnvironment,
    );
    await verifyPinnedGitCheckout(
      stage,
      source,
      execFileImpl,
      binding,
      assertTrustedCommandUnchanged,
      gitEnvironment,
    );
    await rename(stage, target);
    return target;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function readGlobalActionObservation(homeDir) {
  const target = homePath(
    homeDir,
    ".agents/harness/third-party-global-actions.json",
    "Third-party global action ownership",
  );
  if (!(await exists(target))) return { actions: {} };
  try {
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink()) {
      return { unsafe: true, actions: {} };
    }
    const value = JSON.parse(await readFile(target, "utf8"));
    if (
      value?.schemaVersion !== 1 ||
      value.owner !== OWNER ||
      !value.actions ||
      typeof value.actions !== "object" ||
      Array.isArray(value.actions)
    ) {
      return { unsafe: true, actions: {} };
    }
    return value;
  } catch {
    return { unsafe: true, actions: {} };
  }
}

function approvalExpectedInstallation(candidate, source) {
  return {
    scope: candidate.scope,
    sourceId: source.id,
    repository: source.repository,
    commit: source.commit,
    gitTree: source.gitTree,
    release: source.release ?? null,
    packageSelector: candidate.packageSelector ?? null,
    packageIntegrity: source.packageIntegrity ?? null,
    packageLockSha256: source.packageLock?.sha256 ?? null,
    endpoint: source.endpoint ?? null,
    documentation: source.documentation ?? null,
    accessGuide: source.accessGuide ?? null,
    artifactPolicy: source.artifactPolicy ?? null,
    assets: (source.assets ?? []).map(({ platform, name, sha256: digest }) => ({
      platform,
      name,
      sha256: digest,
    })),
    paths: (candidate.paths ?? []).map(({ name, targetPath, treeSha256 }) => ({
      name,
      targetPath,
      treeSha256,
    })),
  };
}

async function installedPathStatus(root, candidate, source, manifestSha256) {
  const expected = approvalExpectedInstallation(candidate, source);
  if (candidate.kind === "ccg-managed-mcp") {
    const observed = {
      status: "manual-pending",
      reason:
        "MCP configuration is delegated to the reviewed CCG workflow; Harness does not inspect, install, or mutate the host configuration.",
      owned: false,
    };
    return { status: observed.status, scope: candidate.scope, expected, observed };
  }
  if (!candidate.paths) {
    const ownership = await readGlobalActionObservation(root);
    if (ownership.unsafe) {
      const observed = {
        status: "drifted",
        reason: "Harness global-action ownership is unsafe or invalid.",
      };
      return { status: observed.status, scope: candidate.scope, expected, observed };
    }
    const owned = ownership.actions[candidate.id];
    if (
      candidate.id === "ponytail.hooks" ||
      candidate.id === "ponytail.default-full"
    ) {
      const observed = {
        status: "manual-pending",
        reason: "Codex host state cannot be proven without a separately approved host inspection; execution rechecks it.",
        owned: Boolean(owned),
      };
      return { status: observed.status, scope: candidate.scope, expected, observed };
    }
    const target = candidate.id === "ponytail.install"
      ? homePath(root, `.agents/harness/sources/${source.id}/${source.commit}`, "Observed Ponytail source")
      : homePath(root, `.agents/harness/tools/${candidate.id}/${source.release}`, "Observed third-party tool");
    const targetPresent = await exists(target);
    let status;
    let reason;
    if (!targetPresent && !owned) {
      status = "absent";
      reason = "No managed target or ownership record was found.";
    } else if (!targetPresent && owned) {
      status = "drifted";
      reason = "Ownership exists but its managed target is absent.";
    } else if (targetPresent && !owned) {
      status = "unowned";
      reason = "A target exists without matching Harness ownership.";
    } else if (owned.sourceManifestSha256 !== manifestSha256) {
      status = "drifted";
      reason = "Ownership is bound to a different source manifest.";
    } else {
      status = "manual-pending";
      reason = "A target and ownership exist; the action runtime must revalidate the complete host/tree inventory before reuse.";
    }
    const observed = { status, reason, target, targetPresent, owned: Boolean(owned) };
    return { status, scope: candidate.scope, expected, observed };
  }
  const ownershipTarget = candidate.group === "project-skills"
    ? path.join(path.resolve(root), ".harness", "third-party-installations.json")
    : homePath(root, ".agents/harness/third-party-installations.json", "Observed third-party Skill ownership");
  let ownership;
  try {
    ownership = await readOwnership(ownershipTarget);
  } catch (error) {
    const observed = {
      status: "drifted",
      reason: `Harness Skill ownership cannot be safely verified: ${error.message}`,
      paths: [],
    };
    return { status: observed.status, scope: candidate.scope, expected, observed };
  }
  const paths = [];
  for (const item of candidate.paths) {
    const target = safeSkillTarget(root, item.targetPath, "Third-party Skill observation target");
    if (!(await exists(target))) { paths.push({ name: item.name, status: "absent" }); continue; }
    const snapshot = await snapshotManagedThirdPartyTree(target);
    paths.push({ name: item.name, status: snapshot.treeSha256 === item.treeSha256 ? "exact" : "drifted", treeSha256: snapshot.treeSha256 });
  }
  const owned = ownership.installations[candidate.id];
  let status = paths.every((entry) => entry.status === "absent")
    ? (owned ? "drifted" : "absent")
    : paths.some((entry) => entry.status === "drifted" || entry.status === "absent")
      ? "drifted"
      : "exact";
  if (
    status === "exact" &&
    (
      owned?.sourceManifestSha256 !== manifestSha256 ||
      candidate.paths.some((item) =>
        owned?.paths?.[item.name]?.treeSha256 !== item.treeSha256)
    )
  ) {
    status = "unowned";
  }
  const observed = {
    status,
    owned: Boolean(owned),
    paths,
  };
  return { status, scope: candidate.scope, expected, observed };
}

function approvalSourceEvidence(source) {
  return {
    id: source.id,
    repository: source.repository,
    commit: source.commit,
    gitTree: source.gitTree,
    release: source.release ?? null,
    package: source.package ?? null,
    packageIntegrity: source.packageIntegrity ?? null,
    packageLock: source.packageLock
      ? {
        path: source.packageLock.path,
        sha256: source.packageLock.sha256,
        lockfileVersion: source.packageLock.lockfileVersion,
        packageCount: source.packageLock.packageCount,
      }
      : null,
    endpoint: source.endpoint ?? null,
    documentation: source.documentation ?? null,
    accessGuide: source.accessGuide ?? null,
    artifactPolicy: source.artifactPolicy ?? null,
    license: source.license,
    assets: (source.assets ?? []).map((asset) => ({
      platform: asset.platform,
      name: asset.name,
      sha256: asset.sha256,
    })),
  };
}

function approvalCandidateEvidence(candidate) {
  const projected = {};
  for (const field of PUBLIC_CANDIDATE_FIELDS) {
    if (candidate[field] !== undefined) projected[field] = structuredClone(candidate[field]);
  }
  return projected;
}

function approvalPlanEvidence(plan) {
  return {
    schemaVersion: 1,
    owner: OWNER,
    sourceManifestSha256: plan.sourceManifestSha256,
    strictDataBoundary: plan.strictDataBoundary,
    targetRoots: structuredClone(plan.targetRoots),
    execution: structuredClone(plan.execution),
    blockedCandidateIds: plan.groups
      .flatMap((group) => group.candidates)
      .filter((candidate) => candidate.blocked)
      .map((candidate) => candidate.id)
      .sort(),
    groups: plan.groups.map((group) => ({
      id: group.id,
      candidates: group.candidates.map((candidate) =>
        structuredClone(candidate)),
    })),
  };
}

function thirdPartyCommandNames(manifest) {
  const names = new Set();
  for (const candidate of manifest.candidates) {
    if (
      candidate.group === "global-skills" ||
      candidate.group === "project-skills" ||
      candidate.id === "ponytail.install"
    ) {
      names.add("git");
    }
    if (candidate.kind === "mcp-cli") {
      names.add("npm");
      names.add("codex");
    }
    if (candidate.id === "ponytail.install") names.add("codex");
    if (candidate.id === "ripgrep") {
      names.add("powershell");
      names.add("tar");
    }
  }
  return [...names].sort();
}

function subprocessConfigRoots(homeDir) {
  const home = path.resolve(homeDir);
  return {
    home,
    userProfile: home,
    xdgConfigHome: path.join(home, ".config"),
    codexHome: path.join(home, ".codex"),
    sourceCache: path.join(home, ".agents", "harness", "sources"),
    toolCache: path.join(home, ".agents", "harness", "tools"),
  };
}

export function thirdPartySubprocessEnvironment(approvalPlan, env = {}) {
  const roots = approvalPlan?.execution?.subprocessConfigRoots;
  if (!roots) throw new Error("Third-party approval plan has no subprocess configuration roots.");
  return {
    ...minimalCommandEnvironment(env),
    HOME: roots.home,
    USERPROFILE: roots.userProfile,
    XDG_CONFIG_HOME: roots.xdgConfigHome,
    CODEX_HOME: roots.codexHome,
  };
}

function approvalPlanSha256(plan) {
  return sha256(canonicalJson(approvalPlanEvidence(plan)));
}

function validateApprovalPlanDigest(plan) {
  if (
    !plan ||
    plan.schemaVersion !== 1 ||
    plan.owner !== OWNER ||
    !HEX_64.test(String(plan.planSha256 ?? ""))
  ) {
    throw new Error("Third-party approval plan is missing a canonical plan SHA-256.");
  }
  const expected = approvalPlanSha256(plan);
  if (
    !timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(plan.planSha256, "hex"),
    )
  ) {
    throw new Error("Third-party approval plan drifted after presentation; explicit approval is invalid.");
  }
  return plan;
}

function assertCanonicalEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} differs from the pinned third-party manifest or runtime target.`);
  }
}

export async function verifyThirdPartyApprovalPlanForOperation({
  approvalPlan,
  homeDir,
  manifest,
  manifestSha256,
  repoRoot,
  strictDataBoundary,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  assetPlatform = `${platform}-${arch}`,
}) {
  if (
    strictDataBoundary !== undefined &&
    typeof strictDataBoundary !== "boolean"
  ) {
    throw new Error("Third-party strict-data-boundary policy must be a boolean.");
  }
  validateApprovalPlanDigest(approvalPlan);
  if (approvalPlan.sourceManifestSha256 !== manifestSha256) {
    throw new Error("Third-party approval plan does not match the pinned source manifest.");
  }
  if (
    strictDataBoundary !== undefined &&
    approvalPlan.strictDataBoundary !== strictDataBoundary
  ) {
    throw new Error("Third-party approval plan strict-data-boundary policy drifted after presentation.");
  }
  const canonicalHome = await assertRealDirectory(homeDir, "User home");
  const canonicalRepo = repoRoot
    ? await assertRealDirectory(repoRoot, "Project root")
    : null;
  assertCanonicalEqual(
    approvalPlan.targetRoots,
    {
      globalSkills: canonicalHome,
      globalPlugins: canonicalHome,
      projectSkills: canonicalRepo,
      mcpCli: canonicalHome,
    },
    "Third-party approval plan target roots",
  );
  if (
    !approvalPlan.execution ||
    !approvalPlan.execution.commandPlan ||
    !approvalPlan.execution.subprocessConfigRoots
  ) {
    throw new Error("Third-party approval plan execution identity is incomplete.");
  }
  if (
    approvalPlan.execution?.platform !== platform ||
    approvalPlan.execution?.arch !== arch ||
    approvalPlan.execution?.assetPlatform !== assetPlatform
  ) {
    throw new Error(
      "Third-party approval plan execution or asset platform drifted after presentation.",
    );
  }
  assertCanonicalEqual(
    approvalPlan.execution.subprocessConfigRoots,
    subprocessConfigRoots(canonicalHome),
    "Third-party approval plan subprocess configuration roots",
  );
  const expectedCommandNames = thirdPartyCommandNames(manifest);
  assertCanonicalEqual(
    Object.keys(approvalPlan.execution.commandPlan?.commands ?? {}).sort(),
    expectedCommandNames,
    "Third-party approval plan command set",
  );
  await bindPlannedTrustedCommands(approvalPlan.execution.commandPlan, {
    env: thirdPartySubprocessEnvironment(approvalPlan, env),
    platform,
  });
  const sources = new Map(manifest.sources.map((source) => [source.id, source]));
  const expectedCandidates = new Map(
    manifest.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const actualCandidates = approvalPlan.groups.flatMap((group) =>
    group.candidates.map((candidate) => ({ groupId: group.id, candidate })));
  if (
    actualCandidates.length !== expectedCandidates.size ||
    new Set(actualCandidates.map(({ candidate }) => candidate.id)).size !==
      expectedCandidates.size
  ) {
    throw new Error("Third-party approval plan candidate set differs from the pinned manifest.");
  }
  for (const { groupId, candidate } of actualCandidates) {
    const pinned = expectedCandidates.get(candidate.id);
    if (!pinned || pinned.group !== groupId || candidate.group !== groupId) {
      throw new Error(`Third-party approval plan candidate ${candidate.id} has invalid group evidence.`);
    }
    const expectedBlocked =
      approvalPlan.strictDataBoundary === true &&
      pinned.strictDataBoundaryAllowed === false;
    if (
      candidate.blocked !== expectedBlocked ||
      candidate.unavailableReason !==
        (expectedBlocked ? "Blocked by strict data boundary." : null)
    ) {
      throw new Error(`Third-party approval plan candidate ${candidate.id} has forged boundary evidence.`);
    }
    const expectedPublicCandidate = approvalCandidateEvidence(pinned);
    for (const [field, value] of Object.entries(expectedPublicCandidate)) {
      if (field === "recommended") continue;
      assertCanonicalEqual(
        candidate[field],
        value,
        `Third-party approval plan candidate ${candidate.id} ${field}`,
      );
    }
    if (
      candidate.recommended !==
      (expectedBlocked ? false : pinned.recommended === true)
    ) {
      throw new Error(`Third-party approval plan candidate ${candidate.id} has forged recommendation evidence.`);
    }
    if (
      candidate.selected !== false ||
      candidate.dataEgress !== (pinned.effects?.dataEgress ?? "None.") ||
      candidate.scripts !== Boolean(pinned.effects?.scripts) ||
      candidate.hooks !== Boolean(pinned.effects?.hooks) ||
      candidate.executables !== Boolean(pinned.effects?.executables)
    ) {
      throw new Error(`Third-party approval plan candidate ${candidate.id} has forged effect evidence.`);
    }
    const source = sources.get(pinned.sourceId);
    const sourceEvidence = approvalSourceEvidence(source);
    assertCanonicalEqual(
      candidate.source,
      sourceEvidence,
      `Third-party approval plan candidate ${candidate.id} source evidence`,
    );
    for (const field of [
      "repository",
      "commit",
      "gitTree",
      "release",
      "package",
      "packageIntegrity",
      "assets",
      "license",
    ]) {
      assertCanonicalEqual(
        candidate[field],
        sourceEvidence[field],
        `Third-party approval plan candidate ${candidate.id} ${field}`,
      );
    }
    const expectedInstallation = approvalExpectedInstallation(pinned, source);
    const allowedStatuses = new Set([
      "absent",
      "exact",
      "drifted",
      "unowned",
      "manual-pending",
    ]);
    if (
      candidate.installed?.scope !== pinned.scope ||
      candidate.installed.status !== candidate.installed.observed?.status ||
      !allowedStatuses.has(candidate.installed.status)
    ) {
      throw new Error(`Third-party approval plan candidate ${candidate.id} has invalid installation observation.`);
    }
    assertCanonicalEqual(
      candidate.installed.expected,
      expectedInstallation,
      `Third-party approval plan candidate ${candidate.id} expected installation`,
    );
  }
  return approvalPlan;
}

/** A read-only plan: third parties are never pre-selected. */
export async function buildThirdPartyApprovalPlan({
  manifestPath,
  manifest: suppliedManifest,
  homeDir,
  repoRoot,
  strictDataBoundary = false,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  approvedPackageRoots,
  approvedCommandRoots,
  discoverCommandRoots = false,
}) {
  if (typeof strictDataBoundary !== "boolean") {
    throw new Error("Third-party strict-data-boundary policy must be a boolean.");
  }
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestPath: manifestPath ?? null, manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  if (!homeDir) throw new Error("homeDir is required.");
  if (!repoRoot) throw new Error("repoRoot is required for authoritative third-party approval planning.");
  const canonicalHomeDir = await assertRealDirectory(homeDir, "User home");
  const canonicalRepoRoot = repoRoot
    ? await assertRealDirectory(repoRoot, "Project root")
    : null;
  const commandNames = thirdPartyCommandNames(loaded.manifest);
  const discoveredRoots =
    discoverCommandRoots &&
    approvedPackageRoots === undefined &&
    approvedCommandRoots === undefined
      ? await discoverTrustedCommandRoots(commandNames, { env, platform })
      : {
        approvedPackageRoots: approvedPackageRoots ?? [],
        approvedCommandRoots: approvedCommandRoots ?? [],
      };
  const commandPlan = await planTrustedCommands(commandNames, {
    env,
    platform,
    approvedPackageRoots: discoveredRoots.approvedPackageRoots,
    approvedCommandRoots: discoveredRoots.approvedCommandRoots,
  });
  const sources = new Map(loaded.manifest.sources.map((source) => [source.id, source]));
  const groupRecords = [];
  for (const [groupId] of GROUPS) {
    const candidates = [];
    for (const candidate of loaded.manifest.candidates.filter((entry) => entry.group === groupId)) {
      const source = sources.get(candidate.sourceId);
      // Global candidates are observed under the user profile; project Skills
      // must be observed at their actual project target and never under home.
      const installationRoot = groupId === "project-skills" && canonicalRepoRoot
        ? canonicalRepoRoot
        : canonicalHomeDir;
      const unavailableReason = strictDataBoundary && candidate.strictDataBoundaryAllowed === false
        ? "Blocked by strict data boundary."
        : null;
      const sourceEvidence = approvalSourceEvidence(source);
      candidates.push({
        ...approvalCandidateEvidence(candidate),
        source: sourceEvidence,
        repository: source.repository,
        commit: source.commit,
        gitTree: source.gitTree,
        release: source.release ?? null,
        package: source.package ?? null,
        packageIntegrity: source.packageIntegrity ?? null,
        assets: sourceEvidence.assets,
        license: source.license,
        dataEgress: candidate.effects?.dataEgress ?? "None.",
        scripts: Boolean(candidate.effects?.scripts),
        hooks: Boolean(candidate.effects?.hooks),
        executables: Boolean(candidate.effects?.executables),
        selected: false,
        recommended: unavailableReason ? false : candidate.recommended === true,
        installed: await installedPathStatus(
          installationRoot,
          candidate,
          source,
          loaded.manifestSha256,
        ),
        unavailableReason,
        blocked: Boolean(unavailableReason),
      });
    }
    groupRecords.push({ id: groupId, candidates });
  }
  const plan = {
    schemaVersion: 1,
    owner: OWNER,
    manifestPath: loaded.manifestPath,
    sourceManifestSha256: loaded.manifestSha256,
    strictDataBoundary: Boolean(strictDataBoundary),
    targetRoots: {
      globalSkills: canonicalHomeDir,
      globalPlugins: canonicalHomeDir,
      projectSkills: canonicalRepoRoot,
      mcpCli: canonicalHomeDir,
    },
    execution: {
      platform,
      arch,
      assetPlatform: `${platform}-${arch}`,
      commandPlan,
      subprocessConfigRoots: subprocessConfigRoots(canonicalHomeDir),
    },
    groups: groupRecords,
    detected: { codegraph: { indexPresent: Boolean(repoRoot && await exists(path.join(path.resolve(repoRoot), ".codegraph"))) } },
  };
  plan.planSha256 = approvalPlanSha256(plan);
  assertSecretFree(plan, "Third-party approval plan");
  validateApprovalPlanDigest(plan);
  return plan;
}

function planHasExactCandidate(plan, id) {
  return plan.groups
    .flatMap((group) => group.candidates)
    .some(
      (candidate) =>
        candidate.id === id && candidate.installed?.status === "exact",
    );
}

/** Resolve only explicit choices; dependency choices are never inferred. */
export function resolveThirdPartyApprovals({ plan, selections }) {
  if (!plan || !Array.isArray(plan.groups) || !selections || typeof selections !== "object") throw new Error("An approval plan and explicit selections are required.");
  validateApprovalPlanDigest(plan);
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
  const skipped = [];
  const validActionIds = new Set(selected);
  for (const group of plan.groups) {
    for (const candidate of group.candidates) {
      if (!selected.has(candidate.id)) continue;
      if (candidate.unavailableReason) {
        validActionIds.delete(candidate.id);
        skipped.push({
          id: candidate.id,
          reason: candidate.unavailableReason,
        });
      }
    }
  }
  let dependenciesChanged;
  do {
    dependenciesChanged = false;
    for (const group of plan.groups) {
      for (const candidate of group.candidates) {
        if (!validActionIds.has(candidate.id)) continue;
        const missingDependencies = candidate.dependencies
          .filter(
            (id) =>
              !validActionIds.has(id) && !planHasExactCandidate(plan, id),
          )
          .sort();
        if (missingDependencies.length === 0) continue;
        validActionIds.delete(candidate.id);
        skipped.push({
          id: candidate.id,
          reason: "Required dependency was not approved or was blocked.",
          missingDependencies,
        });
        dependenciesChanged = true;
      }
    }
  } while (dependenciesChanged);
  const approvedActionIds = plan.groups
    .flatMap((group) => group.candidates)
    .filter((candidate) => validActionIds.has(candidate.id))
    .map((candidate) => candidate.id);
  return {
    schemaVersion: 1,
    owner: OWNER,
    sourceManifestSha256: plan.sourceManifestSha256,
    planSha256: plan.planSha256,
    planEvidence: approvalPlanEvidence(plan),
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

async function keyFor(homeDir, { create = true } = {}) {
  const { key } = transactionPaths(homeDir, "placeholder");
  if (create) await ensureDirectory(homeDir, path.dirname(key));
  try {
    const info = await lstat(key);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
      throw new Error("Third-party transaction key is unsafe.");
    }
    const bytes = await readFile(key);
    if (bytes.length !== 32) {
      throw new Error("Third-party transaction key has an invalid length.");
    }
    return bytes;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!create) {
      throw new Error("Third-party transaction provenance key is missing; manual review is required.");
    }
    const bytes = randomBytes(32);
    try {
      await writeFile(key, bytes, { flag: "wx", mode: 0o600 });
      await chmod(key, 0o600);
      return bytes;
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      const info = await lstat(key);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
        throw new Error("Third-party transaction key is unsafe.");
      }
      const existing = await readFile(key);
      if (existing.length !== 32) {
        throw new Error("Third-party transaction key has an invalid length.");
      }
      return existing;
    }
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

function authenticatedDigest(record, key, domain) {
  const copy = { ...record };
  delete copy.provenance;
  return createHmac("sha256", key)
    .update(`${domain}\0${canonicalJson(copy)}`)
    .digest("hex");
}

function authenticateRecord(record, key, domain) {
  return {
    ...record,
    provenance: {
      algorithm: "hmac-sha256",
      digest: authenticatedDigest(record, key, domain),
    },
  };
}

function verifyAuthenticatedRecord(record, key, domain, label) {
  const expected = authenticatedDigest(record, key, domain);
  const actual = String(record?.provenance?.digest ?? "");
  if (
    record?.provenance?.algorithm !== "hmac-sha256" ||
    !HEX_64.test(actual) ||
    !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"))
  ) {
    throw new Error(`${label} is unauthenticated or tampered; manual review is required.`);
  }
  return record;
}

function validateLockRecord(value, label, kind) {
  if (
    value?.schemaVersion !== 1 ||
    value.owner !== OWNER ||
    value.kind !== kind ||
    typeof value.transactionId !== "string" ||
    !SAFE_IDENTIFIER.test(value.transactionId) ||
    typeof value.token !== "string" ||
    !SAFE_IDENTIFIER.test(value.token) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.processInstance !== "string" ||
    !value.processInstance
  ) {
    throw new Error(`${label} is invalid; manual review is required.`);
  }
  return value;
}

async function writeOwnedLock(lockPath, record, key, domain) {
  await writeFile(
    lockPath,
    canonicalJson(authenticateRecord(record, key, domain)),
    { flag: "wx", mode: 0o600 },
  );
}

async function acquireLock(homeDir, transactionId) {
  const { lock } = transactionPaths(homeDir, transactionId);
  await ensureDirectory(homeDir, path.dirname(lock));
  const key = await keyFor(homeDir);
  await recoverReleasedLockClaims(
    lock,
    key,
    "global-skill-transaction",
    "global-skill-transaction-lock",
    "Third-party transaction lock",
  );
  const token = randomUUID();
  const processInstance = await readProcessInstance(process.pid);
  if (!processInstance) throw new Error("Cannot establish the current process instance for the third-party transaction lock.");
  try {
    await writeOwnedLock(lock, {
      schemaVersion: 1,
      owner: OWNER,
      kind: "global-skill-transaction",
      transactionId,
      pid: process.pid,
      processInstance,
      token,
    }, key, "global-skill-transaction-lock");
  }
  catch (error) { if (error?.code === "EEXIST") throw new Error("A third-party transaction is already in progress; recover it first."); throw error; }
  return { path: lock, transactionId, token, processInstance, key, kind: "global-skill-transaction", domain: "global-skill-transaction-lock" };
}

async function readOwnedLock(lockPath, label, key, kind, domain) {
  const details = await lstat(lockPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`${label} is unsafe.`);
  const value = verifyAuthenticatedRecord(
    JSON.parse(await readFile(lockPath, "utf8")),
    key,
    domain,
    label,
  );
  return validateLockRecord(value, label, kind);
}

async function restoreRegularFileClaimCreateOnly(claim, target, label) {
  if (await exists(target)) return false;
  const claimed = await readOptionalRegularFile(claim, `${label} claim`);
  if (!claimed.exists) return false;
  try {
    await createAtomicFile(target, claimed.bytes);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function removeEmptyLockClaimDirectory(claimDirectory) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rmdir(claimDirectory);
      return;
    } catch (error) {
      if (
        (error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") ||
        attempt >= LOCK_CLAIM_DIRECTORY_REMOVE_RETRIES
      ) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, LOCK_CLAIM_DIRECTORY_REMOVE_RETRY_DELAY_MS);
      });
    }
  }
}

async function recoverReleasedLockClaims(lockPath, key, kind, domain, label) {
  if (await exists(lockPath)) return false;
  const parent = path.dirname(lockPath);
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const prefix = `${path.basename(lockPath)}.release-`;
  let recovered = false;
  for (const entry of entries.filter((item) => item.name.startsWith(prefix))) {
    const claimDirectory = path.join(parent, entry.name);
    assertInside(parent, claimDirectory, `${label} release claim`);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`${label} release claim is unsafe; manual review is required.`);
    }
    const claimEntries = await readdir(claimDirectory, {
      withFileTypes: true,
    });
    if (
      claimEntries.length !== 1 ||
      claimEntries[0].name !== "lock" ||
      !claimEntries[0].isFile() ||
      claimEntries[0].isSymbolicLink()
    ) {
      throw new Error(`${label} release claim contains unrecognized data; manual review is required.`);
    }
    const claim = path.join(claimDirectory, "lock");
    await readOwnedLock(claim, `${label} release claim`, key, kind, domain);
    await rm(claim);
    await removeEmptyLockClaimDirectory(claimDirectory);
    recovered = true;
  }
  return recovered;
}

async function releaseLock(
  lock,
  label,
  { faultInjector = null, phase = "after-lock-claim" } = {},
) {
  const claimDirectory = `${lock.path}.release-${randomUUID()}`;
  assertInside(path.dirname(lock.path), claimDirectory, `${label} release claim`);
  await mkdir(claimDirectory, { mode: 0o700 });
  const claim = path.join(claimDirectory, "lock");
  try {
    await rename(lock.path, claim);
    const current = await readOwnedLock(
      claim,
      `${label} release claim`,
      lock.key,
      lock.kind,
      lock.domain,
    );
    if (
      current.transactionId !== lock.transactionId ||
      current.token !== lock.token ||
      current.processInstance !== lock.processInstance
    ) {
      await restoreRegularFileClaimCreateOnly(claim, lock.path, label);
      throw new Error(`${label} ownership changed; refusing cleanup.`);
    }
    await faultInjector?.(phase, {
      lockPath: lock.path,
      claimPath: claim,
    });
    await rm(claim);
    await removeEmptyLockClaimDirectory(claimDirectory);
  } catch (error) {
    if (error?.leaveLockClaimForRecovery === true) throw error;
    if (await exists(claim)) {
      await restoreRegularFileClaimCreateOnly(claim, lock.path, label);
    }
    throw error;
  }
}

function targetReservationBytes(record, journal, key) {
  return Buffer.from(canonicalJson(authenticateRecord({
    schemaVersion: 1,
    owner: OWNER,
    kind: "third-party-skill-target-reservation",
    transactionId: journal.id,
    target: record.path,
    token: record.reservation.token,
  }, key, "third-party-skill-target-reservation")));
}

async function readExactRegularFile(target, expectedBytes, label) {
  const current = await readOptionalRegularFile(target, label);
  return current.exists && current.bytes.equals(expectedBytes);
}

async function assertJournalTree(
  target,
  expected,
  label,
  options = {},
) {
  const snapshot = await snapshotManagedThirdPartyTree(target, options);
  if (!sameTreeInventory(snapshot, expected)) {
    throw new Error(`${label} changed outside the authenticated transaction; manual review is required.`);
  }
  return snapshot;
}

async function restoreClaimedTreeCreateOnly(record, label) {
  if (!record.previous.exists || !(await exists(record.backup))) return;
  if (await exists(record.path)) {
    throw new Error(`${label} cannot restore over an existing target: ${record.path}`);
  }
  await assertJournalTree(
    record.backup,
    record.previous,
    `${label} previous claim`,
  );
  await mkdir(record.path, { mode: 0o700 });
  try {
    await snapshotThirdPartyTree(record.backup, {
      copyTo: record.path,
      ignoreDefaultDirectories: false,
    });
    await assertJournalTree(
      record.path,
      record.previous,
      `${label} restored target`,
    );
  } catch (error) {
    throw new Error(
      `${label} restoration failed closed; the previous claim and any partial target were preserved.`,
      { cause: error },
    );
  }
}

async function verifyForwardTargetClaim({
  record,
  claimedRoot,
  staged,
  journal,
  key,
  label,
}) {
  const markerBytes = targetReservationBytes(record, journal, key);
  const liveMarker = path.join(claimedRoot, record.reservation.markerName);
  const markerInClaim = await readExactRegularFile(
    liveMarker,
    markerBytes,
    `${label} reservation marker`,
  );
  const markerWasClaimed = await readExactRegularFile(
    record.reservation.claim,
    markerBytes,
    `${label} reservation marker claim`,
  );
  if (!markerInClaim && !markerWasClaimed) {
    throw new Error(`${label} has no authenticated reservation marker; manual review is required.`);
  }
  const claimed = await snapshotManagedThirdPartyTree(claimedRoot, {
    ignoreRelativePaths: markerInClaim
      ? [record.reservation.markerName]
      : [],
  });
  const valid = markerInClaim
    ? treeInventoryIsSubset(claimed, staged)
    : sameTreeInventory(claimed, staged);
  if (!valid) {
    throw new Error(`${label} contains data outside the authenticated staged tree; manual review is required.`);
  }
}

async function removeForwardTargetForRollback({
  record,
  journal,
  key,
  label,
}) {
  const staged = await assertJournalTree(
    record.staged,
    record.next,
    `${label} staged tree`,
  );
  let claimedRoot = record.discard;
  if (!(await exists(claimedRoot))) {
    if (!(await exists(record.path))) return;
    const markerBytes = targetReservationBytes(record, journal, key);
    const liveMarker = path.join(record.path, record.reservation.markerName);
    const markerInTarget = await readExactRegularFile(
      liveMarker,
      markerBytes,
      `${label} reservation marker`,
    );
    const markerWasClaimed = await readExactRegularFile(
      record.reservation.claim,
      markerBytes,
      `${label} reservation marker claim`,
    );
    if (!markerInTarget && !markerWasClaimed) {
      throw new Error(`${label} target collision is not transaction-owned; refusing rollback.`);
    }
    await mkdir(path.dirname(claimedRoot), {
      recursive: true,
      mode: 0o700,
    });
    if (await exists(claimedRoot)) {
      throw new Error(`${label} rollback claim already exists; manual review is required.`);
    }
    await rename(record.path, claimedRoot);
  } else if (await exists(record.path)) {
    throw new Error(`${label} target and rollback claim both exist; manual review is required.`);
  }
  await verifyForwardTargetClaim({
    record,
    claimedRoot,
    staged,
    journal,
    key,
    label,
  });
  await rm(claimedRoot, { recursive: true });
}

async function activateThirdPartyTarget({
  record,
  journal,
  locations,
  key,
  root,
  label,
  faultInjector,
  faultId,
  installedPhase,
}) {
  record.phase = "claiming-previous";
  await writeJournal(locations.journal, journal, key);
  if (record.previous.exists) {
    if (await exists(record.backup)) {
      throw new Error(`${label} previous claim already exists; manual review is required.`);
    }
    await rename(record.path, record.backup);
    await assertJournalTree(
      record.backup,
      record.previous,
      `${label} previous claim`,
    );
  }
  record.phase = "previous-claimed";
  await writeJournal(locations.journal, journal, key);
  await faultInjector?.(`after-target-claim:${faultId}`, {
    target: record.path,
    previousClaim: record.backup,
  });

  record.phase = "reserving";
  await writeJournal(locations.journal, journal, key);
  await faultInjector?.(`before-target-reserve:${faultId}`, {
    target: record.path,
  });
  await ensureDirectory(root, path.dirname(record.path));
  await mkdir(record.path, { mode: 0o700 });
  const markerBytes = targetReservationBytes(record, journal, key);
  const markerPath = path.join(
    record.path,
    record.reservation.markerName,
  );
  await createAtomicFile(markerPath, markerBytes);
  record.phase = "reserved";
  await writeJournal(locations.journal, journal, key);
  await faultInjector?.(`mid-publish:${faultId}`, {
    target: record.path,
    markerPath,
  });

  record.phase = "populating";
  await writeJournal(locations.journal, journal, key);
  await snapshotThirdPartyTree(record.staged, {
    copyTo: record.path,
    ignoreDefaultDirectories: false,
  });
  await assertJournalTree(
    record.path,
    record.next,
    `${label} populated target`,
    { ignoreRelativePaths: [record.reservation.markerName] },
  );
  record.phase = "content-verified";
  await writeJournal(locations.journal, journal, key);

  await mkdir(path.dirname(record.reservation.claim), {
    recursive: true,
    mode: 0o700,
  });
  if (await exists(record.reservation.claim)) {
    throw new Error(`${label} marker claim already exists; manual review is required.`);
  }
  await rename(markerPath, record.reservation.claim);
  if (!(await readExactRegularFile(
    record.reservation.claim,
    markerBytes,
    `${label} reservation marker claim`,
  ))) {
    throw new Error(`${label} reservation marker changed during publish; manual review is required.`);
  }
  await assertJournalTree(
    record.path,
    record.next,
    `${label} published target`,
  );
  record.phase = "published";
  record.installed = true;
  await writeJournal(locations.journal, journal, key);
  await faultInjector?.(installedPhase, {
    target: record.path,
    markerClaim: record.reservation.claim,
  });
}

async function recoverThirdPartyTarget({
  record,
  journal,
  locations,
  key,
  root,
  label,
}) {
  if (
    journal.schemaVersion !== 2 ||
    !record ||
    !TARGET_TRANSACTION_PHASES.has(record.phase) ||
    typeof record.path !== "string" ||
    typeof record.staged !== "string" ||
    typeof record.discard !== "string" ||
    typeof record.previous?.exists !== "boolean" ||
    !HEX_64.test(String(record.next?.treeSha256 ?? "")) ||
    !HEX_64.test(String(record.next?.inventorySha256 ?? "")) ||
    !Array.isArray(record.next?.directories) ||
    !Array.isArray(record.next?.files) ||
    typeof record.reservation?.markerName !== "string" ||
    !SAFE_IDENTIFIER.test(record.reservation.markerName) ||
    typeof record.reservation?.token !== "string" ||
    !SAFE_IDENTIFIER.test(record.reservation.token) ||
    typeof record.reservation?.claim !== "string"
  ) {
    throw new Error(`${label} transaction lacks atomic-claim recovery metadata; manual review is required.`);
  }
  if (
    record.previous.exists &&
    (
      typeof record.backup !== "string" ||
      !HEX_64.test(String(record.previous.treeSha256 ?? "")) ||
      !HEX_64.test(String(record.previous.inventorySha256 ?? "")) ||
      !Array.isArray(record.previous.directories) ||
      !Array.isArray(record.previous.files)
    )
  ) {
    throw new Error(`${label} previous-tree recovery metadata is invalid; manual review is required.`);
  }
  assertInside(root, record.path, `${label} target`);
  assertInside(locations.directory, record.staged, `${label} staged tree`);
  assertInside(locations.directory, record.discard, `${label} rollback claim`);
  if (record.backup) {
    assertInside(locations.directory, record.backup, `${label} previous claim`);
  }
  assertInside(
    locations.directory,
    record.reservation.claim,
    `${label} reservation marker claim`,
  );

  if (record.phase === "prepared") {
    return;
  }
  if (record.phase === "claiming-previous") {
    if (record.previous.exists && await exists(record.backup)) {
      if (await exists(record.path)) {
        throw new Error(`${label} changed while claiming the previous target; manual review is required.`);
      }
      record.phase = "restoring-previous";
      await writeJournal(locations.journal, journal, key);
      await restoreClaimedTreeCreateOnly(record, label);
      record.phase = "restored";
      await writeJournal(locations.journal, journal, key);
    } else if (record.previous.exists) {
      await assertJournalTree(
        record.path,
        record.previous,
        `${label} unchanged previous target`,
      );
    } else if (await exists(record.path)) {
      throw new Error(`${label} target collision occurred while claiming an absent target; refusing overwrite.`);
    }
    return;
  }
  if (record.phase === "previous-claimed") {
    if (await exists(record.path)) {
      throw new Error(`${label} target collision occurred before reservation; refusing overwrite.`);
    }
  } else if (record.phase === "restoring-previous") {
    if (record.previous.exists && await exists(record.path)) {
      await assertJournalTree(
        record.path,
        record.previous,
        `${label} restored target`,
      );
      record.phase = "restored";
      await writeJournal(locations.journal, journal, key);
      return;
    }
  } else if (record.phase === "restored") {
    if (record.previous.exists) {
      await assertJournalTree(
        record.path,
        record.previous,
        `${label} restored target`,
      );
    } else if (await exists(record.path)) {
      throw new Error(`${label} unexpectedly exists after rollback; manual review is required.`);
    }
    return;
  } else {
    await removeForwardTargetForRollback({
      record,
      journal,
      key,
      label,
    });
  }

  if (record.previous.exists) {
    record.phase = "restoring-previous";
    await writeJournal(locations.journal, journal, key);
    await restoreClaimedTreeCreateOnly(record, label);
  } else if (await exists(record.path)) {
    throw new Error(`${label} target appeared during rollback; refusing overwrite.`);
  }
  record.phase = "restored";
  await writeJournal(locations.journal, journal, key);
}

async function recoverGlobalTransactionDirectory({ homeDir, locations, key, ownedLock = null }) {
  if (!(await exists(locations.directory))) return false;
  if (!(await exists(locations.journal))) {
    if (!ownedLock || ownedLock.transactionId !== path.basename(locations.directory)) {
      throw new Error("Third-party transaction residue has no authenticated journal; manual review is required.");
    }
    await rm(locations.directory, { recursive: true, force: true });
    return true;
  }
  const journal = await readJournal(locations.journal, key);
  if (
    journal.owner !== OWNER ||
    journal.id !== path.basename(locations.directory) ||
    !Array.isArray(journal.targets)
  ) {
    throw new Error("Third-party transaction journal is invalid.");
  }
  const ownershipRecovery = await classifyOwnershipRecovery(
    journal,
    homeDir,
    "Third-party ownership",
  );
  if (journal.state === "committed" && ownershipRecovery?.state !== "next") {
    throw new Error("Committed third-party ownership does not match its authenticated transaction.");
  }
  if (journal.state !== "committed") {
    for (const target of [...journal.targets].reverse()) {
      await recoverThirdPartyTarget({
        record: target,
        journal,
        locations,
        key,
        root: homeDir,
        label: "Third-party global Skill",
      });
    }
    await restoreOwnershipAfterRollback(
      journal,
      ownershipRecovery,
      "Third-party ownership",
    );
  }
  await rm(locations.directory, { recursive: true, force: true });
  return true;
}

async function recoverOwnedThirdPartyTransaction({ homeDir, lock }) {
  const current = await readOwnedLock(
    lock.path,
    "Third-party transaction lock",
    lock.key,
    lock.kind,
    lock.domain,
  );
  if (
    current.transactionId !== lock.transactionId ||
    current.token !== lock.token ||
    current.processInstance !== lock.processInstance
  ) {
    throw new Error("Third-party transaction lock ownership changed; refusing owned recovery.");
  }
  const locations = transactionPaths(homeDir, lock.transactionId);
  const recovered = await recoverGlobalTransactionDirectory({
    homeDir,
    locations,
    key: lock.key,
    ownedLock: lock,
  });
  await releaseLock(lock, "Third-party transaction lock");
  return { status: recovered ? "rolled-back" : "unchanged" };
}

/** Recover interrupted atomic global-skill bundle installations. */
export async function recoverThirdPartyTransactions({
  homeDir,
  processAlive = defaultProcessAlive,
}) {
  await assertRealDirectory(homeDir, "User home");
  const probe = transactionPaths(homeDir, "placeholder");
  const rootExists = await exists(probe.root);
  const lockExists = await exists(probe.lock);
  if (!rootExists && !lockExists && !(await exists(probe.key))) {
    return { status: "unchanged" };
  }
  const key = await keyFor(homeDir, { create: false });
  const releasedClaimRecovered = !lockExists && await recoverReleasedLockClaims(
    probe.lock,
    key,
    "global-skill-transaction",
    "global-skill-transaction-lock",
    "Third-party transaction lock",
  );
  if (!rootExists && !lockExists) {
    return { status: releasedClaimRecovered ? "rolled-back" : "unchanged" };
  }
  const heldLock = lockExists
    ? await readOwnedLock(
      probe.lock,
      "Third-party transaction lock",
      key,
      "global-skill-transaction",
      "global-skill-transaction-lock",
    )
    : null;
  if (heldLock && await processAlive(heldLock.pid, heldLock.processInstance)) {
    throw new Error("A third-party transaction lock belongs to a live process; refusing concurrent recovery.");
  }
  const entries = rootExists
    ? await readdir(probe.root, { withFileTypes: true })
    : [];
  if (heldLock && entries.length && !entries.some((entry) => entry.name === heldLock.transactionId)) {
    throw new Error("Third-party transaction lock does not bind transaction residue; manual review is required.");
  }
  let recovered = releasedClaimRecovered;
  const recoveredIds = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_IDENTIFIER.test(entry.name)) {
      throw new Error("Third-party transaction root contains unsafe residue.");
    }
    const locations = transactionPaths(homeDir, entry.name);
    if (await recoverGlobalTransactionDirectory({
      homeDir,
      locations,
      key,
      ownedLock: heldLock?.transactionId === entry.name ? heldLock : null,
    })) {
      recovered = true;
      recoveredIds.add(entry.name);
    }
  }
  if (heldLock) {
    if (entries.length && !recoveredIds.has(heldLock.transactionId)) {
      throw new Error("Third-party transaction lock does not bind recovered residue; manual review is required.");
    }
    const current = await readOwnedLock(
      probe.lock,
      "Third-party transaction lock",
      key,
      "global-skill-transaction",
      "global-skill-transaction-lock",
    );
    if (
      current.token !== heldLock.token ||
      current.transactionId !== heldLock.transactionId ||
      current.processInstance !== heldLock.processInstance
    ) {
      throw new Error("Third-party transaction lock ownership changed during recovery; refusing cleanup.");
    }
    await releaseLock({
      path: probe.lock,
      transactionId: heldLock.transactionId,
      token: heldLock.token,
      processInstance: heldLock.processInstance,
      key,
      kind: "global-skill-transaction",
      domain: "global-skill-transaction-lock",
    }, "Third-party transaction lock");
    recovered = true;
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
      ? await snapshotManagedThirdPartyTree(item.target)
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
    await link(stage, target);
    await rm(stage, { force: true });
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}

async function readOptionalRegularFile(target, label) {
  if (!(await exists(target))) return { exists: false, bytes: null };
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink > 1) {
    throw new Error(`${label} is unsafe.`);
  }
  return { exists: true, bytes: await readFile(target) };
}

async function claimRegularFileToPath(target, claim, expected, label) {
  await mkdir(path.dirname(claim), { recursive: true, mode: 0o700 });
  if (await exists(claim)) {
    throw new Error(`${label} claim already exists; manual review is required.`);
  }
  try {
    await rename(target, claim);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} disappeared before atomic claim; refusing replacement.`);
    }
    throw error;
  }
  const claimed = await readOptionalRegularFile(claim, `${label} claim`);
  if (!claimed.exists || !claimed.bytes.equals(expected.bytes)) {
    await restoreRegularFileClaimCreateOnly(claim, target, label);
    throw new Error(`${label} changed during atomic claim; manual review is required.`);
  }
  return claimed;
}

async function replaceAtomicFileCas(
  target,
  contents,
  expected,
  label,
  {
    claim = null,
    faultInjector = null,
    claimPhase = "after-ownership-claim",
  } = {},
) {
  const current = await readOptionalRegularFile(target, label);
  if (
    current.exists !== expected.exists ||
    (current.exists && !current.bytes.equals(expected.bytes))
  ) {
    throw new Error(`${label} changed before atomic replacement; refusing overwrite.`);
  }
  if (!expected.exists) {
    await createAtomicFile(target, contents);
    return;
  }
  if (!claim) {
    throw new Error(`${label} replacement requires an authenticated transaction claim.`);
  }
  await claimRegularFileToPath(target, claim, expected, label);
  await faultInjector?.(claimPhase, { target, claim });
  await createAtomicFile(target, contents);
}

function ownershipJournalRecord(
  target,
  previous,
  nextBytes,
  { claim, rollbackClaim },
) {
  return {
    path: target,
    claim: previous.exists ? claim : null,
    rollbackClaim,
    previous: {
      exists: previous.exists,
      sha256: previous.exists ? sha256(previous.bytes) : null,
      bytesBase64: previous.exists ? previous.bytes.toString("base64") : null,
    },
    next: {
      exists: true,
      sha256: sha256(nextBytes),
      bytesBase64: nextBytes.toString("base64"),
    },
  };
}

function decodeOwnershipJournalState(value, label) {
  if (
    !value ||
    typeof value.exists !== "boolean" ||
    (value.exists &&
      (
        !HEX_64.test(String(value.sha256 ?? "")) ||
        typeof value.bytesBase64 !== "string"
      )) ||
    (!value.exists && (value.sha256 !== null || value.bytesBase64 !== null))
  ) {
    throw new Error(`${label} is invalid; manual review is required.`);
  }
  if (!value.exists) return { exists: false, bytes: null };
  const bytes = Buffer.from(value.bytesBase64, "base64");
  if (sha256(bytes) !== value.sha256) {
    throw new Error(`${label} digest is invalid; manual review is required.`);
  }
  return { exists: true, bytes };
}

async function classifyOwnershipRecovery(journal, root, label) {
  if (!journal.ownership) return null;
  assertInside(root, journal.ownership.path, `${label} path`);
  const previous = decodeOwnershipJournalState(
    journal.ownership.previous,
    `${label} previous state`,
  );
  const next = decodeOwnershipJournalState(
    journal.ownership.next,
    `${label} next state`,
  );
  if (
    (previous.exists && typeof journal.ownership.claim !== "string") ||
    (!previous.exists && journal.ownership.claim !== null) ||
    typeof journal.ownership.rollbackClaim !== "string"
  ) {
    throw new Error(`${label} claim metadata is invalid; manual review is required.`);
  }
  if (previous.exists) {
    assertInside(root, journal.ownership.claim, `${label} previous claim`);
  }
  assertInside(root, journal.ownership.rollbackClaim, `${label} rollback claim`);
  const current = await readOptionalRegularFile(journal.ownership.path, label);
  const matches = (expected) =>
    current.exists === expected.exists &&
    (!current.exists || current.bytes.equals(expected.bytes));
  const previousClaim = previous.exists
    ? await readOptionalRegularFile(
      journal.ownership.claim,
      `${label} previous claim`,
    )
    : { exists: false, bytes: null };
  if (
    previousClaim.exists &&
    !previousClaim.bytes.equals(previous.bytes)
  ) {
    throw new Error(`${label} previous claim drifted; manual review is required.`);
  }
  const rollbackClaim = await readOptionalRegularFile(
    journal.ownership.rollbackClaim,
    `${label} rollback claim`,
  );
  if (
    rollbackClaim.exists &&
    !rollbackClaim.bytes.equals(next.bytes)
  ) {
    throw new Error(`${label} rollback claim drifted; manual review is required.`);
  }
  if (matches(previous)) {
    return {
      state: rollbackClaim.exists ? "restored" : "previous",
      previous,
      next,
      current,
      previousClaim,
      rollbackClaim,
    };
  }
  if (matches(next)) {
    if (rollbackClaim.exists || (previous.exists && !previousClaim.exists)) {
      throw new Error(`${label} claim topology is inconsistent; manual review is required.`);
    }
    return {
      state: "next",
      previous,
      next,
      current,
      previousClaim,
      rollbackClaim,
    };
  }
  if (
    !current.exists &&
    rollbackClaim.exists &&
    (!previous.exists || previousClaim.exists)
  ) {
    return {
      state: "next-claimed",
      previous,
      next,
      current,
      previousClaim,
      rollbackClaim,
    };
  }
  if (!current.exists && previous.exists && previousClaim.exists) {
    return {
      state: "previous-claimed",
      previous,
      next,
      current,
      previousClaim,
      rollbackClaim,
    };
  }
  throw new Error(`${label} drifted outside the authenticated transaction; manual review is required.`);
}

async function restoreOwnershipAfterRollback(journal, recovery, label) {
  if (!recovery || ["previous", "restored"].includes(recovery.state)) return;
  if (recovery.state === "next") {
    await claimRegularFileToPath(
      journal.ownership.path,
      journal.ownership.rollbackClaim,
      recovery.next,
      label,
    );
  }
  if (recovery.previous.exists) {
    if (!(await readExactRegularFile(
      journal.ownership.claim,
      recovery.previous.bytes,
      `${label} previous claim`,
    ))) {
      throw new Error(`${label} previous claim is missing; manual review is required.`);
    }
    if (await exists(journal.ownership.path)) {
      throw new Error(`${label} changed before rollback restore; manual review is required.`);
    }
    await createAtomicFile(
      journal.ownership.path,
      recovery.previous.bytes,
    );
  } else if (await exists(journal.ownership.path)) {
    throw new Error(`${label} changed before rollback cleanup; manual review is required.`);
  }
}

function normalizeApprovalRecord(
  approvals,
  manifest,
  sourceManifestSha256,
  { approvalPlan },
) {
  if (!approvalPlan) {
    throw new Error("Third-party approvals require the authoritative displayed approval plan.");
  }
  if (!approvals || approvals.sourceManifestSha256 !== sourceManifestSha256) {
    throw new Error("Third-party approvals do not match the pinned source manifest.");
  }
  if (
    !HEX_64.test(String(approvals.planSha256 ?? "")) ||
    !approvals.planEvidence ||
    sha256(canonicalJson(approvals.planEvidence)) !== approvals.planSha256
  ) {
    throw new Error("Third-party approvals do not carry an intact canonical plan binding.");
  }
  if (
    approvals.planEvidence.sourceManifestSha256 !== sourceManifestSha256 ||
    approvals.planEvidence.strictDataBoundary !==
      Boolean(approvals.planEvidence.strictDataBoundary) ||
    !Array.isArray(approvals.planEvidence.blockedCandidateIds) ||
    !Array.isArray(approvals.planEvidence.groups)
  ) {
    throw new Error("Third-party approval plan evidence is incomplete or invalid.");
  }
  validateApprovalPlanDigest(approvalPlan);
  if (
    approvals.planSha256 !== approvalPlan.planSha256 ||
    canonicalJson(approvals.planEvidence) !==
      canonicalJson(approvalPlanEvidence(approvalPlan))
  ) {
    throw new Error("Third-party approvals differ from the authoritative displayed plan.");
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
    if (approvals.planEvidence.blockedCandidateIds.includes(id)) {
      throw new Error(`Approved action ${id} was blocked by the displayed approval plan.`);
    }
    const missingDependencies = candidates
      .get(id)
      .dependencies.filter(
        (dependency) =>
          !approvedActionIds.includes(dependency) &&
          !planHasExactCandidate(approvalPlan, dependency),
      );
    if (missingDependencies.length) {
      throw new Error(`Approved action ${id} lacks explicitly approved dependencies: ${missingDependencies.sort().join(", ")}.`);
    }
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
    planSha256: approvals.planSha256,
    planEvidence: structuredClone(approvals.planEvidence),
    selections,
    approvedActionIds,
    skipped,
  };
  assertSecretFree(record);
  return record;
}

function approvalDecisionRecord(receipt) {
  const decision = structuredClone(receipt);
  delete decision.audit;
  delete decision.provenance;
  return decision;
}

function signApprovalReceipt(record, key, { sequence, previousSha256 }) {
  const decisionSha256 = sha256(canonicalJson(record));
  const unsigned = {
    ...structuredClone(record),
    audit: {
      schemaVersion: 1,
      sequence,
      previousSha256,
      decisionSha256,
    },
  };
  return authenticateRecord(unsigned, key, "approval-receipt");
}

function verifyApprovalReceipt(receipt, key, label) {
  verifyAuthenticatedRecord(receipt, key, "approval-receipt", label);
  if (
    receipt.audit?.schemaVersion !== 1 ||
    !Number.isSafeInteger(receipt.audit.sequence) ||
    receipt.audit.sequence <= 0 ||
    (
      receipt.audit.previousSha256 !== null &&
      !HEX_64.test(String(receipt.audit.previousSha256 ?? ""))
    ) ||
    !HEX_64.test(String(receipt.audit.decisionSha256 ?? ""))
  ) {
    throw new Error(`${label} has invalid chain metadata; manual review is required.`);
  }
  const decision = approvalDecisionRecord(receipt);
  if (sha256(canonicalJson(decision)) !== receipt.audit.decisionSha256) {
    throw new Error(`${label} decision digest is invalid; manual review is required.`);
  }
  assertSecretFree(decision, label);
  return { receipt, decision };
}

async function inspectApprovalReceipts(
  directory,
  {
    key = null,
    currentDecisionSha256 = null,
  } = {},
) {
  if (!(await exists(directory))) {
    return {
      unchanged: false,
      currentPath: null,
      chainHeadSha256: null,
      nextSequence: 1,
    };
  }
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Third-party approval receipt directory is unsafe.");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length && !key) {
    throw new Error("Third-party approval receipt authentication key is required.");
  }
  const receipts = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/i.test(entry.name)) {
      throw new Error("Third-party approval receipt directory contains unsafe or unknown content.");
    }
    const target = path.join(directory, entry.name);
    const existing = await readCanonicalPinnedJson(target, "Pinned third-party approval receipt", (value) => value);
    const expectedName = `${sha256(canonicalJson(existing))}.json`;
    if (entry.name.toLowerCase() !== expectedName) {
      throw new Error("Pinned third-party approval receipt filename does not match its canonical content digest; refusing unsafe audit history.");
    }
    const verified = verifyApprovalReceipt(
      existing,
      key,
      "Pinned third-party approval receipt",
    );
    receipts.push({
      ...verified,
      target,
      contentSha256: entry.name.slice(0, -5).toLowerCase(),
    });
  }
  receipts.sort((left, right) =>
    left.receipt.audit.sequence - right.receipt.audit.sequence);
  for (let index = 0; index < receipts.length; index += 1) {
    const current = receipts[index];
    const expectedSequence = index + 1;
    const expectedPrevious = index === 0
      ? null
      : receipts[index - 1].contentSha256;
    if (
      current.receipt.audit.sequence !== expectedSequence ||
      current.receipt.audit.previousSha256 !== expectedPrevious
    ) {
      throw new Error("Pinned third-party approval receipt chain is incomplete, reordered, or replayed.");
    }
  }
  const matching = currentDecisionSha256
    ? receipts.find((entry) =>
      entry.receipt.audit.decisionSha256 === currentDecisionSha256)
    : null;
  return {
    unchanged: Boolean(matching),
    currentPath: matching?.target ?? null,
    chainHeadSha256: receipts.at(-1)?.contentSha256 ?? null,
    nextSequence: receipts.length + 1,
  };
}

function validateApprovalReceiptLock(record, label) {
  validateLockRecord(record, label, "approval-receipts");
  if (
    !HEX_64.test(String(record.sourceManifestSha256 ?? "")) ||
    !HEX_64.test(String(record.approvalReceiptSha256 ?? ""))
  ) {
    throw new Error(`${label} lacks pinned receipt digests; manual review is required.`);
  }
  return record;
}

async function validateStaleApprovalReceiptState(homeDir, stale, key) {
  const directory = homePath(homeDir, ".agents/harness", "Third-party approval directory");
  const sourceTarget = path.join(directory, "third-party-sources.json");
  const approvalDirectory = path.join(directory, "third-party-approvals");
  let sourcePresent = false;
  if (await exists(sourceTarget)) {
    const source = await readCanonicalPinnedJson(
      sourceTarget,
      "Pinned third-party source manifest",
      validateThirdPartySourceManifest,
    );
    if (sha256(canonicalJson(source)) !== stale.sourceManifestSha256) {
      throw new Error("A stale approval lock does not match the canonical source manifest; manual review is required.");
    }
    sourcePresent = true;
  }
  const {
    unchanged: receiptPresent,
    currentPath: approvalTarget,
  } = await inspectApprovalReceipts(
    approvalDirectory,
    {
      key,
      currentDecisionSha256: stale.approvalReceiptSha256,
    },
  );
  if (receiptPresent) {
    const signedReceipt = await readCanonicalPinnedJson(
      approvalTarget,
      "Pinned third-party approval receipt",
      (value) => value,
    );
    const { decision: receipt } = verifyApprovalReceipt(
      signedReceipt,
      key,
      "Pinned third-party approval receipt",
    );
    if (receipt.sourceManifestSha256 !== stale.sourceManifestSha256) {
      throw new Error("A stale approval receipt does not match its source manifest; manual review is required.");
    }
  }
  if (receiptPresent && !sourcePresent) {
    throw new Error("A stale approval receipt exists without its pinned source manifest; manual review is required.");
  }
}

async function acquireApprovalReceiptLock(
  homeDir,
  {
    sourceManifestSha256,
    approvalReceiptSha256,
    processAlive = defaultProcessAlive,
  },
) {
  const lock = homePath(homeDir, ".agents/harness/third-party-approvals.lock", "Third-party approval receipt lock");
  await ensureDirectory(homeDir, path.dirname(lock));
  const key = await keyFor(homeDir);
  await recoverReleasedLockClaims(
    lock,
    key,
    "approval-receipts",
    "approval-receipt-lock",
    "Third-party approval receipt lock",
  );
  const token = randomUUID();
  const processInstance = await readProcessInstance(process.pid);
  if (!processInstance) throw new Error("Cannot establish the current process instance for the approval receipt lock.");
  const record = {
    schemaVersion: 1,
    owner: OWNER,
    kind: "approval-receipts",
    transactionId: "approval-receipts",
    pid: process.pid,
    processInstance,
    token,
    sourceManifestSha256,
    approvalReceiptSha256,
  };
  try {
    await writeOwnedLock(lock, record, key, "approval-receipt-lock");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let stale;
    try {
      stale = validateApprovalReceiptLock(
        await readOwnedLock(
          lock,
          "Third-party approval receipt lock",
          key,
          "approval-receipts",
          "approval-receipt-lock",
        ),
        "Third-party approval receipt lock",
      );
    } catch (lockError) {
      throw new Error(
        "A third-party approval receipt may be being recorded, but its lock is unsafe; manual review is required.",
        { cause: lockError },
      );
    }
    if (await processAlive(stale.pid, stale.processInstance)) {
      throw new Error("A third-party approval receipt is being recorded by a live process; refusing concurrent recovery.");
    }
    await validateStaleApprovalReceiptState(homeDir, stale, key);
    const staleClaim = `${lock}.stale-${randomUUID()}`;
    assertInside(path.dirname(lock), staleClaim, "Stale approval receipt lock claim");
    try {
      await rename(lock, staleClaim);
    } catch (renameError) {
      if (renameError?.code === "ENOENT") {
        throw new Error("Another process claimed the stale approval receipt lock.");
      }
      throw renameError;
    }
    const claimedStale = validateApprovalReceiptLock(
      await readOwnedLock(
        staleClaim,
        "Stale third-party approval receipt lock claim",
        key,
        "approval-receipts",
        "approval-receipt-lock",
      ),
      "Stale third-party approval receipt lock claim",
    );
    if (
      claimedStale.token !== stale.token ||
      claimedStale.processInstance !== stale.processInstance ||
      claimedStale.sourceManifestSha256 !== stale.sourceManifestSha256 ||
      claimedStale.approvalReceiptSha256 !== stale.approvalReceiptSha256
    ) {
      await restoreRegularFileClaimCreateOnly(
        staleClaim,
        lock,
        "Third-party approval receipt lock",
      );
      throw new Error("The stale approval receipt lock changed during atomic claim; manual review is required.");
    }
    try {
      await writeOwnedLock(lock, record, key, "approval-receipt-lock");
    } catch (writeError) {
      await rm(staleClaim, { force: true });
      if (writeError?.code === "EEXIST") {
        throw new Error("Another process acquired the approval receipt lock during recovery.");
      }
      throw writeError;
    }
    await rm(staleClaim, { force: true });
  }
  return {
    path: lock,
    transactionId: "approval-receipts",
    token,
    processInstance,
    key,
    kind: "approval-receipts",
    domain: "approval-receipt-lock",
  };
}

/**
 * Read-only conflict check for a global third-party decision. Call this before
 * any source acquisition, host CLI command, or managed Skill mutation.
 */
export async function preflightThirdPartyGlobalApproval({
  homeDir,
  manifest: suppliedManifest,
  manifestPath,
  approvals,
  approvalPlan,
  repoRoot,
  strictDataBoundary,
}) {
  if (!approvalPlan || !repoRoot || typeof strictDataBoundary !== "boolean") {
    throw new Error("Third-party approval requires an authoritative plan, repoRoot, and explicit boolean strictDataBoundary.");
  }
  await assertRealDirectory(homeDir, "User home");
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  await verifyThirdPartyApprovalPlanForOperation({
    approvalPlan,
    homeDir,
    manifest: loaded.manifest,
    manifestSha256: loaded.manifestSha256,
    repoRoot,
    strictDataBoundary,
  });
  const record = normalizeApprovalRecord(
    approvals,
    loaded.manifest,
    loaded.manifestSha256,
    { approvalPlan },
  );
  const directory = homePath(homeDir, ".agents/harness", "Third-party approval directory");
  const sourceTarget = path.join(directory, "third-party-sources.json");
  const legacyApprovalTarget = path.join(directory, "third-party-approvals.json");
  const approvalDirectory = path.join(directory, "third-party-approvals");
  const sourceBytes = canonicalJson(loaded.manifest);
  assertSecretFree(loaded.manifest, "Pinned third-party source manifest");
  const approvalBytes = canonicalJson(record);
  const approvalDecisionSha256 = sha256(approvalBytes);
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
  const receiptKey = await exists(approvalDirectory)
    ? await keyFor(homeDir, { create: false })
    : null;
  const receiptState = await inspectApprovalReceipts(approvalDirectory, {
    key: receiptKey,
    currentDecisionSha256: approvalDecisionSha256,
  });
  const approvalTarget = receiptState.currentPath ??
    path.join(approvalDirectory, `${approvalDecisionSha256}.pending`);
  return {
    loaded,
    record,
    sourceTarget,
    approvalTarget,
    approvalDirectory,
    sourceBytes,
    approvalBytes,
    sourceUnchanged,
    approvalUnchanged: receiptState.unchanged,
    approvalDecisionSha256,
    receiptState,
  };
}

/**
 * Persist an explicit global third-party decision, including a complete reject
 * decision. This records only candidate ids and public source fingerprints;
 * credentials and provider configuration are intentionally out of scope.
 */
export async function recordThirdPartyGlobalApproval(input) {
  const initialPreflight = await preflightThirdPartyGlobalApproval(input);
  const lock = await acquireApprovalReceiptLock(input.homeDir, {
    sourceManifestSha256: initialPreflight.loaded.manifestSha256,
    approvalReceiptSha256: initialPreflight.approvalDecisionSha256,
    processAlive: input.processAlive,
  });
  let preserveLock = false;
  try {
    await input.faultInjector?.("after-approval-lock", {
      sourceTarget: initialPreflight.sourceTarget,
      approvalTarget: initialPreflight.approvalTarget,
    });
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
      receiptState,
    } = preflight;
    let finalApprovalTarget = approvalTarget;
    let finalApprovalBytes = approvalBytes;
    if (!approvalUnchanged) {
      const signedReceipt = signApprovalReceipt(preflight.record, lock.key, {
        sequence: receiptState.nextSequence,
        previousSha256: receiptState.chainHeadSha256,
      });
      finalApprovalBytes = canonicalJson(signedReceipt);
      finalApprovalTarget = path.join(
        approvalDirectory,
        `${sha256(finalApprovalBytes)}.json`,
      );
    }
    await ensureDirectory(input.homeDir, path.dirname(sourceTarget));
    await ensureDirectory(input.homeDir, approvalDirectory);
    if (!sourceUnchanged) {
      await input.faultInjector?.("before-source-manifest-write", {
        sourceTarget,
        approvalTarget: finalApprovalTarget,
      });
      await createAtomicFile(sourceTarget, sourceBytes);
    }
    await input.faultInjector?.("after-source-manifest", {
      sourceTarget,
      approvalTarget: finalApprovalTarget,
    });
    if (!approvalUnchanged) {
      await input.faultInjector?.("before-approval-receipt-write", {
        sourceTarget,
        approvalTarget: finalApprovalTarget,
      });
      await createAtomicFile(finalApprovalTarget, finalApprovalBytes);
    }
    await input.faultInjector?.("after-approval-receipt", {
      sourceTarget,
      approvalTarget: finalApprovalTarget,
    });
    const committedReceipts = await inspectApprovalReceipts(
      approvalDirectory,
      {
        key: lock.key,
        currentDecisionSha256: preflight.approvalDecisionSha256,
      },
    );
    if (!committedReceipts.unchanged) {
      throw new Error("Third-party approval receipt was not committed into the authenticated audit chain.");
    }
    return {
      status: sourceUnchanged && approvalUnchanged ? "unchanged" : "recorded",
      sourceManifestPath: sourceTarget,
      approvalPath: finalApprovalTarget,
      sourceManifestSha256: loaded.manifestSha256,
    };
  } catch (error) {
    preserveLock = error?.leaveApprovalLockForRecovery === true;
    throw error;
  } finally {
    if (!preserveLock) {
      await releaseLock(lock, "Third-party approval receipt lock", {
        faultInjector: input.faultInjector,
        phase: "after-approval-lock-claim",
      });
    }
  }
}

/** Install all explicitly approved global Skill bundles in one verified transaction. */
export async function applyThirdPartyGlobalSkills({
  approved,
  approvals,
  homeDir,
  manifest: suppliedManifest,
  manifestPath,
  sourceResolver,
  faultInjector,
  approvalPlan,
  repoRoot,
  strictDataBoundary,
}) {
  if (!approved) throw new Error("Third-party installation requires explicit approval.");
  if (!approvalPlan || !repoRoot || typeof strictDataBoundary !== "boolean") {
    throw new Error("Third-party installation requires an authoritative plan, repoRoot, and explicit boolean strictDataBoundary.");
  }
  await assertRealDirectory(homeDir, "User home");
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  await verifyThirdPartyApprovalPlanForOperation({
    approvalPlan,
    homeDir,
    manifest: loaded.manifest,
    manifestSha256: loaded.manifestSha256,
    repoRoot,
    strictDataBoundary,
  });
  const normalizedApprovals = normalizeApprovalRecord(
    approvals,
    loaded.manifest,
    loaded.manifestSha256,
    { approvalPlan },
  );
  const approvedIds = new Set(normalizedApprovals.approvedActionIds);
  const candidates = loaded.manifest.candidates.filter(
    (candidate) => candidate.group === "global-skills" && approvedIds.has(candidate.id),
  );
  if (!candidates.length) return { status: "skipped", installedSkills: [], approvedSkillIds: [] };
  for (const candidate of candidates) {
    const missing = candidate.dependencies.filter(
      (dependency) =>
        !approvedIds.has(dependency) &&
        !planHasExactCandidate(approvalPlan, dependency),
    );
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
  const initialOwnershipState = await readOptionalRegularFile(
    locations.ownership,
    "Third-party ownership",
  );
  if (
    initialOwnershipState.exists &&
    !initialOwnershipState.bytes.equals(Buffer.from(initialOwnershipCanonical))
  ) {
    throw new Error("Third-party ownership is not canonical; refusing transactional replacement.");
  }
  const targetInfo = [];
  for (const item of desired) {
    const target = homePath(homeDir, item.targetPath, "Third-party Skill target");
    const existing = await exists(target) ? await snapshotManagedThirdPartyTree(target) : null;
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
  const journal = { schemaVersion: 2, owner: OWNER, id: path.basename(locations.directory), state: "prepared", targets: [] };
  try {
    for (let index = 0; index < targetInfo.length; index += 1) {
      const item = targetInfo[index];
      const staged = path.join(locations.stage, item.candidate.id, item.name);
      await mkdir(path.dirname(staged), { recursive: true, mode: 0o700 });
      const copied = await snapshotThirdPartyTree(item.sourcePath, { copyTo: staged });
      if (copied.treeSha256 !== item.treeSha256) throw new Error(`Staged source drifted for ${item.name}.`);
      const backup = item.existing
        ? path.join(locations.backup, "previous", String(index))
        : null;
      if (backup) await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
      journal.targets.push({
        path: item.target,
        staged,
        previous: item.existing
          ? { exists: true, ...journalTreeSnapshot(item.existing) }
          : { exists: false },
        next: journalTreeSnapshot(copied),
        backup,
        discard: path.join(locations.backup, "rollback", String(index)),
        reservation: {
          markerName: `harness-third-party-${journal.id}.reservation.json`,
          token: randomUUID(),
          claim: path.join(locations.backup, "markers", `${index}.json`),
        },
        phase: "prepared",
        installed: false,
      });
    }
    await writeJournal(locations.journal, journal, key);
    for (let index = 0; index < journal.targets.length; index += 1) {
      const record = journal.targets[index];
      const item = targetInfo[index];
      await faultInjector?.(`before-activate:${item.candidate.id}:${item.name}`);
      await assertActivationCas([item], homeDir, "Third-party global Skill");
      await activateThirdPartyTarget({
        record,
        journal,
        locations,
        key,
        root: homeDir,
        label: "Third-party global Skill",
        faultInjector,
        faultId: `${item.candidate.id}:${item.name}`,
        installedPhase: `installed:${item.name}`,
      });
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
    const nextOwnershipBytes = Buffer.from(canonicalJson(ownership));
    journal.ownership = ownershipJournalRecord(
      locations.ownership,
      initialOwnershipState,
      nextOwnershipBytes,
      {
        claim: path.join(locations.backup, "ownership", "previous.json"),
        rollbackClaim: path.join(locations.backup, "ownership", "next.json"),
      },
    );
    journal.state = "committing";
    await writeJournal(locations.journal, journal, key);
    await faultInjector?.("after-ownership-journal");
    await replaceAtomicFileCas(
      locations.ownership,
      nextOwnershipBytes,
      initialOwnershipState,
      "Third-party ownership",
      {
        claim: journal.ownership.claim,
        faultInjector,
      },
    );
    await faultInjector?.("after-ownership-write");
    journal.state = "committed";
    await writeJournal(locations.journal, journal, key);
    await rm(locations.directory, { recursive: true, force: true });
    await releaseLock(lock, "Third-party transaction lock", {
      faultInjector,
      phase: "after-transaction-lock-claim",
    });
    return { status: "installed", installedSkills: desired.map((item) => item.name), approvedSkillIds: candidates.map((candidate) => candidate.id) };
  } catch (error) {
    if (error?.leaveTransactionForRecovery) throw error;
    try {
      await recoverOwnedThirdPartyTransaction({ homeDir, lock });
    } catch (recoveryError) {
      throw new Error(`Third-party installation failed and recovery also failed: ${recoveryError.message}`, { cause: error });
    }
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
    lock: path.join(harness, "third-party.lock"),
    ownership: path.join(harness, "third-party-installations.json"),
  };
}

async function acquireProjectLock(repoRoot, homeDir, transactionId) {
  const locations = projectTransactionPaths(repoRoot, transactionId);
  await ensureDirectory(repoRoot, locations.harness);
  const key = await keyFor(homeDir);
  await recoverReleasedLockClaims(
    locations.lock,
    key,
    "project-skill-transaction",
    "project-skill-transaction-lock",
    "Project third-party transaction lock",
  );
  const token = randomUUID();
  const processInstance = await readProcessInstance(process.pid);
  if (!processInstance) throw new Error("Cannot establish the current process instance for the project third-party transaction lock.");
  try {
    await writeOwnedLock(locations.lock, {
      schemaVersion: 1,
      owner: OWNER,
      kind: "project-skill-transaction",
      transactionId,
      pid: process.pid,
      processInstance,
      token,
    }, key, "project-skill-transaction-lock");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("A project third-party transaction is already in progress; recover it first.");
    throw error;
  }
  return {
    path: locations.lock,
    transactionId,
    token,
    processInstance,
    key,
    kind: "project-skill-transaction",
    domain: "project-skill-transaction-lock",
  };
}

async function recoverProjectTransactionDirectory({ repoRoot, locations, key, ownedLock = null }) {
  if (!(await exists(locations.directory))) return false;
  if (!(await exists(locations.journal))) {
    if (!ownedLock || ownedLock.transactionId !== path.basename(locations.directory)) {
      throw new Error("Project third-party transaction residue has no authenticated journal; manual review is required.");
    }
    await rm(locations.directory, { recursive: true, force: true });
    return true;
  }
  const journal = await readJournal(locations.journal, key);
  if (
    journal.owner !== OWNER ||
    journal.id !== path.basename(locations.directory) ||
    !Array.isArray(journal.targets)
  ) {
    throw new Error("Project third-party transaction journal is invalid.");
  }
  const ownershipRecovery = await classifyOwnershipRecovery(
    journal,
    repoRoot,
    "Project third-party ownership",
  );
  if (journal.state === "committed" && ownershipRecovery?.state !== "next") {
    throw new Error("Committed project third-party ownership does not match its authenticated transaction.");
  }
  if (journal.state !== "committed") {
    for (const target of [...journal.targets].reverse()) {
      await recoverThirdPartyTarget({
        record: target,
        journal,
        locations,
        key,
        root: repoRoot,
        label: "Project third-party Skill",
      });
    }
    await restoreOwnershipAfterRollback(
      journal,
      ownershipRecovery,
      "Project third-party ownership",
    );
  }
  await rm(locations.directory, { recursive: true, force: true });
  return true;
}

async function recoverOwnedThirdPartyProjectTransaction({ repoRoot, lock }) {
  const current = await readOwnedLock(
    lock.path,
    "Project third-party transaction lock",
    lock.key,
    lock.kind,
    lock.domain,
  );
  if (
    current.transactionId !== lock.transactionId ||
    current.token !== lock.token ||
    current.processInstance !== lock.processInstance
  ) {
    throw new Error("Project third-party transaction lock ownership changed; refusing owned recovery.");
  }
  const locations = projectTransactionPaths(repoRoot, lock.transactionId);
  const recovered = await recoverProjectTransactionDirectory({
    repoRoot,
    locations,
    key: lock.key,
    ownedLock: lock,
  });
  await releaseLock(lock, "Project third-party transaction lock");
  return { status: recovered ? "rolled-back" : "unchanged" };
}

/** Recover an interrupted project-local Skill transaction without touching `.claude`. */
export async function recoverThirdPartyProjectTransactions({
  repoRoot,
  homeDir,
  processAlive = defaultProcessAlive,
}) {
  await assertRealDirectory(repoRoot, "Project root");
  await assertRealDirectory(homeDir, "User home");
  const probe = projectTransactionPaths(repoRoot, "placeholder");
  const rootExists = await exists(probe.root);
  const lockExists = await exists(probe.lock);
  const keyPath = transactionPaths(homeDir, "placeholder").key;
  if (!rootExists && !lockExists && !(await exists(keyPath))) {
    return { status: "unchanged" };
  }
  const key = await keyFor(homeDir, { create: false });
  const releasedClaimRecovered = !lockExists && await recoverReleasedLockClaims(
    probe.lock,
    key,
    "project-skill-transaction",
    "project-skill-transaction-lock",
    "Project third-party transaction lock",
  );
  if (!rootExists && !lockExists) {
    return { status: releasedClaimRecovered ? "rolled-back" : "unchanged" };
  }
  const heldLock = lockExists
    ? await readOwnedLock(
      probe.lock,
      "Project third-party transaction lock",
      key,
      "project-skill-transaction",
      "project-skill-transaction-lock",
    )
    : null;
  if (heldLock && await processAlive(heldLock.pid, heldLock.processInstance)) {
    throw new Error("A project third-party transaction lock belongs to a live process; refusing concurrent recovery.");
  }
  const entries = rootExists
    ? await readdir(probe.root, { withFileTypes: true })
    : [];
  if (heldLock && entries.length && !entries.some((entry) => entry.name === heldLock.transactionId)) {
    throw new Error("Project third-party transaction lock does not bind transaction residue; manual review is required.");
  }
  let recovered = releasedClaimRecovered;
  const recoveredIds = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_IDENTIFIER.test(entry.name)) {
      throw new Error("Project third-party transaction root contains unsafe residue.");
    }
    const locations = projectTransactionPaths(repoRoot, entry.name);
    if (await recoverProjectTransactionDirectory({
      repoRoot,
      locations,
      key,
      ownedLock: heldLock?.transactionId === entry.name ? heldLock : null,
    })) {
      recovered = true;
      recoveredIds.add(entry.name);
    }
  }
  if (heldLock) {
    const current = await readOwnedLock(
      probe.lock,
      "Project third-party transaction lock",
      key,
      "project-skill-transaction",
      "project-skill-transaction-lock",
    );
    if (
      current.token !== heldLock.token ||
      current.transactionId !== heldLock.transactionId ||
      current.processInstance !== heldLock.processInstance
    ) {
      throw new Error("Project third-party transaction lock ownership changed during recovery; refusing cleanup.");
    }
    await releaseLock({
      path: probe.lock,
      transactionId: heldLock.transactionId,
      token: heldLock.token,
      processInstance: heldLock.processInstance,
      key,
      kind: "project-skill-transaction",
      domain: "project-skill-transaction-lock",
    }, "Project third-party transaction lock");
    recovered = true;
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
  approvalPlan,
  strictDataBoundary,
}) {
  if (!approved) throw new Error("Project third-party installation requires explicit approval.");
  if (!approvalPlan || !repoRoot || typeof strictDataBoundary !== "boolean") {
    throw new Error("Project third-party installation requires an authoritative plan, repoRoot, and explicit boolean strictDataBoundary.");
  }
  await assertRealDirectory(repoRoot, "Project root");
  await assertRealDirectory(homeDir, "User home");
  const loaded = suppliedManifest
    ? { manifest: validateThirdPartySourceManifest(suppliedManifest), manifestSha256: sha256(canonicalJson(suppliedManifest)) }
    : await loadThirdPartySourceManifest({ manifestPath });
  await verifyThirdPartyApprovalPlanForOperation({
    approvalPlan,
    homeDir,
    manifest: loaded.manifest,
    manifestSha256: loaded.manifestSha256,
    repoRoot,
    strictDataBoundary,
  });
  const normalizedApprovals = normalizeApprovalRecord(
    approvals,
    loaded.manifest,
    loaded.manifestSha256,
    { approvalPlan },
  );
  const approvedIds = new Set(normalizedApprovals.approvedActionIds);
  const candidates = loaded.manifest.candidates.filter((entry) => entry.group === "project-skills" && approvedIds.has(entry.id));
  if (!candidates.length) return { status: "skipped", installedSkills: [] };
  for (const candidate of candidates) {
    const missing = candidate.dependencies.filter(
      (dependency) =>
        !approvedIds.has(dependency) &&
        !planHasExactCandidate(approvalPlan, dependency),
    );
    if (missing.length) throw new Error(`Project Skill ${candidate.id} has dependencies absent from explicit approvals: ${missing.sort().join(", ")}.`);
  }
  await recoverThirdPartyProjectTransactions({ repoRoot, homeDir });
  const sources = new Map(loaded.manifest.sources.map((source) => [source.id, source]));
  const sourceRoots = new Map();
  try {
    for (const sourceId of new Set(candidates.map((candidate) => candidate.sourceId))) {
      const source = sources.get(sourceId);
      const sourceRoot = sourceResolver
        ? await sourceResolver({ source, candidates: candidates.filter((candidate) => candidate.sourceId === sourceId), homeDir, repoRoot })
        : await acquirePinnedGitSource({ homeDir, source, approvalPlan });
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
  const initialOwnershipState = await readOptionalRegularFile(
    projectTransactionPaths(repoRoot, "placeholder").ownership,
    "Project third-party ownership",
  );
  if (
    initialOwnershipState.exists &&
    !initialOwnershipState.bytes.equals(Buffer.from(initialOwnershipCanonical))
  ) {
    throw new Error("Project third-party ownership is not canonical; refusing transactional replacement.");
  }
  const targetInfo = [];
  for (const item of desired) {
    const existing = await exists(item.target) ? await snapshotManagedThirdPartyTree(item.target) : null;
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
  const lock = await acquireProjectLock(repoRoot, homeDir, path.basename(locations.directory));
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
  const key = lock.key;
  await ensureDirectory(repoRoot, locations.stage);
  await mkdir(locations.backup, { recursive: true, mode: 0o700 });
  const journal = { schemaVersion: 2, owner: OWNER, id: path.basename(locations.directory), state: "prepared", targets: [] };
  try {
    for (let index = 0; index < targetInfo.length; index += 1) {
      const item = targetInfo[index];
      const staged = path.join(locations.stage, item.candidate.id, item.name);
      await mkdir(path.dirname(staged), { recursive: true, mode: 0o700 });
      const copied = await snapshotThirdPartyTree(item.sourcePath, { copyTo: staged });
      if (copied.treeSha256 !== item.treeSha256) throw new Error(`Staged project Skill drifted for ${item.name}.`);
      const backup = item.existing
        ? path.join(locations.backup, "previous", String(index))
        : null;
      if (backup) await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
      journal.targets.push({
        path: item.target,
        staged,
        previous: item.existing
          ? { exists: true, ...journalTreeSnapshot(item.existing) }
          : { exists: false },
        next: journalTreeSnapshot(copied),
        backup,
        discard: path.join(locations.backup, "rollback", String(index)),
        reservation: {
          markerName: `harness-third-party-${journal.id}.reservation.json`,
          token: randomUUID(),
          claim: path.join(locations.backup, "markers", `${index}.json`),
        },
        phase: "prepared",
        installed: false,
      });
    }
    await writeJournal(locations.journal, journal, key);
    for (let index = 0; index < journal.targets.length; index += 1) {
      const record = journal.targets[index];
      const item = targetInfo[index];
      await faultInjector?.(`before-activate:${item.candidate.id}:${item.name}`);
      await assertActivationCas([item], repoRoot, "Project third-party Skill");
      await activateThirdPartyTarget({
        record,
        journal,
        locations,
        key,
        root: repoRoot,
        label: "Project third-party Skill",
        faultInjector,
        faultId: `${item.candidate.id}:${item.name}`,
        installedPhase: `installed:${item.candidate.id}:${item.name}`,
      });
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
    const nextOwnershipBytes = Buffer.from(canonicalJson(ownership));
    journal.ownership = ownershipJournalRecord(
      locations.ownership,
      initialOwnershipState,
      nextOwnershipBytes,
      {
        claim: path.join(locations.backup, "ownership", "previous.json"),
        rollbackClaim: path.join(locations.backup, "ownership", "next.json"),
      },
    );
    journal.state = "committing";
    await writeJournal(locations.journal, journal, key);
    await faultInjector?.("after-ownership-journal");
    await replaceAtomicFileCas(
      locations.ownership,
      nextOwnershipBytes,
      initialOwnershipState,
      "Project third-party ownership",
      {
        claim: journal.ownership.claim,
        faultInjector,
      },
    );
    await faultInjector?.("after-ownership-write");
    journal.state = "committed";
    await writeJournal(locations.journal, journal, key);
    await rm(locations.directory, { recursive: true, force: true });
    await releaseLock(lock, "Project third-party transaction lock", {
      faultInjector,
      phase: "after-project-transaction-lock-claim",
    });
    return { status: "installed", installedSkills: targetInfo.map((item) => item.name) };
  } catch (error) {
    if (error?.leaveTransactionForRecovery) throw error;
    try { await recoverOwnedThirdPartyProjectTransaction({ repoRoot, lock }); }
    catch (recoveryError) { throw new Error(`Project third-party installation failed and recovery also failed: ${recoveryError.message}`, { cause: error }); }
    throw error;
  }
}
