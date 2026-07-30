import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  AGENTS_PERSONAL_SKILLS,
  auditSkillPlatformMigration as auditSkillPlatformMigrationCore,
  applySkillPlatformMigration as applySkillPlatformMigrationCore,
  CODEX_PERSONAL_SKILLS,
  GLOBAL_PLATFORM_SKILLS,
  HARNESS_PROJECTED_SKILLS,
  planSkillPlatformMigration,
  rollbackSkillPlatformMigration,
  seedPersonalSkillRepository,
} from "./skill-platform-migration.mjs";
import {
  assertCloneSourceHasNoCredentials,
  GUIDED_INIT_PROVIDER_NAMES,
  describeProviderAction,
  detectTechnologyStack,
  inspectProviderCliStatuses,
  installBundledPlatformSkills,
  loadGlobalInitState,
  preparePersonalSkillCatalog,
  recommendProjectSkillsFromCatalog,
  recordGlobalInitState,
  validateProviderActions,
} from "./guided-init.mjs";
import {
  executeProviderAction,
  planProviderAction,
} from "./provider-actions.mjs";
import {
  acquirePinnedGitSource,
  applyThirdPartyGlobalSkills,
  applyThirdPartyProjectSkills,
  buildThirdPartyApprovalPlan,
  loadThirdPartySourceManifest,
  preflightThirdPartyGlobalApproval,
  recordThirdPartyGlobalApproval,
  resolveThirdPartyApprovals,
} from "./third-party-approval.mjs";
import { applyThirdPartyGlobalActions } from "./third-party-global-actions.mjs";

export {
  inspectProviderCliStatuses,
  installBundledPlatformSkills,
  preparePersonalSkillCatalog,
};

const CONTRACT_STATUSES = new Set(["draft", "approved", "ready"]);
const MANIFEST_CANDIDATES = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
];
const CREDENTIAL_KEY = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|private[_-]?key|client[_-]?secret|credential)/i;
const CREDENTIAL_VALUE = /(?:\bsk-[A-Za-z0-9_-]{8,}\b|\bgh[pousr]_[A-Za-z0-9_]{8,}\b|\bBearer\s+[A-Za-z0-9._~-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const ALLOWED_POLICY_KEYS = new Set([
  "credentialFieldsForbidden",
  "secretPolicy",
]);
const REQUIRED_GLOBAL_SKILLS = new Set(GLOBAL_PLATFORM_SKILLS);
const SKILL_NAME = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const SKILL_CATALOG_MAX_DEPTH = 10;
const SKILL_CATALOG_MAX_ENTRIES = 10_000;
const SKILL_FILE_MAX_BYTES = 512 * 1024;
const SKILL_REPOSITORY_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  "node_modules",
]);
const PROJECT_SKILL_MAX_FILES = 2_000;
const PROJECT_SKILL_MAX_FILE_BYTES = 16 * 1024 * 1024;
const PROJECT_SKILL_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const COLLABORATION_BLOCK_START = "<!-- HARNESS-COLLABORATION:START -->";
const COLLABORATION_BLOCK_END = "<!-- HARNESS-COLLABORATION:END -->";
const PROJECT_POLICY_VERSION = 6;
const COLLABORATION_MARKER_FORMAT_VERSION = 1;
const PROJECT_OWNERSHIP_SCHEMA_VERSION = 2;
const PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION = 3;
const THIRD_PARTY_SOURCE_RELATIVE_PATH =
  ".harness/third-party-sources.json";
const THIRD_PARTY_INSTALLATIONS_RELATIVE_PATH =
  ".harness/third-party-installations.json";
const PROJECT_POLICY_RELATIVE_PATH =
  ".harness/policies/collaboration-policy.md";
const PROJECT_TRANSACTION_PREFIX = ".harness-init-txn-";
const PROJECT_LOCK_PATH = ".harness-init-lock";
const PROJECT_LOCK_CANDIDATE_PREFIX = ".harness-init-lock-";
const PROJECT_GC_PREFIX = ".harness-init-gc-";
const PROJECT_GC_PATTERN =
  /^\.harness-init-gc-(?:transaction|lock|candidate)-[a-f0-9-]{36}$/i;
const PROJECT_PROVENANCE_SCHEMA_VERSION = 1;
const PROJECT_OWNER_SCHEMA_VERSION = 2;
const PROJECT_JOURNAL_SCHEMA_VERSION = 3;
const PROJECT_COMMIT_MARKER_SCHEMA_VERSION = 2;
const CURRENT_PROCESS_FALLBACK_IDENTITY =
  `fallback:${process.platform}:${process.pid}:` +
  `${Math.round((Date.now() - process.uptime() * 1000) / 100)}`;
const execFile = promisify(execFileCallback);
let currentProcessIdentityPromise;
const LEGACY_AGENTS_STAGE_PATTERN =
  /^\.AGENTS\.md\.harness-init-[a-f0-9-]{36}$/i;
const PROJECT_TRANSACTION_TARGETS = new Set([
  "AGENTS.md",
  PROJECT_POLICY_RELATIVE_PATH,
  ".harness/project.json",
  ".harness/project.schema.json",
  ".harness/product-manager.schema.json",
  ".harness/ownership.json",
  ".harness/project-skills.json",
  THIRD_PARTY_SOURCE_RELATIVE_PATH,
  THIRD_PARTY_INSTALLATIONS_RELATIVE_PATH,
]);
const PROJECT_SKILL_TRANSACTION_TARGET =
  /^\.agents\/skills\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function pathEntryExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readUtf8IfExists(target) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertSafeRegularFile(target, label, { allowMissing } = {}) {
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) {
      throw new Error(
        `${label} is a symbolic link or reparse point: ${target}`,
      );
    }
    if (!details.isFile()) {
      throw new Error(`${label} is not a regular file: ${target}`);
    }
    return true;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false;
    throw error;
  }
}

function markerCount(content, marker) {
  return content.split(marker).length - 1;
}

function findCollaborationBlock(content) {
  const starts = markerCount(content, COLLABORATION_BLOCK_START);
  const ends = markerCount(content, COLLABORATION_BLOCK_END);
  if (starts !== ends || starts > 1) {
    throw new Error(
      "AGENTS.md has a malformed or duplicate Harness collaboration managed block.",
    );
  }
  if (starts === 0) return null;
  const start = content.indexOf(COLLABORATION_BLOCK_START);
  const end = content.indexOf(COLLABORATION_BLOCK_END);
  if (end < start) {
    throw new Error(
      "AGENTS.md has an invalid Harness collaboration managed block order.",
    );
  }
  return content.slice(start, end + COLLABORATION_BLOCK_END.length);
}

function renderCollaborationBlock(policy) {
  return `${COLLABORATION_BLOCK_START}\n${policy.trim()}\n${COLLABORATION_BLOCK_END}`;
}

function addCollaborationBlock(content, expectedBlock) {
  const currentBlock = findCollaborationBlock(content);
  if (currentBlock === expectedBlock) return content;
  if (currentBlock !== null) {
    throw new Error(
      "AGENTS.md contains a conflicting Harness collaboration managed block; refusing to overwrite it.",
    );
  }
  const separator =
    content.length === 0
      ? ""
      : content.endsWith("\n\n")
        ? ""
        : content.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${content}${separator}${expectedBlock}\n`;
}

function replaceCollaborationBlock(content, currentBlock, expectedBlock) {
  if (currentBlock === expectedBlock) return content;
  const start = content.indexOf(currentBlock);
  if (start < 0) {
    throw new Error(
      "The managed AGENTS.md collaboration block changed during projection.",
    );
  }
  return (
    content.slice(0, start) +
    expectedBlock +
    content.slice(start + currentBlock.length)
  );
}

function assertInside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the target repository.`);
  }
}

async function ensureSafeDirectoryChain(root, target, label, { create } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rootDetails = await lstat(resolvedRoot);
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
    throw new Error(`${label} root must be a real directory: ${resolvedRoot}`);
  }
  assertInside(resolvedRoot, resolvedTarget, label);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new Error(
          `${label} contains a symbolic link or reparse point: ${current}`,
        );
      }
      if (!details.isDirectory()) {
        throw new Error(`${label} contains a non-directory entry: ${current}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (!create) return;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value, label, { allowNull = false } = {}) {
  if (allowNull && value === null) return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error(`${label} has an invalid schema.`);
  }
}

function normalizeUniqueStrings(values, label, { skillNames = false } = {}) {
  assertStringArray(values, label);
  const normalized = values.map((entry) => entry.trim());
  if (skillNames) {
    for (const name of normalized) {
      if (!SKILL_NAME.test(name)) {
        throw new Error(`${label} contains an invalid Skill name: ${name}.`);
      }
    }
  }
  return [...new Set(normalized)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function skillRepositoryProfilePath(homeDir = homedir()) {
  const root = path.resolve(homeDir);
  const target = path.join(
    root,
    ".agents",
    "harness",
    "skill-repository.json",
  );
  assertInside(root, target, "Skill repository profile");
  return target;
}

function isSameOrInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function assertDedicatedSkillRepository(repositoryPath, homeDir) {
  const repository = path.resolve(repositoryPath);
  const userRoot = path.resolve(homeDir);
  for (const activeRoot of [
    path.join(userRoot, ".agents", "skills"),
    path.join(userRoot, ".codex", "skills"),
  ]) {
    if (
      isSameOrInside(activeRoot, repository) ||
      isSameOrInside(repository, activeRoot)
    ) {
      throw new Error(
        "Skill repository must be dedicated and separate from active global " +
          `Skill roots: ${activeRoot}`,
      );
    }
  }
}

function validateSkillRepositoryProfile(profile) {
  assertExactKeys(
    profile,
    [
      "schemaVersion",
      "repositoryPath",
      "globalEssentialSkills",
      "selection",
      "refinedAt",
    ],
    "Skill repository profile",
  );
  if (profile.schemaVersion !== 1) {
    throw new Error("Skill repository profile schemaVersion must be 1.");
  }
  assertString(profile.repositoryPath, "Skill repository path");
  if (!path.isAbsolute(profile.repositoryPath)) {
    throw new Error("Skill repository path must be absolute.");
  }
  const globalEssentialSkills = normalizeUniqueStrings(
    profile.globalEssentialSkills,
    "Global essential Skills",
    { skillNames: true },
  );
  for (const required of REQUIRED_GLOBAL_SKILLS) {
    if (!globalEssentialSkills.includes(required)) {
      throw new Error(
        `Global essential Skills must include ${required}.`,
      );
    }
  }
  assertExactKeys(
    profile.selection,
    [
      "approvalRequired",
      "installMode",
      "guidance",
      "excludedSkills",
    ],
    "Skill selection profile",
  );
  if (profile.selection.approvalRequired !== true) {
    throw new Error("Project Skill selection must require approval.");
  }
  if (profile.selection.installMode !== "copy") {
    throw new Error("Project Skills must use copy installation mode.");
  }
  normalizeUniqueStrings(
    profile.selection.guidance,
    "Skill selection guidance",
  );
  const excludedSkills = normalizeUniqueStrings(
    profile.selection.excludedSkills,
    "Excluded Skills",
    { skillNames: true },
  );
  for (const name of excludedSkills) {
    if (globalEssentialSkills.includes(name)) {
      throw new Error(
        `Global essential Skill ${name} cannot also be excluded.`,
      );
    }
  }
  assertString(profile.refinedAt, "Skill profile refinement time");
  if (Number.isNaN(Date.parse(profile.refinedAt))) {
    throw new Error("Skill profile refinement time must be an ISO date-time.");
  }
  assertNoCredentials(profile);
  return profile;
}

export async function loadSkillRepositoryProfile({
  homeDir = homedir(),
} = {}) {
  const canonicalHome = await realpath(path.resolve(homeDir));
  const target = skillRepositoryProfilePath(homeDir);
  await ensureSafeDirectoryChain(
    path.resolve(homeDir),
    path.dirname(target),
    "Skill repository profile directory",
    { create: false },
  );
  if (
    !(await assertSafeRegularFile(
      target,
      "Skill repository profile",
      { allowMissing: true },
    ))
  ) {
    return null;
  }
  const profile = validateSkillRepositoryProfile(await readJson(target));
  assertDedicatedSkillRepository(profile.repositoryPath, canonicalHome);
  return profile;
}

export async function saveSkillRepositoryProfile({
  approved,
  createOnly = false,
  excludedSkills = [],
  globalEssentialSkills,
  homeDir = homedir(),
  now = () => new Date(),
  repositoryPath,
  selectionGuidance = [],
}) {
  if (approved !== true) {
    throw new Error(
      "Saving the Skill repository profile requires explicit approval.",
    );
  }
  assertString(repositoryPath, "Skill repository path");
  const canonicalHome = await realpath(path.resolve(homeDir));
  const canonicalRepository = await realpath(path.resolve(repositoryPath));
  const repositoryStat = await stat(canonicalRepository);
  if (!repositoryStat.isDirectory()) {
    throw new Error(
      `Skill repository path is not a directory: ${canonicalRepository}`,
    );
  }
  assertDedicatedSkillRepository(canonicalRepository, canonicalHome);
  const profile = {
    schemaVersion: 1,
    repositoryPath: canonicalRepository,
    globalEssentialSkills: normalizeUniqueStrings(
      globalEssentialSkills,
      "Global essential Skills",
      { skillNames: true },
    ),
    selection: {
      approvalRequired: true,
      installMode: "copy",
      guidance: normalizeUniqueStrings(
        selectionGuidance,
        "Skill selection guidance",
      ),
      excludedSkills: normalizeUniqueStrings(
        excludedSkills,
        "Excluded Skills",
        { skillNames: true },
      ),
    },
    refinedAt: now().toISOString(),
  };
  validateSkillRepositoryProfile(profile);
  const target = skillRepositoryProfilePath(homeDir);
  const parent = path.dirname(target);
  const temporary = path.join(
    parent,
    `.skill-repository-${randomUUID()}.tmp`,
  );
  await ensureSafeDirectoryChain(
    path.resolve(homeDir),
    parent,
    "Skill repository profile directory",
    { create: true },
  );
  await assertSafeRegularFile(target, "Skill repository profile", {
    allowMissing: true,
  });
  try {
    await writeFile(temporary, canonicalJson(profile), {
      flag: "wx",
      mode: 0o600,
    });
    if (createOnly) {
      await link(temporary, target);
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, target);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return profile;
}

function parseSkillFrontmatter(bytes, sourcePath) {
  if (bytes.length > SKILL_FILE_MAX_BYTES) {
    throw new Error(`Skill definition is too large: ${sourcePath}`);
  }
  const value = bytes.toString("utf8");
  const frontmatter = value.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  );
  if (!frontmatter) {
    throw new Error(`Skill definition has invalid frontmatter: ${sourcePath}`);
  }
  const readField = (field) => {
    const match = frontmatter[1].match(
      new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m"),
    );
    if (!match) {
      throw new Error(
        `Skill definition is missing ${field}: ${sourcePath}`,
      );
    }
    const raw = match[1].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(
          `Skill definition has invalid quoted ${field}: ${sourcePath}`,
        );
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) {
      return raw.slice(1, -1).replaceAll("''", "'");
    }
    return raw;
  };
  const name = readField("name");
  const description = readField("description");
  assertString(name, `Skill name in ${sourcePath}`);
  assertString(description, `Skill description in ${sourcePath}`);
  if (!SKILL_NAME.test(name)) {
    throw new Error(`Skill definition has an invalid name: ${name}.`);
  }
  assertNoCredentials({ description });
  return { name, description };
}

export async function discoverSkillCatalog({ repositoryPath }) {
  assertString(repositoryPath, "Skill repository path");
  const root = await realpath(path.resolve(repositoryPath));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Skill repository is not a directory: ${root}`);
  }
  const catalog = [];
  let entriesVisited = 0;

  const visit = async (directory, depth) => {
    if (depth > SKILL_CATALOG_MAX_DEPTH) {
      throw new Error(
        `Skill repository exceeds maximum depth ${SKILL_CATALOG_MAX_DEPTH}.`,
      );
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      entriesVisited++;
      if (entriesVisited > SKILL_CATALOG_MAX_ENTRIES) {
        throw new Error(
          `Skill repository exceeds ${SKILL_CATALOG_MAX_ENTRIES} entries.`,
        );
      }
      if (
        entry.isDirectory() &&
        SKILL_REPOSITORY_IGNORED_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Skill repository contains a symbolic link or reparse point: ${target}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(target, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name !== "SKILL.md") continue;
      const bytes = await readFile(target);
      const parsed = parseSkillFrontmatter(bytes, target);
      const skillDirectory = path.dirname(target);
      const relativePath = path
        .relative(root, skillDirectory)
        .split(path.sep)
        .join("/");
      if (
        !relativePath ||
        relativePath === "." ||
        relativePath.startsWith("../")
      ) {
        throw new Error(
          `Skill definition must live below the repository root: ${target}`,
        );
      }
      catalog.push({
        name: parsed.name,
        description: parsed.description,
        relativePath,
        skillSha256: sha256(bytes),
      });
    }
  };

  await visit(root, 0);
  catalog.sort((left, right) =>
    left.name.localeCompare(right.name) ||
    left.relativePath.localeCompare(right.relativePath),
  );
  const names = new Set();
  for (const entry of catalog) {
    if (names.has(entry.name)) {
      throw new Error(`Skill repository contains duplicate name ${entry.name}.`);
    }
    names.add(entry.name);
  }
  return catalog;
}

async function snapshotSkillTree(sourceRoot, { copyTo = null } = {}) {
  const source = path.resolve(sourceRoot);
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error(`Skill source must be a real directory: ${source}`);
  }
  const files = [];
  let totalBytes = 0;

  const visit = async (sourceDirectory, relativeDirectory) => {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const sourcePath = path.join(sourceDirectory, entry.name);
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Skill source contains a symbolic link or reparse point: ${sourcePath}`,
        );
      }
      if (entry.isDirectory()) {
        const details = await lstat(sourcePath);
        if (details.isSymbolicLink() || !details.isDirectory()) {
          throw new Error(
            `Skill source contains an unsafe directory: ${sourcePath}`,
          );
        }
        if (copyTo) {
          await mkdir(
            path.join(copyTo, ...relativePath.split("/")),
            { recursive: true, mode: 0o700 },
          );
        }
        await visit(sourcePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Skill source contains a special file: ${sourcePath}`);
      }
      const details = await lstat(sourcePath);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw new Error(`Skill source contains an unsafe file: ${sourcePath}`);
      }
      if (details.size > PROJECT_SKILL_MAX_FILE_BYTES) {
        throw new Error(`Skill source file is too large: ${sourcePath}`);
      }
      totalBytes += details.size;
      if (totalBytes > PROJECT_SKILL_MAX_TOTAL_BYTES) {
        throw new Error(
          `Skill source exceeds ${PROJECT_SKILL_MAX_TOTAL_BYTES} bytes.`,
        );
      }
      if (files.length >= PROJECT_SKILL_MAX_FILES) {
        throw new Error(
          `Skill source exceeds ${PROJECT_SKILL_MAX_FILES} files.`,
        );
      }
      const bytes = await readFile(sourcePath);
      if (bytes.length > PROJECT_SKILL_MAX_FILE_BYTES) {
        throw new Error(`Skill source file is too large: ${sourcePath}`);
      }
      totalBytes += bytes.length - details.size;
      if (totalBytes > PROJECT_SKILL_MAX_TOTAL_BYTES) {
        throw new Error(
          `Skill source exceeds ${PROJECT_SKILL_MAX_TOTAL_BYTES} bytes.`,
        );
      }
      files.push({
        path: relativePath,
        size: bytes.length,
        sha256: sha256(bytes),
      });
      if (copyTo) {
        const destination = path.join(
          copyTo,
          ...relativePath.split("/"),
        );
        await mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(destination, bytes, {
          flag: "wx",
          mode: details.mode & 0o777,
        });
        await chmod(destination, details.mode & 0o777);
      }
    }
  };

  if (copyTo) {
    await mkdir(copyTo, { recursive: true, mode: 0o700 });
  }
  await visit(source, "");
  if (!files.some((entry) => entry.path === "SKILL.md")) {
    throw new Error(`Skill source is missing SKILL.md: ${source}`);
  }
  return {
    files,
    fileCount: files.length,
    totalBytes,
    treeSha256: sha256(canonicalJson(files)),
  };
}

function projectSkillManifestIdentity(manifest) {
  return canonicalJson({
    schemaVersion: manifest.schemaVersion,
    owner: manifest.owner,
    profileSha256: manifest.profileSha256,
    repository: manifest.repository,
    managedPaths: manifest.managedPaths,
    skills: manifest.skills,
  });
}

function normalizeCredentialFreeRepositoryRemotes(remotes) {
  if (!Array.isArray(remotes)) {
    throw new Error("Project Skill repository remotes must be an array.");
  }
  const normalized = [];
  const identities = new Set();
  for (const remote of remotes) {
    assertExactKeys(
      remote,
      ["name", "url"],
      "Project Skill repository remote",
    );
    if (
      typeof remote.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote.name)
    ) {
      throw new Error("Project Skill repository remote name is invalid.");
    }
    let url;
    try {
      url = assertCloneSourceHasNoCredentials(remote.url);
    } catch {
      throw new Error(
        "Project Skill repository remotes must be credential-free.",
      );
    }
    const key = `${remote.name}\0${url}`;
    if (identities.has(key)) {
      throw new Error("Project Skill repository remote identity is duplicated.");
    }
    identities.add(key);
    normalized.push({ name: remote.name, url });
  }
  return normalized.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.url.localeCompare(right.url),
  );
}

function validateProjectSkillManifest(manifest) {
  const allowedKeys = [
    "schemaVersion",
    "status",
    "owner",
    "profileSha256",
    "installedAt",
    "managedPaths",
    "skills",
  ];
  if (manifest?.schemaVersion === 2) allowedKeys.push("repository");
  assertExactKeys(
    manifest,
    allowedKeys,
    "Project Skill manifest",
  );
  if (![1, 2].includes(manifest.schemaVersion)) {
    throw new Error("Project Skill manifest schemaVersion must be 1 or 2.");
  }
  if (manifest.schemaVersion === 2) {
    assertExactKeys(
      manifest.repository,
      ["path", "branch", "commit", "tree", "clean", "remotes"],
      "Project Skill repository identity",
    );
    if (
      !path.isAbsolute(manifest.repository.path) ||
      manifest.repository.branch !== "main" ||
      !/^[a-f0-9]{40,64}$/.test(manifest.repository.commit) ||
      !/^[a-f0-9]{40,64}$/.test(manifest.repository.tree) ||
      manifest.repository.clean !== true ||
      canonicalJson(
        normalizeCredentialFreeRepositoryRemotes(
          manifest.repository.remotes,
        ),
      ) !== canonicalJson(manifest.repository.remotes)
    ) {
      throw new Error("Project Skill repository identity is invalid.");
    }
  }
  if (!["pending", "ready"].includes(manifest.status)) {
    throw new Error("Project Skill manifest status is invalid.");
  }
  if (manifest.owner !== "trellis-ccg-harness") {
    throw new Error("Project Skill manifest owner is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.profileSha256)) {
    throw new Error("Project Skill manifest profile digest is invalid.");
  }
  if (
    manifest.installedAt !== null &&
    (typeof manifest.installedAt !== "string" ||
      Number.isNaN(Date.parse(manifest.installedAt)))
  ) {
    throw new Error("Project Skill manifest installation time is invalid.");
  }
  if (
    (manifest.status === "pending" && manifest.installedAt !== null) ||
    (manifest.status === "ready" && manifest.installedAt === null)
  ) {
    throw new Error(
      "Project Skill manifest status and installation time do not match.",
    );
  }
  assertSafeProjectPaths(manifest.managedPaths, "Project Skill managed paths");
  if (!Array.isArray(manifest.skills)) {
    throw new Error("Project Skill manifest skills must be an array.");
  }
  const names = new Set();
  for (const skill of manifest.skills) {
    assertExactKeys(
      skill,
      [
        "name",
        "sourceRelativePath",
        "targetPath",
        "skillSha256",
        "treeSha256",
        "fileCount",
        "totalBytes",
      ],
      "Project Skill entry",
    );
    if (!SKILL_NAME.test(skill.name) || names.has(skill.name)) {
      throw new Error("Project Skill manifest contains an invalid name.");
    }
    names.add(skill.name);
    assertSafeProjectPaths(
      [skill.sourceRelativePath],
      "Project Skill source path",
    );
    if (skill.targetPath !== `.agents/skills/${skill.name}`) {
      throw new Error("Project Skill manifest target path is invalid.");
    }
    for (const field of ["skillSha256", "treeSha256"]) {
      if (!/^[a-f0-9]{64}$/.test(skill[field])) {
        throw new Error(`Project Skill ${field} is invalid.`);
      }
    }
    if (
      !Number.isSafeInteger(skill.fileCount) ||
      skill.fileCount < 1 ||
      !Number.isSafeInteger(skill.totalBytes) ||
      skill.totalBytes < 1
    ) {
      throw new Error("Project Skill manifest size metadata is invalid.");
    }
  }
  return manifest;
}

async function writeNewFileAtomically(root, target, value, label) {
  assertInside(root, target, label);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, target);
    await rm(temporary, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (error?.code === "EEXIST") {
      throw new Error(`${label} already exists and is treated as user-owned.`);
    }
    throw error;
  }
}

async function replaceFileAtomically(root, target, value, label) {
  assertInside(root, target, label);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function installProjectSkills({
  approved,
  homeDir = homedir(),
  now = () => new Date(),
  repoRoot,
  selectedSkills,
}) {
  if (approved !== true) {
    throw new Error("Project Skill installation requires explicit approval.");
  }
  const root = path.resolve(repoRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Repository root is not a directory: ${root}`);
  }
  const harnessDirectory = path.join(root, ".harness");
  const projectContractPath = path.join(root, ".harness", "project.json");
  if (!(await pathEntryExists(projectContractPath))) {
    throw new Error(
      "Project Skills require an initialized .harness/project.json contract.",
    );
  }
  await ensureSafeDirectoryChain(
    root,
    harnessDirectory,
    "Harness contract directory",
    { create: false },
  );
  await assertSafeRegularFile(
    projectContractPath,
    "Harness project contract",
  );
  const projectContract = await readJson(projectContractPath);
  validateProjectContract(projectContract, { requireApproved: true });
  const profile = await loadSkillRepositoryProfile({ homeDir });
  if (!profile) {
    throw new Error(
      "Skill repository is not configured; complete first-run refinement.",
    );
  }
  const requested = normalizeUniqueStrings(
    selectedSkills,
    "Selected project Skills",
    { skillNames: true },
  );
  for (const name of requested) {
    if (profile.globalEssentialSkills.includes(name)) {
      throw new Error(
        `Selected Skill ${name} is global essential and must not be duplicated.`,
      );
    }
    if (profile.selection.excludedSkills.includes(name)) {
      throw new Error(`Selected Skill ${name} is excluded by the user profile.`);
    }
  }
  const approvedSelection = projectContract.skills.projectSelection
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (canonicalJson(requested) !== canonicalJson(approvedSelection)) {
    throw new Error(
      "Requested Project Skills do not match the approved project contract.",
    );
  }
  if (
    canonicalJson(profile.globalEssentialSkills) !==
    canonicalJson(
      [...projectContract.skills.globalEssential].sort((left, right) =>
        left.localeCompare(right),
      ),
    )
  ) {
    throw new Error(
      "Project contract global essential Skills differ from the saved profile.",
    );
  }
  const catalog = await discoverSkillCatalog({
    repositoryPath: profile.repositoryPath,
  });
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  const skills = [];
  for (const name of requested) {
    const catalogEntry = byName.get(name);
    if (!catalogEntry) {
      throw new Error(`Selected Skill is missing from the repository: ${name}`);
    }
    const sourcePath = path.join(
      profile.repositoryPath,
      ...catalogEntry.relativePath.split("/"),
    );
    const snapshot = await snapshotSkillTree(sourcePath);
    const skillDefinition = snapshot.files.find(
      (entry) => entry.path === "SKILL.md",
    );
    if (skillDefinition?.sha256 !== catalogEntry.skillSha256) {
      throw new Error(
        `Skill source changed during cataloging: ${name}`,
      );
    }
    skills.push({
      name,
      sourceRelativePath: catalogEntry.relativePath,
      targetPath: `.agents/skills/${name}`,
      skillSha256: catalogEntry.skillSha256,
      treeSha256: snapshot.treeSha256,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
    });
  }
  const manifestPath = path.join(
    root,
    ".harness",
    "project-skills.json",
  );
  const profileSha256 = sha256(canonicalJson(profile));
  const pendingManifest = validateProjectSkillManifest({
    schemaVersion: 1,
    status: "pending",
    owner: "trellis-ccg-harness",
    profileSha256,
    installedAt: null,
    managedPaths: [
      ".harness/project-skills.json",
      ...skills.map((entry) => entry.targetPath),
    ],
    skills,
  });
  let existingManifest = null;
  if (await pathEntryExists(manifestPath)) {
    await assertSafeRegularFile(
      manifestPath,
      "Project Skill manifest",
    );
    existingManifest = validateProjectSkillManifest(
      await readJson(manifestPath),
    );
    if (
      projectSkillManifestIdentity(existingManifest) !==
      projectSkillManifestIdentity(pendingManifest)
    ) {
      throw new Error(
        "Existing Project Skill manifest differs from the approved selection.",
      );
    }
  }

  const targetParent = path.join(root, ".agents", "skills");
  await ensureSafeDirectoryChain(
    root,
    targetParent,
    "Project Skill directory",
    { create: false },
  );
  for (const skill of skills) {
    const target = path.join(
      root,
      ...skill.targetPath.split("/"),
    );
    if (!(await pathEntryExists(target))) {
      if (existingManifest?.status === "ready") {
        throw new Error(
          `Managed Project Skill is missing; detected drift: ${skill.name}`,
        );
      }
      continue;
    }
    if (!existingManifest) {
      throw new Error(
        `Project Skill target is user-owned; refusing collision: ${skill.targetPath}`,
      );
    }
    const snapshot = await snapshotSkillTree(target);
    if (snapshot.treeSha256 !== skill.treeSha256) {
      throw new Error(
        `Managed Project Skill differs from its source: ${skill.name}`,
      );
    }
  }

  if (existingManifest?.status === "ready") {
    return {
      status: "unchanged",
      manifestPath,
      installedSkills: skills.map((entry) => entry.name),
    };
  }
  if (!existingManifest) {
    await writeNewFileAtomically(
      root,
      manifestPath,
      canonicalJson(pendingManifest),
      "Project Skill manifest",
    );
  }

  await ensureSafeDirectoryChain(
    root,
    targetParent,
    "Project Skill directory",
    { create: true },
  );
  const stage = path.join(
    targetParent,
    `.harness-skill-stage-${randomUUID()}`,
  );
  assertInside(root, stage, "Project Skill staging directory");
  await mkdir(stage, { mode: 0o700 });
  try {
    for (const skill of skills) {
      const target = path.join(
        root,
        ...skill.targetPath.split("/"),
      );
      if (await pathEntryExists(target)) continue;
      const source = path.join(
        profile.repositoryPath,
        ...skill.sourceRelativePath.split("/"),
      );
      const stagedSkill = path.join(stage, skill.name);
      const stagedSnapshot = await snapshotSkillTree(source, {
        copyTo: stagedSkill,
      });
      if (stagedSnapshot.treeSha256 !== skill.treeSha256) {
        throw new Error(
          `Skill source changed during installation: ${skill.name}`,
        );
      }
      if (await pathEntryExists(target)) {
        throw new Error(
          `Project Skill target appeared during installation: ${skill.name}`,
        );
      }
      await rename(stagedSkill, target);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }

  const readyManifest = validateProjectSkillManifest({
    ...pendingManifest,
    status: "ready",
    installedAt: now().toISOString(),
  });
  await replaceFileAtomically(
    root,
    manifestPath,
    canonicalJson(readyManifest),
    "Project Skill manifest",
  );
  return {
    status: "installed",
    manifestPath,
    installedSkills: skills.map((entry) => entry.name),
  };
}

async function readCleanSkillRepositoryIdentity(repositoryPath) {
  const runGit = async (...args) => {
    const { stdout } = await execFile(
      "git",
      ["-C", repositoryPath, ...args],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );
    return String(stdout ?? "").trim();
  };
  const remoteNames = (await runGit("remote"))
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const remotes = [];
  for (const name of remoteNames) {
    const urls = (await runGit("remote", "get-url", "--all", name))
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      throw new Error(
        "Project Skill repository remote identity is incomplete.",
      );
    }
    for (const url of urls) remotes.push({ name, url });
  }
  const clean = (await runGit("status", "--porcelain")) === "";
  if (!clean) {
    throw new Error(
      "Project Skill revision requires a clean catalog repository.",
    );
  }
  return normalizeRepositoryIdentity({
    path: await realpath(repositoryPath),
    branch: await runGit("branch", "--show-current"),
    commit: await runGit("rev-parse", "HEAD"),
    tree: await runGit("rev-parse", "HEAD^{tree}"),
    clean,
    remotes,
  });
}

function normalizeRepositoryIdentity(identity) {
  assertExactKeys(
    identity,
    ["path", "branch", "commit", "tree", "clean", "remotes"],
    "Project Skill repository identity",
  );
  const remotes = normalizeCredentialFreeRepositoryRemotes(identity.remotes);
  if (
    !path.isAbsolute(identity.path) ||
    identity.branch !== "main" ||
    identity.clean !== true ||
    !/^[a-f0-9]{40,64}$/.test(identity.commit) ||
    !/^[a-f0-9]{40,64}$/.test(identity.tree)
  ) {
    throw new Error("Project Skill repository identity is invalid.");
  }
  return {
    path: path.resolve(identity.path),
    branch: identity.branch,
    commit: identity.commit,
    tree: identity.tree,
    clean: true,
    remotes,
  };
}

export async function reviseReadyProjectSkills({
  approved,
  repoRoot,
  homeDir = homedir(),
  selectedSkills,
  globalEssentialSkills,
  repositoryIdentity = null,
  now = () => new Date(),
  skillRoot = DEFAULT_SKILL_ROOT,
  faultInjector,
  isProcessAlive,
  readProcessIdentity,
  provenanceKeyPath,
  replaceExisting = false,
}) {
  if (approved !== true) {
    throw new Error("Ready project Skill revision requires explicit approval.");
  }
  const root = path.resolve(repoRoot);
  const sourceSkill = path.resolve(skillRoot);
  const harnessDir = path.join(root, ".harness");
  const projectPath = path.join(harnessDir, "project.json");
  const ownershipPath = path.join(harnessDir, "ownership.json");
  const schemaPath = path.join(harnessDir, "project.schema.json");
  const policyPath = path.join(
    root,
    ...PROJECT_POLICY_RELATIVE_PATH.split("/"),
  );
  const agentsPath = path.join(root, "AGENTS.md");
  const manifestPath = path.join(harnessDir, "project-skills.json");
  const productManagerSchemaPath = path.join(
    harnessDir,
    "product-manager.schema.json",
  );
  const profile = await loadSkillRepositoryProfile({ homeDir });
  if (!profile) {
    throw new Error(
      "Ready project Skill revision requires a saved Skill repository profile.",
    );
  }
  const requested = normalizeUniqueStrings(
    selectedSkills,
    "Selected project Skills",
    { skillNames: true },
  );
  const essentials = normalizeUniqueStrings(
    globalEssentialSkills,
    "Global essential Skills",
    { skillNames: true },
  );
  if (
    canonicalJson(essentials) !==
    canonicalJson(profile.globalEssentialSkills)
  ) {
    throw new Error(
      "Ready project Skill revision essentials differ from the saved profile.",
    );
  }
  for (const name of requested) {
    if (
      essentials.includes(name) ||
      profile.selection.excludedSkills.includes(name)
    ) {
      throw new Error(
        `Selected project Skill is global or excluded: ${name}.`,
      );
    }
  }
  const identity = repositoryIdentity
    ? normalizeRepositoryIdentity(repositoryIdentity)
    : await readCleanSkillRepositoryIdentity(profile.repositoryPath);
  if (
    normalizeResolvedPath(identity.path) !==
    normalizeResolvedPath(profile.repositoryPath)
  ) {
    throw new Error(
      "Project Skill repository identity differs from the saved profile.",
    );
  }

  const provenanceKey = await loadProjectProvenanceKey(
    root,
    provenanceKeyPath,
  );
  const recoveryLock = await acquireProjectLock(root, {
    isProcessAlive,
    readProcessIdentity,
    provenanceKey,
  });
  try {
    await recoverProjectTransactions(root, {
      isProcessAlive,
      readProcessIdentity,
      provenanceKey,
    });
  } finally {
    await recoveryLock.release();
  }

  const [
    projectFingerprint,
    ownershipFingerprint,
    schemaFingerprint,
    productManagerSchemaFingerprint,
    policyFingerprint,
    agentsFingerprint,
  ] = await Promise.all([
    readFileFingerprint(projectPath, "Harness project contract"),
    readFileFingerprint(ownershipPath, "Harness ownership manifest"),
    readFileFingerprint(schemaPath, "Harness project schema"),
    readFileFingerprint(
      productManagerSchemaPath,
      "Harness product-manager schema",
    ),
    readFileFingerprint(policyPath, "Harness collaboration policy"),
    readFileFingerprint(agentsPath, "AGENTS.md"),
  ]);
  if (
    !projectFingerprint.exists ||
    !ownershipFingerprint.exists ||
    !schemaFingerprint.exists ||
    !productManagerSchemaFingerprint.exists ||
    !policyFingerprint.exists ||
    !agentsFingerprint.exists
  ) {
    throw new Error(
      "Ready project Skill revision requires complete Harness ownership.",
    );
  }
  const contract = JSON.parse(projectFingerprint.bytes.toString("utf8"));
  validateProjectContract(contract);
  if (contract.status !== "ready") {
    throw new Error("Project contract must remain ready during Skill revision.");
  }
  const currentOwnership = validateExistingProjectOwnership(
    JSON.parse(ownershipFingerprint.bytes.toString("utf8")),
    projectFingerprint.sha256,
    schemaFingerprint.sha256,
    productManagerSchemaFingerprint.sha256,
  );
  const managedBlock = currentOwnership.managedBlocks?.find(
    (entry) => entry?.path === "AGENTS.md",
  );
  const currentBlock = findCollaborationBlock(
    agentsFingerprint.bytes.toString("utf8"),
  );
  if (
    !managedBlock ||
    currentBlock === null ||
    sha256(currentBlock) !== managedBlock.renderedBlockSha256
  ) {
    throw new Error(
      "Managed project collaboration policy is missing or modified.",
    );
  }
  const sourcePolicyFingerprint = await readFileFingerprint(
    path.join(sourceSkill, "assets", "collaboration-policy.md"),
    "Harness collaboration policy asset",
  );
  const sourceSchemaFingerprint = await readFileFingerprint(
    path.join(sourceSkill, "assets", "project-contract.schema.json"),
    "Harness project contract schema asset",
  );
  if (!sourceSchemaFingerprint.exists) {
    throw new Error("Harness project contract schema asset does not exist.");
  }
  const sourceSchemaBytes = canonicalJsonBytes(sourceSchemaFingerprint.bytes);
  const sourceSchemaSha256 = sha256(sourceSchemaBytes);
  const sourceProductManagerSchemaFingerprint =
    await readFileFingerprint(
      path.join(
        sourceSkill,
        "assets",
        "product-manager.schema.json",
      ),
      "Harness product-manager schema asset",
    );
  if (!sourceProductManagerSchemaFingerprint.exists) {
    throw new Error("Harness product-manager schema asset does not exist.");
  }
  const sourceProductManagerSchemaBytes = canonicalJsonBytes(
    sourceProductManagerSchemaFingerprint.bytes,
  );
  const sourceProductManagerSchemaSha256 = sha256(
    sourceProductManagerSchemaBytes,
  );
  validateOwnedPolicyProjection(
    currentOwnership,
    managedBlock,
    policyFingerprint,
    sourcePolicyFingerprint.sha256,
    sha256(
      renderCollaborationBlock(
        sourcePolicyFingerprint.bytes.toString("utf8"),
      ),
    ),
  );

  const catalog = await discoverSkillCatalog({
    repositoryPath: profile.repositoryPath,
  });
  const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
  const skills = [];
  for (const name of requested) {
    const catalogEntry = catalogByName.get(name);
    if (!catalogEntry) {
      throw new Error(`Selected Skill is missing from the repository: ${name}`);
    }
    const sourcePath = path.join(
      profile.repositoryPath,
      ...catalogEntry.relativePath.split("/"),
    );
    const snapshot = await snapshotSkillTree(sourcePath);
    const skillDefinition = snapshot.files.find(
      (entry) => entry.path === "SKILL.md",
    );
    if (skillDefinition?.sha256 !== catalogEntry.skillSha256) {
      throw new Error(`Skill source changed during revision: ${name}`);
    }
    skills.push({
      name,
      sourceRelativePath: catalogEntry.relativePath,
      targetPath: `.agents/skills/${name}`,
      skillSha256: catalogEntry.skillSha256,
      treeSha256: snapshot.treeSha256,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
    });
  }
  const managedSkillPaths = [
    ".harness/project-skills.json",
    ...skills.map((entry) => entry.targetPath),
  ];
  const nonSkillManagedPaths = contract.workflow.managedProjectPaths.filter(
    (entry) =>
      entry !== ".harness/project-skills.json" &&
      !entry.startsWith(".agents/skills/"),
  );
  const approvedReasons = new Map(
    contract.skills.projectSelection.map((entry) => [
      entry.name,
      entry.reason,
    ]),
  );
  const candidateContract = {
    ...contract,
    workflow: {
      ...contract.workflow,
      managedProjectPaths: [
        ...nonSkillManagedPaths,
        ...managedSkillPaths,
      ],
    },
    skills: {
      ...contract.skills,
      globalEssential: essentials,
      projectSelection: skills.map((entry) => ({
        name: entry.name,
        reason:
          approvedReasons.get(entry.name) ??
          "Approved as a project-specific Skill for this repository.",
      })),
    },
  };
  validateProjectContract(candidateContract);
  const profileSha256 = sha256(canonicalJson(profile));
  const readyManifest = validateProjectSkillManifest({
    schemaVersion: 2,
    status: "ready",
    owner: "trellis-ccg-harness",
    profileSha256,
    repository: identity,
    installedAt: now().toISOString(),
    managedPaths: managedSkillPaths,
    skills,
  });
  const candidateContractBytes = Buffer.from(
    canonicalJson(candidateContract),
  );
  const manifestBytes = Buffer.from(canonicalJson(readyManifest));
  const existingManifestFingerprint = await readFileFingerprint(
    manifestPath,
    "Project Skill manifest",
  );
  let existingManifest = null;
  if (
    currentOwnership.schemaVersion ===
      PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION ||
    existingManifestFingerprint.exists
  ) {
    if (
      currentOwnership.schemaVersion !==
        PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION ||
      !existingManifestFingerprint.exists ||
      existingManifestFingerprint.sha256 !==
        currentOwnership.projectSkillsManifestSha256
    ) {
      throw new Error("Owned Project Skill manifest is missing or modified.");
    }
    existingManifest = validateProjectSkillManifest(
      JSON.parse(existingManifestFingerprint.bytes.toString("utf8")),
    );
    for (const skill of existingManifest.skills) {
      if (!currentOwnership.managedPaths.includes(skill.targetPath)) {
        throw new Error(`Managed Project Skill ownership is missing: ${skill.name}`);
      }
      const target = path.join(root, ...skill.targetPath.split("/"));
      const snapshot = await snapshotSkillTree(target);
      if (snapshot.treeSha256 !== skill.treeSha256) {
        throw new Error(`Managed Project Skill drifted: ${skill.name}`);
      }
    }
  }
  const previousSkillPaths = new Set(
    existingManifest?.skills.map((entry) => entry.targetPath) ?? [],
  );
  const nextOwnership = {
    ...currentOwnership,
    schemaVersion: PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION,
    contractSha256: sha256(candidateContractBytes),
    schemaSha256: sourceSchemaSha256,
    productManagerSchemaSha256:
      sourceProductManagerSchemaSha256,
    projectSkillsManifestSha256: sha256(manifestBytes),
    managedPaths: [
      ...new Set([
        ...currentOwnership.managedPaths.filter(
          (entry) => !previousSkillPaths.has(entry),
        ),
        ".harness/product-manager.schema.json",
        ...managedSkillPaths,
      ]),
    ],
  };
  const nextOwnershipBytes = Buffer.from(canonicalJson(nextOwnership));

  const sameContractAndSchema =
    projectFingerprint.sha256 === sha256(candidateContractBytes) &&
    schemaFingerprint.sha256 === sourceSchemaSha256 &&
    currentOwnership.schemaVersion ===
      PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION;
  if (sameContractAndSchema && existingManifest !== null) {
    if (
      projectSkillManifestIdentity(existingManifest) ===
      projectSkillManifestIdentity(readyManifest)
    ) {
      return {
        status: "unchanged",
        projectPath,
        manifestPath,
        installedSkills: skills.map((entry) => entry.name),
      };
    }
  }
  if (existingManifest !== null && replaceExisting !== true) {
    throw new Error(
      "Ready project already has a different owned Skill revision; rerun with explicit replacement approval.",
    );
  }

  const lock = await acquireProjectLock(root, {
    isProcessAlive,
    readProcessIdentity,
    provenanceKey,
    faultInjector,
  });
  try {
    await recoverProjectTransactions(root, {
      isProcessAlive,
      readProcessIdentity,
      provenanceKey,
    });
    await assertFingerprintUnchanged(
      projectPath,
      projectFingerprint,
      "Harness project contract",
    );
    await assertFingerprintUnchanged(
      ownershipPath,
      ownershipFingerprint,
      "Harness ownership manifest",
    );
    await assertFingerprintUnchanged(
      schemaPath,
      schemaFingerprint,
      "Harness project schema",
    );
    await assertFingerprintUnchanged(
      policyPath,
      policyFingerprint,
      "Harness collaboration policy",
    );
    await assertFingerprintUnchanged(
      agentsPath,
      agentsFingerprint,
      "AGENTS.md",
    );
    await assertFingerprintUnchanged(
      path.join(sourceSkill, "assets", "project-contract.schema.json"),
      sourceSchemaFingerprint,
      "Harness project contract schema asset",
    );
    for (const skill of skills) {
      const target = path.join(root, ...skill.targetPath.split("/"));
      if (
        await pathEntryExists(target) &&
        !previousSkillPaths.has(skill.targetPath)
      ) {
        throw new Error(
          `Project Skill target is user-owned; refusing collision: ${skill.targetPath}`,
        );
      }
    }
    const existingSkillsByPath = new Map(
      (existingManifest?.skills ?? []).map((skill) => [
        skill.targetPath,
        skill,
      ]),
    );
    const nextSkillsByPath = new Map(
      skills.map((skill) => [skill.targetPath, skill]),
    );
    const directoryTargets = [
      ...new Set([
        ...existingSkillsByPath.keys(),
        ...nextSkillsByPath.keys(),
      ]),
    ].sort((left, right) => left.localeCompare(right)).map((targetPath) => {
      const original = existingSkillsByPath.get(targetPath);
      const next = nextSkillsByPath.get(targetPath);
      return {
        path: targetPath,
        expectedOriginalTreeSha256: original?.treeSha256 ?? null,
        expectedNextTreeSha256: next?.treeSha256 ?? null,
        sourceDirectory: next
          ? path.join(
            profile.repositoryPath,
            ...next.sourceRelativePath.split("/"),
          )
          : null,
      };
    });
    await runProjectTransaction({
      root,
      lock,
      provenanceKey,
      faultInjector,
      directoryTargets,
      preconditions: [
        { path: PROJECT_POLICY_RELATIVE_PATH, expected: policyFingerprint },
        { path: "AGENTS.md", expected: agentsFingerprint },
      ],
      targets: [
        {
          path: ".harness/project.schema.json",
          bytes: sourceSchemaBytes,
          mode: schemaFingerprint.mode,
          expectedOriginal: schemaFingerprint,
        },
        {
          path: ".harness/product-manager.schema.json",
          bytes: sourceProductManagerSchemaBytes,
          mode: productManagerSchemaFingerprint.mode,
          expectedOriginal: productManagerSchemaFingerprint,
        },
        {
          path: ".harness/project.json",
          bytes: candidateContractBytes,
          mode: projectFingerprint.mode,
          expectedOriginal: projectFingerprint,
        },
        {
          path: ".harness/project-skills.json",
          bytes: manifestBytes,
          mode: 0o600,
          expectedOriginal: await readFileFingerprint(
            manifestPath,
            "Project Skill manifest",
          ),
        },
        {
          path: ".harness/ownership.json",
          bytes: nextOwnershipBytes,
          mode: ownershipFingerprint.mode,
          expectedOriginal: ownershipFingerprint,
        },
      ],
    });
    return {
      status: "revised",
      projectPath,
      manifestPath,
      contractSha256: sha256(candidateContractBytes),
      projectSkillsManifestSha256: sha256(manifestBytes),
      installedSkills: skills.map((entry) => entry.name),
    };
  } finally {
    await lock.release();
  }
}

export {
  AGENTS_PERSONAL_SKILLS,
  CODEX_PERSONAL_SKILLS,
  GLOBAL_PLATFORM_SKILLS,
  HARNESS_PROJECTED_SKILLS,
  planSkillPlatformMigration,
  rollbackSkillPlatformMigration,
  seedPersonalSkillRepository,
};

export async function applySkillPlatformMigration(options) {
  return applySkillPlatformMigrationCore({
    ...options,
    reviseProjectSkills:
      options?.reviseProjectSkills ?? reviseReadyProjectSkills,
  });
}

export async function auditSkillPlatformMigration(options) {
  return auditSkillPlatformMigrationCore(options);
}

function assertSafeProjectPaths(values, label) {
  assertStringArray(values, label);
  for (const value of values) {
    const normalized = value.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      path.posix.normalize(normalized) !== normalized ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(`${label} contains an unsafe project path: ${value}.`);
    }
  }
}

function assertNoCredentials(value, location = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoCredentials(entry, `${location}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && CREDENTIAL_VALUE.test(value)) {
      throw new Error(
        `Credential or secret value is forbidden in the contract at ${location}.`,
      );
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key) && !ALLOWED_POLICY_KEYS.has(key)) {
      throw new Error(
        `Credential or secret field is forbidden in the contract at ${location}.${key}.`,
      );
    }
    assertNoCredentials(entry, `${location}.${key}`);
  }
}

function assertProviders(providers) {
  assertObject(providers, "providers");
  for (const provider of ["codex", "gemini", "claude", "grok", "gptPro"]) {
    assertObject(providers[provider], `providers.${provider}`);
    for (const field of ["enabled", "workspaceWrite"]) {
      if (typeof providers[provider][field] !== "boolean") {
        throw new Error(`providers.${provider}.${field} must be boolean.`);
      }
    }
  }
  if (!providers.codex.enabled || !providers.codex.workspaceWrite) {
    throw new Error("Codex must remain the enabled workspace writer.");
  }
  for (const provider of ["gemini", "claude", "grok", "gptPro"]) {
    if (providers[provider].workspaceWrite) {
      throw new Error(
        `${provider} cannot receive workspace write authority.`,
      );
    }
  }
  for (const provider of ["grok", "gptPro"]) {
    if (typeof providers[provider].manualOnly !== "boolean") {
      throw new Error(`providers.${provider}.manualOnly must be boolean.`);
    }
  }
  if (providers.grok.enabled && providers.grok.manualOnly !== true) {
    throw new Error("grok must remain manual-only when enabled.");
  }
  if (providers.gptPro.manualOnly !== false) {
    throw new Error("gptPro must use the automated sidebar transport.");
  }
}

function assertProductManager(productManager) {
  assertObject(productManager, "productManager");
  assertExactKeys(
    productManager,
    [
      "stateAuthority",
      "stateFile",
      "evidenceRoot",
      "selectedProviderAuthority",
      "allowedProviders",
      "providerCapabilities",
    ],
    "productManager",
  );
  const expected = {
    stateAuthority: "trellis-task-projection",
    stateFile: ".trellis/tasks/<task>/product-manager.json",
    evidenceRoot:
      ".trellis/tasks/<task>/.ccg-evidence/product-manager",
    selectedProviderAuthority: "unified-ccg-routing",
  };
  for (const [field, value] of Object.entries(expected)) {
    if (productManager[field] !== value) {
      throw new Error(`productManager.${field} must be ${value}.`);
    }
  }
  if (
    !Array.isArray(productManager.allowedProviders) ||
    productManager.allowedProviders.length === 0 ||
    productManager.allowedProviders.some(
      (provider) => !["codex", "gemini", "claude"].includes(provider),
    ) ||
    new Set(productManager.allowedProviders).size !==
      productManager.allowedProviders.length
  ) {
    throw new Error(
      "productManager.allowedProviders must be a unique non-empty subset of codex, gemini, and claude.",
    );
  }
  assertObject(
    productManager.providerCapabilities,
    "productManager.providerCapabilities",
  );
  assertExactKeys(
    productManager.providerCapabilities,
    ["codex", "gemini", "claude"],
    "productManager.providerCapabilities",
  );
  for (const provider of ["codex", "gemini", "claude"]) {
    const capabilities = productManager.providerCapabilities[provider];
    assertObject(
      capabilities,
      `productManager.providerCapabilities.${provider}`,
    );
    assertExactKeys(
      capabilities,
      [
        "readOnly",
        "workspaceWrite",
        "terminal",
        "subagents",
        "network",
        "paid",
      ],
      `productManager.providerCapabilities.${provider}`,
    );
    if (
      capabilities.readOnly !== true ||
      capabilities.workspaceWrite !== false ||
      capabilities.terminal !== false ||
      capabilities.subagents !== false ||
      capabilities.network !== "explicit-per-call" ||
      capabilities.paid !== "explicit-per-call"
    ) {
      throw new Error(
        `productManager provider ${provider} must be independently read-only with no terminal, workspace-write, or subagent authority.`,
      );
    }
  }
}

function assertContractObjects(contract) {
  for (const field of [
    "project",
    "authorities",
    "workflow",
    "toolchain",
    "qualityGates",
    "skills",
    "security",
    "productManager",
    "hooks",
    "source",
    "ci",
    "approval",
  ]) {
    assertObject(contract[field], field);
  }
  if (!Array.isArray(contract.unresolvedDecisions)) {
    throw new Error("unresolvedDecisions must be an array.");
  }
}

function assertContractAuthorities(authorities) {
  const expected = {
    lifecycle: "trellis",
    tasks: ".trellis/tasks",
    requirements: ".trellis/tasks",
    specifications: ".trellis/spec",
    intelligence: "ccg",
    workspaceWriter: "codex",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (authorities[key] !== value) {
      throw new Error(`authorities.${key} must be ${value}.`);
    }
  }
}

function assertContractWorkflow(contract) {
  if (contract.workflow.dispatchMode !== "inline") {
    throw new Error("workflow.dispatchMode must be inline.");
  }
  if (contract.workflow.planningApprovalRequired !== true) {
    throw new Error("Planning approval must remain required.");
  }
  for (const field of [
    "taskLifecycle",
    "managedProjectPaths",
    "ignoredRuntimePaths",
    "forbiddenTrackedPaths",
  ]) {
    assertSafeProjectPaths(
      contract.workflow[field],
      `workflow.${field}`,
    );
  }
  for (const field of [
    "requiredLocalCommands",
    "requiredCiChecks",
    "definitionOfDone",
  ]) {
    assertStringArray(contract.qualityGates[field], `qualityGates.${field}`);
  }
}

function assertContractSkills(skills, workflow) {
  assertExactKeys(
    skills,
    [
      "globalPolicy",
      "globalEssential",
      "repositoryProfile",
      "selectionMode",
      "installMode",
      "projectSelection",
    ],
    "skills",
  );
  const expected = {
    globalPolicy: "minimal-essential-only",
    repositoryProfile: "user-saved",
    selectionMode: "recommend-and-approve",
    installMode: "copy",
  };
  for (const [field, value] of Object.entries(expected)) {
    if (skills[field] !== value) {
      throw new Error(`skills.${field} must be ${value}.`);
    }
  }
  const globalEssential = normalizeUniqueStrings(
    skills.globalEssential,
    "skills.globalEssential",
    { skillNames: true },
  );
  for (const required of REQUIRED_GLOBAL_SKILLS) {
    if (!globalEssential.includes(required)) {
      throw new Error(`skills.globalEssential must include ${required}.`);
    }
  }
  if (!Array.isArray(skills.projectSelection)) {
    throw new Error("skills.projectSelection must be an array.");
  }
  const names = new Set();
  for (const entry of skills.projectSelection) {
    assertExactKeys(entry, ["name", "reason"], "Project Skill selection");
    assertString(entry.name, "Project Skill selection name");
    assertString(entry.reason, `Project Skill ${entry.name} reason`);
    if (!SKILL_NAME.test(entry.name) || names.has(entry.name)) {
      throw new Error("skills.projectSelection contains an invalid name.");
    }
    if (globalEssential.includes(entry.name)) {
      throw new Error(
        `Project Skill ${entry.name} duplicates a global essential Skill.`,
      );
    }
    const targetPath = `.agents/skills/${entry.name}`;
    if (!workflow.managedProjectPaths.includes(targetPath)) {
      throw new Error(
        `workflow.managedProjectPaths must include ${targetPath}.`,
      );
    }
    names.add(entry.name);
  }
}

function assertContractThirdParty(contract) {
  if (contract.thirdParty === undefined) return;
  assertObject(contract.thirdParty, "thirdParty");
  assertExactKeys(
    contract.thirdParty,
    [
      "sourceManifestSha256",
      "globalSkills",
      "globalPlugins",
      "projectSkills",
      "mcpCli",
      "excluded",
    ],
    "thirdParty",
  );
  const digest = contract.thirdParty.sourceManifestSha256;
  if (
    digest !== null &&
    (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))
  ) {
    throw new Error(
      "thirdParty.sourceManifestSha256 must be null or a SHA-256 digest.",
    );
  }
  if (contract.status !== "draft" && digest === null) {
    throw new Error(
      "Approved or ready contracts must bind the third-party source manifest SHA-256.",
    );
  }
  for (const field of [
    "globalSkills",
    "globalPlugins",
    "projectSkills",
    "mcpCli",
    "excluded",
  ]) {
    assertStringArray(contract.thirdParty[field], `thirdParty.${field}`);
    const normalized = contract.thirdParty[field].map((entry) =>
      entry.toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      throw new Error(`thirdParty.${field} must not contain duplicates.`);
    }
  }
}

function assertContractSecurity(contract) {
  if (
    contract.security.strictDataBoundary !== null &&
    typeof contract.security.strictDataBoundary !== "boolean"
  ) {
    throw new Error("security.strictDataBoundary must be a boolean or null in a draft.");
  }
  if (contract.security.credentialFieldsForbidden !== true) {
    throw new Error("Credential fields must remain forbidden.");
  }
  if (
    contract.security.secretPolicy !==
    "environment-or-owned-secret-store"
  ) {
    throw new Error(
      "security.secretPolicy must use environment-or-owned-secret-store.",
    );
  }
  assertSafeProjectPaths(
    contract.security.forbiddenTrackedPaths,
    "security.forbiddenTrackedPaths",
  );
  if (contract.hooks.globalMutationAllowed !== false) {
    throw new Error("Global mutation must remain disabled.");
  }
  if (contract.ci.offlineByDefault !== true) {
    throw new Error("CI must remain offline by default.");
  }
}

function assertApprovedContract(contract) {
  if (contract.status !== "approved") {
    throw new Error(
      "Project contract must have status approved before initialization.",
    );
  }
  if (contract.unresolvedDecisions.length !== 0) {
    throw new Error(
      "Approved project contract cannot contain unresolved decisions.",
    );
  }
  for (const field of ["name", "purpose", "adoptionMode"]) {
    assertString(contract.project[field], `project.${field}`);
  }
  if (contract.project.repositoryRoot !== ".") {
    throw new Error("project.repositoryRoot must be '.'.");
  }
  assertString(
    contract.security.dataClassification,
    "security.dataClassification",
  );
  assertString(contract.security.networkPolicy, "security.networkPolicy");
  if (typeof contract.security.strictDataBoundary !== "boolean") {
    throw new Error(
      "Approved project contract security.strictDataBoundary must be a boolean.",
    );
  }
  for (const field of [
    "dependencyPolicy",
    "updatePolicy",
    "rollbackPolicy",
    "uninstallPolicy",
  ]) {
    assertString(contract.source[field], `source.${field}`);
  }
  assertString(contract.approval.approvedBy, "approval.approvedBy");
  assertString(contract.approval.approvedAt, "approval.approvedAt");
  if (Number.isNaN(Date.parse(contract.approval.approvedAt))) {
    throw new Error("approval.approvedAt must be an ISO date-time.");
  }
}

function assertDraftProjectFields(contract) {
  for (const field of ["name", "purpose", "adoptionMode"]) {
    assertString(contract.project[field], `project.${field}`, {
      allowNull: contract.status === "draft",
    });
  }
}

export function validateProjectContract(
  contract,
  { requireApproved = false } = {},
) {
  assertObject(contract, "Project contract");
  assertNoCredentials(contract);
  if (contract.schemaVersion !== 1) {
    throw new Error("Project contract schemaVersion must be 1.");
  }
  if (!CONTRACT_STATUSES.has(contract.status)) {
    throw new Error("Project contract status is unsupported.");
  }

  assertContractObjects(contract);
  assertContractAuthorities(contract.authorities);
  assertContractWorkflow(contract);
  assertContractSkills(contract.skills, contract.workflow);
  assertContractThirdParty(contract);
  assertProviders(contract.providers);
  assertProductManager(contract.productManager);
  assertContractSecurity(contract);
  if (requireApproved) assertApprovedContract(contract);
  else assertDraftProjectFields(contract);
  return contract;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalJsonBytes(bytes) {
  return Buffer.from(
    canonicalJson(JSON.parse(bytes.toString("utf8"))),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

function normalizeResolvedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectTargetPath(root, relativePath, label = "Project target") {
  if (
    typeof relativePath !== "string" ||
    !PROJECT_TRANSACTION_TARGETS.has(relativePath)
  ) {
    throw new Error(`${label} is outside the Harness-owned project surface.`);
  }
  const target = path.join(root, ...relativePath.split("/"));
  assertInside(root, target, label);
  return target;
}

function projectSkillTransactionTargetPath(
  root,
  relativePath,
  label = "Project Skill transaction target",
) {
  if (
    typeof relativePath !== "string" ||
    !PROJECT_SKILL_TRANSACTION_TARGET.test(relativePath)
  ) {
    throw new Error(
      `${label} is outside the Harness-owned Project Skill surface.`,
    );
  }
  const target = path.join(root, ...relativePath.split("/"));
  assertInside(root, target, label);
  return target;
}

function statIdentity(details) {
  return {
    dev: String(details.dev),
    ino: String(details.ino),
    size: String(details.size),
    mtimeMs: String(details.mtimeMs),
    ctimeMs: String(details.ctimeMs),
    birthtimeMs: String(details.birthtimeMs),
    uid: String(details.uid),
    gid: String(details.gid),
  };
}

function identitiesEqual(left, right, { ignoreCtime = false } = {}) {
  return (
    left?.dev === right?.dev &&
    left?.ino === right?.ino &&
    left?.size === right?.size &&
    left?.mtimeMs === right?.mtimeMs &&
    (ignoreCtime || left?.ctimeMs === right?.ctimeMs) &&
    left?.birthtimeMs === right?.birthtimeMs &&
    left?.uid === right?.uid &&
    left?.gid === right?.gid
  );
}

async function readFileFingerprint(target, label) {
  let before;
  try {
    before = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        sha256: null,
        identity: null,
        mode: null,
        bytes: null,
      };
    }
    throw error;
  }
  if (before.isSymbolicLink()) {
    throw new Error(`${label} is a symbolic link or reparse point: ${target}`);
  }
  if (!before.isFile()) {
    throw new Error(`${label} is not a regular file: ${target}`);
  }
  const bytes = await readFile(target);
  const after = await lstat(target);
  const beforeIdentity = statIdentity(before);
  const afterIdentity = statIdentity(after);
  if (!identitiesEqual(beforeIdentity, afterIdentity)) {
    throw new Error(`${label} changed while it was being read.`);
  }
  return {
    exists: true,
    sha256: sha256(bytes),
    identity: afterIdentity,
    mode: after.mode & 0o777,
    bytes,
  };
}

function journalFingerprint(fingerprint) {
  return {
    exists: fingerprint.exists,
    sha256: fingerprint.sha256,
    identity: fingerprint.identity,
    mode: fingerprint.mode,
  };
}

function fingerprintMatches(
  current,
  expected,
  {
    requireIdentity = true,
    ignoreCtime = false,
  } = {},
) {
  if (current.exists !== expected.exists) return false;
  if (!current.exists) return true;
  return (
    current.sha256 === expected.sha256 &&
    current.mode === expected.mode &&
    (
      !requireIdentity ||
      identitiesEqual(current.identity, expected.identity, {
        ignoreCtime,
      })
    )
  );
}

async function assertFingerprintUnchanged(target, expected, label) {
  const current = await readFileFingerprint(target, label);
  if (!fingerprintMatches(current, expected)) {
    throw new Error(
      `${label} drifted after discovery; refusing compare-and-swap replacement.`,
    );
  }
  return current;
}

function assertOutside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    !relative ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    throw new Error(`${label} must stay outside the target repository.`);
  }
}

async function loadProjectProvenanceKey(root, configuredPath) {
  const keyPath = path.resolve(
    configuredPath ??
      process.env.HARNESS_INIT_PROVENANCE_KEY_PATH ??
      path.join(homedir(), ".harness-init", "project-transaction.key"),
  );
  assertOutside(root, keyPath, "Harness recovery provenance key");
  const parent = path.dirname(keyPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentDetails = await lstat(parent);
  if (parentDetails.isSymbolicLink() || !parentDetails.isDirectory()) {
    throw new Error(
      `Harness recovery provenance directory is unsafe: ${parent}`,
    );
  }
  if (
    process.platform !== "win32" &&
    (parentDetails.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Harness recovery provenance directory must not be accessible by group or other users.",
    );
  }
  try {
    await writeFile(keyPath, randomBytes(32).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await assertSafeRegularFile(keyPath, "Harness recovery provenance key");
  const details = await lstat(keyPath);
  if (process.platform !== "win32" && (details.mode & 0o077) !== 0) {
    throw new Error(
      "Harness recovery provenance key must not be accessible by group or other users.",
    );
  }
  const encoded = (await readFile(keyPath, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error("Harness recovery provenance key is invalid.");
  }
  return Buffer.from(encoded, "hex");
}

function provenanceDigest(key, domain, payload) {
  return createHmac("sha256", key)
    .update(`harness-init:${domain}\n`)
    .update(canonicalJson(payload))
    .digest("hex");
}

function authenticateProjectRecord(key, domain, payload) {
  return {
    ...payload,
    provenance: {
      schemaVersion: PROJECT_PROVENANCE_SCHEMA_VERSION,
      algorithm: "hmac-sha256",
      digest: provenanceDigest(key, domain, payload),
    },
  };
}

function verifyProjectRecordProvenance(key, domain, record, label) {
  const { provenance, ...payload } = record ?? {};
  if (
    provenance?.schemaVersion !== PROJECT_PROVENANCE_SCHEMA_VERSION ||
    provenance?.algorithm !== "hmac-sha256" ||
    !/^[a-f0-9]{64}$/i.test(String(provenance?.digest ?? ""))
  ) {
    throw new Error(
      `${label} lacks authenticated recovery provenance; manual review is required.`,
    );
  }
  const expected = Buffer.from(provenanceDigest(key, domain, payload), "hex");
  const actual = Buffer.from(provenance.digest, "hex");
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new Error(
      `${label} recovery provenance is not authentic; preserving residue for manual review.`,
    );
  }
  return payload;
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function assertSafeDirectory(target, label, { allowMissing } = {}) {
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) {
      throw new Error(
        `${label} is a symbolic link or reparse point: ${target}`,
      );
    }
    if (!details.isDirectory()) {
      throw new Error(`${label} is not a regular directory: ${target}`);
    }
    return true;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return false;
    throw error;
  }
}

function validateTransactionOwner(owner, root, label, provenanceKey) {
  if (owner?.schemaVersion !== PROJECT_OWNER_SCHEMA_VERSION) {
    throw new Error(
      `${label} lacks authenticated recovery provenance; manual review is required.`,
    );
  }
  const payload = verifyProjectRecordProvenance(
    provenanceKey,
    "owner",
    owner,
    `${label} owner`,
  );
  if (
    !Number.isSafeInteger(payload.pid) ||
    payload.pid <= 0 ||
    typeof payload.processIdentity !== "string" ||
    !payload.processIdentity ||
    typeof payload.createdAt !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(String(payload.token ?? "")) ||
    normalizeResolvedPath(payload.repoRoot) !== normalizeResolvedPath(root)
  ) {
    throw new Error(`${label} ownership metadata is invalid.`);
  }
  return owner;
}

async function readOwnedDirectoryOwner(
  directory,
  root,
  label,
  provenanceKey,
) {
  await assertSafeDirectory(directory, label);
  const ownerPath = path.join(directory, "owner.json");
  await assertSafeRegularFile(ownerPath, `${label} owner`);
  return validateTransactionOwner(
    JSON.parse(await readFile(ownerPath, "utf8")),
    root,
    label,
    provenanceKey,
  );
}

async function cleanupProjectGcTombstones(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.name.startsWith(PROJECT_GC_PREFIX)) continue;
    if (!PROJECT_GC_PATTERN.test(entry.name)) {
      throw new Error(
        `Unrecognized Harness cleanup tombstone requires manual review: ${entry.name}`,
      );
    }
    const directory = path.join(root, entry.name);
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error(
        `Harness cleanup tombstone is not a regular directory: ${directory}`,
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function readPlatformProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const [bootId, statLine] = await Promise.all([
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readFile(`/proc/${pid}/stat`, "utf8"),
      ]);
      const commandEnd = statLine.lastIndexOf(")");
      if (commandEnd < 0) return undefined;
      const fields = statLine.slice(commandEnd + 2).trim().split(/\s+/);
      const startTicks = fields[19];
      if (!startTicks) return undefined;
      return `linux:${bootId.trim()}:${startTicks}`;
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ESRCH") return null;
      return undefined;
    }
  }
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
            "[Console]::Out.Write($p.StartTime.ToUniversalTime().Ticks)",
        ],
        { windowsHide: true, timeout: 5_000, maxBuffer: 4_096 },
      );
      const ticks = stdout.trim();
      if (/^\d+$/.test(ticks)) return `win32:${pid}:${ticks}`;
      return undefined;
    } catch {
      return undefined;
    }
  }
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFile(
        "/bin/ps",
        ["-p", String(pid), "-o", "lstart="],
        {
          timeout: 5_000,
          maxBuffer: 4_096,
          env: { ...process.env, LANG: "C", LC_ALL: "C" },
        },
      );
      const startedAt = stdout.trim().replace(/\s+/g, " ");
      if (startedAt) return `darwin:${pid}:${startedAt}`;
      return undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function defaultReadProcessIdentity(pid) {
  if (pid === process.pid) {
    currentProcessIdentityPromise ??= readPlatformProcessIdentity(pid).then(
      (identity) => identity ?? CURRENT_PROCESS_FALLBACK_IDENTITY,
    );
    return currentProcessIdentityPromise;
  }
  return readPlatformProcessIdentity(pid);
}

async function transactionOwnerIsAlive(
  owner,
  {
    isProcessAlive = defaultIsProcessAlive,
    readProcessIdentity = defaultReadProcessIdentity,
    identityIsAuthoritative = true,
  } = {},
) {
  if (!(await isProcessAlive(owner.pid))) return false;
  const observed = await readProcessIdentity(owner.pid);
  if (owner.processIdentity.startsWith("fallback:")) {
    return owner.pid === process.pid
      ? observed === owner.processIdentity
      : true;
  }
  if (typeof observed === "string") {
    return observed === owner.processIdentity;
  }
  if (observed === null && identityIsAuthoritative) return false;
  return true;
}

async function terminalizeOwnedDirectory(
  root,
  directory,
  kind,
  { faultInjector, phase } = {},
) {
  if (!["transaction", "lock", "candidate"].includes(kind)) {
    throw new Error(`Unsupported Harness cleanup tombstone kind: ${kind}`);
  }
  const tombstone = path.join(
    root,
    `${PROJECT_GC_PREFIX}${kind}-${randomUUID()}`,
  );
  assertInside(root, tombstone, "Harness cleanup tombstone");
  await rename(directory, tombstone);
  if (faultInjector && phase) await faultInjector(phase);
  await rm(tombstone, { recursive: true, force: true });
}

async function clearStaleProjectLock(
  root,
  provenanceKey,
  processOptions,
) {
  const lockDirectory = path.join(root, PROJECT_LOCK_PATH);
  if (!(await pathEntryExists(lockDirectory))) return;
  const owner = await readOwnedDirectoryOwner(
    lockDirectory,
    root,
    "Harness initialization lock",
    provenanceKey,
  );
  if (await transactionOwnerIsAlive(owner, processOptions)) {
    throw new Error(
      `Another Harness initializer is running with PID ${owner.pid}.`,
    );
  }
  await terminalizeOwnedDirectory(root, lockDirectory, "lock");
}

async function acquireProjectLock(
  root,
  {
    isProcessAlive = defaultIsProcessAlive,
    readProcessIdentity = defaultReadProcessIdentity,
    provenanceKey,
    faultInjector,
  } = {},
) {
  await cleanupProjectGcTombstones(root);
  const processOptions = {
    isProcessAlive,
    readProcessIdentity,
    identityIsAuthoritative:
      readProcessIdentity !== defaultReadProcessIdentity ||
      isProcessAlive === defaultIsProcessAlive,
  };
  await clearStaleProjectLock(root, provenanceKey, processOptions);
  const token = randomUUID();
  const candidate = path.join(
    root,
    `${PROJECT_LOCK_CANDIDATE_PREFIX}${token}`,
  );
  const lockDirectory = path.join(root, PROJECT_LOCK_PATH);
  const processIdentity = await readProcessIdentity(process.pid);
  if (typeof processIdentity !== "string" || !processIdentity) {
    throw new Error(
      "Harness initializer could not determine its process instance identity.",
    );
  }
  const owner = authenticateProjectRecord(provenanceKey, "owner", {
    schemaVersion: PROJECT_OWNER_SCHEMA_VERSION,
    pid: process.pid,
    processIdentity,
    createdAt: new Date().toISOString(),
    token,
    repoRoot: root,
  });
  await mkdir(candidate, { mode: 0o700 });
  try {
    await writeFile(
      path.join(candidate, "owner.json"),
      canonicalJson(owner),
      { flag: "wx", mode: 0o600 },
    );
    await rename(candidate, lockDirectory);
  } catch (error) {
    if (await pathEntryExists(candidate)) {
      await terminalizeOwnedDirectory(root, candidate, "candidate");
    }
    if (await pathEntryExists(lockDirectory)) {
      const current = await readOwnedDirectoryOwner(
        lockDirectory,
        root,
        "Harness initialization lock",
        provenanceKey,
      );
      throw new Error(
        `Another Harness initializer is running or owns the project lock with PID ${current.pid}.`,
      );
    }
    throw error;
  }
  return {
    directory: lockDirectory,
    owner,
    async release() {
      if (!(await pathEntryExists(lockDirectory))) return;
      const current = await readOwnedDirectoryOwner(
        lockDirectory,
        root,
        "Harness initialization lock",
        provenanceKey,
      );
      if (current.token !== token) {
        throw new Error(
          "Harness initialization lock ownership changed; refusing cleanup.",
        );
      }
      await terminalizeOwnedDirectory(root, lockDirectory, "lock", {
        faultInjector,
        phase: "after-lock-terminalize",
      });
    },
  };
}

function transactionStagePath(stageDirectory, bucket, relativePath) {
  const target = path.join(
    stageDirectory,
    bucket,
    ...relativePath.split("/"),
  );
  assertInside(stageDirectory, target, "Transaction staging path");
  return target;
}

async function writeStagedFile(stageDirectory, target, bytes, mode) {
  await ensureSafeDirectoryChain(
    stageDirectory,
    path.dirname(target),
    "Transaction staging parent",
    { create: true },
  );
  await writeFile(target, bytes, { flag: "wx", mode });
}

async function collectMissingTargetDirectories(
  root,
  targets,
  directoryTargets = [],
) {
  const candidates = new Set();
  for (const target of targets) {
    let current = path.dirname(projectTargetPath(root, target.path));
    while (normalizeResolvedPath(current) !== normalizeResolvedPath(root)) {
      candidates.add(current);
      current = path.dirname(current);
    }
  }
  for (const target of directoryTargets) {
    let current = path.dirname(
      projectSkillTransactionTargetPath(root, target.path),
    );
    while (normalizeResolvedPath(current) !== normalizeResolvedPath(root)) {
      candidates.add(current);
      current = path.dirname(current);
    }
  }
  const ordered = [...candidates].sort(
    (left, right) =>
      left.split(path.sep).length - right.split(path.sep).length,
  );
  const missing = [];
  for (const directory of ordered) {
    const present = await assertSafeDirectory(
      directory,
      "Harness transaction target parent",
      { allowMissing: true },
    );
    if (!present) {
      missing.push(
        path.relative(root, directory).split(path.sep).join("/"),
      );
    }
  }
  return missing;
}

async function prepareProjectTransaction({
  root,
  lock,
  targets,
  directoryTargets = [],
  preconditions = [],
  provenanceKey,
}) {
  const id = randomUUID();
  const stageDirectory = path.join(root, `${PROJECT_TRANSACTION_PREFIX}${id}`);
  assertInside(root, stageDirectory, "Harness transaction staging directory");
  await mkdir(stageDirectory, { mode: 0o700 });
  await writeFile(
    path.join(stageDirectory, "owner.json"),
    canonicalJson(
      authenticateProjectRecord(provenanceKey, "owner", {
        schemaVersion: PROJECT_OWNER_SCHEMA_VERSION,
        pid: process.pid,
        processIdentity: lock.owner.processIdentity,
        createdAt: new Date().toISOString(),
        token: id,
        repoRoot: root,
      }),
    ),
    { flag: "wx", mode: 0o600 },
  );

  const targetPaths = new Set(targets.map((target) => target.path));
  const directoryTargetPaths = new Set();
  if (
    targetPaths.size !== targets.length ||
    (directoryTargets.length === 0 && targets.length === 0)
  ) {
    throw new Error("Harness transaction targets must be unique and non-empty.");
  }
  const preconditionPaths = new Set();
  const journalPreconditions = [];
  for (const precondition of preconditions) {
    if (
      !precondition ||
      preconditionPaths.has(precondition.path) ||
      targetPaths.has(precondition.path)
    ) {
      throw new Error(
        "Harness transaction preconditions must be unique read-only project paths.",
      );
    }
    const absolute = projectTargetPath(
      root,
      precondition.path,
      "Harness transaction precondition",
    );
    const current = await assertFingerprintUnchanged(
      absolute,
      precondition.expected,
      `${precondition.path} transaction precondition`,
    );
    preconditionPaths.add(precondition.path);
    journalPreconditions.push({
      path: precondition.path,
      fingerprint: journalFingerprint(current),
    });
  }

  const journalTargets = [];
  for (const target of targets) {
    const absolute = projectTargetPath(
      root,
      target.path,
      "Harness transaction target",
    );
    const original = target.expectedOriginal
      ? await assertFingerprintUnchanged(
        absolute,
        target.expectedOriginal,
        target.path,
      )
      : await readFileFingerprint(absolute, target.path);
    const nextPath = transactionStagePath(
      stageDirectory,
      "next",
      target.path,
    );
    const backupPath = transactionStagePath(
      stageDirectory,
      "backup",
      target.path,
    );
    const displacedPath = transactionStagePath(
      stageDirectory,
      "displaced",
      target.path,
    );
    await writeStagedFile(
      stageDirectory,
      nextPath,
      target.bytes,
      target.mode,
    );
    const stagedNext = await readFileFingerprint(
      nextPath,
      `Staged ${target.path}`,
    );
    if (stagedNext.sha256 !== sha256(target.bytes)) {
      throw new Error(`Staged ${target.path} failed digest verification.`);
    }
    if (original.exists) {
      await writeStagedFile(
        stageDirectory,
        backupPath,
        original.bytes,
        original.mode,
      );
      const backup = await readFileFingerprint(
        backupPath,
        `Backup ${target.path}`,
      );
      if (backup.sha256 !== original.sha256) {
        throw new Error(`Backup ${target.path} failed digest verification.`);
      }
    } else {
      await ensureSafeDirectoryChain(
        stageDirectory,
        path.dirname(displacedPath),
        "Transaction displaced parent",
        { create: true },
      );
    }
    journalTargets.push({
      path: target.path,
      original: journalFingerprint(original),
      next: {
        sha256: stagedNext.sha256,
        mode: stagedNext.mode,
      },
    });
  }

  const journalDirectoryTargets = [];
  for (const target of directoryTargets) {
    if (
      !target ||
      directoryTargetPaths.has(target.path) ||
      (
        typeof target.expectedOriginalTreeSha256 !== "string" &&
        target.expectedOriginalTreeSha256 !== null
      ) ||
      (
        typeof target.expectedNextTreeSha256 !== "string" &&
        target.expectedNextTreeSha256 !== null
      )
    ) {
      throw new Error("Harness Project Skill transaction target is invalid.");
    }
    const absolute = projectSkillTransactionTargetPath(root, target.path);
    const originalExists = await pathEntryExists(absolute);
    let originalTreeSha256 = null;
    if (originalExists) {
      originalTreeSha256 = (await snapshotSkillTree(absolute)).treeSha256;
    }
    if (
      originalTreeSha256 !== target.expectedOriginalTreeSha256
    ) {
      throw new Error(
        `${target.path} drifted before the Project Skill transaction was journaled.`,
      );
    }

    let nextTreeSha256 = null;
    if (target.expectedNextTreeSha256 !== null) {
      assertString(
        target.sourceDirectory,
        `${target.path} source directory`,
      );
      const stagedNext = transactionStagePath(
        stageDirectory,
        "next-directories",
        target.path,
      );
      const copied = await snapshotSkillTree(
        path.resolve(target.sourceDirectory),
        { copyTo: stagedNext },
      );
      nextTreeSha256 = copied.treeSha256;
      if (nextTreeSha256 !== target.expectedNextTreeSha256) {
        throw new Error(
          `Project Skill source changed while staging: ${target.path}.`,
        );
      }
    }
    if (
      originalTreeSha256 === null &&
      nextTreeSha256 === null
    ) {
      throw new Error(
        `Project Skill transaction target has no current or next tree: ${target.path}.`,
      );
    }
    directoryTargetPaths.add(target.path);
    journalDirectoryTargets.push({
      path: target.path,
      original: {
        exists: originalTreeSha256 !== null,
        treeSha256: originalTreeSha256,
      },
      next: {
        exists: nextTreeSha256 !== null,
        treeSha256: nextTreeSha256,
      },
    });
  }

  const journal = authenticateProjectRecord(provenanceKey, "journal", {
    schemaVersion: PROJECT_JOURNAL_SCHEMA_VERSION,
    operation: "project-policy-apply",
    id,
    repoRoot: root,
    lockToken: lock.owner.token,
    createdAt: new Date().toISOString(),
    createdDirectories: await collectMissingTargetDirectories(
      root,
      targets,
      directoryTargets,
    ),
    preconditions: journalPreconditions,
    targets: journalTargets,
    directoryTargets: journalDirectoryTargets,
  });
  const journalBytes = canonicalJson(journal);
  await writeFile(
    path.join(stageDirectory, "journal.json"),
    journalBytes,
    { flag: "wx", mode: 0o600 },
  );
  return {
    stageDirectory,
    journal,
    journalSha256: sha256(journalBytes),
  };
}

function validJournalFingerprint(fingerprint) {
  if (!fingerprint || typeof fingerprint.exists !== "boolean") {
    return false;
  }
  if (!fingerprint.exists) {
    return (
      fingerprint.sha256 === null &&
      fingerprint.identity === null &&
      fingerprint.mode === null
    );
  }
  return (
    /^[a-f0-9]{64}$/.test(String(fingerprint.sha256 ?? "")) &&
    fingerprint.identity &&
    Number.isInteger(fingerprint.mode)
  );
}

function validateProjectTransactionJournal(
  journal,
  root,
  stageDirectory,
  provenanceKey,
) {
  if (journal?.schemaVersion !== PROJECT_JOURNAL_SCHEMA_VERSION) {
    throw new Error(
      "Harness project transaction journal lacks authenticated recovery provenance; manual review is required.",
    );
  }
  verifyProjectRecordProvenance(
    provenanceKey,
    "journal",
    journal,
    "Harness project transaction journal",
  );
  if (
    !journal ||
    journal.operation !== "project-policy-apply" ||
    !/^[a-f0-9-]{36}$/i.test(String(journal.id ?? "")) ||
    normalizeResolvedPath(journal.repoRoot) !== normalizeResolvedPath(root) ||
    path.basename(stageDirectory) !== `${PROJECT_TRANSACTION_PREFIX}${journal.id}` ||
    !Array.isArray(journal.targets) ||
    (
      journal.directoryTargets !== undefined &&
      !Array.isArray(journal.directoryTargets)
    ) ||
    journal.targets.length + (journal.directoryTargets?.length ?? 0) === 0 ||
    !Array.isArray(journal.createdDirectories) ||
    !Array.isArray(journal.preconditions)
  ) {
    throw new Error("Harness project transaction journal is invalid.");
  }
  const seen = new Set();
  for (const target of journal.targets) {
    if (
      !target ||
      !PROJECT_TRANSACTION_TARGETS.has(target.path) ||
      seen.has(target.path) ||
      !validJournalFingerprint(target.original) ||
      !/^[a-f0-9]{64}$/.test(String(target.next?.sha256 ?? "")) ||
      !Number.isInteger(target.next?.mode)
    ) {
      throw new Error("Harness project transaction target is invalid.");
    }
    seen.add(target.path);
  }
  const directoryPaths = new Set();
  for (const target of journal.directoryTargets ?? []) {
    if (
      !target ||
      !PROJECT_SKILL_TRANSACTION_TARGET.test(String(target.path ?? "")) ||
      directoryPaths.has(target.path) ||
      typeof target.original?.exists !== "boolean" ||
      typeof target.next?.exists !== "boolean" ||
      target.original.exists !==
        (typeof target.original.treeSha256 === "string") ||
      target.next.exists !==
        (typeof target.next.treeSha256 === "string") ||
      (
        target.original.exists &&
        !/^[a-f0-9]{64}$/.test(target.original.treeSha256)
      ) ||
      (
        target.next.exists &&
        !/^[a-f0-9]{64}$/.test(target.next.treeSha256)
      ) ||
      (!target.original.exists && !target.next.exists)
    ) {
      throw new Error(
        "Harness Project Skill transaction target is invalid.",
      );
    }
    directoryPaths.add(target.path);
  }
  const preconditionPaths = new Set();
  for (const precondition of journal.preconditions ?? []) {
    if (
      !precondition ||
      !PROJECT_TRANSACTION_TARGETS.has(precondition.path) ||
      seen.has(precondition.path) ||
      preconditionPaths.has(precondition.path) ||
      !validJournalFingerprint(precondition.fingerprint)
    ) {
      throw new Error("Harness project transaction precondition is invalid.");
    }
    preconditionPaths.add(precondition.path);
  }
  for (const relative of journal.createdDirectories) {
    if (
      relative !== ".harness" &&
      relative !== ".harness/policies" &&
      relative !== ".agents" &&
      relative !== ".agents/skills"
    ) {
      throw new Error("Harness transaction directory journal is invalid.");
    }
  }
  return journal;
}

async function verifyProjectTransactionPreconditions(root, journal) {
  for (const precondition of journal.preconditions ?? []) {
    const current = await readFileFingerprint(
      projectTargetPath(
        root,
        precondition.path,
        "Harness transaction precondition",
      ),
      `${precondition.path} transaction precondition`,
    );
    if (!fingerprintMatches(current, precondition.fingerprint)) {
      throw new Error(
        `${precondition.path} transaction precondition drifted; refusing to commit a split Harness state.`,
      );
    }
  }
}

async function createTransactionTargetDirectories(root, journal) {
  for (const relative of journal.createdDirectories) {
    const directory = path.join(root, ...relative.split("/"));
    assertInside(root, directory, "Harness transaction target directory");
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await assertSafeDirectory(
        directory,
        "Harness transaction target directory",
      );
    }
  }
}

async function installTransactionTarget(root, stageDirectory, target) {
  const destination = projectTargetPath(root, target.path);
  const current = await readFileFingerprint(destination, target.path);
  if (!fingerprintMatches(current, target.original)) {
    throw new Error(
      `${target.path} drifted before final replacement; refusing to overwrite it.`,
    );
  }
  const stagedNext = transactionStagePath(
    stageDirectory,
    "next",
    target.path,
  );
  const displaced = transactionStagePath(
    stageDirectory,
    "displaced",
    target.path,
  );
  await ensureSafeDirectoryChain(
    stageDirectory,
    path.dirname(displaced),
    "Transaction displaced parent",
    { create: true },
  );
  if (target.original.exists) {
    await rename(destination, displaced);
    const moved = await readFileFingerprint(
      displaced,
      `Displaced ${target.path}`,
    );
    if (
      !fingerprintMatches(moved, target.original, {
        ignoreCtime: true,
      })
    ) {
      if (!(await pathEntryExists(destination))) {
        await link(displaced, destination);
      }
      throw new Error(
        `${target.path} changed during final compare-and-swap.`,
      );
    }
  }
  try {
    await link(stagedNext, destination);
  } catch (error) {
    if (
      target.original.exists &&
      !(await pathEntryExists(destination)) &&
      await pathEntryExists(displaced)
    ) {
      await link(displaced, destination);
    }
    if (error?.code === "EEXIST") {
      throw new Error(
        `${target.path} was created concurrently; both versions were preserved.`,
      );
    }
    throw error;
  }
  const installed = await readFileFingerprint(
    destination,
    `Installed ${target.path}`,
  );
  if (
    installed.sha256 !== target.next.sha256 ||
    installed.mode !== target.next.mode
  ) {
    throw new Error(`Installed ${target.path} failed digest verification.`);
  }
}

async function projectSkillTreeSha256(root, target) {
  const destination = projectSkillTransactionTargetPath(root, target.path);
  if (!(await pathEntryExists(destination))) return null;
  return (await snapshotSkillTree(destination)).treeSha256;
}

async function installTransactionDirectoryTarget(
  root,
  stageDirectory,
  target,
) {
  const destination = projectSkillTransactionTargetPath(root, target.path);
  const currentTreeSha256 = await projectSkillTreeSha256(root, target);
  if (currentTreeSha256 !== target.original.treeSha256) {
    throw new Error(
      `${target.path} drifted before final Project Skill replacement.`,
    );
  }
  const displaced = transactionStagePath(
    stageDirectory,
    "displaced-directories",
    target.path,
  );
  await ensureSafeDirectoryChain(
    stageDirectory,
    path.dirname(displaced),
    "Transaction displaced Project Skill parent",
    { create: true },
  );
  if (target.original.exists) {
    await rename(destination, displaced);
    const displacedTreeSha256 = (
      await snapshotSkillTree(displaced)
    ).treeSha256;
    if (displacedTreeSha256 !== target.original.treeSha256) {
      if (!(await pathEntryExists(destination))) {
        await rename(displaced, destination);
      }
      throw new Error(
        `${target.path} changed during final Project Skill compare-and-swap.`,
      );
    }
  }
  if (!target.next.exists) return;

  const stagedNext = transactionStagePath(
    stageDirectory,
    "next-directories",
    target.path,
  );
  try {
    await rename(stagedNext, destination);
  } catch (error) {
    if (
      target.original.exists &&
      !(await pathEntryExists(destination)) &&
      await pathEntryExists(displaced)
    ) {
      await rename(displaced, destination);
    }
    if (error?.code === "EEXIST") {
      throw new Error(
        `${target.path} was created concurrently; both Project Skill trees were preserved.`,
      );
    }
    throw error;
  }
  const installedTreeSha256 = await projectSkillTreeSha256(root, target);
  if (installedTreeSha256 !== target.next.treeSha256) {
    throw new Error(
      `Installed Project Skill ${target.path} failed digest verification.`,
    );
  }
}

async function removeCreatedTransactionDirectories(root, journal) {
  for (const relative of [...journal.createdDirectories].reverse()) {
    const directory = path.join(root, ...relative.split("/"));
    if (!(await pathEntryExists(directory))) continue;
    await assertSafeDirectory(
      directory,
      "Harness transaction cleanup directory",
    );
    try {
      await rmdir(directory);
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") {
        throw error;
      }
    }
  }
}

async function rollbackProjectTransaction(
  root,
  stageDirectory,
  journal,
  { faultInjector } = {},
) {
  for (const target of [...journal.targets].reverse()) {
    const destination = projectTargetPath(root, target.path);
    const current = await readFileFingerprint(destination, target.path);
    const displaced = transactionStagePath(
      stageDirectory,
      "displaced",
      target.path,
    );
    const displacedFingerprint = await readFileFingerprint(
      displaced,
      `Displaced ${target.path}`,
    );
    const currentIsNext =
      current.exists &&
      current.sha256 === target.next.sha256 &&
      current.mode === target.next.mode;
    const currentIsOriginal =
      target.original.exists &&
      fingerprintMatches(current, target.original, {
        requireIdentity: false,
      });

    if (!current.exists || currentIsNext) {
      if (currentIsNext) await rm(destination, { force: true });
      if (target.original.exists) {
        const backup = transactionStagePath(
          stageDirectory,
          "backup",
          target.path,
        );
        const backupFingerprint = await readFileFingerprint(
          backup,
          `Backup ${target.path}`,
        );
        if (backupFingerprint.sha256 !== target.original.sha256) {
          throw new Error(
            `Cannot recover ${target.path}: verified backup is invalid.`,
          );
        }
        if (
          normalizeResolvedPath(path.dirname(destination)) !==
          normalizeResolvedPath(root)
        ) {
          await ensureSafeDirectoryChain(
            root,
            path.dirname(destination),
            `Recovery parent for ${target.path}`,
            { create: true },
          );
        }
        await link(backup, destination);
      }
      continue;
    }
    if (currentIsOriginal) continue;
    if (displacedFingerprint.exists) {
      throw new Error(
        `${target.path} changed after transaction replacement; ` +
          "current bytes and the verified original backup were preserved " +
          `in ${stageDirectory}.`,
      );
    }
    // The target drifted before this transaction reached it. Preserve that
    // concurrent content while rolling back targets already installed.
  }
  for (const target of [...(journal.directoryTargets ?? [])].reverse()) {
    const destination = projectSkillTransactionTargetPath(root, target.path);
    const currentTreeSha256 = await projectSkillTreeSha256(root, target);
    const displaced = transactionStagePath(
      stageDirectory,
      "displaced-directories",
      target.path,
    );
    const displacedTreeSha256 = await pathEntryExists(displaced)
      ? (await snapshotSkillTree(displaced)).treeSha256
      : null;
    const currentIsNext =
      target.next.exists &&
      currentTreeSha256 === target.next.treeSha256;
    const currentIsOriginal =
      target.original.exists &&
      currentTreeSha256 === target.original.treeSha256;

    if (currentTreeSha256 === null || currentIsNext) {
      if (currentIsNext) {
        await rm(destination, { recursive: true, force: true });
      }
      if (target.original.exists) {
        if (displacedTreeSha256 !== target.original.treeSha256) {
          throw new Error(
            `Cannot recover ${target.path}: verified Project Skill backup is invalid.`,
          );
        }
        await ensureSafeDirectoryChain(
          root,
          path.dirname(destination),
          `Recovery parent for ${target.path}`,
          { create: true },
        );
        await rename(displaced, destination);
      }
      continue;
    }
    if (currentIsOriginal) continue;
    if (displacedTreeSha256 !== null) {
      throw new Error(
        `${target.path} changed after Project Skill replacement; ` +
          "current and original trees were preserved in " +
          `${stageDirectory}.`,
      );
    }
    // This target drifted before the transaction reached it. Preserve it while
    // rolling back the Project Skill targets already installed.
  }
  await removeCreatedTransactionDirectories(root, journal);
  await terminalizeOwnedDirectory(
    root,
    stageDirectory,
    "transaction",
    {
      faultInjector,
      phase: "after-rollback-terminalize",
    },
  );
}

async function verifyCommittedProjectTransaction(
  root,
  stageDirectory,
  journal,
) {
  await verifyProjectTransactionPreconditions(root, journal);
  for (const target of journal.targets) {
    const current = await readFileFingerprint(
      projectTargetPath(root, target.path),
      `Committed ${target.path}`,
    );
    if (
      !current.exists ||
      current.sha256 !== target.next.sha256 ||
      current.mode !== target.next.mode
    ) {
      throw new Error(
        `Committed Harness transaction target ${target.path} drifted; preserving recovery evidence.`,
      );
    }
  }
  for (const target of journal.directoryTargets ?? []) {
    const currentTreeSha256 = await projectSkillTreeSha256(root, target);
    if (currentTreeSha256 !== target.next.treeSha256) {
      throw new Error(
        `Committed Project Skill transaction target ${target.path} drifted; preserving recovery evidence.`,
      );
    }
  }
}

async function recoverProjectTransactions(
  root,
  {
    isProcessAlive = defaultIsProcessAlive,
    readProcessIdentity = defaultReadProcessIdentity,
    provenanceKey,
  } = {},
) {
  await cleanupProjectGcTombstones(root);
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name))) {
    if (
      !entry.name.startsWith(PROJECT_TRANSACTION_PREFIX) &&
      !entry.name.startsWith(PROJECT_LOCK_CANDIDATE_PREFIX)
    ) {
      continue;
    }
    const directory = path.join(root, entry.name);
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error(
        `Harness initializer residue is not an owned directory: ${directory}`,
      );
    }
    const owner = await readOwnedDirectoryOwner(
      directory,
      root,
      "Harness initializer residue",
      provenanceKey,
    );
    if (
      await transactionOwnerIsAlive(owner, {
        isProcessAlive,
        readProcessIdentity,
        identityIsAuthoritative:
          readProcessIdentity !== defaultReadProcessIdentity ||
          isProcessAlive === defaultIsProcessAlive,
      })
    ) {
      throw new Error(
        `Harness initializer residue still belongs to live PID ${owner.pid}.`,
      );
    }
    if (entry.name.startsWith(PROJECT_LOCK_CANDIDATE_PREFIX)) {
      await terminalizeOwnedDirectory(root, directory, "candidate");
      continue;
    }
    const journalPath = path.join(directory, "journal.json");
    if (!(await pathEntryExists(journalPath))) {
      await terminalizeOwnedDirectory(root, directory, "transaction");
      continue;
    }
    await assertSafeRegularFile(
      journalPath,
      "Harness project transaction journal",
    );
    const journal = validateProjectTransactionJournal(
      JSON.parse(await readFile(journalPath, "utf8")),
      root,
      directory,
      provenanceKey,
    );
    const committedPath = path.join(directory, "committed.json");
    if (await pathEntryExists(committedPath)) {
      await assertSafeRegularFile(
        committedPath,
        "Harness project transaction commit marker",
      );
      const marker = JSON.parse(await readFile(committedPath, "utf8"));
      if (marker?.schemaVersion !== PROJECT_COMMIT_MARKER_SCHEMA_VERSION) {
        throw new Error(
          "Harness project transaction commit marker lacks authenticated " +
            "recovery provenance; manual review is required.",
        );
      }
      verifyProjectRecordProvenance(
        provenanceKey,
        "commit-marker",
        marker,
        "Harness project transaction commit marker",
      );
      if (
        marker.id !== journal.id ||
        marker.journalSha256 !==
          sha256(canonicalJson(journal))
      ) {
        throw new Error(
          "Harness project transaction commit marker is invalid.",
        );
      }
      try {
        await verifyCommittedProjectTransaction(root, directory, journal);
      } catch (error) {
        await rollbackProjectTransaction(root, directory, journal);
        throw error;
      }
      await terminalizeOwnedDirectory(root, directory, "transaction");
    } else {
      await rollbackProjectTransaction(root, directory, journal);
    }
  }
}

async function runProjectTransaction({
  root,
  lock,
  targets,
  directoryTargets = [],
  preconditions = [],
  provenanceKey,
  faultInjector,
}) {
  let prepared;
  let committedValidated = false;
  try {
    prepared = await prepareProjectTransaction({
      root,
      lock,
      targets,
      directoryTargets,
      preconditions,
      provenanceKey,
    });
    if (faultInjector) await faultInjector("after-journal");
    await verifyProjectTransactionPreconditions(root, prepared.journal);
    await createTransactionTargetDirectories(root, prepared.journal);
    for (const target of prepared.journal.directoryTargets ?? []) {
      if (faultInjector) {
        await faultInjector(`before-directory:${target.path}`);
      }
      await installTransactionDirectoryTarget(
        root,
        prepared.stageDirectory,
        target,
      );
      if (faultInjector) {
        await faultInjector(`after-directory:${target.path}`);
      }
    }
    for (const target of prepared.journal.targets) {
      if (faultInjector) {
        await faultInjector(`before-target:${target.path}`);
      }
      await installTransactionTarget(
        root,
        prepared.stageDirectory,
        target,
      );
      if (faultInjector) {
        await faultInjector(`after-target:${target.path}`);
      }
    }
    if (faultInjector) await faultInjector("before-commit-marker");
    await verifyProjectTransactionPreconditions(root, prepared.journal);
    await writeFile(
      path.join(prepared.stageDirectory, "committed.json"),
      canonicalJson(
        authenticateProjectRecord(provenanceKey, "commit-marker", {
          schemaVersion: PROJECT_COMMIT_MARKER_SCHEMA_VERSION,
          id: prepared.journal.id,
          journalSha256: prepared.journalSha256,
        }),
      ),
      { flag: "wx", mode: 0o600 },
    );
    if (faultInjector) await faultInjector("after-commit-marker");
    await verifyCommittedProjectTransaction(
      root,
      prepared.stageDirectory,
      prepared.journal,
    );
    committedValidated = true;
    await terminalizeOwnedDirectory(
      root,
      prepared.stageDirectory,
      "transaction",
      {
        faultInjector,
        phase: "after-commit-terminalize",
      },
    );
  } catch (error) {
    if (committedValidated) throw error;
    if (!prepared) {
      const candidates = (await readdir(root, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith(PROJECT_TRANSACTION_PREFIX),
        );
      for (const candidate of candidates) {
        const directory = path.join(root, candidate.name);
        const owner = await readOwnedDirectoryOwner(
          directory,
          root,
          "Failed Harness transaction staging",
          provenanceKey,
        );
        if (owner.pid === process.pid) {
          await terminalizeOwnedDirectory(
            root,
            directory,
            "transaction",
          );
        }
      }
      throw error;
    }
    try {
      await rollbackProjectTransaction(
        root,
        prepared.stageDirectory,
        prepared.journal,
        { faultInjector },
      );
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Harness project transaction failed and requires recovery from ${prepared.stageDirectory}.`,
      );
    }
    throw error;
  }
}

function buildProjectOwnership(
  contractSha256,
  schemaSha256,
  productManagerSchemaSha256,
  policyBytes,
  renderedBlock,
  thirdPartySourceBytes = null,
) {
  const sourceSha256 = sha256(policyBytes);
  const renderedBlockSha256 = sha256(renderedBlock);
  const ownership = {
    schemaVersion: PROJECT_OWNERSHIP_SCHEMA_VERSION,
    owner: "trellis-ccg-harness",
    contractSha256,
    schemaSha256,
    productManagerSchemaSha256,
    policy: {
      policyVersion: PROJECT_POLICY_VERSION,
      markerFormatVersion: COLLABORATION_MARKER_FORMAT_VERSION,
      sourcePath: PROJECT_POLICY_RELATIVE_PATH,
      sourceSha256,
      renderedBlockSha256,
    },
    managedPaths: [
      ".harness/ownership.json",
      PROJECT_POLICY_RELATIVE_PATH,
      ".harness/project.json",
      ".harness/project.schema.json",
      ".harness/product-manager.schema.json",
    ],
    managedBlocks: [
      {
        path: "AGENTS.md",
        startMarker: COLLABORATION_BLOCK_START,
        endMarker: COLLABORATION_BLOCK_END,
        markerFormatVersion: COLLABORATION_MARKER_FORMAT_VERSION,
        renderedBlockSha256,
      },
    ],
  };
  if (thirdPartySourceBytes !== null) {
    ownership.thirdPartySourceManifestSha256 = sha256(
      thirdPartySourceBytes,
    );
    ownership.managedPaths.push(THIRD_PARTY_SOURCE_RELATIVE_PATH);
  }
  return ownership;
}

function validateExistingProjectOwnership(
  ownership,
  contractSha256,
  schemaSha256,
  productManagerSchemaSha256 = null,
  { allowLegacyProductManagerSchema = false } = {},
) {
  const legacyPaths = [
    ".harness/ownership.json",
    ".harness/project.json",
    ".harness/project.schema.json",
  ];
  if (
    !ownership ||
    ![
      1,
      PROJECT_OWNERSHIP_SCHEMA_VERSION,
      PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION,
    ].includes(
      ownership.schemaVersion,
    ) ||
    ownership.owner !== "trellis-ccg-harness" ||
    ownership.contractSha256 !== contractSha256 ||
    (ownership.schemaSha256 !== undefined &&
      ownership.schemaSha256 !== schemaSha256) ||
    (ownership.schemaVersion >= PROJECT_OWNERSHIP_SCHEMA_VERSION &&
      ownership.schemaSha256 !== schemaSha256) ||
    !Array.isArray(ownership.managedPaths) ||
    !legacyPaths.every((entry) => ownership.managedPaths.includes(entry))
  ) {
    throw new Error(
      "The existing .harness ownership is not a compatible Harness-managed project contract.",
    );
  }
  if (productManagerSchemaSha256 !== null) {
    const ownsSchemaPath = ownership.managedPaths.includes(
      ".harness/product-manager.schema.json",
    );
    const ownsSchemaDigest =
      ownership.productManagerSchemaSha256 ===
      productManagerSchemaSha256;
    if (
      (ownsSchemaPath || ownership.productManagerSchemaSha256 !== undefined) &&
      (!ownsSchemaPath || !ownsSchemaDigest)
    ) {
      throw new Error(
        "The managed product-manager schema ownership is incomplete or modified.",
      );
    }
    if (
      !allowLegacyProductManagerSchema &&
      (!ownsSchemaPath || !ownsSchemaDigest)
    ) {
      throw new Error(
        "The managed product-manager schema ownership is missing.",
      );
    }
  }
  if (
    ownership.schemaVersion === PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION &&
    (
      !/^[a-f0-9]{64}$/.test(
        String(ownership.projectSkillsManifestSha256 ?? ""),
      ) ||
      !ownership.managedPaths.includes(".harness/project-skills.json")
    )
  ) {
    throw new Error(
      "The existing .harness project Skill ownership is incomplete or invalid.",
    );
  }
  return ownership;
}

function validateOwnedPolicyProjection(
  ownership,
  managedBlock,
  policyFingerprint,
  expectedSourceSha256,
  expectedRenderedBlockSha256,
) {
  if (ownership.schemaVersion < PROJECT_OWNERSHIP_SCHEMA_VERSION) {
    if (policyFingerprint.exists) {
      throw new Error(
        "The project policy path exists without schema-v2 ownership; refusing to overwrite user state.",
      );
    }
    return;
  }
  if (
    ownership.policy?.sourcePath !== PROJECT_POLICY_RELATIVE_PATH ||
    !ownership.managedPaths.includes(PROJECT_POLICY_RELATIVE_PATH) ||
    !Number.isSafeInteger(ownership.policy?.policyVersion) ||
    ownership.policy.policyVersion < 1 ||
    ownership.policy?.markerFormatVersion !==
      COLLABORATION_MARKER_FORMAT_VERSION ||
    managedBlock.markerFormatVersion !==
      COLLABORATION_MARKER_FORMAT_VERSION ||
    ownership.policy?.renderedBlockSha256 !==
      managedBlock.renderedBlockSha256 ||
    !/^[a-f0-9]{64}$/.test(
      String(ownership.policy?.sourceSha256 ?? ""),
    ) ||
    !policyFingerprint.exists ||
    policyFingerprint.sha256 !== ownership.policy.sourceSha256
  ) {
    throw new Error(
      "The managed project policy source is missing or modified; refusing to overwrite user state.",
    );
  }
  if (ownership.policy.policyVersion > PROJECT_POLICY_VERSION) {
    throw new Error(
      "The managed project policy version " +
        `${ownership.policy.policyVersion} is newer than this initializer ` +
        "supports; refusing to downgrade it.",
    );
  }
  if (
    ownership.policy.policyVersion === PROJECT_POLICY_VERSION &&
    (
      ownership.policy.sourceSha256 !== expectedSourceSha256 ||
      ownership.policy.renderedBlockSha256 !==
        expectedRenderedBlockSha256
    )
  ) {
    throw new Error(
      "The managed project policy content differs at the current policy " +
        "version; bump the policy version before upgrading it.",
    );
  }
}

async function discoverLegacyAgentsStages(root) {
  const stages = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!LEGACY_AGENTS_STAGE_PATTERN.test(entry.name)) continue;
    const stagePath = path.join(root, entry.name);
    const fingerprint = await readFileFingerprint(
      stagePath,
      "Legacy AGENTS.md staging file",
    );
    const content = fingerprint.bytes.toString("utf8");
    stages.push({
      path: stagePath,
      fingerprint,
      block: findCollaborationBlock(content),
    });
  }
  return stages;
}

async function cleanupLegacyAgentsStage(stage) {
  await assertFingerprintUnchanged(
    stage.path,
    stage.fingerprint,
    "Legacy AGENTS.md staging file",
  );
  await rm(stage.path, { force: true });
}

export async function applyProjectContract({
  repoRoot,
  contractPath,
  skillRoot,
  faultInjector,
  isProcessAlive,
  readProcessIdentity,
  provenanceKeyPath,
}) {
  const root = path.resolve(repoRoot);
  const sourceSkill = path.resolve(skillRoot);
  const resolvedContractPath = path.resolve(contractPath);
  const contractFingerprint = await readFileFingerprint(
    resolvedContractPath,
    "Approved project contract",
  );
  if (!contractFingerprint.exists) {
    throw new Error("Approved project contract does not exist.");
  }
  const contract = JSON.parse(contractFingerprint.bytes.toString("utf8"));
  validateProjectContract(contract, { requireApproved: true });
  const contractBytes = canonicalJson(contract);
  const contractSha256 = sha256(contractBytes);
  const harnessDir = path.join(root, ".harness");
  const projectPath = path.join(harnessDir, "project.json");
  const agentsPath = path.join(root, "AGENTS.md");
  const policyPath = path.join(
    sourceSkill,
    "assets",
    "collaboration-policy.md",
  );
  const policyFingerprint = await readFileFingerprint(
    policyPath,
    "Harness collaboration policy asset",
  );
  if (!policyFingerprint.exists) {
    throw new Error("Harness collaboration policy asset does not exist.");
  }
  const policyBytes = policyFingerprint.bytes;
  const collaborationBlock = renderCollaborationBlock(
    policyBytes.toString("utf8"),
  );
  const collaborationSha256 = sha256(collaborationBlock);
  assertInside(root, harnessDir, "Harness contract directory");
  const schemaPath = path.join(
    sourceSkill,
    "assets",
    "project-contract.schema.json",
  );
  const schemaFingerprint = await readFileFingerprint(
    schemaPath,
    "Harness project contract schema asset",
  );
  if (!schemaFingerprint.exists) {
    throw new Error("Harness project contract schema asset does not exist.");
  }
  const schemaBytes = canonicalJsonBytes(schemaFingerprint.bytes);
  const schemaSha256 = sha256(schemaBytes);
  const productManagerSchemaPath = path.join(
    sourceSkill,
    "assets",
    "product-manager.schema.json",
  );
  const productManagerSchemaFingerprint = await readFileFingerprint(
    productManagerSchemaPath,
    "Harness product-manager schema asset",
  );
  if (!productManagerSchemaFingerprint.exists) {
    throw new Error("Harness product-manager schema asset does not exist.");
  }
  const productManagerSchemaBytes = canonicalJsonBytes(
    productManagerSchemaFingerprint.bytes,
  );
  const productManagerSchemaSha256 = sha256(productManagerSchemaBytes);
  const thirdPartySourcePath = path.join(
    sourceSkill,
    "assets",
    "third-party-sources.json",
  );
  let thirdPartySourceFingerprint = null;
  let thirdPartySourceBytes = null;
  if (contract.thirdParty !== undefined) {
    thirdPartySourceFingerprint = await readFileFingerprint(
      thirdPartySourcePath,
      "Harness third-party source manifest asset",
    );
    if (!thirdPartySourceFingerprint.exists) {
      throw new Error(
        "Harness third-party source manifest asset does not exist.",
      );
    }
    const loadedThirdPartySource = await loadThirdPartySourceManifest({
      manifestPath: thirdPartySourcePath,
    });
    if (
      loadedThirdPartySource.manifestSha256 !==
      contract.thirdParty.sourceManifestSha256
    ) {
      throw new Error(
        "Approved contract third-party source digest does not match the Harness distribution.",
      );
    }
    thirdPartySourceBytes = Buffer.from(
      canonicalJson(loadedThirdPartySource.manifest),
    );
  }
  const provenanceKey = await loadProjectProvenanceKey(
    root,
    provenanceKeyPath,
  );
  const lock = await acquireProjectLock(root, {
    isProcessAlive,
    readProcessIdentity,
    provenanceKey,
    faultInjector,
  });
  try {
    await recoverProjectTransactions(root, {
      isProcessAlive,
      readProcessIdentity,
      provenanceKey,
    });
    await assertFingerprintUnchanged(
      resolvedContractPath,
      contractFingerprint,
      "Approved project contract",
    );
    await assertFingerprintUnchanged(
      policyPath,
      policyFingerprint,
      "Harness collaboration policy asset",
    );
    await assertFingerprintUnchanged(
      schemaPath,
      schemaFingerprint,
      "Harness project contract schema asset",
    );
    await assertFingerprintUnchanged(
      productManagerSchemaPath,
      productManagerSchemaFingerprint,
      "Harness product-manager schema asset",
    );
    if (thirdPartySourceFingerprint !== null) {
      await assertFingerprintUnchanged(
        thirdPartySourcePath,
        thirdPartySourceFingerprint,
        "Harness third-party source manifest asset",
      );
    }

    const agentsFingerprint = await readFileFingerprint(
      agentsPath,
      "AGENTS.md",
    );
    const currentAgents = agentsFingerprint.exists
      ? agentsFingerprint.bytes.toString("utf8")
      : "";
    let ownership = buildProjectOwnership(
      contractSha256,
      schemaSha256,
      productManagerSchemaSha256,
      policyBytes,
      collaborationBlock,
      thirdPartySourceBytes,
    );
    let nextOwnershipBytes = Buffer.from(canonicalJson(ownership));
    const targets = [];
    const preconditions = [];
    let status = "applied";
    let legacyAgentsStage = null;

    const harnessExists = await pathEntryExists(harnessDir);
    const ownershipPath = path.join(harnessDir, "ownership.json");
    const targetPolicyPath = path.join(
      root,
      ...PROJECT_POLICY_RELATIVE_PATH.split("/"),
    );
    const targetSchemaPath = path.join(harnessDir, "project.schema.json");
    const targetProductManagerSchemaPath = path.join(
      harnessDir,
      "product-manager.schema.json",
    );
    const targetThirdPartySourcePath = path.join(
      root,
      ...THIRD_PARTY_SOURCE_RELATIVE_PATH.split("/"),
    );
    const projectFingerprint = await readFileFingerprint(
      projectPath,
      "Existing Harness project contract",
    );
    const ownershipFingerprint = await readFileFingerprint(
      ownershipPath,
      "Existing Harness ownership",
    );
    const targetSchemaFingerprint = await readFileFingerprint(
      targetSchemaPath,
      "Existing Harness project schema",
    );
    const targetProductManagerSchemaFingerprint =
      await readFileFingerprint(
        targetProductManagerSchemaPath,
        "Existing Harness product-manager schema",
      );
    const targetThirdPartySourceFingerprint =
      thirdPartySourceBytes === null
        ? null
        : await readFileFingerprint(
            targetThirdPartySourcePath,
            "Existing Harness third-party source manifest",
          );
    const installedTargetCount = [
      projectFingerprint,
      ownershipFingerprint,
      targetSchemaFingerprint,
    ].filter((entry) => entry.exists).length;
    if (harnessExists) {
      await assertSafeDirectory(harnessDir, "Existing .harness");
    }
    if (installedTargetCount !== 0 && installedTargetCount !== 3) {
      throw new Error(
        "The .harness path is incomplete and is treated as user-owned; refusing collision.",
      );
    }

    if (installedTargetCount === 0) {
      const currentBlock = findCollaborationBlock(currentAgents);
      if (
        currentBlock !== null &&
        sha256(currentBlock) !== collaborationSha256
      ) {
        throw new Error(
          "The existing collaboration block differs from the approved policy; refusing collision.",
        );
      }
      if (currentBlock === null) {
        targets.push({
          path: "AGENTS.md",
          bytes: Buffer.from(
            addCollaborationBlock(currentAgents, collaborationBlock),
          ),
          mode: agentsFingerprint.exists ? agentsFingerprint.mode : 0o644,
          expectedOriginal: agentsFingerprint,
        });
      } else {
        preconditions.push({
          path: "AGENTS.md",
          expected: agentsFingerprint,
        });
      }

      const targetPolicyFingerprint = await readFileFingerprint(
        targetPolicyPath,
        "Project collaboration policy",
      );
      if (
        targetPolicyFingerprint.exists &&
        targetPolicyFingerprint.sha256 !== sha256(policyBytes)
      ) {
        throw new Error(
          "The existing project policy differs from the approved policy; refusing collision.",
        );
      }
      if (targetPolicyFingerprint.exists) {
        preconditions.push({
          path: PROJECT_POLICY_RELATIVE_PATH,
          expected: targetPolicyFingerprint,
        });
      } else {
        targets.push({
          path: PROJECT_POLICY_RELATIVE_PATH,
          bytes: policyBytes,
          mode: 0o600,
          expectedOriginal: targetPolicyFingerprint,
        });
      }
      if (targetThirdPartySourceFingerprint?.exists) {
        throw new Error(
          "The project third-party source manifest exists without Harness ownership; refusing collision.",
        );
      }
      if (targetProductManagerSchemaFingerprint.exists) {
        throw new Error(
          "The project product-manager schema exists without Harness ownership; refusing collision.",
        );
      }
      if (thirdPartySourceBytes !== null) {
        targets.push({
          path: THIRD_PARTY_SOURCE_RELATIVE_PATH,
          bytes: thirdPartySourceBytes,
          mode: 0o600,
          expectedOriginal: targetThirdPartySourceFingerprint,
        });
      }
      targets.push(
        {
          path: ".harness/project.json",
          bytes: Buffer.from(contractBytes),
          mode: 0o600,
          expectedOriginal: projectFingerprint,
        },
        {
          path: ".harness/project.schema.json",
          bytes: schemaBytes,
          mode: 0o600,
          expectedOriginal: targetSchemaFingerprint,
        },
        {
          path: ".harness/product-manager.schema.json",
          bytes: productManagerSchemaBytes,
          mode: 0o600,
          expectedOriginal: targetProductManagerSchemaFingerprint,
        },
        {
          path: ".harness/ownership.json",
          bytes: nextOwnershipBytes,
          mode: 0o600,
          expectedOriginal: ownershipFingerprint,
        },
      );
    } else {
      const currentProjectBytes = canonicalJson(
        JSON.parse(projectFingerprint.bytes.toString("utf8")),
      );
      try {
        canonicalJsonBytes(targetSchemaFingerprint.bytes);
      } catch {
        throw new Error(
          "The existing Harness project schema differs; refusing collision.",
        );
      }
      let currentProductManagerSchemaSha256 = null;
      if (targetProductManagerSchemaFingerprint.exists) {
        try {
          currentProductManagerSchemaSha256 = sha256(
            canonicalJsonBytes(
              targetProductManagerSchemaFingerprint.bytes,
            ),
          );
        } catch {
          throw new Error(
            "The existing Harness product-manager schema differs; refusing collision.",
          );
        }
      }
      const currentOwnership = validateExistingProjectOwnership(
        JSON.parse(ownershipFingerprint.bytes.toString("utf8")),
        projectFingerprint.sha256,
        targetSchemaFingerprint.sha256,
        targetProductManagerSchemaFingerprint.sha256 ??
          productManagerSchemaSha256,
        { allowLegacyProductManagerSchema: true },
      );
      const claimsProductManagerSchema =
        currentOwnership.productManagerSchemaSha256 !== undefined ||
        currentOwnership.managedPaths.includes(
          ".harness/product-manager.schema.json",
        );
      if (
        claimsProductManagerSchema &&
        !targetProductManagerSchemaFingerprint.exists
      ) {
        throw new Error(
          "The managed project product-manager schema is missing; refusing overwrite.",
        );
      }
      if (
        !claimsProductManagerSchema &&
        targetProductManagerSchemaFingerprint.exists
      ) {
        throw new Error(
          "The project product-manager schema exists without ownership; refusing collision.",
        );
      }
      if (currentProjectBytes === contractBytes) {
        preconditions.push({
          path: ".harness/project.json",
          expected: projectFingerprint,
        });
      } else {
        targets.push({
          path: ".harness/project.json",
          bytes: Buffer.from(contractBytes),
          mode: projectFingerprint.mode,
          expectedOriginal: projectFingerprint,
        });
        status = "upgraded";
      }
      if (thirdPartySourceBytes !== null) {
        const expectedThirdPartySourceSha256 =
          sha256(thirdPartySourceBytes);
        const ownsThirdPartySource =
          currentOwnership.thirdPartySourceManifestSha256 !== undefined ||
          currentOwnership.managedPaths.includes(
            THIRD_PARTY_SOURCE_RELATIVE_PATH,
          );
        if (ownsThirdPartySource) {
          if (
            currentOwnership.thirdPartySourceManifestSha256 !==
              expectedThirdPartySourceSha256 ||
            !currentOwnership.managedPaths.includes(
              THIRD_PARTY_SOURCE_RELATIVE_PATH,
            ) ||
            !targetThirdPartySourceFingerprint?.exists ||
            targetThirdPartySourceFingerprint.sha256 !==
              expectedThirdPartySourceSha256
          ) {
            throw new Error(
              "The managed project third-party source manifest is missing or modified; refusing overwrite.",
            );
          }
          preconditions.push({
            path: THIRD_PARTY_SOURCE_RELATIVE_PATH,
            expected: targetThirdPartySourceFingerprint,
          });
        } else {
          if (targetThirdPartySourceFingerprint?.exists) {
            throw new Error(
              "The project third-party source manifest exists without ownership; refusing collision.",
            );
          }
          targets.push({
            path: THIRD_PARTY_SOURCE_RELATIVE_PATH,
            bytes: thirdPartySourceBytes,
            mode: 0o600,
            expectedOriginal: targetThirdPartySourceFingerprint,
          });
          status = "migrated";
        }
      }
      if (
        currentOwnership.schemaVersion ===
        PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION
      ) {
        ownership = {
          ...ownership,
          schemaVersion: PROJECT_SKILL_OWNERSHIP_SCHEMA_VERSION,
          projectSkillsManifestSha256:
            currentOwnership.projectSkillsManifestSha256,
          managedPaths: [
            ...new Set([
              ...ownership.managedPaths,
              ...currentOwnership.managedPaths.filter(
                (entry) =>
                  entry === ".harness/project-skills.json" ||
                  entry.startsWith(".agents/skills/"),
              ),
            ]),
          ],
        };
        nextOwnershipBytes = Buffer.from(canonicalJson(ownership));
      }
      if (targetSchemaFingerprint.sha256 === schemaSha256) {
        preconditions.push({
          path: ".harness/project.schema.json",
          expected: targetSchemaFingerprint,
        });
      } else {
        targets.push({
          path: ".harness/project.schema.json",
          bytes: schemaBytes,
          mode: targetSchemaFingerprint.mode,
          expectedOriginal: targetSchemaFingerprint,
        });
        status = "migrated";
      }
      if (
        targetProductManagerSchemaFingerprint.exists &&
        currentProductManagerSchemaSha256 ===
          productManagerSchemaSha256
      ) {
        preconditions.push({
          path: ".harness/product-manager.schema.json",
          expected: targetProductManagerSchemaFingerprint,
        });
      } else {
        targets.push({
          path: ".harness/product-manager.schema.json",
          bytes: productManagerSchemaBytes,
          mode: targetProductManagerSchemaFingerprint.exists
            ? targetProductManagerSchemaFingerprint.mode
            : 0o600,
          expectedOriginal: targetProductManagerSchemaFingerprint,
        });
        status = targetProductManagerSchemaFingerprint.exists
          ? "upgraded"
          : "migrated";
      }
      const managedBlock = currentOwnership.managedBlocks?.find(
        (entry) => entry?.path === "AGENTS.md",
      );
      const currentBlock = findCollaborationBlock(currentAgents);
      const targetPolicyFingerprint = await readFileFingerprint(
        targetPolicyPath,
        "Managed project collaboration policy",
      );
      const legacyAgentsStages = await discoverLegacyAgentsStages(root);
      let nextAgents;
      if (!managedBlock) {
        if (
          currentOwnership.schemaVersion !== 1 ||
          currentBlock !== null
        ) {
          throw new Error(
            "The existing collaboration block has no compatible Harness ownership; refusing to overwrite user state.",
          );
        }
        if (targetPolicyFingerprint.exists) {
          throw new Error(
            "The project policy path exists without ownership; refusing to overwrite user state.",
          );
        }
        nextAgents = addCollaborationBlock(
          currentAgents,
          collaborationBlock,
        );
        status = "migrated";
      } else {
        const recordedBlockSha256 =
          managedBlock.renderedBlockSha256 ?? managedBlock.sha256;
        if (
          managedBlock.startMarker !== COLLABORATION_BLOCK_START ||
          managedBlock.endMarker !== COLLABORATION_BLOCK_END ||
          !/^[a-f0-9]{64}$/.test(String(recordedBlockSha256 ?? ""))
        ) {
          throw new Error(
            "The managed AGENTS.md collaboration block is missing or modified; refusing to overwrite user state.",
          );
        }
        const matchingLegacyStages = legacyAgentsStages.filter(
          (entry) =>
            entry.block !== null &&
            sha256(entry.block) === recordedBlockSha256,
        );
        if (legacyAgentsStages.length > 0) {
          if (
            legacyAgentsStages.length !== 1 ||
            matchingLegacyStages.length !== 1
          ) {
            throw new Error(
              "Legacy AGENTS.md staging residue is ambiguous or modified; refusing cleanup.",
            );
          }
          legacyAgentsStage = matchingLegacyStages[0];
        }
        if (currentBlock === null) {
          if (
            currentOwnership.schemaVersion !== 1 ||
            legacyAgentsStage === null ||
            targetPolicyFingerprint.exists
          ) {
            throw new Error(
              "The managed AGENTS.md collaboration block is missing or modified; refusing to overwrite user state.",
            );
          }
          nextAgents = addCollaborationBlock(
            currentAgents,
            collaborationBlock,
          );
          status = "migrated";
        } else {
          if (sha256(currentBlock) !== recordedBlockSha256) {
            throw new Error(
              "The managed AGENTS.md collaboration block is missing or modified; refusing to overwrite user state.",
            );
          }
          validateOwnedPolicyProjection(
            currentOwnership,
            managedBlock,
            targetPolicyFingerprint,
            sha256(policyBytes),
            collaborationSha256,
          );
          nextAgents = replaceCollaborationBlock(
            currentAgents,
            currentBlock,
            collaborationBlock,
          );
          status =
            currentOwnership.schemaVersion ===
              PROJECT_OWNERSHIP_SCHEMA_VERSION &&
            recordedBlockSha256 !== collaborationSha256
              ? "upgraded"
              : currentOwnership.schemaVersion === 1
                ? "migrated"
                : "upgraded";
        }
      }

      if (nextAgents !== currentAgents) {
        targets.push({
          path: "AGENTS.md",
          bytes: Buffer.from(nextAgents),
          mode: agentsFingerprint.exists ? agentsFingerprint.mode : 0o644,
          expectedOriginal: agentsFingerprint,
        });
      }
      if (
        !targetPolicyFingerprint.exists ||
        targetPolicyFingerprint.sha256 !== sha256(policyBytes)
      ) {
        targets.push({
          path: PROJECT_POLICY_RELATIVE_PATH,
          bytes: policyBytes,
          mode: targetPolicyFingerprint.exists
            ? targetPolicyFingerprint.mode
            : 0o600,
          expectedOriginal: targetPolicyFingerprint,
        });
      }
      if (
        ownershipFingerprint.sha256 !== sha256(nextOwnershipBytes)
      ) {
        targets.push({
          path: ".harness/ownership.json",
          bytes: nextOwnershipBytes,
          mode: ownershipFingerprint.mode,
          expectedOriginal: ownershipFingerprint,
        });
      }
      if (targets.length === 0) {
        if (legacyAgentsStage) {
          await cleanupLegacyAgentsStage(legacyAgentsStage);
        }
        return {
          status: "unchanged",
          projectPath,
          agentsPath,
          contractSha256,
          collaborationSha256,
        };
      }
    }

    await runProjectTransaction({
      root,
      lock,
      targets,
      preconditions,
      provenanceKey,
      faultInjector,
    });
    if (legacyAgentsStage) {
      await cleanupLegacyAgentsStage(legacyAgentsStage);
    }
    return {
      status,
      projectPath,
      agentsPath,
      contractSha256,
      collaborationSha256,
    };
  } finally {
    await lock.release();
  }
}

export async function migrateProjectProductManager({
  approved,
  allowedProviders = null,
  coupledSourceUpdate = false,
  markReady = true,
  repoRoot,
  skillRoot = DEFAULT_SKILL_ROOT,
  faultInjector,
  isProcessAlive,
  readProcessIdentity,
  provenanceKeyPath,
}) {
  if (approved !== true) {
    throw new Error(
      "Product-manager contract migration requires explicit approval.",
    );
  }
  const root = path.resolve(repoRoot);
  const sourceSkill = path.resolve(skillRoot);
  const projectPath = path.join(root, ".harness", "project.json");
  const templatePath = path.join(
    sourceSkill,
    "assets",
    "project-contract.template.json",
  );
  const currentFingerprint = await readFileFingerprint(
    projectPath,
    "Existing Harness project contract",
  );
  const templateFingerprint = await readFileFingerprint(
    templatePath,
    "Harness project contract template",
  );
  if (!currentFingerprint.exists || !templateFingerprint.exists) {
    throw new Error(
      "Product-manager migration requires an initialized Harness and its contract template.",
    );
  }
  const current = JSON.parse(currentFingerprint.bytes.toString("utf8"));
  const template = JSON.parse(templateFingerprint.bytes.toString("utf8"));
  assertProductManager(template.productManager);
  const selectedAllowedProviders =
    allowedProviders ??
    current.productManager?.allowedProviders ??
    template.productManager.allowedProviders;
  if (
    !Array.isArray(selectedAllowedProviders) ||
    selectedAllowedProviders.some(
      (provider) => !template.productManager.allowedProviders.includes(provider),
    )
  ) {
    throw new Error(
      "Requested product-manager providers are not supported by the current Harness template.",
    );
  }
  const enableClaude = selectedAllowedProviders.includes("claude");
  const candidate = {
    ...current,
    status: "approved",
    providers: {
      ...current.providers,
      claude: {
        ...current.providers.claude,
        enabled: enableClaude,
        workspaceWrite: false,
      },
    },
    productManager: {
      ...template.productManager,
      allowedProviders: selectedAllowedProviders,
    },
    source: coupledSourceUpdate
      ? {
          ...current.source,
          dependencyPolicy: "source-verified-current-snapshot",
          updatePolicy:
            "coupled-bundle-update-with-current-snapshot-source-fingerprint",
        }
      : current.source,
  };
  validateProjectContract(candidate, { requireApproved: true });
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "harness-product-manager-migration-"),
  );
  const contractPath = path.join(
    temporaryRoot,
    "approved-project-contract.json",
  );
  try {
    await writeFile(contractPath, canonicalJson(candidate), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    const applied = await applyProjectContract({
      repoRoot: root,
      contractPath,
      skillRoot: sourceSkill,
      faultInjector,
      isProcessAlive,
      readProcessIdentity,
      provenanceKeyPath,
    });
    const ready = markReady
      ? await markProjectReady({
          repoRoot: root,
          skillRoot: sourceSkill,
          faultInjector,
          isProcessAlive,
          readProcessIdentity,
          provenanceKeyPath,
        })
      : null;
    return {
      status: markReady ? "ready" : "approved-awaiting-gates",
      appliedStatus: applied.status,
      readyStatus: ready?.status ?? null,
      projectPath,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function markProjectReady({
  repoRoot,
  skillRoot = DEFAULT_SKILL_ROOT,
  faultInjector,
  isProcessAlive,
  readProcessIdentity,
  provenanceKeyPath,
}) {
  const root = path.resolve(repoRoot);
  const sourceSkill = path.resolve(skillRoot);
  const harnessDir = path.join(root, ".harness");
  const projectPath = path.join(harnessDir, "project.json");
  const ownershipPath = path.join(harnessDir, "ownership.json");
  const schemaPath = path.join(harnessDir, "project.schema.json");
  const productManagerSchemaPath = path.join(
    harnessDir,
    "product-manager.schema.json",
  );
  const policyPath = path.join(
    root,
    ...PROJECT_POLICY_RELATIVE_PATH.split("/"),
  );
  const agentsPath = path.join(root, "AGENTS.md");
  const sourcePolicyPath = path.join(
    sourceSkill,
    "assets",
    "collaboration-policy.md",
  );
  const sourcePolicyFingerprint = await readFileFingerprint(
    sourcePolicyPath,
    "Harness collaboration policy asset",
  );
  if (!sourcePolicyFingerprint.exists) {
    throw new Error("Harness collaboration policy asset does not exist.");
  }
  const sourceSchemaPath = path.join(
    sourceSkill,
    "assets",
    "project-contract.schema.json",
  );
  const sourceSchemaFingerprint = await readFileFingerprint(
    sourceSchemaPath,
    "Harness project contract schema asset",
  );
  if (!sourceSchemaFingerprint.exists) {
    throw new Error("Harness project contract schema asset does not exist.");
  }
  const sourceSchemaSha256 = sha256(
    canonicalJsonBytes(sourceSchemaFingerprint.bytes),
  );
  const sourceProductManagerSchemaPath = path.join(
    sourceSkill,
    "assets",
    "product-manager.schema.json",
  );
  const sourceProductManagerSchemaFingerprint =
    await readFileFingerprint(
      sourceProductManagerSchemaPath,
      "Harness product-manager schema asset",
    );
  if (!sourceProductManagerSchemaFingerprint.exists) {
    throw new Error("Harness product-manager schema asset does not exist.");
  }
  const sourceProductManagerSchemaSha256 = sha256(
    canonicalJsonBytes(sourceProductManagerSchemaFingerprint.bytes),
  );
  const expectedRenderedBlockSha256 = sha256(
    renderCollaborationBlock(
      sourcePolicyFingerprint.bytes.toString("utf8"),
    ),
  );
  const provenanceKey = await loadProjectProvenanceKey(
    root,
    provenanceKeyPath,
  );
  const lock = await acquireProjectLock(root, {
    isProcessAlive,
    readProcessIdentity,
    provenanceKey,
    faultInjector,
  });
  try {
    await recoverProjectTransactions(root, {
      isProcessAlive,
      readProcessIdentity,
      provenanceKey,
    });
    await assertFingerprintUnchanged(
      sourcePolicyPath,
      sourcePolicyFingerprint,
      "Harness collaboration policy asset",
    );
    await assertFingerprintUnchanged(
      sourceSchemaPath,
      sourceSchemaFingerprint,
      "Harness project contract schema asset",
    );
    await assertFingerprintUnchanged(
      sourceProductManagerSchemaPath,
      sourceProductManagerSchemaFingerprint,
      "Harness product-manager schema asset",
    );
    const projectFingerprint = await readFileFingerprint(
      projectPath,
      "Harness project contract",
    );
    const ownershipFingerprint = await readFileFingerprint(
      ownershipPath,
      "Harness ownership manifest",
    );
    const schemaFingerprint = await readFileFingerprint(
      schemaPath,
      "Harness project schema",
    );
    const productManagerSchemaFingerprint = await readFileFingerprint(
      productManagerSchemaPath,
      "Harness product-manager schema",
    );
    const policyFingerprint = await readFileFingerprint(
      policyPath,
      "Harness project policy",
    );
    const agentsFingerprint = await readFileFingerprint(
      agentsPath,
      "AGENTS.md",
    );
    if (
      !projectFingerprint.exists ||
      !ownershipFingerprint.exists ||
      !schemaFingerprint.exists ||
      !productManagerSchemaFingerprint.exists ||
      !policyFingerprint.exists ||
      !agentsFingerprint.exists
    ) {
      throw new Error(
        "Harness project ownership is incomplete; refusing readiness promotion.",
      );
    }
    if (schemaFingerprint.sha256 !== sourceSchemaSha256) {
      throw new Error(
        "The managed Harness project schema is modified; refusing readiness promotion.",
      );
    }
    if (
      productManagerSchemaFingerprint.sha256 !==
      sourceProductManagerSchemaSha256
    ) {
      throw new Error(
        "The managed Harness product-manager schema is modified; refusing readiness promotion.",
      );
    }

    const contract = JSON.parse(projectFingerprint.bytes.toString("utf8"));
    if (contract.status === "approved") {
      validateProjectContract(contract, { requireApproved: true });
    } else if (contract.status === "ready") {
      validateProjectContract(contract);
    } else {
      throw new Error(
        "Harness project contract must be approved before readiness promotion.",
      );
    }
    const ownership = validateExistingProjectOwnership(
      JSON.parse(ownershipFingerprint.bytes.toString("utf8")),
      projectFingerprint.sha256,
      schemaFingerprint.sha256,
      productManagerSchemaFingerprint.sha256,
    );
    let thirdPartySourceFingerprint = null;
    if (contract.thirdParty !== undefined) {
      const distributionSource = await loadThirdPartySourceManifest({
        manifestPath: path.join(
          sourceSkill,
          "assets",
          "third-party-sources.json",
        ),
      });
      if (
        distributionSource.manifestSha256 !==
          contract.thirdParty.sourceManifestSha256 ||
        ownership.thirdPartySourceManifestSha256 !==
          distributionSource.manifestSha256 ||
        !ownership.managedPaths.includes(
          THIRD_PARTY_SOURCE_RELATIVE_PATH,
        )
      ) {
        throw new Error(
          "Harness third-party source ownership is incomplete; refusing readiness promotion.",
        );
      }
      thirdPartySourceFingerprint = await readFileFingerprint(
        path.join(root, ...THIRD_PARTY_SOURCE_RELATIVE_PATH.split("/")),
        "Harness project third-party source manifest",
      );
      if (
        !thirdPartySourceFingerprint.exists ||
        thirdPartySourceFingerprint.sha256 !==
          sha256(canonicalJson(distributionSource.manifest))
      ) {
        throw new Error(
          "The managed third-party source manifest is missing or modified; refusing readiness promotion.",
        );
      }
    }
    const managedBlock = ownership.managedBlocks?.find(
      (entry) => entry?.path === "AGENTS.md",
    );
    const currentBlock = findCollaborationBlock(
      agentsFingerprint.bytes.toString("utf8"),
    );
    if (
      !managedBlock ||
      currentBlock === null ||
      sha256(currentBlock) !== managedBlock.renderedBlockSha256
    ) {
      throw new Error(
        "The managed AGENTS.md collaboration block is missing or modified; refusing readiness promotion.",
      );
    }
    validateOwnedPolicyProjection(
      ownership,
      managedBlock,
      policyFingerprint,
      sourcePolicyFingerprint.sha256,
      expectedRenderedBlockSha256,
    );
    if (contract.status === "ready") {
      return { status: "unchanged", projectPath };
    }

    const readyContractBytes = Buffer.from(
      canonicalJson({ ...contract, status: "ready" }),
    );
    const readyOwnershipBytes = Buffer.from(
      canonicalJson({
        ...ownership,
        contractSha256: sha256(readyContractBytes),
      }),
    );
    await runProjectTransaction({
      root,
      lock,
      provenanceKey,
      faultInjector,
      preconditions: [
        { path: ".harness/project.schema.json", expected: schemaFingerprint },
        {
          path: ".harness/product-manager.schema.json",
          expected: productManagerSchemaFingerprint,
        },
        { path: PROJECT_POLICY_RELATIVE_PATH, expected: policyFingerprint },
        { path: "AGENTS.md", expected: agentsFingerprint },
        ...(thirdPartySourceFingerprint
          ? [
              {
                path: THIRD_PARTY_SOURCE_RELATIVE_PATH,
                expected: thirdPartySourceFingerprint,
              },
            ]
          : []),
      ],
      targets: [
        {
          path: ".harness/project.json",
          bytes: readyContractBytes,
          mode: projectFingerprint.mode,
          expectedOriginal: projectFingerprint,
        },
        {
          path: ".harness/ownership.json",
          bytes: readyOwnershipBytes,
          mode: ownershipFingerprint.mode,
          expectedOriginal: ownershipFingerprint,
        },
      ],
    });
    return {
      status: "ready",
      projectPath,
      contractSha256: sha256(readyContractBytes),
    };
  } finally {
    await lock.release();
  }
}

export async function inspectProject(
  repoRoot,
  { homeDir = homedir() } = {},
) {
  const root = path.resolve(repoRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Repository root is not a directory: ${root}`);
  }
  const manifests = [];
  for (const candidate of MANIFEST_CANDIDATES) {
    if (await exists(path.join(root, candidate))) manifests.push(candidate);
  }
  const harnessDir = path.join(root, ".harness");
  const harnessExists = await exists(harnessDir);
  const projectExists = await exists(path.join(harnessDir, "project.json"));
  const skillProfile = await loadSkillRepositoryProfile({ homeDir });
  const skillRepositoryAvailable = skillProfile
    ? await isDirectory(skillProfile.repositoryPath)
    : false;
  return {
    repositoryRoot: root,
    manifests,
    gitPresent: await exists(path.join(root, ".git")),
    trellisPresent: await exists(path.join(root, ".trellis")),
    harnessState: projectExists
      ? "initialized"
      : harnessExists
        ? "partial"
        : "absent",
    harnessInitSkillPresent: await exists(
      path.join(root, ".agents", "skills", "harness-init", "SKILL.md"),
    ),
    skillRepository: skillProfile
      ? {
          configured: true,
          path: skillProfile.repositoryPath,
          available: skillRepositoryAvailable,
          globalEssentialSkills: skillProfile.globalEssentialSkills,
        }
      : {
          configured: false,
          path: null,
          available: false,
          globalEssentialSkills: [],
        },
  };
}

async function prepareThirdPartyGlobalOperation({
  homeDir,
  repoRoot,
  skillRoot,
  strictDataBoundary,
  thirdPartyGlobalPlugins,
  thirdPartyGlobalSkills,
  thirdPartyMcpCli,
  thirdPartyApprovalPlan = null,
  thirdPartyPlanSha256 = null,
  thirdPartyPlanBuilder = prepareThirdPartyPlan,
  thirdPartySourceSha256 = null,
  requirePlanSha256 = false,
  requireSourceSha256 = false,
}) {
  const approvalPlan =
    thirdPartyApprovalPlan ??
    (await thirdPartyPlanBuilder({
      homeDir,
      repoRoot,
      skillRoot,
      strictDataBoundary,
    }));
  const selectedCount =
    thirdPartyGlobalSkills.length +
    thirdPartyGlobalPlugins.length +
    thirdPartyMcpCli.length;
  const effectivePlanSha256 =
    thirdPartyPlanSha256 ?? thirdPartyApprovalPlan?.planSha256 ?? null;
  if ((requirePlanSha256 || selectedCount > 0) && effectivePlanSha256 === null) {
    throw new Error(
      "Selected third-party actions require an explicitly approved plan SHA-256.",
    );
  }
  if (
    effectivePlanSha256 !== null &&
    effectivePlanSha256 !== approvalPlan.planSha256
  ) {
    throw new Error(
      "Third-party approval plan SHA-256 differs from the displayed execution plan.",
    );
  }
  if (
    thirdPartySourceSha256 !== null &&
    thirdPartySourceSha256 !== approvalPlan.sourceManifestSha256
  ) {
    throw new Error(
      "Third-party approval SHA-256 differs from the distribution source manifest.",
    );
  }
  if (
    (requireSourceSha256 || selectedCount > 0) &&
    thirdPartySourceSha256 === null
  ) {
    throw new Error(
      "Selected third-party actions require an explicit source manifest SHA-256.",
    );
  }
  const approvals = resolveThirdPartyApprovals({
    plan: approvalPlan,
    selections: {
      globalSkills: thirdPartyGlobalSkills,
      globalPlugins: thirdPartyGlobalPlugins,
      projectSkills: [],
      mcpCli: thirdPartyMcpCli,
    },
  });
  return { approvalPlan, approvals };
}

async function applyPreparedThirdPartyGlobals({
  allowNetwork,
  approved,
  execFileImpl,
  homeDir,
  prepared,
  repoRoot,
  strictDataBoundary,
  thirdPartyRunCommand,
  thirdPartySourceResolver,
}) {
  const { approvalPlan, approvals } = prepared;
  const loadedSource = await loadThirdPartySourceManifest({
    manifestPath: approvalPlan.manifestPath,
  });
  const approvalPreflight = await preflightThirdPartyGlobalApproval({
    approvalPlan,
    approvals,
    homeDir,
    manifest: loadedSource.manifest,
    repoRoot,
    strictDataBoundary,
  });
  const record = await recordThirdPartyGlobalApproval({
    approvalPlan,
    approvals,
    homeDir,
    manifest: loadedSource.manifest,
    repoRoot,
    strictDataBoundary,
  });
  const sourceResolver =
    thirdPartySourceResolver ??
    (async ({ source }) => {
      const cachedSource = path.join(
        path.resolve(homeDir),
        ".agents",
        "harness",
        "sources",
        source.id,
        source.commit,
      );
      if (!allowNetwork && !(await pathEntryExists(cachedSource))) {
        throw new Error(
          `Pinned source ${source.id} is not cached and network access was not approved.`,
        );
      }
      return acquirePinnedGitSource({
        approvalPlan,
        homeDir,
        source,
        execFileImpl: execFileImpl ?? execFile,
      });
    });
  const globalSkills = await applyThirdPartyGlobalSkills({
    approved,
    approvalPlan,
    approvals,
    homeDir,
    manifest: loadedSource.manifest,
    repoRoot,
    sourceResolver,
    strictDataBoundary,
  });
  const globalActions = await applyThirdPartyGlobalActions({
    allowNetwork,
    approvalPlan,
    approvals,
    homeDir,
    manifest: loadedSource.manifest,
    repoRoot,
    runCommand: thirdPartyRunCommand,
    sourceResolver,
    strictDataBoundary,
  });
  return {
    plan: approvalPlan,
    approvals,
    approvalPreflight,
    globalSkills,
    globalActions,
    record,
  };
}

export async function runGlobalInit({
  allowNetwork = false,
  allowCatalogNetwork = null,
  allowThirdPartyNetwork = null,
  approved,
  catalogMode,
  catalogPath = null,
  catalogUrl = null,
  execFileImpl,
  homeDir = homedir(),
  now = () => new Date(),
  providerActions,
  providerRunCommand,
  providerStatusOverrides = null,
  repoRoot = process.cwd(),
  skillRoot,
  strictDataBoundary = false,
  thirdPartyGlobalPlugins = [],
  thirdPartyGlobalSkills = [],
  thirdPartyMcpCli = [],
  thirdPartyRunCommand,
  thirdPartyApprovalPlan = null,
  thirdPartyPlanSha256 = null,
  thirdPartyPlanBuilder = prepareThirdPartyPlan,
  thirdPartySourceResolver,
  thirdPartySourceSha256 = null,
}) {
  if (approved !== true) {
    throw new Error("Global Init requires --approved.");
  }
  const actions = validateProviderActions(providerActions);
  const catalogNetworkApproved =
    allowCatalogNetwork === null ? allowNetwork : allowCatalogNetwork;
  const thirdPartyNetworkApproved =
    allowThirdPartyNetwork === null ? allowNetwork : allowThirdPartyNetwork;
  const sourceSkillRoot = path.resolve(skillRoot ?? DEFAULT_SKILL_ROOT);
  const preparedThirdParty = await prepareThirdPartyGlobalOperation({
    homeDir,
    repoRoot,
    skillRoot: sourceSkillRoot,
    strictDataBoundary,
    thirdPartyGlobalPlugins,
    thirdPartyGlobalSkills,
    thirdPartyMcpCli,
    thirdPartyApprovalPlan,
    thirdPartyPlanSha256,
    thirdPartyPlanBuilder,
    thirdPartySourceSha256,
  });
  const thirdPartyPlan = preparedThirdParty.approvalPlan;
  const thirdPartyApprovals = preparedThirdParty.approvals;
  const providers = await inspectProviderCliStatuses({
    runCommand: providerRunCommand,
    statusOverrides: providerStatusOverrides,
  });
  for (const name of GUIDED_INIT_PROVIDER_NAMES) {
    if (
      actions[name] !== "later" &&
      !providers[name].choices.includes(actions[name])
    ) {
      throw new Error(
        `Provider action ${actions[name]} is not valid for ${name} status ${providers[name].status}.`,
      );
    }
  }
  const existingProfile = await loadSkillRepositoryProfile({ homeDir });
  const existingGlobalState = await loadGlobalInitState({ homeDir });
  let requestedCatalogPath = null;
  if (existingGlobalState) {
    if (existingGlobalState.catalog.mode !== catalogMode) {
      throw new Error(
        "Existing Global Init catalog mode is immutable.",
      );
    }
    if (catalogMode !== "skip") {
      requestedCatalogPath = catalogPath
        ? await realpath(path.resolve(catalogPath))
        : null;
      if (
        requestedCatalogPath === null ||
        (await realpath(
          path.resolve(existingGlobalState.catalog.repositoryPath),
        )) !== requestedCatalogPath
      ) {
        throw new Error(
          "Existing Global Init catalog path is immutable.",
        );
      }
    }
  }
  const allowExistingClone =
    catalogMode === "clone" &&
    existingProfile !== null &&
    existingGlobalState?.catalog?.mode === "clone" &&
    requestedCatalogPath !== null &&
    (await realpath(path.resolve(existingProfile.repositoryPath))) ===
      requestedCatalogPath &&
    (await realpath(
      path.resolve(existingGlobalState.catalog.repositoryPath),
    )) === requestedCatalogPath;
  const catalog = await preparePersonalSkillCatalog({
    allowExistingClone,
    allowNetwork: catalogNetworkApproved,
    catalogMode,
    catalogPath,
    catalogUrl,
    execFileImpl,
  });
  const platform = await installBundledPlatformSkills({
    approved,
    homeDir,
    now,
    platformSkillsRoot: path.dirname(sourceSkillRoot),
  });
  const thirdPartyResult = await applyPreparedThirdPartyGlobals({
    allowNetwork: thirdPartyNetworkApproved,
    approved,
    execFileImpl,
    homeDir,
    prepared: preparedThirdParty,
    repoRoot,
    strictDataBoundary,
    thirdPartyRunCommand,
    thirdPartySourceResolver,
  });
  const thirdPartyApprovalPreflight = thirdPartyResult.approvalPreflight;
  const thirdPartyApprovalRecord = thirdPartyResult.record;
  const thirdPartyGlobalSkillResult = thirdPartyResult.globalSkills;
  const thirdPartyGlobalActionResult = thirdPartyResult.globalActions;
  let profileStatus = "skipped";
  if (catalog.repositoryPath) {
    const canonicalRepository = await realpath(catalog.repositoryPath);
    if (existingProfile) {
      if (
        (await realpath(path.resolve(existingProfile.repositoryPath))) !==
          canonicalRepository ||
        canonicalJson(existingProfile.globalEssentialSkills) !==
          canonicalJson(
            [...GLOBAL_PLATFORM_SKILLS].sort((left, right) =>
              left.localeCompare(right),
            ),
          )
      ) {
        throw new Error(
          "Existing Skill repository profile differs from the approved Global Init catalog.",
        );
      }
      profileStatus = "unchanged";
    } else {
      await saveSkillRepositoryProfile({
        approved,
        createOnly: true,
        globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
        homeDir,
        now,
        repositoryPath: canonicalRepository,
        selectionGuidance: [
          "Recommend only Skills relevant to confirmed project technology and constraints.",
        ],
      });
      profileStatus = "configured";
    }
  }
  const providerActionReports = GUIDED_INIT_PROVIDER_NAMES.map((name) =>
    describeProviderAction(name, actions[name], providers[name].status),
  );
  const pendingProviderActions = providerActionReports.filter(
    (entry) => entry.pending,
  );
  const failedThirdPartyActions = thirdPartyGlobalActionResult.actions.filter(
    (entry) => entry.status === "failed" || entry.status === "partial-failure",
  );
  const failedThirdPartyGlobalSkills =
    thirdPartyGlobalSkillResult.status === "source-unavailable"
      ? (thirdPartyGlobalSkillResult.approvedSkillIds ?? []).map((id) => ({
          id,
          status: "failed",
          error: thirdPartyGlobalSkillResult.error ?? "Pinned source was unavailable.",
        }))
      : [];
  const pendingThirdPartyActions = thirdPartyGlobalActionResult.actions.filter(
    (entry) => entry.status === "manual-pending",
  );
  const state = await recordGlobalInitState({
    catalog,
    homeDir,
    pendingProviderActions,
    platformManifestPath: platform.manifestPath,
    providerActions: actions,
  });
  return {
    status:
      failedThirdPartyGlobalSkills.length > 0
        ? "third-party-skills-failed"
        : failedThirdPartyActions.length > 0
        ? "third-party-actions-failed"
        : pendingThirdPartyActions.length > 0
          ? "needs-third-party-actions"
        : pendingProviderActions.length > 0
        ? "needs-provider-actions"
        : platform.status === "unchanged" &&
            profileStatus !== "configured" &&
            state.status === "unchanged"
          ? "unchanged"
          : "initialized",
    platform,
    catalog,
    profileStatus,
    providers,
    providerActions: actions,
    pendingProviderActions,
    pendingThirdPartyActions,
    failedThirdPartyActions,
    failedThirdPartyGlobalSkills,
    zeroClaudeProfile: state.state.zeroClaudeProfile,
    residualActions: providerActionReports.filter(
      (entry) => entry.action !== "keep",
    ),
    thirdParty: {
      plan: thirdPartyPlan,
      approvals: thirdPartyApprovals,
      approvalPreflight: thirdPartyApprovalPreflight,
      globalSkills: thirdPartyGlobalSkillResult,
      globalActions: thirdPartyGlobalActionResult,
      record: thirdPartyApprovalRecord,
    },
  };
}

export async function recommendProjectSkills({
  homeDir = homedir(),
  repoRoot,
}) {
  const facts = await inspectProject(repoRoot, { homeDir });
  let packageManifest = null;
  if (facts.manifests.includes("package.json")) {
    try {
      packageManifest = await readJson(
        path.join(facts.repositoryRoot, "package.json"),
      );
    } catch {
      packageManifest = null;
    }
  }
  const technologyStack = detectTechnologyStack(
    facts.manifests,
    packageManifest,
  );
  const profile = await loadSkillRepositoryProfile({ homeDir });
  const catalog = profile
    ? await discoverSkillCatalog({ repositoryPath: profile.repositoryPath })
    : [];
  return {
    facts,
    technologyStack,
    catalogConfigured: profile !== null,
    recommendations: recommendProjectSkillsFromCatalog({
      catalog,
      technologyStack,
    }),
  };
}

function projectThirdPartyCandidates(plan) {
  return plan.groups.find((entry) => entry.id === "project-skills")
    ?.candidates ?? [];
}

function selectedProjectManagedPaths({ contract, catalogSkills, thirdPartyCandidates }) {
  const preserved = contract.workflow.managedProjectPaths.filter(
    (entry) =>
      entry !== ".harness/project-skills.json" &&
      entry !== THIRD_PARTY_INSTALLATIONS_RELATIVE_PATH &&
      entry !== THIRD_PARTY_SOURCE_RELATIVE_PATH &&
      !entry.startsWith(".agents/skills/"),
  );
  return [
    ...preserved,
    THIRD_PARTY_SOURCE_RELATIVE_PATH,
    ...(catalogSkills.length > 0 ? [".harness/project-skills.json"] : []),
    ...(thirdPartyCandidates.length > 0
      ? [THIRD_PARTY_INSTALLATIONS_RELATIVE_PATH]
      : []),
    ...catalogSkills.map((name) => `.agents/skills/${name}`),
    ...thirdPartyCandidates.flatMap((candidate) =>
      candidate.paths.map((item) => item.targetPath),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function compileApprovedInteractiveProjectContract({
  contract,
  now,
  plan,
  recommendations,
  selectedCatalogSkills,
  selectedThirdPartySkills,
  strictDataBoundary,
}) {
  if (typeof strictDataBoundary !== "boolean") {
    throw new Error("Interactive project strict data boundary must be a boolean.");
  }
  const catalogSkills = normalizeUniqueStrings(
    selectedCatalogSkills,
    "Selected project Skills",
    { skillNames: true },
  );
  const requestedThirdParty = normalizeUniqueStrings(
    selectedThirdPartySkills,
    "Selected third-party project Skills",
  );
  const byId = new Map(
    projectThirdPartyCandidates(plan).map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  for (const id of requestedThirdParty) {
    const candidate = byId.get(id);
    if (!candidate) {
      throw new Error(`${id} is not a selectable project third-party candidate.`);
    }
    if (candidate.unavailableReason) {
      throw new Error(
        `${id} cannot be approved: ${candidate.unavailableReason}`,
      );
    }
    const missingDependencies = candidate.dependencies.filter(
      (dependency) => !requestedThirdParty.includes(dependency),
    );
    if (missingDependencies.length > 0) {
      throw new Error(
        `${id} requires explicitly selected project dependencies: ${missingDependencies.sort().join(", ")}.`,
      );
    }
  }
  const approvals = resolveThirdPartyApprovals({
    plan,
    selections: {
      globalSkills: contract.thirdParty.globalSkills,
      globalPlugins: contract.thirdParty.globalPlugins,
      projectSkills: requestedThirdParty,
      mcpCli: contract.thirdParty.mcpCli,
    },
  });
  const skipped = approvals.skipped.filter((entry) =>
    requestedThirdParty.includes(entry.id),
  );
  if (skipped.length > 0) {
    throw new Error(
      `Selected project third-party Skills cannot be approved: ${skipped
        .map((entry) => entry.id)
        .join(", ")}.`,
    );
  }
  const approvedThirdParty = approvals.approvedByGroup.projectSkills;
  if (
    canonicalJson(approvedThirdParty) !== canonicalJson(requestedThirdParty)
  ) {
    throw new Error(
      "Selected project third-party Skills did not resolve to an exact approval set.",
    );
  }
  const recommendationReasons = new Map(
    recommendations.map((entry) => [entry.name, entry.reason]),
  );
  const thirdPartyCandidates = approvedThirdParty.map((id) => byId.get(id));
  const managedProjectPaths = selectedProjectManagedPaths({
    contract,
    catalogSkills,
    thirdPartyCandidates,
  });
  if (new Set(managedProjectPaths).size !== managedProjectPaths.length) {
    throw new Error(
      "Catalog and third-party project selections share a managed target path.",
    );
  }
  const candidate = {
    ...contract,
    status: "approved",
    workflow: {
      ...contract.workflow,
      managedProjectPaths,
    },
    skills: {
      ...contract.skills,
      projectSelection: catalogSkills.map((name) => ({
        name,
        reason:
          recommendationReasons.get(name) ??
          "Explicitly approved for this project during interactive initialization.",
      })),
    },
    thirdParty: {
      ...contract.thirdParty,
      sourceManifestSha256: plan.sourceManifestSha256,
      projectSkills: approvedThirdParty,
    },
    security: {
      ...contract.security,
      strictDataBoundary,
    },
    approval: {
      approvedAt: now().toISOString(),
      approvedBy:
        typeof contract.approval.approvedBy === "string" &&
        contract.approval.approvedBy.trim()
          ? contract.approval.approvedBy
          : "interactive-user",
    },
  };
  validateProjectContract(candidate, { requireApproved: true });
  return candidate;
}

async function promoteDraftProjectContract({
  candidate,
  contractPath,
  expectedFingerprint,
}) {
  if (!expectedFingerprint.exists) {
    throw new Error("Draft project contract disappeared before approval.");
  }
  const target = path.resolve(contractPath);
  const parent = path.dirname(target);
  await assertSafeDirectory(parent, "Draft project contract directory");
  await assertFingerprintUnchanged(
    target,
    expectedFingerprint,
    "Draft project contract",
  );
  const temporary = path.join(
    parent,
    `.${path.basename(target)}-${randomUUID()}.tmp`,
  );
  const bytes = canonicalJson(candidate);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await assertFingerprintUnchanged(
      target,
      expectedFingerprint,
      "Draft project contract",
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { contract: candidate, contractPath: target };
}

export async function runProjectInit({
  allowNetwork = false,
  allowThirdPartyNetwork = null,
  approved,
  contractPath,
  homeDir = homedir(),
  now = () => new Date(),
  repoRoot,
  selectedSkills,
  skillRoot,
  strictDataBoundary = false,
  thirdPartyApprovalPlan = null,
  thirdPartyPlanSha256 = null,
  thirdPartyPlanBuilder = prepareThirdPartyPlan,
  thirdPartyProjectSkills = [],
  thirdPartySourceResolver,
  thirdPartySourceSha256 = null,
}) {
  if (approved !== true) {
    throw new Error("Project Init requires --approved.");
  }
  const thirdPartyNetworkApproved =
    allowThirdPartyNetwork === null ? allowNetwork : allowThirdPartyNetwork;
  const requested = normalizeUniqueStrings(
    selectedSkills,
    "Selected project Skills",
    { skillNames: true },
  );
  const contract = await readJson(contractPath);
  validateProjectContract(contract, { requireApproved: true });
  if (contract.thirdParty === undefined) {
    throw new Error(
      "Project Init requires an approved thirdParty contract section.",
    );
  }
  const sourceSkillRoot = path.resolve(skillRoot ?? DEFAULT_SKILL_ROOT);
  const effectiveStrictDataBoundary =
    strictDataBoundary === true || contract.security.strictDataBoundary === true;
  const thirdPartyPlan =
    thirdPartyApprovalPlan ??
    (await thirdPartyPlanBuilder({
      homeDir,
      repoRoot,
      skillRoot: sourceSkillRoot,
      strictDataBoundary: effectiveStrictDataBoundary,
    }));
  const effectiveThirdPartyPlanSha256 =
    thirdPartyPlanSha256 ?? thirdPartyApprovalPlan?.planSha256 ?? null;
  if (
    thirdPartyProjectSkills.length > 0 &&
    effectiveThirdPartyPlanSha256 === null
  ) {
    throw new Error(
      "Selected third-party project Skills require an explicitly approved plan SHA-256.",
    );
  }
  if (
    effectiveThirdPartyPlanSha256 !== null &&
    effectiveThirdPartyPlanSha256 !== thirdPartyPlan.planSha256
  ) {
    throw new Error(
      "Project Init third-party approval plan SHA-256 differs from the displayed execution plan.",
    );
  }
  const effectiveThirdPartySourceSha256 =
    thirdPartySourceSha256 ?? contract.thirdParty.sourceManifestSha256;
  if (
    effectiveThirdPartySourceSha256 !==
      thirdPartyPlan.sourceManifestSha256 ||
    contract.thirdParty.sourceManifestSha256 !==
      thirdPartyPlan.sourceManifestSha256
  ) {
    throw new Error(
      "Project Init third-party source SHA-256 differs from the approved contract or distribution.",
    );
  }
  const requestedThirdParty = [...thirdPartyProjectSkills].sort((left, right) =>
    left.localeCompare(right),
  );
  const contractThirdParty = [...contract.thirdParty.projectSkills].sort(
    (left, right) => left.localeCompare(right),
  );
  if (canonicalJson(requestedThirdParty) !== canonicalJson(contractThirdParty)) {
    throw new Error(
      "Project Init third-party Skill selection differs from the approved contract.",
    );
  }
  const thirdPartyApprovals = resolveThirdPartyApprovals({
    plan: thirdPartyPlan,
    selections: {
      globalSkills: contract.thirdParty.globalSkills,
      globalPlugins: contract.thirdParty.globalPlugins,
      projectSkills: contract.thirdParty.projectSkills,
      mcpCli: contract.thirdParty.mcpCli,
    },
  });
  const blockedApprovedThirdParty = thirdPartyApprovals.skipped.filter(
    (entry) => contract.thirdParty.projectSkills.includes(entry.id),
  );
  if (blockedApprovedThirdParty.length > 0) {
    throw new Error(
      `Approved project third-party Skills cannot be honored under the effective security policy: ${blockedApprovedThirdParty
        .map((entry) => entry.id)
        .join(", ")}.`,
    );
  }
  const approvedSelection = [...contract.skills.projectSelection]
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (canonicalJson(requested) !== canonicalJson(approvedSelection)) {
    throw new Error(
      "Project Init Skill selection differs from the approved contract.",
    );
  }
  const managedSkillPaths = contract.workflow.managedProjectPaths
    .filter((entry) => entry.startsWith(".agents/skills/"))
    .sort((left, right) => left.localeCompare(right));
  const approvedThirdPartyIds = new Set(
    thirdPartyApprovals.approvedActionIds,
  );
  const thirdPartySkillPaths = thirdPartyPlan.groups
    .find((entry) => entry.id === "project-skills")
    .candidates.filter((entry) => approvedThirdPartyIds.has(entry.id))
    .flatMap((entry) => entry.paths.map((item) => item.targetPath));
  const expectedSkillPaths = [
    ...requested.map((name) => `.agents/skills/${name}`),
    ...thirdPartySkillPaths,
  ].sort((left, right) => left.localeCompare(right));
  if (canonicalJson(managedSkillPaths) !== canonicalJson(expectedSkillPaths)) {
    throw new Error(
      "Approved Project Skill selection and managed paths must match exactly.",
    );
  }
  if (
    requested.length > 0 &&
    !contract.workflow.managedProjectPaths.includes(
      ".harness/project-skills.json",
    )
  ) {
    throw new Error(
      "Approved managed paths must include .harness/project-skills.json.",
    );
  }
  if (
    thirdPartySkillPaths.length > 0 &&
    !contract.workflow.managedProjectPaths.includes(
      THIRD_PARTY_INSTALLATIONS_RELATIVE_PATH,
    )
  ) {
    throw new Error(
      `Approved managed paths must include ${THIRD_PARTY_INSTALLATIONS_RELATIVE_PATH}.`,
    );
  }
  const discovery = await recommendProjectSkills({ homeDir, repoRoot });
  if (requested.length > 0 && !discovery.catalogConfigured) {
    throw new Error(
      "Selected Project Skills require a configured personal Skill catalog.",
    );
  }
  const catalogNames = new Set(
    discovery.catalogConfigured
      ? (
          await discoverSkillCatalog({
            repositoryPath: (
              await loadSkillRepositoryProfile({ homeDir })
            ).repositoryPath,
          })
        ).map((entry) => entry.name)
      : [],
  );
  for (const name of requested) {
    if (!catalogNames.has(name)) {
      throw new Error(`Approved Project Skill is absent from catalog: ${name}`);
    }
  }
  const applied = await applyProjectContract({
    repoRoot,
    contractPath,
    skillRoot: sourceSkillRoot,
  });
  const projectSkills =
    requested.length > 0
      ? await installProjectSkills({
          approved,
          homeDir,
          now,
          repoRoot,
          selectedSkills: requested,
        })
      : {
          status: "skipped",
          installedSkills: [],
        };
  const loadedThirdPartySource = await loadThirdPartySourceManifest({
    manifestPath: thirdPartyPlan.manifestPath,
  });
  const resolveThirdPartySource =
    thirdPartySourceResolver ??
    (async ({ source }) => {
      const cachedSource = path.join(
        path.resolve(homeDir),
        ".agents",
        "harness",
        "sources",
        source.id,
        source.commit,
      );
      if (!thirdPartyNetworkApproved && !(await pathEntryExists(cachedSource))) {
        throw new Error(
          `Pinned source ${source.id} is not cached and network access was not approved.`,
        );
      }
      return acquirePinnedGitSource({
        approvalPlan: thirdPartyPlan,
        homeDir,
        source,
      });
    });
  const thirdPartyProjectSkillResult = await applyThirdPartyProjectSkills({
    approved,
    approvalPlan: thirdPartyPlan,
    approvals: thirdPartyApprovals,
    homeDir,
    manifest: loadedThirdPartySource.manifest,
    repoRoot,
    sourceResolver: resolveThirdPartySource,
    strictDataBoundary,
  });
  const failedThirdPartyProjectSkills =
    thirdPartyProjectSkillResult.status === "source-unavailable"
      ? [
          {
            id: "project-skills",
            status: "failed",
            error:
              thirdPartyProjectSkillResult.error ??
              "Pinned third-party project Skill source was unavailable.",
          },
        ]
      : [];
  const markReadyCommand =
    `node scripts/harness-init.mjs mark-ready --repo-root ` +
    `"${path.resolve(repoRoot)}"`;
  return {
    status:
      failedThirdPartyProjectSkills.length > 0
        ? "third-party-project-skills-failed"
        : "approved-awaiting-gates",
    discovery,
    applied,
    projectSkills,
    thirdParty: {
      plan: thirdPartyPlan,
      approvals: thirdPartyApprovals,
      projectSkills: thirdPartyProjectSkillResult,
    },
    failedThirdPartyProjectSkills,
    next:
      failedThirdPartyProjectSkills.length > 0
        ? {
            action: "resolve-third-party-project-skill-failure",
          }
        : {
            action: "run-approved-quality-gates-then-mark-ready",
            command: markReadyCommand,
          },
  };
}

export async function exportHarnessInitSkill({
  sourceSkillRoot,
  targetRepo,
}) {
  const source = path.resolve(sourceSkillRoot);
  const root = path.resolve(targetRepo);
  const targetParent = path.join(root, ".agents", "skills");
  const target = path.join(targetParent, "harness-init");
  assertInside(root, target, "Harness Init Skill target");
  await ensureSafeDirectoryChain(
    root,
    targetParent,
    "Harness Init Skill target",
    { create: true },
  );
  if (await pathEntryExists(target)) {
    throw new Error(
      `Harness Init Skill target already exists; refusing collision: ${target}`,
    );
  }
  const stage = path.join(
    targetParent,
    `.harness-init-export-${randomUUID()}`,
  );
  const sourceSnapshot = await snapshotSkillTree(source);
  try {
    await snapshotSkillTree(source, { copyTo: stage });
    const stagedSnapshot = await snapshotSkillTree(stage);
    if (stagedSnapshot.treeSha256 !== sourceSnapshot.treeSha256) {
      throw new Error("Harness Init Skill staged export identity changed.");
    }
    await ensureSafeDirectoryChain(
      root,
      targetParent,
      "Harness Init Skill target",
    );
    if (await pathEntryExists(target)) {
      throw new Error(
        `Harness Init Skill target already exists; refusing collision: ${target}`,
      );
    }
    await rename(stage, target);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return { status: "exported", target };
}

function requireOption(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function commaSeparatedValues(value, label) {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${label} requires at least one value.`);
  }
  return values;
}

function commaSeparatedAssignments(value, label) {
  const assignments = {};
  for (const entry of commaSeparatedValues(value, label)) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`${label} entries must use name=value.`);
    }
    const name = entry.slice(0, separator).trim();
    const selected = entry.slice(separator + 1).trim();
    if (Object.hasOwn(assignments, name)) {
      throw new Error(`${label} contains duplicate name ${name}.`);
    }
    assignments[name] = selected;
  }
  return assignments;
}

function explicitCandidateValues(value, label) {
  if (value.trim().toLowerCase() === "none") return [];
  const values = commaSeparatedValues(value, label);
  if (values.some((entry) => entry.toLowerCase() === "none")) {
    throw new Error(`${label} cannot combine none with candidate ids.`);
  }
  return values;
}

function parseCliArgs(argv) {
  const [command, ...args] = argv;
  if (
    ![
      "addons",
      "global-init",
      "project-init",
      "third-party-plan",
      "provider-action-plan",
      "provider-action-run",
      "inspect",
      "validate",
      "apply",
      "mark-ready",
      "export-skill",
      "configure-skills",
      "catalog-skills",
      "install-skills",
      "revise-project-skills",
      "skill-migration-plan",
      "skill-migration-apply",
      "skill-migration-status",
      "skill-migration-rollback",
    ].includes(command)
  ) {
    throw new Error(
      `Unknown Harness Init command: ${command ?? "(missing)"}.`,
    );
  }
  const result = {
    command,
    repoRoot: process.cwd(),
    repoRootExplicit: false,
    homeDir: null,
    contractPath: null,
    targetRepo: null,
    repositoryPath: null,
    globalEssentialSkills: [],
    selectionGuidance: [],
    excludedSkills: [],
    selectedSkills: [],
    inventorySha256: null,
    backupId: null,
    catalogMode: null,
    catalogUrl: null,
    providerActions: null,
    provider: null,
    providerAction: null,
    planSha256: null,
    thirdPartyGlobalSkills: null,
    thirdPartyGlobalPlugins: null,
    thirdPartyProjectSkills: null,
    thirdPartyMcpCli: null,
    thirdPartyPlanSha256: null,
    thirdPartySourceSha256: null,
    strictDataBoundary: false,
    allowCatalogNetwork: false,
    allowThirdPartyNetwork: false,
    nonInteractive: false,
    statusOnly: false,
    planOnly: false,
    noProjectSkills: false,
    replaceExistingProjectSkills: false,
    selectedSkillsExplicit: false,
    approved: false,
  };
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === "--repo-root") {
      result.repoRoot = path.resolve(requireOption(args, index, option));
      result.repoRootExplicit = true;
      index++;
    } else if (option === "--home-dir") {
      result.homeDir = path.resolve(requireOption(args, index, option));
      index++;
    } else if (option === "--contract") {
      result.contractPath = path.resolve(requireOption(args, index, option));
      index++;
    } else if (option === "--target") {
      result.targetRepo = path.resolve(requireOption(args, index, option));
      index++;
    } else if (option === "--repository") {
      result.repositoryPath = path.resolve(
        requireOption(args, index, option),
      );
      index++;
    } else if (option === "--global-essential") {
      result.globalEssentialSkills.push(
        ...commaSeparatedValues(
          requireOption(args, index, option),
          option,
        ),
      );
      index++;
    } else if (option === "--guidance") {
      result.selectionGuidance.push(
        requireOption(args, index, option),
      );
      index++;
    } else if (option === "--exclude") {
      result.excludedSkills.push(
        ...commaSeparatedValues(
          requireOption(args, index, option),
          option,
        ),
      );
      index++;
    } else if (option === "--skills") {
      result.selectedSkills.push(
        ...commaSeparatedValues(
          requireOption(args, index, option),
          option,
        ),
      );
      result.selectedSkillsExplicit = true;
      index++;
    } else if (option === "--no-project-skills") {
      result.noProjectSkills = true;
      result.selectedSkillsExplicit = true;
    } else if (option === "--replace-existing") {
      result.replaceExistingProjectSkills = true;
    } else if (option === "--catalog-mode") {
      result.catalogMode = requireOption(args, index, option);
      index++;
    } else if (option === "--catalog-url") {
      result.catalogUrl = requireOption(args, index, option);
      index++;
    } else if (option === "--provider-actions") {
      result.providerActions = commaSeparatedAssignments(
        requireOption(args, index, option),
        option,
      );
      index++;
    } else if (option === "--provider") {
      result.provider = requireOption(args, index, option);
      index++;
    } else if (option === "--action") {
      result.providerAction = requireOption(args, index, option);
      index++;
    } else if (option === "--plan-sha256") {
      result.planSha256 = requireOption(args, index, option);
      index++;
    } else if (option === "--third-party-global-skills") {
      result.thirdPartyGlobalSkills = explicitCandidateValues(
        requireOption(args, index, option),
        option,
      );
      index++;
    } else if (option === "--third-party-global-plugins") {
      result.thirdPartyGlobalPlugins = explicitCandidateValues(
        requireOption(args, index, option),
        option,
      );
      index++;
    } else if (option === "--third-party-project-skills") {
      result.thirdPartyProjectSkills = explicitCandidateValues(
        requireOption(args, index, option),
        option,
      );
      index++;
    } else if (option === "--third-party-mcp-cli") {
      result.thirdPartyMcpCli = explicitCandidateValues(
        requireOption(args, index, option),
        option,
      );
      index++;
    } else if (option === "--third-party-source-sha256") {
      result.thirdPartySourceSha256 = requireOption(args, index, option);
      index++;
    } else if (option === "--third-party-plan-sha256") {
      result.thirdPartyPlanSha256 = requireOption(args, index, option);
      index++;
    } else if (option === "--strict-data-boundary") {
      result.strictDataBoundary = true;
    } else if (option === "--allow-catalog-network") {
      result.allowCatalogNetwork = true;
    } else if (option === "--allow-third-party-network") {
      result.allowThirdPartyNetwork = true;
    } else if (option === "--non-interactive") {
      result.nonInteractive = true;
    } else if (option === "--status") {
      result.statusOnly = true;
    } else if (option === "--plan-only") {
      result.planOnly = true;
    } else if (option === "--inventory-sha256") {
      result.inventorySha256 = requireOption(args, index, option);
      index++;
    } else if (option === "--backup-id") {
      result.backupId = requireOption(args, index, option);
      index++;
    } else if (option === "--approved") {
      result.approved = true;
    } else {
      throw new Error(`Unknown option for ${command}: ${option}`);
    }
  }
  if (["validate", "apply"].includes(command) && !result.contractPath) {
    throw new Error(`${command} requires --contract <path>.`);
  }
  if (command === "export-skill" && !result.targetRepo) {
    throw new Error("export-skill requires --target <repository>.");
  }
  if (command === "configure-skills") {
    if (!result.repositoryPath) {
      throw new Error(
        "configure-skills requires --repository <directory>.",
      );
    }
    if (result.globalEssentialSkills.length === 0) {
      throw new Error(
        "configure-skills requires --global-essential <names>.",
      );
    }
    if (!result.approved) {
      throw new Error("configure-skills requires --approved.");
    }
  }
  if (
    command === "install-skills" &&
    result.selectedSkills.length === 0
  ) {
    throw new Error("install-skills requires --skills <names>.");
  }
  if (command === "install-skills" && !result.approved) {
    throw new Error("install-skills requires --approved.");
  }
  if (
    ["skill-migration-plan", "skill-migration-apply"].includes(command) &&
    !result.repositoryPath
  ) {
    throw new Error(`${command} requires --repository <directory>.`);
  }
  if (
    ["revise-project-skills", "skill-migration-apply"].includes(command) &&
    result.selectedSkills.length === 0
  ) {
    throw new Error(`${command} requires --skills <names>.`);
  }
  if (
    ["revise-project-skills", "skill-migration-apply", "skill-migration-rollback"].includes(
      command,
    ) &&
    !result.approved
  ) {
    throw new Error(`${command} requires --approved.`);
  }
  if (
    result.replaceExistingProjectSkills &&
    command !== "revise-project-skills"
  ) {
    throw new Error("--replace-existing is only valid for revise-project-skills.");
  }
  if (
    command === "skill-migration-apply" &&
    !/^[a-f0-9]{64}$/.test(String(result.inventorySha256 ?? ""))
  ) {
    throw new Error(
      "skill-migration-apply requires --inventory-sha256 <sha256>.",
    );
  }
  if (command === "skill-migration-rollback" && !result.backupId) {
    throw new Error(
      "skill-migration-rollback requires --backup-id <backup-id>.",
    );
  }
  if (command === "global-init" && result.nonInteractive) {
    if (!result.approved) {
      throw new Error("global-init --non-interactive requires --approved.");
    }
    if (!result.homeDir) {
      throw new Error(
        "global-init --non-interactive requires explicit --home-dir.",
      );
    }
    if (!result.catalogMode) {
      throw new Error(
        "global-init --non-interactive requires --catalog-mode.",
      );
    }
    if (!result.providerActions) {
      throw new Error(
        "global-init --non-interactive requires --provider-actions.",
      );
    }
    for (const [field, option] of [
      ["thirdPartyGlobalSkills", "--third-party-global-skills"],
      ["thirdPartyGlobalPlugins", "--third-party-global-plugins"],
      ["thirdPartyMcpCli", "--third-party-mcp-cli"],
    ]) {
      if (result[field] === null) {
        throw new Error(
          `global-init --non-interactive requires ${option} (use none to reject all).`,
        );
      }
    }
    if (
      !/^[a-f0-9]{64}$/.test(
        String(result.thirdPartySourceSha256 ?? ""),
      )
    ) {
      throw new Error(
        "global-init --non-interactive requires --third-party-source-sha256 <sha256>.",
      );
    }
    const selectedThirdPartyCount = [
      ...result.thirdPartyGlobalSkills,
      ...result.thirdPartyGlobalPlugins,
      ...result.thirdPartyMcpCli,
    ].length;
    if (
      selectedThirdPartyCount > 0 &&
      !/^[a-f0-9]{64}$/.test(
        String(result.thirdPartyPlanSha256 ?? ""),
      )
    ) {
      throw new Error(
        "global-init --non-interactive with selected third parties requires --third-party-plan-sha256 <sha256>.",
      );
    }
  }
  if (command === "addons") {
    if (result.statusOnly && result.planOnly) {
      throw new Error("addons cannot combine --status with --plan-only.");
    }
    if (result.thirdPartyProjectSkills !== null) {
      throw new Error(
        "addons manages global candidates only; use project-init for project Skills.",
      );
    }
    const unrelatedOption = [
      [result.contractPath !== null, "--contract"],
      [result.targetRepo !== null, "--target"],
      [result.repositoryPath !== null, "--repository"],
      [result.catalogMode !== null, "--catalog-mode"],
      [result.catalogUrl !== null, "--catalog-url"],
      [result.providerActions !== null, "--provider-actions"],
      [result.provider !== null, "--provider"],
      [result.providerAction !== null, "--action"],
      [result.planSha256 !== null, "--plan-sha256"],
      [result.allowCatalogNetwork, "--allow-catalog-network"],
      [result.selectedSkills.length > 0, "--skills"],
      [result.noProjectSkills, "--no-project-skills"],
    ].find(([present]) => present);
    if (unrelatedOption) {
      throw new Error(`addons does not accept ${unrelatedOption[1]}.`);
    }
    const selectionsComplete = [
      ["thirdPartyGlobalSkills", "--third-party-global-skills"],
      ["thirdPartyGlobalPlugins", "--third-party-global-plugins"],
      ["thirdPartyMcpCli", "--third-party-mcp-cli"],
    ];
    if (result.statusOnly) {
      if (
        result.approved ||
        result.nonInteractive ||
        result.allowThirdPartyNetwork ||
        result.thirdPartyPlanSha256 !== null ||
        result.thirdPartySourceSha256 !== null ||
        selectionsComplete.some(([field]) => result[field] !== null)
      ) {
        throw new Error(
          "addons --status is read-only and rejects selection or approval flags.",
        );
      }
    } else if (result.planOnly) {
      if (
        result.approved ||
        result.nonInteractive ||
        result.allowThirdPartyNetwork ||
        result.thirdPartyPlanSha256 !== null ||
        result.thirdPartySourceSha256 !== null
      ) {
        throw new Error(
          "addons --plan-only is read-only and rejects execution approval flags.",
        );
      }
      for (const [field, option] of selectionsComplete) {
        if (result[field] === null) {
          throw new Error(
            `addons --plan-only requires ${option} (use none to reject all).`,
          );
        }
      }
    } else if (result.nonInteractive) {
      if (!result.approved) {
        throw new Error("addons --non-interactive requires --approved.");
      }
      if (!result.homeDir) {
        throw new Error(
          "addons --non-interactive requires explicit --home-dir.",
        );
      }
      for (const [field, option] of selectionsComplete) {
        if (result[field] === null) {
          throw new Error(
            `addons --non-interactive requires ${option} (use none to reject all).`,
          );
        }
      }
      if (
        !/^[a-f0-9]{64}$/.test(
          String(result.thirdPartySourceSha256 ?? ""),
        )
      ) {
        throw new Error(
          "addons --non-interactive requires --third-party-source-sha256 <sha256>.",
        );
      }
      if (
        !/^[a-f0-9]{64}$/.test(
          String(result.thirdPartyPlanSha256 ?? ""),
        )
      ) {
        throw new Error(
          "addons --non-interactive requires --third-party-plan-sha256 <sha256>.",
        );
      }
    } else if (
      result.approved ||
      result.allowThirdPartyNetwork ||
      result.thirdPartyPlanSha256 !== null ||
      result.thirdPartySourceSha256 !== null ||
      selectionsComplete.some(([field]) => result[field] !== null)
    ) {
      throw new Error(
        "interactive addons obtains selections and approvals from its own prompts.",
      );
    }
  }
  if (command === "project-init") {
    if (!result.contractPath) {
      throw new Error("project-init requires --contract <path>.");
    }
    if (result.noProjectSkills && result.selectedSkills.length > 0) {
      throw new Error(
        "project-init cannot combine --skills with --no-project-skills.",
      );
    }
    if (result.nonInteractive) {
      if (!result.approved) {
        throw new Error("project-init --non-interactive requires --approved.");
      }
      if (!result.homeDir) {
        throw new Error(
          "project-init --non-interactive requires explicit --home-dir.",
        );
      }
      if (!result.repoRootExplicit) {
        throw new Error(
          "project-init --non-interactive requires explicit --repo-root.",
        );
      }
      if (!result.selectedSkillsExplicit) {
        throw new Error(
          "project-init --non-interactive requires --skills or --no-project-skills.",
        );
      }
      if (result.thirdPartyProjectSkills === null) {
        throw new Error(
          "project-init --non-interactive requires --third-party-project-skills (use none to reject all).",
        );
      }
      if (
        !/^[a-f0-9]{64}$/.test(
          String(result.thirdPartySourceSha256 ?? ""),
        )
      ) {
        throw new Error(
          "project-init --non-interactive requires --third-party-source-sha256 <sha256>.",
        );
      }
      if (
        result.thirdPartyProjectSkills.length > 0 &&
        !/^[a-f0-9]{64}$/.test(
          String(result.thirdPartyPlanSha256 ?? ""),
        )
      ) {
        throw new Error(
          "project-init --non-interactive with selected third parties requires --third-party-plan-sha256 <sha256>.",
        );
      }
    }
  }
  if (["provider-action-plan", "provider-action-run"].includes(command)) {
    if (!result.homeDir) {
      throw new Error(`${command} requires explicit --home-dir.`);
    }
    if (!GUIDED_INIT_PROVIDER_NAMES.includes(result.provider)) {
      throw new Error(
        `${command} requires --provider codex|gemini|grok|claude.`,
      );
    }
    if (!["install", "login"].includes(result.providerAction)) {
      throw new Error(`${command} requires --action install|login.`);
    }
    if (!result.repoRootExplicit) {
      throw new Error(`${command} requires explicit --repo-root.`);
    }
  }
  if (command === "provider-action-run") {
    if (result.nonInteractive) {
      throw new Error(
        "provider-action-run refuses non-interactive execution; use provider-action-plan for automation.",
      );
    }
    if (!result.approved) {
      throw new Error("provider-action-run requires --approved.");
    }
    if (!/^[a-f0-9]{64}$/.test(String(result.planSha256 ?? ""))) {
      throw new Error(
        "provider-action-run requires --plan-sha256 <sha256>.",
      );
    }
  }
  return result;
}

const DEFAULT_SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function thirdPartyManifestPathForSkillRoot(skillRoot) {
  return path.join(
    path.resolve(skillRoot ?? DEFAULT_SKILL_ROOT),
    "assets",
    "third-party-sources.json",
  );
}

function thirdPartyCandidateQuestion(candidate, sourceManifestSha256) {
  const paths = candidate.paths?.map(
    (entry) => `${entry.sourcePath} -> ${entry.targetPath}`,
  ) ??
    candidate.writePaths ??
    [];
  const groupLabel = {
    "global-skills": "Global Skills",
    "global-plugins": "Global Plugins",
    "project-skills": "Project Skills",
    "mcp-cli": "MCP / CLI",
  }[candidate.group] ?? candidate.group;
  const installed = candidate.installed ?? {};
  const observed = installed.observed ?? {};
  const observedPaths = Array.isArray(observed.paths)
    ? observed.paths.map((entry) =>
      `${entry.name}:${entry.status}${entry.treeSha256 ? `@${entry.treeSha256}` : ""}`)
    : [];
  const installationDetails = [
    `status=${installed.status ?? "unknown"}`,
    `scope=${installed.scope ?? candidate.scope}`,
    typeof observed.owned === "boolean" ? `owned=${observed.owned}` : null,
    observed.target ? `target=${observed.target}` : null,
    observedPaths.length ? `paths=${observedPaths.join(",")}` : null,
    observed.reason ? `reason=${observed.reason}` : null,
  ].filter(Boolean).join("; ");
  return [
    `Approve ${candidate.name}?`,
    `Approval group: ${groupLabel}`,
    `Purpose: ${candidate.purpose}`,
    `Source manifest SHA-256: ${sourceManifestSha256}`,
    `Source: ${candidate.repository} @ ${candidate.commit}`,
    candidate.gitTree ? `Source Git tree: ${candidate.gitTree}` : null,
    candidate.release ? `Release: ${candidate.release}` : null,
    candidate.packageIntegrity
      ? `Package SRI: ${candidate.packageIntegrity}`
      : null,
    candidate.source?.packageLock
      ? `Complete package lock: ${candidate.source.packageLock.path}; ` +
        `SHA-256=${candidate.source.packageLock.sha256}; ` +
        `packages=${candidate.source.packageLock.packageCount}`
      : null,
    candidate.assets?.length
      ? `Release assets: ${candidate.assets
        .map(
          (asset) =>
            `${asset.platform}/${asset.name} SHA-256=${asset.sha256}`,
        )
        .join(", ")}`
      : null,
    `Existing installation: ${installationDetails}`,
    `Path/write scope: ${paths.join(", ") || "(declared by host)"}`,
    `License/scope: ${candidate.license}; ${candidate.scope}`,
    candidate.unavailableReason
      ? `Status: BLOCKED — ${candidate.unavailableReason}`
      : candidate.recommended === true
      ? "Recommended: yes — install is recommended, but remains unselected until you explicitly choose yes."
      : "Recommended: no — optional; remains unselected unless you explicitly choose yes.",
    "Default: skip — press Enter or choose no to leave this candidate unchanged.",
    `Dependencies: ${candidate.dependencies.join(", ") || "none"}`,
    `Effects: scripts=${candidate.scripts}, hooks=${candidate.hooks}, ` +
      `executables=${candidate.executables}, network=${Boolean(candidate.effects?.network)}`,
    `Data egress: ${candidate.dataEgress}`,
    `Lifecycle: update=${candidate.lifecycle.update}; ` +
      `rollback=${candidate.lifecycle.rollback}; uninstall=${candidate.lifecycle.uninstall}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function thirdPartyExecutionApprovalSummary(plan) {
  const commandPlan = plan.execution.commandPlan;
  const commands = Object.entries(commandPlan.commands).map(([name, record]) => {
    if (record.status !== "bound") return `- ${name}: ${record.status} (${record.reason})`;
    const identity = record.binding.identity;
    return (
      `- ${name}: ${record.binding.command}; ` +
      `file=${identity.executable?.sha256 ?? identity.launcher?.sha256 ?? "n/a"}; ` +
      `packageTree=${identity.packageTree?.treeSha256 ?? "n/a"}`
    );
  });
  return [
    `Third-party plan SHA-256: ${plan.planSha256}`,
    `Approved package roots: ${commandPlan.approvedPackageRoots.join(", ") || "none"}`,
    `Approved command roots: ${commandPlan.approvedCommandRoots.join(", ") || "none"}`,
    "Subprocess configuration roots:",
    ...Object.entries(plan.execution.subprocessConfigRoots).map(
      ([name, value]) => `- ${name}: ${value}`,
    ),
    "Command identities:",
    ...commands,
  ].join("\n");
}

async function prepareThirdPartyPlan({
  homeDir,
  repoRoot,
  skillRoot,
  strictDataBoundary,
}) {
  return buildThirdPartyApprovalPlan({
    discoverCommandRoots: true,
    homeDir,
    manifestPath: thirdPartyManifestPathForSkillRoot(skillRoot),
    repoRoot,
    strictDataBoundary,
  });
}

const ADDON_GROUPS = [
  ["global-skills", "thirdPartyGlobalSkills", "globalSkills"],
  ["global-plugins", "thirdPartyGlobalPlugins", "globalPlugins"],
  ["mcp-cli", "thirdPartyMcpCli", "mcpCli"],
];

function addonSelectionsFromArgs(args) {
  return Object.fromEntries(
    ADDON_GROUPS.map(([, field, outputKey]) => [
      outputKey,
      [...(args[field] ?? [])],
    ]),
  );
}

function addonCandidates(plan) {
  const allowedGroups = new Set(ADDON_GROUPS.map(([groupId]) => groupId));
  return plan.groups
    .filter((group) => allowedGroups.has(group.id))
    .flatMap((group) => group.candidates);
}

function addonSelectedIds(selections) {
  return new Set(Object.values(selections).flat());
}

function addonCandidateView(plan, candidate, selectedIds) {
  const byId = new Map(
    plan.groups
      .flatMap((group) => group.candidates)
      .map((entry) => [entry.id, entry]),
  );
  const missingDependencies = candidate.dependencies.filter((dependency) => {
    if (selectedIds.has(dependency)) return false;
    return byId.get(dependency)?.installed?.status !== "exact";
  });
  let status;
  let reason = candidate.installed?.observed?.reason ?? null;
  if (candidate.unavailableReason) {
    status = "blocked";
    reason = candidate.unavailableReason;
  } else if (missingDependencies.length > 0) {
    status = "blocked";
    reason =
      `Missing exact-installed or same-transaction dependencies: ` +
      `${missingDependencies.join(", ")}.`;
  } else if (
    candidate.installed?.status === "drifted" ||
    candidate.installed?.status === "unowned"
  ) {
    status = "drifted";
  } else if (candidate.installed?.status === "exact") {
    status = "installed";
  } else if (candidate.installed?.status === "manual-pending") {
    status = "manual-pending";
  } else {
    status = "absent";
  }
  return {
    id: candidate.id,
    name: candidate.name,
    group: candidate.group,
    purpose: candidate.purpose,
    recommended: candidate.recommended === true,
    selected: selectedIds.has(candidate.id),
    status,
    selectable: status !== "blocked" && status !== "drifted",
    reason,
    dependencies: [...candidate.dependencies],
    effects: {
      scripts: candidate.scripts,
      hooks: candidate.hooks,
      executables: candidate.executables,
      network: Boolean(candidate.effects?.network),
      dataEgress: candidate.dataEgress,
    },
    installed: structuredClone(candidate.installed),
  };
}

function addonEvidence(plan, selections, mode) {
  const selectedIds = addonSelectedIds(selections);
  const candidates = addonCandidates(plan).map((candidate) =>
    addonCandidateView(plan, candidate, selectedIds),
  );
  return {
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    command: "addons",
    mode,
    sourceManifestSha256: plan.sourceManifestSha256,
    planSha256: plan.planSha256,
    strictDataBoundary: plan.strictDataBoundary,
    selections,
    networkCandidateIds: candidates
      .filter(
        (candidate) =>
          candidate.selected && candidate.effects.network === true,
      )
      .map((candidate) => candidate.id),
    candidates,
  };
}

function assertAddonApprovalsApplicable(evidence, approvals) {
  const unsafe = evidence.candidates.find(
    (candidate) =>
      candidate.selected &&
      (candidate.status === "blocked" || candidate.status === "drifted"),
  );
  if (unsafe) {
    throw new Error(
      `${unsafe.id} is ${unsafe.status} and cannot be approved: ` +
      `${unsafe.reason ?? "manual remediation is required."}`,
    );
  }
  if (approvals.skipped.length > 0) {
    throw new Error(
      `Selected add-ons cannot be approved: ${approvals.skipped
        .map((entry) => `${entry.id}: ${entry.reason}`)
        .join("; ")}.`,
    );
  }
}

function addonExecutionStatus(operation) {
  if (operation.globalSkills.status === "source-unavailable") {
    return "failed";
  }
  if (
    operation.globalActions.actions.some((action) =>
      ["failed", "partial-failure"].includes(action.status))
  ) {
    return "failed";
  }
  if (
    operation.globalActions.actions.some(
      (action) => action.status === "manual-pending",
    )
  ) {
    return "manual-pending";
  }
  return "completed";
}

async function runAddons({
  args,
  execFileImpl,
  homeDir,
  promptChoice,
  skillRoot,
  stdin,
  stdout,
  thirdPartyPlanBuilder,
  thirdPartyRunCommand,
  thirdPartySourceResolver,
}) {
  const ask =
    promptChoice ??
    ((question) =>
      numberedTtyChoice({
        stdin,
        stdout,
        ...question,
      }));
  const sourceSkillRoot = path.resolve(skillRoot ?? DEFAULT_SKILL_ROOT);
  const initialPlan = await thirdPartyPlanBuilder({
    homeDir,
    repoRoot: args.repoRoot,
    skillRoot: sourceSkillRoot,
    strictDataBoundary: args.strictDataBoundary,
  });
  if (args.statusOnly) {
    return addonEvidence(
      initialPlan,
      { globalSkills: [], globalPlugins: [], mcpCli: [] },
      "status",
    );
  }

  if (!args.nonInteractive && !args.planOnly) {
    args.thirdPartyGlobalSkills = [];
    args.thirdPartyGlobalPlugins = [];
    args.thirdPartyMcpCli = [];
    const selectedIds = new Set();
    for (const [, field] of ADDON_GROUPS) {
      const groupId = ADDON_GROUPS.find(([, key]) => key === field)[0];
      const group = initialPlan.groups.find((entry) => entry.id === groupId);
      for (const candidate of group.candidates) {
        const view = addonCandidateView(initialPlan, candidate, selectedIds);
        const choice = await ask({
          question:
            `${thirdPartyCandidateQuestion(
              candidate,
              initialPlan.sourceManifestSha256,
            )}\nAdd-on status: ${view.status}` +
            `${view.reason ? ` — ${view.reason}` : ""}`,
          options: view.selectable ? ["no", "yes"] : ["no"],
          defaultOption: "no",
          recommended: "no",
        });
        if (choice === "yes") {
          args[field].push(candidate.id);
          selectedIds.add(candidate.id);
        }
      }
    }
  }

  let selections = addonSelectionsFromArgs(args);
  let prepared = await prepareThirdPartyGlobalOperation({
    homeDir,
    repoRoot: args.repoRoot,
    skillRoot: sourceSkillRoot,
    strictDataBoundary: args.strictDataBoundary,
    thirdPartyGlobalPlugins: selections.globalPlugins,
    thirdPartyGlobalSkills: selections.globalSkills,
    thirdPartyMcpCli: selections.mcpCli,
    thirdPartyApprovalPlan: initialPlan,
    thirdPartyPlanSha256: args.nonInteractive
      ? args.thirdPartyPlanSha256
      : initialPlan.planSha256,
    thirdPartyPlanBuilder,
    thirdPartySourceSha256: args.nonInteractive
      ? args.thirdPartySourceSha256
      : initialPlan.sourceManifestSha256,
    requirePlanSha256: args.nonInteractive,
    requireSourceSha256: args.nonInteractive,
  });
  let evidence = addonEvidence(
    initialPlan,
    selections,
    args.planOnly ? "plan" : args.nonInteractive ? "apply" : "interactive",
  );
  assertAddonApprovalsApplicable(evidence, prepared.approvals);
  if (args.planOnly) {
    return { ...evidence, approvals: prepared.approvals };
  }
  if (!args.nonInteractive && addonSelectedIds(selections).size === 0) {
    return { ...evidence, status: "skipped", approvals: prepared.approvals };
  }

  if (
    evidence.networkCandidateIds.length > 0 &&
    !args.allowThirdPartyNetwork
  ) {
    if (args.nonInteractive) {
      throw new Error(
        "Selected add-ons require --allow-third-party-network after separate approval.",
      );
    }
    const networkApproval = await ask({
      question:
        "Approve network acquisition for these explicitly selected add-ons?\n" +
        evidence.networkCandidateIds.map((id) => `- ${id}`).join("\n") +
        `\nSource manifest SHA-256: ${initialPlan.sourceManifestSha256}`,
      options: ["no", "yes"],
      defaultOption: "no",
      recommended: "no",
    });
    if (networkApproval !== "yes") {
      const declined = new Set(evidence.networkCandidateIds);
      for (const [, field] of ADDON_GROUPS) {
        args[field] = args[field].filter((id) => !declined.has(id));
      }
      selections = addonSelectionsFromArgs(args);
      prepared = await prepareThirdPartyGlobalOperation({
        homeDir,
        repoRoot: args.repoRoot,
        skillRoot: sourceSkillRoot,
        strictDataBoundary: args.strictDataBoundary,
        thirdPartyGlobalPlugins: selections.globalPlugins,
        thirdPartyGlobalSkills: selections.globalSkills,
        thirdPartyMcpCli: selections.mcpCli,
        thirdPartyApprovalPlan: initialPlan,
        thirdPartyPlanBuilder,
      });
      evidence = addonEvidence(initialPlan, selections, "interactive");
      assertAddonApprovalsApplicable(evidence, prepared.approvals);
      if (addonSelectedIds(selections).size === 0) {
        return {
          ...evidence,
          status: "skipped",
          approvals: prepared.approvals,
        };
      }
    } else {
      args.allowThirdPartyNetwork = true;
    }
  }

  if (!args.nonInteractive) {
    const approval = await ask({
      question:
        `Approve installation of ${addonSelectedIds(selections).size} ` +
        `explicitly selected add-ons for ${homeDir}?\n` +
        thirdPartyExecutionApprovalSummary(initialPlan),
      options: ["cancel", "approve"],
      defaultOption: "cancel",
      recommended: "cancel",
    });
    if (approval !== "approve") {
      throw new Error("Add-on approval was declined; no state changed.");
    }
  }

  const executionPlan = await thirdPartyPlanBuilder({
    homeDir,
    repoRoot: args.repoRoot,
    skillRoot: sourceSkillRoot,
    strictDataBoundary: args.strictDataBoundary,
  });
  if (
    executionPlan.planSha256 !== initialPlan.planSha256 ||
    executionPlan.sourceManifestSha256 !== initialPlan.sourceManifestSha256
  ) {
    throw new Error(
      "Add-on approval plan drifted after presentation; no state changed.",
    );
  }
  prepared = await prepareThirdPartyGlobalOperation({
    homeDir,
    repoRoot: args.repoRoot,
    skillRoot: sourceSkillRoot,
    strictDataBoundary: args.strictDataBoundary,
    thirdPartyGlobalPlugins: selections.globalPlugins,
    thirdPartyGlobalSkills: selections.globalSkills,
    thirdPartyMcpCli: selections.mcpCli,
    thirdPartyApprovalPlan: executionPlan,
    thirdPartyPlanSha256: args.nonInteractive
      ? args.thirdPartyPlanSha256
      : executionPlan.planSha256,
    thirdPartyPlanBuilder,
    thirdPartySourceSha256: args.nonInteractive
      ? args.thirdPartySourceSha256
      : executionPlan.sourceManifestSha256,
    requirePlanSha256: true,
    requireSourceSha256: true,
  });
  evidence = addonEvidence(
    executionPlan,
    selections,
    args.nonInteractive ? "apply" : "interactive",
  );
  assertAddonApprovalsApplicable(evidence, prepared.approvals);
  const operation = await applyPreparedThirdPartyGlobals({
    allowNetwork: args.allowThirdPartyNetwork,
    approved: true,
    execFileImpl,
    homeDir,
    prepared,
    repoRoot: args.repoRoot,
    strictDataBoundary: args.strictDataBoundary,
    thirdPartyRunCommand,
    thirdPartySourceResolver,
  });
  return {
    ...evidence,
    status: addonExecutionStatus(operation),
    approvals: prepared.approvals,
    operation,
  };
}

async function numberedTtyChoice({
  stdin,
  stdout,
  question,
  options,
  defaultOption,
  recommended,
}) {
  if (!stdin?.isTTY || !stdout?.isTTY) {
    throw new Error(
      "Interactive Harness Init requires a TTY; use complete non-interactive flags.",
    );
  }
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    if (defaultOption !== undefined && !options.includes(defaultOption)) {
      throw new Error("Interactive default must be one listed option.");
    }
    stdout.write(`${question}\n`);
    options.forEach((option, index) => {
      const labels = [
        option === recommended ? "recommended" : null,
        option === defaultOption ? "default" : null,
      ].filter(Boolean);
      const suffix = labels.length ? ` (${labels.join(", ")})` : "";
      stdout.write(`  ${index + 1}. ${option}${suffix}\n`);
    });
    const answer = await terminal.question("Select one number: ");
    if (answer.trim() === "" && defaultOption !== undefined) {
      return defaultOption;
    }
    const selected = Number(answer);
    if (
      !Number.isInteger(selected) ||
      selected < 1 ||
      selected > options.length
    ) {
      throw new Error("Interactive selection must be one listed number.");
    }
    return options[selected - 1];
  } finally {
    terminal.close();
  }
}

async function resolveInteractiveGlobalArgs(
  args,
  {
    homeDir,
    promptChoice,
    providerRunCommand,
    skillRoot,
    stdin,
    stdout,
    thirdPartyPlanBuilder = prepareThirdPartyPlan,
  },
) {
  const ask =
    promptChoice ??
    ((question) =>
      numberedTtyChoice({
        stdin,
        stdout,
        ...question,
      }));
  if (!args.catalogMode) {
    args.catalogMode = await ask({
      question: "Choose the personal Skill catalog source.",
      options: ["skip", "local", "clone"],
      recommended: "skip",
    });
  }
  const providers = await inspectProviderCliStatuses({
    runCommand: providerRunCommand,
  });
  if (!args.providerActions) {
    args.providerActions = {};
    for (const name of GUIDED_INIT_PROVIDER_NAMES) {
      args.providerActions[name] = await ask({
        question:
          name === "claude"
            ? "Choose the Claude Code action. Install/login leaves the zero-.claude profile."
            : `Choose the ${name} CLI action for status ${providers[name].status}.`,
        options: providers[name].choices,
        recommended: providers[name].recommendedAction,
      });
    }
  }
  const thirdPartyPlan = await thirdPartyPlanBuilder({
    homeDir: path.resolve(args.homeDir ?? homeDir),
    repoRoot: args.repoRoot,
    skillRoot,
    strictDataBoundary: args.strictDataBoundary,
  });
  if (
    args.thirdPartySourceSha256 !== null &&
    args.thirdPartySourceSha256 !== thirdPartyPlan.sourceManifestSha256
  ) {
    throw new Error(
      "Requested third-party source SHA-256 differs from the distribution manifest.",
    );
  }
  args.thirdPartySourceSha256 = thirdPartyPlan.sourceManifestSha256;
  if (
    args.thirdPartyPlanSha256 !== null &&
    args.thirdPartyPlanSha256 !== thirdPartyPlan.planSha256
  ) {
    throw new Error(
      "Requested third-party plan SHA-256 differs from the displayed execution plan.",
    );
  }
  args.thirdPartyPlanSha256 = thirdPartyPlan.planSha256;
  for (const [groupId, field] of [
    ["global-skills", "thirdPartyGlobalSkills"],
    ["global-plugins", "thirdPartyGlobalPlugins"],
    ["mcp-cli", "thirdPartyMcpCli"],
  ]) {
    if (args[field] !== null) continue;
    args[field] = [];
    const group = thirdPartyPlan.groups.find((entry) => entry.id === groupId);
    for (const candidate of group.candidates) {
      const choice = await ask({
        question: thirdPartyCandidateQuestion(
          candidate,
          thirdPartyPlan.sourceManifestSha256,
        ),
        options: candidate.unavailableReason ? ["no"] : ["no", "yes"],
        defaultOption: "no",
        recommended: "no",
      });
      if (choice === "yes") args[field].push(candidate.id);
    }
  }
  const selectedByField = new Map([
    ["global-skills", "thirdPartyGlobalSkills"],
    ["global-plugins", "thirdPartyGlobalPlugins"],
    ["mcp-cli", "thirdPartyMcpCli"],
  ]);
  const networkCandidates = thirdPartyPlan.groups.flatMap((group) => {
    const field = selectedByField.get(group.id);
    if (!field) return [];
    const selected = new Set(args[field]);
    return group.candidates.filter(
      (candidate) =>
        selected.has(candidate.id) &&
        candidate.effects?.network === true,
    );
  });
  if (networkCandidates.length > 0 && !args.allowThirdPartyNetwork) {
    const approval = await ask({
      question:
        "Approve network acquisition for these explicitly selected third-party candidates?\n" +
        networkCandidates
          .map(
            (candidate) =>
              `- ${candidate.id}: ${candidate.repository} @ ${candidate.commit}`,
          )
          .join("\n") +
        `\nSource manifest SHA-256: ${thirdPartyPlan.sourceManifestSha256}`,
      options: ["no", "yes"],
      defaultOption: "no",
      recommended: "no",
    });
    if (approval === "yes") {
      args.allowThirdPartyNetwork = true;
    } else {
      const declined = new Set(
        networkCandidates.map((candidate) => candidate.id),
      );
      for (const field of selectedByField.values()) {
        args[field] = args[field].filter((id) => !declined.has(id));
      }
      stdout?.write?.(
        `Third-party network approval declined; skipped candidates: ` +
          `${[...declined].join(", ")}.\n`,
      );
    }
  }
  if (!args.approved) {
    const approval = await ask({
      question:
        `Approve Global Init for ${path.resolve(args.homeDir ?? homeDir)} ` +
        `with catalog mode ${args.catalogMode} and ` +
        `${[
          ...args.thirdPartyGlobalSkills,
          ...args.thirdPartyGlobalPlugins,
          ...args.thirdPartyMcpCli,
        ].length} explicitly selected third-party actions?\n` +
        thirdPartyExecutionApprovalSummary(thirdPartyPlan),
      options: ["approve", "cancel"],
      recommended: "approve",
    });
    if (approval !== "approve") {
      throw new Error("Global Init approval was declined; no state changed.");
    }
    args.approved = true;
  }
  return { args, providers, thirdPartyPlan };
}

export async function runHarnessInitCli(
  argv,
  {
    homeDir = homedir(),
    now = () => new Date(),
    promptChoice = null,
    providerActionResolveCommand,
    providerRunCommand,
    skillRoot = DEFAULT_SKILL_ROOT,
    stdin = process.stdin,
    stdout = process.stdout,
    providerActionRunCommand,
    providerActionVerifyCommand,
    thirdPartyRunCommand,
    thirdPartyPlanBuilder = prepareThirdPartyPlan,
    thirdPartySourceResolver,
  } = {},
) {
  const args = parseCliArgs(argv);
  const effectiveHomeDir = args.homeDir ?? homeDir;
  let result;
  if (args.command === "addons") {
    result = await runAddons({
      args,
      homeDir: effectiveHomeDir,
      promptChoice,
      skillRoot,
      stdin,
      stdout,
      thirdPartyPlanBuilder,
      thirdPartyRunCommand,
      thirdPartySourceResolver,
    });
  } else if (args.command === "global-init") {
    let providerStatusOverrides = null;
    let thirdPartyApprovalPlan = null;
    if (!args.nonInteractive) {
      const resolved = await resolveInteractiveGlobalArgs(args, {
        homeDir: effectiveHomeDir,
        promptChoice,
        providerRunCommand,
        skillRoot,
        stdin,
        stdout,
        thirdPartyPlanBuilder,
      });
      providerStatusOverrides = Object.fromEntries(
        Object.entries(resolved.providers).map(([name, value]) => [
          name,
          value.status,
        ]),
      );
      thirdPartyApprovalPlan = resolved.thirdPartyPlan;
    }
    result = await runGlobalInit({
      allowCatalogNetwork: args.allowCatalogNetwork,
      allowThirdPartyNetwork: args.allowThirdPartyNetwork,
      approved: args.approved,
      catalogMode: args.catalogMode,
      catalogPath: args.repositoryPath,
      catalogUrl: args.catalogUrl,
      homeDir: effectiveHomeDir,
      now,
      providerActions: args.providerActions,
      providerRunCommand,
      providerStatusOverrides,
      repoRoot: args.repoRoot,
      skillRoot,
      strictDataBoundary: args.strictDataBoundary,
      thirdPartyGlobalPlugins: args.thirdPartyGlobalPlugins ?? [],
      thirdPartyGlobalSkills: args.thirdPartyGlobalSkills ?? [],
      thirdPartyMcpCli: args.thirdPartyMcpCli ?? [],
      thirdPartyRunCommand,
      thirdPartyApprovalPlan,
      thirdPartyPlanSha256: args.thirdPartyPlanSha256,
      thirdPartyPlanBuilder,
      thirdPartySourceResolver,
      thirdPartySourceSha256: args.thirdPartySourceSha256,
    });
  } else if (args.command === "project-init") {
    const contractFingerprint = await readFileFingerprint(
      args.contractPath,
      "Project Init contract",
    );
    if (!contractFingerprint.exists) {
      throw new Error("Project Init contract does not exist.");
    }
    const suppliedContract = JSON.parse(
      contractFingerprint.bytes.toString("utf8"),
    );
    validateProjectContract(suppliedContract);
    if (!["draft", "approved"].includes(suppliedContract.status)) {
      throw new Error(
        "Interactive Project Init accepts a draft candidate or approved contract.",
      );
    }
    if (suppliedContract.thirdParty === undefined) {
      throw new Error("Project Init contract must include a thirdParty section.");
    }
    if (suppliedContract.status === "approved") {
      validateProjectContract(suppliedContract, { requireApproved: true });
    }
    const effectiveStrictDataBoundary =
      args.strictDataBoundary === true ||
      suppliedContract.security.strictDataBoundary === true;
    const projectThirdPartyPlan = await thirdPartyPlanBuilder({
      homeDir: effectiveHomeDir,
      repoRoot: args.repoRoot,
      skillRoot,
      strictDataBoundary: effectiveStrictDataBoundary,
    });
    if (
      args.thirdPartySourceSha256 !== null &&
      args.thirdPartySourceSha256 !==
        projectThirdPartyPlan.sourceManifestSha256
    ) {
      throw new Error(
        "Requested third-party source SHA-256 differs from the distribution manifest.",
      );
    }
    args.thirdPartySourceSha256 =
      projectThirdPartyPlan.sourceManifestSha256;
    if (
      args.thirdPartyPlanSha256 !== null &&
      args.thirdPartyPlanSha256 !== projectThirdPartyPlan.planSha256
    ) {
      throw new Error(
        "Requested project third-party plan SHA-256 differs from the current execution plan.",
      );
    }
    if (!args.nonInteractive) {
      args.thirdPartyPlanSha256 = projectThirdPartyPlan.planSha256;
    }
    if (args.nonInteractive && suppliedContract.status !== "approved") {
      throw new Error(
        "project-init --non-interactive only accepts an approved exact contract.",
      );
    }
    const ask =
      promptChoice ??
      ((question) =>
        numberedTtyChoice({
          stdin,
          stdout,
          ...question,
        }));
    if (!args.nonInteractive && suppliedContract.status === "draft") {
      const discovery = await recommendProjectSkills({
        homeDir: effectiveHomeDir,
        repoRoot: args.repoRoot,
      });
      const profile = await loadSkillRepositoryProfile({
        homeDir: effectiveHomeDir,
      });
      const catalog = profile
        ? await discoverSkillCatalog({ repositoryPath: profile.repositoryPath })
        : [];
      const catalogCandidates = catalog.filter(
        (entry) =>
          !profile?.globalEssentialSkills.includes(entry.name) &&
          !profile?.selection.excludedSkills.includes(entry.name),
      );
      const recommendationReasons = new Map(
        discovery.recommendations
          .filter((entry) =>
            catalogCandidates.some((candidate) => candidate.name === entry.name),
          )
          .map((entry) => [entry.name, entry.reason]),
      );
      stdout?.write?.(
        `Project discovery: technologies=${discovery.technologyStack.join(", ") || "none"}; ` +
          `catalog recommendations=${[...recommendationReasons.keys()].join(", ") || "none"}.\n`,
      );
      if (!args.selectedSkillsExplicit) {
        args.selectedSkills = [];
        for (const candidate of catalogCandidates) {
          const choice = await ask({
            question:
              `Approve catalog Skill ${candidate.name}?\n` +
              `Description: ${candidate.description}\n` +
              `Recommendation: ${
                recommendationReasons.has(candidate.name)
                  ? `${recommendationReasons.get(candidate.name)}; remains unselected until you explicitly choose yes.`
                  : "optional; remains unselected until you explicitly choose yes."
            }`,
            options: ["no", "yes"],
            recommended: "no",
          });
          if (choice === "yes") args.selectedSkills.push(candidate.name);
        }
      }
      const allowedCatalogSkills = new Set(
        catalogCandidates.map((entry) => entry.name),
      );
      for (const name of args.selectedSkills) {
        if (!allowedCatalogSkills.has(name)) {
          throw new Error(
            `Selected catalog Skill is unavailable, global, or excluded: ${name}.`,
          );
        }
      }
      if (args.thirdPartyProjectSkills === null) {
        args.thirdPartyProjectSkills = [];
        for (const candidate of projectThirdPartyCandidates(
          projectThirdPartyPlan,
        )) {
          const choice = await ask({
            question: thirdPartyCandidateQuestion(
              candidate,
              projectThirdPartyPlan.sourceManifestSha256,
            ),
            options: candidate.unavailableReason ? ["no"] : ["no", "yes"],
            defaultOption: "no",
            recommended: "no",
          });
          if (choice === "yes") args.thirdPartyProjectSkills.push(candidate.id);
        }
      }
      const selectedProjectThirdParty = new Set(
        args.thirdPartyProjectSkills,
      );
      const networkProjectCandidates = projectThirdPartyCandidates(
        projectThirdPartyPlan,
      ).filter(
        (candidate) =>
          selectedProjectThirdParty.has(candidate.id) &&
          candidate.effects?.network === true,
      );
      if (
        networkProjectCandidates.length > 0 &&
        !args.allowThirdPartyNetwork
      ) {
        const networkApproval = await ask({
          question:
            "Approve network acquisition for these selected project Skills?\n" +
            networkProjectCandidates
              .map(
                (candidate) =>
                  `- ${candidate.id}: ${candidate.repository} @ ${candidate.commit}`,
              )
              .join("\n") +
            `\nSource manifest SHA-256: ${projectThirdPartyPlan.sourceManifestSha256}`,
          options: ["no", "yes"],
          defaultOption: "no",
          recommended: "no",
        });
        if (networkApproval === "yes") {
          args.allowThirdPartyNetwork = true;
        } else {
          const declined = new Set(
            networkProjectCandidates.map((candidate) => candidate.id),
          );
          args.thirdPartyProjectSkills =
            args.thirdPartyProjectSkills.filter((id) => !declined.has(id));
          stdout?.write?.(
            `Third-party network approval declined; skipped project candidates: ` +
              `${[...declined].join(", ")}.\n`,
          );
        }
      }
      const candidateContract = compileApprovedInteractiveProjectContract({
        contract: suppliedContract,
        now,
        plan: projectThirdPartyPlan,
        recommendations: discovery.recommendations,
        selectedCatalogSkills: args.selectedSkills,
        selectedThirdPartySkills: args.thirdPartyProjectSkills,
        strictDataBoundary: effectiveStrictDataBoundary,
      });
      if (!args.approved) {
        const approval = await ask({
          question:
            `Approve Project Init for ${args.repoRoot} with ` +
            `${args.selectedSkills.length} catalog Skills and ` +
            `${args.thirdPartyProjectSkills.length} third-party project Skills?\n` +
            thirdPartyExecutionApprovalSummary(projectThirdPartyPlan),
          options: ["approve", "cancel"],
          recommended: "approve",
        });
        if (approval !== "approve") {
          throw new Error("Project Init approval was declined; no state changed.");
        }
        args.approved = true;
      }
      await promoteDraftProjectContract({
        candidate: candidateContract,
        contractPath: args.contractPath,
        expectedFingerprint: contractFingerprint,
      });
    } else if (!args.nonInteractive) {
      validateProjectContract(suppliedContract, { requireApproved: true });
      const approvedCatalogSkills = suppliedContract.skills.projectSelection.map(
        (entry) => entry.name,
      );
      const approvedThirdPartySkills = suppliedContract.thirdParty.projectSkills;
      if (
        args.selectedSkillsExplicit &&
        canonicalJson([...args.selectedSkills].sort()) !==
          canonicalJson([...approvedCatalogSkills].sort())
      ) {
        throw new Error(
          "Approved Project Init contract does not permit a different catalog Skill selection.",
        );
      }
      if (
        args.thirdPartyProjectSkills !== null &&
        canonicalJson([...args.thirdPartyProjectSkills].sort()) !==
          canonicalJson([...approvedThirdPartySkills].sort())
      ) {
        throw new Error(
          "Approved Project Init contract does not permit a different third-party Skill selection.",
        );
      }
      args.selectedSkills = approvedCatalogSkills;
      args.thirdPartyProjectSkills = approvedThirdPartySkills;
      if (!args.approved) {
        const approval = await ask({
          question:
            `Confirm execution of the approved Project Init contract for ${args.repoRoot} with ` +
            `${approvedCatalogSkills.length} catalog Skills and ` +
            `${approvedThirdPartySkills.length} third-party project Skills.\n` +
            thirdPartyExecutionApprovalSummary(projectThirdPartyPlan),
          options: ["approve", "cancel"],
          recommended: "approve",
        });
        if (approval !== "approve") {
          throw new Error("Project Init approval was declined; no state changed.");
        }
        args.approved = true;
      }
    }
    result = await runProjectInit({
      allowThirdPartyNetwork: args.allowThirdPartyNetwork,
      approved: args.approved,
      contractPath: args.contractPath,
      homeDir: effectiveHomeDir,
      now,
      repoRoot: args.repoRoot,
      selectedSkills: args.selectedSkills,
      skillRoot,
      strictDataBoundary: effectiveStrictDataBoundary,
      thirdPartyProjectSkills: args.thirdPartyProjectSkills,
      thirdPartyApprovalPlan: projectThirdPartyPlan,
      thirdPartyPlanSha256: args.thirdPartyPlanSha256,
      thirdPartyPlanBuilder,
      thirdPartySourceResolver,
      thirdPartySourceSha256: args.thirdPartySourceSha256,
    });
  } else if (args.command === "third-party-plan") {
    result = await thirdPartyPlanBuilder({
      homeDir: effectiveHomeDir,
      repoRoot: args.repoRoot,
      skillRoot,
      strictDataBoundary: args.strictDataBoundary,
    });
  } else if (args.command === "provider-action-plan") {
    result = await planProviderAction({
      homeDir: effectiveHomeDir,
      provider: args.provider,
      action: args.providerAction,
      repoRoot: args.repoRoot,
      resolveCommand: providerActionResolveCommand,
    });
  } else if (args.command === "provider-action-run") {
    const ask =
      promptChoice ??
      ((question) =>
        numberedTtyChoice({
          stdin,
          stdout,
          ...question,
        }));
    const confirmation = await ask({
      question:
        `Show the separately approved manual ${args.provider} ${args.providerAction} guidance? ` +
        "Harness will not start a provider CLI or modify authentication state.",
      options: ["cancel", "show-guide"],
      recommended: "cancel",
    });
    if (confirmation !== "show-guide") {
      throw new Error(
        "Provider action guidance was declined; no provider command started.",
      );
    }
    result = await executeProviderAction({
      homeDir: effectiveHomeDir,
      provider: args.provider,
      action: args.providerAction,
      planSha256: args.planSha256,
      approved: args.approved,
      repoRoot: args.repoRoot,
      resolveCommand: providerActionResolveCommand,
    });
  } else if (args.command === "inspect") {
    result = await inspectProject(args.repoRoot, { homeDir: effectiveHomeDir });
  } else if (args.command === "validate") {
    const contract = await readJson(args.contractPath);
    validateProjectContract(contract);
    result = {
      status: "valid",
      contractStatus: contract.status,
      unresolvedDecisions: contract.unresolvedDecisions.length,
    };
  } else if (args.command === "apply") {
    result = await applyProjectContract({
      repoRoot: args.repoRoot,
      contractPath: args.contractPath,
      skillRoot,
    });
  } else if (args.command === "mark-ready") {
    result = await markProjectReady({
      repoRoot: args.repoRoot,
      skillRoot,
    });
  } else if (args.command === "export-skill") {
    result = await exportHarnessInitSkill({
      sourceSkillRoot: skillRoot,
      targetRepo: args.targetRepo,
    });
  } else if (args.command === "configure-skills") {
    const profile = await saveSkillRepositoryProfile({
      approved: args.approved,
      excludedSkills: args.excludedSkills,
      globalEssentialSkills: args.globalEssentialSkills,
      homeDir: effectiveHomeDir,
      now,
      repositoryPath: args.repositoryPath,
      selectionGuidance: args.selectionGuidance,
    });
    result = {
      status: "configured",
      configPath: skillRepositoryProfilePath(effectiveHomeDir),
      profile,
    };
  } else if (args.command === "catalog-skills") {
    const profile = await loadSkillRepositoryProfile({
      homeDir: effectiveHomeDir,
    });
    const repositoryPath =
      args.repositoryPath ?? profile?.repositoryPath ?? null;
    if (!repositoryPath) {
      throw new Error(
        "Skill repository is not configured; provide --repository for " +
          "read-only discovery or complete first-run refinement.",
      );
    }
    const catalog = await discoverSkillCatalog({ repositoryPath });
    const globalEssentialSkills = profile?.globalEssentialSkills ?? [];
    const excludedSkills = profile?.selection.excludedSkills ?? [];
    result = {
      status: "cataloged",
      repositoryPath: await realpath(repositoryPath),
      reusedSavedPath: args.repositoryPath === null && profile !== null,
      globalEssentialSkills,
      excludedSkills,
      skills: catalog.filter(
        (entry) =>
          !globalEssentialSkills.includes(entry.name) &&
          !excludedSkills.includes(entry.name),
      ),
    };
  } else if (args.command === "install-skills") {
    result = await installProjectSkills({
      approved: args.approved,
      homeDir: effectiveHomeDir,
      now,
      repoRoot: args.repoRoot,
      selectedSkills: args.selectedSkills,
    });
  } else if (args.command === "revise-project-skills") {
    const profile = await loadSkillRepositoryProfile({
      homeDir: effectiveHomeDir,
    });
    if (!profile) {
      throw new Error(
        "revise-project-skills requires a configured Skill repository profile.",
      );
    }
    result = await reviseReadyProjectSkills({
      approved: args.approved,
      repoRoot: args.repoRoot,
      homeDir: effectiveHomeDir,
      now,
      skillRoot,
      selectedSkills: args.selectedSkills,
      replaceExisting: args.replaceExistingProjectSkills,
      globalEssentialSkills:
        args.globalEssentialSkills.length > 0
          ? args.globalEssentialSkills
          : profile.globalEssentialSkills,
    });
  } else if (args.command === "skill-migration-plan") {
    result = await planSkillPlatformMigration({
      repoRoot: args.repoRoot,
      homeDir: effectiveHomeDir,
      repositoryPath: args.repositoryPath,
      projectSkills:
        args.selectedSkills.length > 0 ? args.selectedSkills : undefined,
    });
  } else if (args.command === "skill-migration-apply") {
    result = await applySkillPlatformMigration({
      approved: args.approved,
      expectedInventorySha256: args.inventorySha256,
      repoRoot: args.repoRoot,
      homeDir: effectiveHomeDir,
      repositoryPath: args.repositoryPath,
      projectSkills: args.selectedSkills,
      now,
    });
  } else if (args.command === "skill-migration-status") {
    result = await auditSkillPlatformMigration({
      repoRoot: args.repoRoot,
      homeDir: effectiveHomeDir,
      repositoryPath: args.repositoryPath,
    });
  } else {
    result = await rollbackSkillPlatformMigration({
      approved: args.approved,
      backupId: args.backupId,
      repoRoot: args.repoRoot,
      homeDir: effectiveHomeDir,
    });
  }
  stdout.write(canonicalJson(result));
  return result;
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  runHarnessInitCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Harness Init failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
