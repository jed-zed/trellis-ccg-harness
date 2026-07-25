import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
const REQUIRED_GLOBAL_SKILLS = new Set(["grill-me", "harness-init"]);
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
    await rename(temporary, target);
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
    managedPaths: manifest.managedPaths,
    skills: manifest.skills,
  });
}

function validateProjectSkillManifest(manifest) {
  assertExactKeys(
    manifest,
    [
      "schemaVersion",
      "status",
      "owner",
      "profileSha256",
      "installedAt",
      "managedPaths",
      "skills",
    ],
    "Project Skill manifest",
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("Project Skill manifest schemaVersion must be 1.");
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
  if (providers.claude.enabled || providers.claude.workspaceWrite) {
    throw new Error("Claude must remain disabled with no workspace write access.");
  }
  for (const provider of ["gemini", "grok", "gptPro"]) {
    if (providers[provider].workspaceWrite) {
      throw new Error(
        `${provider} cannot receive workspace write authority.`,
      );
    }
  }
  for (const provider of ["grok", "gptPro"]) {
    if (
      providers[provider].enabled &&
      providers[provider].manualOnly !== true
    ) {
      throw new Error(`${provider} must remain manual-only when enabled.`);
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

function assertContractSecurity(contract) {
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
  assertProviders(contract.providers);
  assertContractSecurity(contract);
  if (requireApproved) assertApprovedContract(contract);
  else assertDraftProjectFields(contract);
  return contract;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const PROJECT_MANAGED_PATHS = Object.freeze([
  ".harness/ownership.json",
  ".harness/project.json",
  ".harness/project.schema.json",
]);

function validateProjectOwnership(
  ownership,
  { contractSha256, schemaSha256 },
) {
  assertObject(ownership, "Harness project ownership");
  const expectedKeys = [
    "schemaVersion",
    "owner",
    "contractSha256",
    "schemaSha256",
    "managedPaths",
    "managedBlocks",
  ];
  if (
    Object.keys(ownership).sort().join(",") !==
      expectedKeys.sort().join(",") ||
    ownership.schemaVersion !== 1 ||
    ownership.owner !== "trellis-ccg-harness" ||
    ownership.contractSha256 !== contractSha256 ||
    ownership.schemaSha256 !== schemaSha256 ||
    !Array.isArray(ownership.managedPaths) ||
    ownership.managedPaths.length !== PROJECT_MANAGED_PATHS.length ||
    ownership.managedPaths.some(
      (entry, index) => entry !== PROJECT_MANAGED_PATHS[index],
    )
  ) {
    throw new Error(
      "Harness project ownership identity is invalid or changed.",
    );
  }
  return ownership;
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

export async function applyProjectContract({
  repoRoot,
  contractPath,
  skillRoot,
}) {
  const root = path.resolve(repoRoot);
  const sourceSkill = path.resolve(skillRoot);
  const contract = await readJson(path.resolve(contractPath));
  validateProjectContract(contract, { requireApproved: true });
  const contractBytes = canonicalJson(contract);
  const harnessDir = path.join(root, ".harness");
  const projectPath = path.join(harnessDir, "project.json");
  const ownershipPath = path.join(harnessDir, "ownership.json");
  const installedSchemaPath = path.join(
    harnessDir,
    "project.schema.json",
  );
  const schemaPath = path.join(
    sourceSkill,
    "assets",
    "project-contract.schema.json",
  );
  const schemaBytes = await readFile(schemaPath);
  const contractSha256 = sha256(contractBytes);
  const schemaSha256 = sha256(schemaBytes);
  const agentsPath = path.join(root, "AGENTS.md");
  const policyPath = path.join(
    sourceSkill,
    "assets",
    "collaboration-policy.md",
  );
  const collaborationBlock = renderCollaborationBlock(
    await readFile(policyPath, "utf8"),
  );
  const collaborationSha256 = sha256(collaborationBlock);
  assertInside(root, harnessDir, "Harness contract directory");
  await assertSafeRegularFile(agentsPath, "AGENTS.md", {
    allowMissing: true,
  });

  if (await pathEntryExists(harnessDir)) {
    await ensureSafeDirectoryChain(
      root,
      harnessDir,
      "Harness contract directory",
    );
    if (await pathEntryExists(projectPath)) {
      await assertSafeRegularFile(
        projectPath,
        "Harness project contract",
      );
      await assertSafeRegularFile(
        ownershipPath,
        "Harness project ownership",
      );
      await assertSafeRegularFile(
        installedSchemaPath,
        "Harness project schema",
      );
      const currentBytes = canonicalJson(await readJson(projectPath));
      if (
        currentBytes === contractBytes &&
        sha256(await readFile(installedSchemaPath)) === schemaSha256
      ) {
        const ownership = validateProjectOwnership(
          await readJson(ownershipPath),
          { contractSha256, schemaSha256 },
        );
        const managedBlock = ownership.managedBlocks?.find(
          (entry) => entry?.path === "AGENTS.md",
        );
        const currentBlock = findCollaborationBlock(
          await readUtf8IfExists(agentsPath),
        );
        if (
          managedBlock?.startMarker !== COLLABORATION_BLOCK_START ||
          managedBlock?.endMarker !== COLLABORATION_BLOCK_END ||
          managedBlock?.sha256 !== collaborationSha256 ||
          currentBlock !== collaborationBlock
        ) {
          throw new Error(
            "The managed AGENTS.md collaboration block is missing or modified; refusing to overwrite user state.",
          );
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
    throw new Error(
      "The .harness path already exists and is treated as user-owned; refusing collision.",
    );
  }

  const currentAgents = await readUtf8IfExists(agentsPath);
  const nextAgents = addCollaborationBlock(
    currentAgents,
    collaborationBlock,
  );
  const agentsChanged = currentAgents !== nextAgents;
  const stageDir = path.join(root, `.harness-init-${randomUUID()}`);
  const agentsStagePath = path.join(
    root,
    `.AGENTS.md.harness-init-${randomUUID()}`,
  );
  assertInside(root, stageDir, "Harness initialization staging directory");
  assertInside(root, agentsStagePath, "Harness AGENTS staging file");
  const ownership = {
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    contractSha256,
    schemaSha256,
    managedPaths: [...PROJECT_MANAGED_PATHS],
    managedBlocks: [
      {
        path: "AGENTS.md",
        startMarker: COLLABORATION_BLOCK_START,
        endMarker: COLLABORATION_BLOCK_END,
        sha256: collaborationSha256,
      },
    ],
  };

  let harnessApplied = false;
  try {
    await mkdir(stageDir, { mode: 0o700 });
    await writeFile(
      path.join(stageDir, "project.json"),
      contractBytes,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(stageDir, "project.schema.json"),
      schemaBytes,
      { mode: 0o600 },
    );
    await writeFile(
      path.join(stageDir, "ownership.json"),
      canonicalJson(ownership),
      { mode: 0o600 },
    );
    if (agentsChanged) {
      const agentsMode = await exists(agentsPath)
        ? (await stat(agentsPath)).mode & 0o777
        : 0o644;
      await writeFile(agentsStagePath, nextAgents, {
        flag: "wx",
        mode: agentsMode,
      });
    }
    await rename(stageDir, harnessDir);
    harnessApplied = true;
    if (agentsChanged) await rename(agentsStagePath, agentsPath);
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    await rm(agentsStagePath, { force: true });
    if (harnessApplied) {
      await rm(harnessDir, { recursive: true, force: true });
    }
    if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
      throw new Error(
        "The .harness path already exists; refusing initialization collision.",
      );
    }
    throw error;
  }

  return {
    status: "applied",
    projectPath,
    agentsPath,
    contractSha256: ownership.contractSha256,
    collaborationSha256,
  };
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

function parseCliArgs(argv) {
  const [command, ...args] = argv;
  if (
    ![
      "inspect",
      "validate",
      "apply",
      "export-skill",
      "configure-skills",
      "catalog-skills",
      "install-skills",
    ].includes(command)
  ) {
    throw new Error(
      `Unknown Harness Init command: ${command ?? "(missing)"}.`,
    );
  }
  const result = {
    command,
    repoRoot: process.cwd(),
    contractPath: null,
    targetRepo: null,
    repositoryPath: null,
    globalEssentialSkills: [],
    selectionGuidance: [],
    excludedSkills: [],
    selectedSkills: [],
    approved: false,
  };
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === "--repo-root") {
      result.repoRoot = path.resolve(requireOption(args, index, option));
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
  return result;
}

const DEFAULT_SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function runHarnessInitCli(
  argv,
  {
    homeDir = homedir(),
    now = () => new Date(),
    skillRoot = DEFAULT_SKILL_ROOT,
    stdout = process.stdout,
  } = {},
) {
  const args = parseCliArgs(argv);
  let result;
  if (args.command === "inspect") {
    result = await inspectProject(args.repoRoot, { homeDir });
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
      homeDir,
      now,
      repositoryPath: args.repositoryPath,
      selectionGuidance: args.selectionGuidance,
    });
    result = {
      status: "configured",
      configPath: skillRepositoryProfilePath(homeDir),
      profile,
    };
  } else if (args.command === "catalog-skills") {
    const profile = await loadSkillRepositoryProfile({ homeDir });
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
  } else {
    result = await installProjectSkills({
      approved: args.approved,
      homeDir,
      now,
      repoRoot: args.repoRoot,
      selectedSkills: args.selectedSkills,
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
