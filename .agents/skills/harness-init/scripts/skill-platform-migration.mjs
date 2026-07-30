import { execFile as execFileCallback } from "node:child_process";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
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
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const ORIGINAL_GLOBAL_PLATFORM_SKILLS = Object.freeze([
  "harness-init",
  "trellis-before-dev",
  "trellis-brainstorm",
  "trellis-break-loop",
  "trellis-channel",
  "trellis-check",
  "trellis-continue",
  "trellis-finish-work",
  "trellis-meta",
  "trellis-session-insight",
  "trellis-spec-bootstrap",
  "trellis-start",
  "trellis-update-spec",
]);

export const GLOBAL_PLATFORM_SKILLS = Object.freeze([
  "chatgpt-pro-sidebar",
  "grill-with-docs",
  ...ORIGINAL_GLOBAL_PLATFORM_SKILLS,
]);

// Accept the released or previewed direct Global Init baselines that can
// precede the current one: the original 13 Skills and the 14-Skill sidebar
// baseline.
export const PREVIOUS_GLOBAL_PLATFORM_SKILLS =
  ORIGINAL_GLOBAL_PLATFORM_SKILLS;
export const PREVIOUS_GLOBAL_PLATFORM_SKILL_SETS = Object.freeze([
  ORIGINAL_GLOBAL_PLATFORM_SKILLS,
  Object.freeze([
    "chatgpt-pro-sidebar",
    ...ORIGINAL_GLOBAL_PLATFORM_SKILLS,
  ]),
]);

export const HARNESS_PROJECTED_SKILLS = GLOBAL_PLATFORM_SKILLS;

// Compatibility exports for callers from the pre-catalog migration API. The
// public Harness embeds no personal Skill inventory; catalog contents are an
// explicit user-approved input.
export const AGENTS_PERSONAL_SKILLS = Object.freeze([]);
export const CODEX_PERSONAL_SKILLS = Object.freeze([]);
export const PERSONAL_SKILLS = Object.freeze([]);

const PROJECT_SKILLS = Object.freeze([]);
const GLOBAL_BLOCK_START = "<!-- HARNESS-SKILL-REPOSITORY:START -->";
const GLOBAL_BLOCK_END = "<!-- HARNESS-SKILL-REPOSITORY:END -->";
const OWNER = "trellis-ccg-harness";
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const SKILL_NAME = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const CATALOG_MAX_DEPTH = 10;

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function assertInside(root, target, label) {
  if (!isInside(root, target)) {
    throw new Error(`${label} escapes its approved root: ${target}`);
  }
}

function assertDedicatedDirectory(target, label) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error(`${label} cannot be a drive or filesystem root.`);
  }
}

async function pathExists(target) {
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
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${target}`);
  }
  return realpath(target);
}

async function readFileState(target, label) {
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(`${label} must be a regular non-linked file: ${target}`);
    }
    const bytes = await readFile(target);
    return {
      exists: true,
      bytes,
      mode: details.mode & 0o777,
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, bytes: null, mode: null, sha256: null };
    }
    throw error;
  }
}

async function atomicWrite(target, bytes, mode = 0o600) {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stage = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(stage, bytes, { flag: "wx", mode });
    await chmod(stage, mode);
    await rename(stage, target);
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}

async function replaceRegularFileCas(target, expectedBytes, nextBytes, mode) {
  const parent = path.dirname(target);
  const stage = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  await writeFile(stage, nextBytes, { flag: "wx", mode });
  try {
    const current = await readFile(target);
    if (!current.equals(expectedBytes)) {
      throw new Error(`Managed file changed concurrently: ${target}`);
    }
    await chmod(stage, mode);
    await rename(stage, target);
  } catch (error) {
    await rm(stage, { force: true });
    throw error;
  }
}

function parseSkillFrontmatter(bytes, sourcePath) {
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
      throw new Error(`Skill definition is missing ${field}: ${sourcePath}`);
    }
    const raw = match[1].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) return JSON.parse(raw);
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
    return raw;
  };
  const name = readField("name");
  const description = readField("description");
  if (!SKILL_NAME.test(name) || !description.trim()) {
    throw new Error(`Skill definition has invalid metadata: ${sourcePath}`);
  }
  return { name, description };
}

async function snapshotTree(
  sourceRoot,
  {
    copyTo = null,
    ignoredDirectoryNames = new Set([
      ".git",
      ".venv",
      "__pycache__",
      "node_modules",
    ]),
  } = {},
) {
  const root = path.resolve(sourceRoot);
  await assertRealDirectory(root, "Skill tree");
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
          `Skill tree contains a symbolic link or reparse point: ${sourcePath}`,
        );
      }
      if (entry.isDirectory()) {
        if (ignoredDirectoryNames.has(entry.name.toLocaleLowerCase("en-US"))) continue;
        await assertRealDirectory(sourcePath, "Skill subtree");
        if (copyTo) {
          await mkdir(path.join(copyTo, ...relativePath.split("/")), {
            recursive: true,
            mode: 0o700,
          });
        }
        await visit(sourcePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Skill tree contains a special file: ${sourcePath}`);
      }
      if (entry.name.toLocaleLowerCase("en-US").endsWith(".pyc")) continue;
      const details = await lstat(sourcePath);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw new Error(`Skill tree contains an unsafe file: ${sourcePath}`);
      }
      if (details.nlink > 1) {
        throw new Error(`Skill tree contains a hard-linked file: ${sourcePath}`);
      }
      if (details.size > MAX_FILE_BYTES) {
        throw new Error(`Skill tree file is too large: ${sourcePath}`);
      }
      const bytes = await readFile(sourcePath);
      totalBytes += bytes.length;
      if (files.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`Skill tree exceeds the migration safety limits: ${root}`);
      }
      files.push({
        path: relativePath,
        size: bytes.length,
        sha256: sha256(bytes),
      });
      if (copyTo) {
        const destination = path.join(copyTo, ...relativePath.split("/"));
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
  await visit(root, "");
  const skillDefinition = files.find((entry) => entry.path === "SKILL.md");
  if (!skillDefinition) {
    throw new Error(`Skill tree is missing SKILL.md: ${root}`);
  }
  const parsed = parseSkillFrontmatter(
    await readFile(path.join(root, "SKILL.md")),
    path.join(root, "SKILL.md"),
  );
  return {
    name: parsed.name,
    description: parsed.description,
    files,
    fileCount: files.length,
    totalBytes,
    skillSha256: skillDefinition.sha256,
    treeSha256: sha256(canonicalJson(files)),
  };
}

async function describeSkill(sourceRoot, sourceDirectory, expectedName, rootAlias) {
  const sourcePath = path.join(sourceRoot, sourceDirectory);
  const snapshot = await snapshotTree(sourcePath);
  if (snapshot.name !== expectedName) {
    throw new Error(
      `Skill frontmatter name mismatch: expected ${expectedName}, found ${snapshot.name} at ${sourcePath}`,
    );
  }
  return {
    name: expectedName,
    rootAlias,
    sourceDirectory,
    sourcePath,
    sourceRelativePath: sourceDirectory,
    skillSha256: snapshot.skillSha256,
    treeSha256: snapshot.treeSha256,
    fileCount: snapshot.fileCount,
    totalBytes: snapshot.totalBytes,
  };
}

async function discoverCatalogSkills(repositoryPath) {
  const root = await assertRealDirectory(repositoryPath, "Skill catalog");
  const catalog = [];
  const seenNames = new Set();
  const ignoredDirectories = new Set([
    ".git",
    ".venv",
    "__pycache__",
    "node_modules",
  ]);

  const visit = async (directory, relativeDirectory, depth) => {
    if (depth > CATALOG_MAX_DEPTH) {
      throw new Error(`Skill catalog exceeds maximum directory depth: ${directory}`);
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const definition = entries.find(
      (entry) => entry.isFile() && entry.name === "SKILL.md",
    );
    if (definition) {
      const snapshot = await snapshotTree(directory);
      const parsed = parseSkillFrontmatter(
        await readFile(path.join(directory, "SKILL.md")),
        path.join(directory, "SKILL.md"),
      );
      const folded = parsed.name.toLocaleLowerCase("en-US");
      if (seenNames.has(folded)) {
        throw new Error(`Skill catalog contains a duplicate name: ${parsed.name}`);
      }
      seenNames.add(folded);
      catalog.push({
        name: parsed.name,
        description: parsed.description,
        relativePath: relativeDirectory,
        sourcePath: directory,
        skillSha256: snapshot.skillSha256,
        treeSha256: snapshot.treeSha256,
        fileCount: snapshot.fileCount,
        totalBytes: snapshot.totalBytes,
      });
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill catalog contains a symbolic link or reparse point: ${target}`);
      }
      if (!entry.isDirectory()) continue;
      if (ignoredDirectories.has(entry.name.toLocaleLowerCase("en-US"))) continue;
      await assertRealDirectory(target, "Skill catalog directory");
      await visit(
        target,
        relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name,
        depth + 1,
      );
    }
  };

  await visit(root, "", 0);
  return catalog.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeProjectSkills(projectSkills) {
  if (!Array.isArray(projectSkills)) {
    throw new Error("Project Skill selection must be an array.");
  }
  const normalized = projectSkills.map((value) => String(value).trim());
  for (const name of normalized) {
    if (!SKILL_NAME.test(name)) {
      throw new Error(`Project Skill selection contains an invalid name: ${name}`);
    }
    if (GLOBAL_PLATFORM_SKILLS.includes(name)) {
      throw new Error(`Project Skill selection duplicates a global platform Skill: ${name}`);
    }
  }
  assertUniqueCaseFolded(normalized, "Project Skill selection");
  return normalized.sort((left, right) => left.localeCompare(right));
}

async function snapshotOptionalTree(target) {
  if (!(await pathExists(target))) {
    return { path: target, exists: false, treeSha256: null, fileCount: 0, totalBytes: 0 };
  }
  const details = await lstat(target);
  if (details.isSymbolicLink()) {
    throw new Error(`Preserved path is a symbolic link or reparse point: ${target}`);
  }
  if (!details.isDirectory()) {
    throw new Error(`Preserved path is not a directory: ${target}`);
  }
  const snapshot = await snapshotGenericTree(target);
  return { path: target, exists: true, ...snapshot };
}

async function snapshotGenericTree(root) {
  const files = [];
  let totalBytes = 0;
  const visit = async (directory, relativeDirectory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Preserved tree contains a link: ${target}`);
      }
      if (entry.isDirectory()) {
        await visit(target, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(target);
        totalBytes += bytes.length;
        files.push({ path: relative, size: bytes.length, sha256: sha256(bytes) });
      } else {
        throw new Error(`Preserved tree contains a special file: ${target}`);
      }
    }
  };
  await visit(root, "");
  return {
    treeSha256: sha256(canonicalJson(files)),
    fileCount: files.length,
    totalBytes,
  };
}

async function snapshotDirectoryListing(target) {
  if (!(await pathExists(target))) {
    return {
      path: target,
      exists: false,
      treeSha256: null,
      fileCount: 0,
      totalBytes: 0,
      observation: "top-level-listing",
    };
  }
  await assertRealDirectory(target, "Untouched directory");
  const entries = await readdir(target, { withFileTypes: true });
  const listing = entries
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : entry.isSymbolicLink()
            ? "link"
            : "special",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    path: target,
    exists: true,
    treeSha256: sha256(canonicalJson(listing)),
    fileCount: listing.length,
    totalBytes: 0,
    observation: "top-level-listing",
  };
}

function assertUniqueCaseFolded(names, label) {
  const seen = new Set();
  for (const name of names) {
    const folded = name.toLocaleLowerCase("en-US");
    if (seen.has(folded)) {
      throw new Error(`${label} contains a duplicate name: ${name}`);
    }
    seen.add(folded);
  }
}

export async function planSkillPlatformMigration({
  repoRoot,
  homeDir = homedir(),
  repositoryPath,
  projectSkills = PROJECT_SKILLS,
  preservedPaths,
}) {
  const canonicalHome = await assertRealDirectory(
    path.resolve(homeDir),
    "User home",
  );
  const canonicalRepo = await assertRealDirectory(
    path.resolve(repoRoot),
    "Harness repository",
  );
  if (typeof repositoryPath !== "string" || repositoryPath.trim() === "") {
    throw new Error("Skill catalog repository path is required.");
  }
  const catalogRepository = await assertRealDirectory(
    path.resolve(repositoryPath),
    "Skill catalog repository",
  );
  assertDedicatedDirectory(catalogRepository, "Skill catalog repository");
  const repository = await readSkillRepositoryIdentity(catalogRepository);
  const agentsRoot = path.join(canonicalHome, ".agents", "skills");
  const harnessRoot = path.join(canonicalRepo, ".agents", "skills");
  await assertRealDirectory(agentsRoot, "Global Agents Skill root");
  await assertRealDirectory(harnessRoot, "Harness Skill source root");

  assertUniqueCaseFolded(GLOBAL_PLATFORM_SKILLS, "Global platform Skills");
  const normalizedProjectSkills = normalizeProjectSkills(projectSkills);
  const catalog = await discoverCatalogSkills(catalogRepository);
  const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
  const selectedCatalogSkills = normalizedProjectSkills.map((name) => {
    const entry = catalogByName.get(name);
    if (!entry) {
      throw new Error(`Selected project Skill is absent from the explicit catalog: ${name}`);
    }
    return entry;
  });

  const platform = [];
  for (const name of HARNESS_PROJECTED_SKILLS) {
    const source = await describeSkill(harnessRoot, name, name, "harness");
    const targetPath = path.join(agentsRoot, name);
    let target = null;
    let action = "add";
    if (await pathExists(targetPath)) {
      target = await snapshotTree(targetPath);
      action = target.treeSha256 === source.treeSha256 ? "preserve" : "replace";
    }
    platform.push({
      ...source,
      targetPath,
      targetTreeSha256: target?.treeSha256 ?? null,
      action,
    });
  }

  const preserved = [];
  const effectivePreservedPaths =
    preservedPaths ?? [path.join(path.dirname(canonicalRepo), "skills")];
  for (const target of effectivePreservedPaths) {
    preserved.push(await snapshotOptionalTree(path.resolve(target)));
  }
  const untouched = [];
  for (const target of [
    path.join(canonicalHome, ".codex", "skills", ".system"),
    path.join(canonicalHome, ".codex", "skills", "lib"),
  ]) {
    untouched.push(await snapshotOptionalTree(target));
  }
  untouched.push(
    await snapshotDirectoryListing(
      path.join(canonicalHome, ".codex", "plugins"),
    ),
  );

  const inventory = {
    schemaVersion: 2,
    owner: OWNER,
    repoRoot: canonicalRepo,
    homeDir: canonicalHome,
    repositoryPath: catalogRepository,
    repository,
    globalEssentialSkills: [...GLOBAL_PLATFORM_SKILLS],
    projectSkills: normalizedProjectSkills,
    roots: {
      agents: agentsRoot,
      harness: harnessRoot,
    },
    platform,
    catalog,
    catalogSkills: selectedCatalogSkills,
    preservedExternalSkills: [],
    preservedPaths: preserved,
    untouched,
  };
  return {
    ...inventory,
    inventorySha256: sha256(canonicalJson(inventory)),
  };
}

async function runGit(args, cwd, { env = process.env, execFileImpl = execFile } = {}) {
  const result = await execFileImpl("git", ["-C", cwd, ...args], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  return String(result?.stdout ?? "").trim();
}

export async function readSkillRepositoryIdentity(
  repositoryPath,
  options = {},
) {
  const root = await assertRealDirectory(
    path.resolve(repositoryPath),
    "Skill catalog repository",
  );
  const branch = await runGit(["branch", "--show-current"], root, options);
  const commit = await runGit(["rev-parse", "HEAD"], root, options);
  const tree = await runGit(["rev-parse", "HEAD^{tree}"], root, options);
  const status = await runGit(["status", "--porcelain"], root, options);
  const remotes = await runGit(["remote"], root, options);
  return {
    path: root,
    branch,
    commit,
    tree,
    clean: status === "",
    remotes: remotes ? remotes.split(/\r?\n/).filter(Boolean) : [],
  };
}

export async function seedPersonalSkillRepository({
  inventory,
  repositoryPath = inventory?.repositoryPath,
  gitEnv = process.env,
  execFileImpl = execFile,
}) {
  if (!inventory || inventory.schemaVersion !== 2) {
    throw new Error("A validated Skill migration inventory is required.");
  }
  const source = await assertRealDirectory(
    path.resolve(repositoryPath),
    "Skill catalog repository",
  );
  const approvedSource = await assertRealDirectory(
    path.resolve(inventory.repositoryPath),
    "Approved Skill catalog repository",
  );
  if (normalizePath(source) !== normalizePath(approvedSource)) {
    throw new Error("Skill catalog repository differs from the approved inventory.");
  }
  const identity = await readSkillRepositoryIdentity(source, {
    env: gitEnv,
    execFileImpl,
  });
  for (const field of ["path", "branch", "commit", "tree", "clean"]) {
    if (identity[field] !== inventory.repository[field]) {
      throw new Error(`Skill catalog repository ${field} drifted after approval.`);
    }
  }
  if (canonicalJson(identity.remotes) !== canonicalJson(inventory.repository.remotes)) {
    throw new Error("Skill catalog repository remotes drifted after approval.");
  }
  const catalog = await discoverCatalogSkills(source);
  const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));
  for (const expected of inventory.catalogSkills) {
    const current = catalogByName.get(expected.name);
    if (
      !current ||
      current.relativePath !== expected.relativePath ||
      current.treeSha256 !== expected.treeSha256
    ) {
      throw new Error(`Approved catalog Skill drifted after approval: ${expected.name}`);
    }
  }
  return {
    status: "verified",
    repository: identity,
    skillCount: catalog.length,
  };
}

function markerCount(content, marker) {
  return content.split(marker).length - 1;
}

function findGlobalBlock(content) {
  const starts = markerCount(content, GLOBAL_BLOCK_START);
  const ends = markerCount(content, GLOBAL_BLOCK_END);
  if (starts !== ends || starts > 1) {
    throw new Error("Global AGENTS.md has a malformed or duplicate Skill repository block.");
  }
  if (starts === 0) return null;
  const start = content.indexOf(GLOBAL_BLOCK_START);
  const end = content.indexOf(GLOBAL_BLOCK_END);
  if (end < start) {
    throw new Error("Global AGENTS.md has an invalid Skill repository block order.");
  }
  return content.slice(start, end + GLOBAL_BLOCK_END.length);
}

function renderGlobalBlock(profilePath, repositoryPath) {
  return [
    GLOBAL_BLOCK_START,
    "# Harness Skill Catalog",
    "",
    `- Canonical machine profile: \`${profilePath}\``,
    `- Approved Skill catalog: \`${repositoryPath}\``,
    `- Global platform Skills: ${GLOBAL_PLATFORM_SKILLS.map((name) => `\`${name}\``).join(", ")}`,
    "- Catalog Skills are copied into each project only after explicit project approval.",
    "- Only the listed 15 global platform Skill projections are Harness-owned; pre-existing third-party Skills, including legacy `grill-me`, remain user-owned unless separately approved.",
    GLOBAL_BLOCK_END,
  ].join("\n");
}

function replaceOrAppendGlobalBlock(content, nextBlock, ownedDigest = null) {
  const current = findGlobalBlock(content);
  if (current === null) {
    if (ownedDigest !== null) {
      throw new Error("Owned global Skill repository block is missing.");
    }
    const separator = content.length === 0 || content.endsWith("\n") ? "" : "\n";
    return `${content}${separator}\n${nextBlock}\n`;
  }
  if (ownedDigest === null) {
    throw new Error("Global Skill repository block exists without compatible ownership.");
  }
  if (sha256(current) !== ownedDigest) {
    throw new Error("Global Skill repository block was edited; refusing overwrite.");
  }
  return content.replace(current, nextBlock);
}

function matchesPlatformSkillSet(values, expected) {
  return (
    canonicalJson(
      [...values].sort((left, right) => left.localeCompare(right)),
    ) ===
    canonicalJson([...expected].sort((left, right) => left.localeCompare(right)))
  );
}

function isPreviousPlatformSkillSet(values) {
  return PREVIOUS_GLOBAL_PLATFORM_SKILL_SETS.some(
    (previous) =>
      matchesPlatformSkillSet(values, previous) ||
      matchesPlatformSkillSet(values, [...previous, "grill-me"]),
  );
}

export async function upgradeLegacySkillPlatformDefaults({
  approved,
  homeDir = homedir(),
  platformSkillsRoot,
  now = () => new Date(),
}) {
  if (approved !== true) {
    throw new Error("Legacy Skill platform upgrade requires explicit approval.");
  }
  const home = await assertRealDirectory(path.resolve(homeDir), "User home");
  const sourceRoot = await assertRealDirectory(
    path.resolve(platformSkillsRoot),
    "Harness Skill source root",
  );
  const manifestPath = globalManifestPathFor(home);
  const profilePath = profilePathFor(home);
  const agentsPath = path.join(home, ".codex", "AGENTS.md");
  const [manifestState, profileState, agentsState] = await Promise.all([
    readFileState(manifestPath, "Global Skill ownership manifest"),
    readFileState(profilePath, "Skill repository profile"),
    readFileState(agentsPath, "Global AGENTS.md"),
  ]);
  if (!manifestState.exists || !profileState.exists || !agentsState.exists) {
    throw new Error(
      "Legacy Skill platform upgrade requires its manifest, profile, and global AGENTS.md.",
    );
  }
  const manifest = JSON.parse(manifestState.bytes.toString("utf8"));
  const profile = JSON.parse(profileState.bytes.toString("utf8"));
  const managedNames = (manifest.managedPlatformSkills ?? []).map(
    (entry) => entry?.name,
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.owner !== OWNER ||
    manifest.installMode !== undefined ||
    !isPreviousPlatformSkillSet(managedNames) ||
    manifest.profileSha256 !== profileState.sha256 ||
    profile.schemaVersion !== 1 ||
    !isPreviousPlatformSkillSet(profile.globalEssentialSkills ?? []) ||
    path.resolve(profile.repositoryPath ?? "") !==
      path.resolve(manifest.repository?.path ?? "")
  ) {
    throw new Error("Legacy Skill platform ownership is not eligible for upgrade.");
  }

  const targetRoot = path.join(home, ".agents", "skills");
  for (const entry of manifest.managedPlatformSkills) {
    const target = path.join(targetRoot, entry.name);
    if (
      path.resolve(entry.targetPath ?? "") !== path.resolve(target) ||
      !/^[a-f0-9]{64}$/.test(String(entry.treeSha256 ?? ""))
    ) {
      throw new Error(`Legacy platform ownership is invalid: ${entry.name}`);
    }
    const current = await snapshotTree(target);
    if (current.treeSha256 !== entry.treeSha256) {
      throw new Error(`Managed global platform Skill drifted: ${entry.name}`);
    }
  }
  for (const entry of manifest.preservedExternalSkills ?? []) {
    const current = await snapshotTree(entry.path);
    if (current.treeSha256 !== entry.observedTreeSha256) {
      throw new Error(`Preserved external Skill changed: ${entry.name}`);
    }
  }

  const ownedNames = new Set(managedNames);
  const additions = [];
  for (const name of GLOBAL_PLATFORM_SKILLS) {
    if (ownedNames.has(name)) continue;
    const source = await describeSkill(sourceRoot, name, name, "harness");
    const targetPath = path.join(targetRoot, name);
    if (await pathExists(targetPath)) {
      throw new Error(
        `Legacy global Skill upgrade target collision is user-owned: ${targetPath}`,
      );
    }
    additions.push({ ...source, targetPath });
  }
  if (additions.length === 0) {
    return {
      status: "unchanged",
      manifestPath,
      installedSkills: [...GLOBAL_PLATFORM_SKILLS],
      ownershipMode: "skill-platform-migration",
    };
  }

  const blockOwnership = (manifest.managedBlocks ?? []).find(
    (entry) =>
      path.resolve(entry?.path ?? "") === path.resolve(agentsPath) &&
      entry.startMarker === GLOBAL_BLOCK_START &&
      entry.endMarker === GLOBAL_BLOCK_END,
  );
  const currentAgents = agentsState.bytes.toString("utf8");
  const currentBlock = findGlobalBlock(currentAgents);
  if (
    !blockOwnership ||
    currentBlock === null ||
    sha256(currentBlock) !== blockOwnership.renderedBlockSha256
  ) {
    throw new Error(
      "Legacy global Skill repository block is missing or was edited.",
    );
  }

  const upgradedAt = now().toISOString();
  const profileCandidate = {
    ...profile,
    globalEssentialSkills: [...GLOBAL_PLATFORM_SKILLS].sort((left, right) =>
      left.localeCompare(right),
    ),
    refinedAt: upgradedAt,
  };
  const profileBytes = Buffer.from(canonicalJson(profileCandidate));
  const nextBlock = renderGlobalBlock(profilePath, profile.repositoryPath);
  const agentsCandidate = replaceOrAppendGlobalBlock(
    currentAgents,
    nextBlock,
    blockOwnership.renderedBlockSha256,
  );
  const agentsBytes = Buffer.from(agentsCandidate);
  const manifestCandidate = {
    ...manifest,
    profileSha256: sha256(profileBytes),
    managedPlatformSkills: [
      ...manifest.managedPlatformSkills,
      ...additions.map((entry) => ({
        name: entry.name,
        sourcePath: entry.sourcePath,
        targetPath: entry.targetPath,
        treeSha256: entry.treeSha256,
        fileCount: entry.fileCount,
        totalBytes: entry.totalBytes,
      })),
    ],
    managedBlocks: manifest.managedBlocks.map((entry) =>
      entry === blockOwnership
        ? {
            ...entry,
            renderedBlockSha256: sha256(findGlobalBlock(agentsCandidate)),
            installedFileSha256: sha256(agentsBytes),
          }
        : entry,
    ),
    upgradedAt,
  };
  const manifestBytes = Buffer.from(canonicalJson(manifestCandidate));
  const harnessRoot = path.dirname(manifestPath);
  const stageRoot = path.join(
    harnessRoot,
    `.legacy-platform-upgrade-${randomUUID()}`,
  );
  await mkdir(stageRoot, { mode: 0o700 });
  const installed = [];
  let profileReplaced = false;
  let agentsReplaced = false;
  let manifestReplaced = false;
  try {
    for (const entry of additions) {
      const staged = path.join(stageRoot, entry.name);
      const snapshot = await snapshotTree(entry.sourcePath, { copyTo: staged });
      if (snapshot.treeSha256 !== entry.treeSha256) {
        throw new Error(`Bundled platform Skill changed while staging: ${entry.name}`);
      }
    }
    for (const entry of additions) {
      if (await pathExists(entry.targetPath)) {
        throw new Error(`Global Skill target appeared during upgrade: ${entry.name}`);
      }
      await rename(path.join(stageRoot, entry.name), entry.targetPath);
      installed.push(entry);
    }
    await replaceRegularFileCas(
      profilePath,
      profileState.bytes,
      profileBytes,
      profileState.mode,
    );
    profileReplaced = true;
    await replaceRegularFileCas(
      agentsPath,
      agentsState.bytes,
      agentsBytes,
      agentsState.mode,
    );
    agentsReplaced = true;
    await replaceRegularFileCas(
      manifestPath,
      manifestState.bytes,
      manifestBytes,
      manifestState.mode,
    );
    manifestReplaced = true;
  } catch (error) {
    const rollbackErrors = [];
    for (const [target, expected, original, mode, active] of [
      [
        manifestPath,
        manifestBytes,
        manifestState.bytes,
        manifestState.mode,
        manifestReplaced,
      ],
      [agentsPath, agentsBytes, agentsState.bytes, agentsState.mode, agentsReplaced],
      [
        profilePath,
        profileBytes,
        profileState.bytes,
        profileState.mode,
        profileReplaced,
      ],
    ]) {
      if (!active) continue;
      try {
        await replaceRegularFileCas(target, expected, original, mode);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const entry of installed.reverse()) {
      try {
        const current = await snapshotTree(entry.targetPath);
        if (current.treeSha256 !== entry.treeSha256) {
          throw new Error(
            `Installed global Skill changed before rollback: ${entry.name}`,
          );
        }
        await rm(entry.targetPath, { recursive: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Legacy Skill platform upgrade failed and could not be fully rolled back.",
      );
    }
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
  return {
    status: "upgraded",
    manifestPath,
    installedSkills: [...GLOBAL_PLATFORM_SKILLS],
    ownershipMode: "skill-platform-migration",
  };
}

async function verifyInventorySources(inventory) {
  for (const entry of [
    ...inventory.platform,
    ...inventory.preservedExternalSkills,
    ...inventory.catalogSkills,
  ]) {
    const current = await snapshotTree(entry.sourcePath);
    if (
      current.name !== entry.name ||
      current.treeSha256 !== entry.treeSha256
    ) {
      throw new Error(`Skill source drifted after inventory approval: ${entry.name}`);
    }
  }
  for (const entry of inventory.preservedPaths) {
    const current = await snapshotOptionalTree(entry.path);
    if (
      current.exists !== entry.exists ||
      current.treeSha256 !== entry.treeSha256
    ) {
      throw new Error(`Preserved path drifted after inventory approval: ${entry.path}`);
    }
  }
  for (const entry of inventory.untouched) {
    const current =
      entry.observation === "top-level-listing"
        ? await snapshotDirectoryListing(entry.path)
        : await snapshotOptionalTree(entry.path);
    if (
      current.exists !== entry.exists ||
      current.treeSha256 !== entry.treeSha256
    ) {
      throw new Error(`Untouched path drifted after inventory approval: ${entry.path}`);
    }
  }
}

function profilePathFor(homeDir) {
  return path.join(homeDir, ".agents", "harness", "skill-repository.json");
}

function globalManifestPathFor(homeDir) {
  return path.join(homeDir, ".agents", "harness", "global-skills.json");
}

function provenancePathFor(homeDir) {
  return path.join(homeDir, ".agents", "harness", "skill-platform.provenance.key");
}

async function loadOrCreateProvenanceKey(homeDir) {
  const target = provenancePathFor(homeDir);
  const state = await readFileState(target, "Skill platform provenance key");
  if (state.exists) {
    if (state.bytes.length !== 64 || !/^[a-f0-9]{64}$/.test(state.bytes.toString("utf8"))) {
      throw new Error("Skill platform provenance key is invalid.");
    }
    return state.bytes;
  }
  const bytes = Buffer.from(randomBytes(32).toString("hex"));
  await atomicWrite(target, bytes, 0o600);
  return bytes;
}

function signRecord(record, key) {
  const unsigned = { ...record };
  delete unsigned.provenance;
  return {
    ...unsigned,
    provenance: {
      algorithm: "hmac-sha256",
      value: createHmac("sha256", key).update(canonicalJson(unsigned)).digest("hex"),
    },
  };
}

function verifySignedRecord(record, key, label) {
  const signature = String(record?.provenance?.value ?? "");
  const unsigned = { ...record };
  delete unsigned.provenance;
  const expected = createHmac("sha256", key)
    .update(canonicalJson(unsigned))
    .digest("hex");
  if (
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new Error(`${label} lacks valid authenticated provenance.`);
  }
  return unsigned;
}

async function writeSignedJournal(target, journal, key) {
  await atomicWrite(target, Buffer.from(canonicalJson(signRecord(journal, key))), 0o600);
}

async function acquireGlobalLock(homeDir, transactionId) {
  const root = path.join(homeDir, ".agents", "harness");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, "skill-platform.lock");
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Another Skill platform migration owns the global lock: ${target}`);
    }
    throw error;
  }
  await writeFile(
    path.join(target, "owner.json"),
    canonicalJson({
      schemaVersion: 1,
      id: transactionId,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    }),
    { flag: "wx", mode: 0o600 },
  );
  return {
    path: target,
    async release() {
      const owner = JSON.parse(await readFile(path.join(target, "owner.json"), "utf8"));
      if (owner.id !== transactionId || owner.pid !== process.pid) {
        throw new Error("Skill platform lock ownership changed; refusing cleanup.");
      }
      await rm(target, { recursive: true });
    },
  };
}

async function restoreFileState(target, state) {
  if (state.exists) {
    await atomicWrite(target, state.bytes, state.mode);
  } else {
    await rm(target, { force: true });
  }
}

async function copySkillToStage(entry, stageRoot) {
  const destination = path.join(stageRoot, entry.name);
  const copied = await snapshotTree(entry.sourcePath, { copyTo: destination });
  if (copied.treeSha256 !== entry.treeSha256 || copied.name !== entry.name) {
    throw new Error(`Platform Skill changed while staging: ${entry.name}`);
  }
  return destination;
}

async function captureProjectState(repoRoot, projectSkills) {
  const files = {};
  for (const relative of [
    ".harness/project.json",
    ".harness/ownership.json",
    ".harness/project-skills.json",
  ]) {
    files[relative] = await readFileState(
      path.join(repoRoot, ...relative.split("/")),
      relative,
    );
  }
  const skills = {};
  for (const name of projectSkills) {
    const target = path.join(repoRoot, ".agents", "skills", name);
    skills[name] = await pathExists(target)
      ? { exists: true, ...(await snapshotTree(target)) }
      : { exists: false };
  }
  return { files, skills };
}

async function restoreProjectState(repoRoot, before, currentManifest = null) {
  for (const [name, state] of Object.entries(before.skills)) {
    const target = path.join(repoRoot, ".agents", "skills", name);
    if (!state.exists && (await pathExists(target))) {
      if (currentManifest) {
        const expected = currentManifest.skills.find((entry) => entry.name === name);
        const current = await snapshotTree(target);
        if (!expected || current.treeSha256 !== expected.treeSha256) {
          throw new Error(`Project Skill changed after migration; refusing rollback: ${name}`);
        }
      }
      await rm(target, { recursive: true });
    }
  }
  for (const [relative, state] of Object.entries(before.files)) {
    await restoreFileState(path.join(repoRoot, ...relative.split("/")), state);
  }
}

async function readProjectSkillManifest(repoRoot) {
  const target = path.join(repoRoot, ".harness", "project-skills.json");
  if (!(await pathExists(target))) return null;
  return JSON.parse(await readFile(target, "utf8"));
}

export async function applySkillPlatformMigration({
  approved,
  expectedInventorySha256,
  repoRoot,
  homeDir = homedir(),
  repositoryPath,
  projectSkills = PROJECT_SKILLS,
  preservedPaths,
  reviseProjectSkills,
  now = () => new Date(),
  gitEnv = process.env,
  execFileImpl = execFile,
  faultInjector,
}) {
  if (approved !== true) {
    throw new Error("Skill platform migration requires explicit approval.");
  }
  if (typeof reviseProjectSkills !== "function") {
    throw new Error("Skill platform migration requires the project revision adapter.");
  }
  const root = path.resolve(repoRoot);
  const home = path.resolve(homeDir);
  const existingManifestPath = globalManifestPathFor(home);
  if (await pathExists(existingManifestPath)) {
    const audit = await auditSkillPlatformMigration({
      repoRoot: root,
      homeDir: home,
      repositoryPath,
      gitEnv,
      execFileImpl,
    });
    if (audit.status === "ready") {
      return { status: "unchanged", audit };
    }
    throw new Error(`Existing Skill platform migration is ${audit.status}: ${audit.issues.join("; ")}`);
  }

  const inventory = await planSkillPlatformMigration({
    repoRoot: root,
    homeDir: home,
    repositoryPath,
    projectSkills,
    preservedPaths,
  });
  if (
    !/^[a-f0-9]{64}$/.test(String(expectedInventorySha256 ?? "")) ||
    inventory.inventorySha256 !== expectedInventorySha256
  ) {
    throw new Error("Live Skill inventory differs from the approved inventory digest.");
  }
  await verifyInventorySources(inventory);
  const catalog = await seedPersonalSkillRepository({
    inventory,
    repositoryPath,
    gitEnv,
    execFileImpl,
  });
  const repository = catalog.repository;
  if (faultInjector) await faultInjector("after-catalog-verification");

  const transactionId = randomUUID();
  const backupId = `${now().toISOString().replaceAll(/[:.]/g, "-")}-${transactionId}`;
  const harnessHome = path.join(home, ".agents", "harness");
  const backupRoot = path.join(harnessHome, "backups", backupId);
  const transactionRoot = path.join(
    harnessHome,
    "transactions",
    "skill-platform",
    transactionId,
  );
  assertInside(harnessHome, backupRoot, "Skill migration backup");
  assertInside(harnessHome, transactionRoot, "Skill migration transaction");
  const lock = await acquireGlobalLock(home, transactionId);
  const provenanceKey = await loadOrCreateProvenanceKey(home);
  await mkdir(path.join(backupRoot, "platform"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(transactionRoot, "stage"), {
    recursive: true,
    mode: 0o700,
  });
  const journalPath = path.join(transactionRoot, "journal.json");
  let journal = {
    schemaVersion: 1,
    owner: OWNER,
    operation: "skill-platform-migration",
    id: transactionId,
    backupId,
    status: "prepared",
    inventorySha256: inventory.inventorySha256,
    repoRoot: root,
    homeDir: home,
    repositoryPath: repository.path,
    completedOperations: [],
    createdAt: now().toISOString(),
  };
  await writeSignedJournal(journalPath, journal, provenanceKey);

  const profilePath = profilePathFor(home);
  const agentsPath = path.join(home, ".codex", "AGENTS.md");
  const globalManifestPath = globalManifestPathFor(home);
  const originalProfile = await readFileState(profilePath, "Skill repository profile");
  const originalAgents = await readFileState(agentsPath, "Global AGENTS.md");
  const projectBefore = await captureProjectState(root, projectSkills);
  const replacedPlatform = [];
  const addedPlatform = [];
  const stagedPlatform = new Map();
  let projectRevision = null;
  let profileCandidate = null;
  let agentsCandidate = null;

  const checkpoint = async (operation) => {
    journal = {
      ...journal,
      status: "applying",
      completedOperations: [...journal.completedOperations, operation],
    };
    await writeSignedJournal(journalPath, journal, provenanceKey);
    if (faultInjector) await faultInjector(operation);
  };

  try {
    for (const entry of inventory.platform) {
      stagedPlatform.set(
        entry.name,
        await copySkillToStage(
          entry,
          path.join(transactionRoot, "stage"),
        ),
      );
    }
    await checkpoint("platform-staged");

    const previousProfile = originalProfile.exists
      ? JSON.parse(originalProfile.bytes.toString("utf8"))
      : {
          schemaVersion: 1,
          repositoryPath: repository.path,
          globalEssentialSkills: [],
          selection: {
            approvalRequired: true,
            installMode: "copy",
            guidance: [],
            excludedSkills: [],
          },
          refinedAt: now().toISOString(),
        };
    profileCandidate = {
      schemaVersion: 1,
      repositoryPath: repository.path,
      globalEssentialSkills: [...GLOBAL_PLATFORM_SKILLS].sort((a, b) =>
        a.localeCompare(b),
      ),
      selection: {
        approvalRequired: true,
        installMode: "copy",
        guidance: [
          ...new Set([
            ...(previousProfile.selection?.guidance ?? []),
            "Harness platform Skills remain global; catalog Skills require explicit project approval and are copied as snapshots.",
          ]),
        ].sort((a, b) => a.localeCompare(b)),
        excludedSkills: [
          ...new Set(previousProfile.selection?.excludedSkills ?? []),
        ].sort((a, b) => a.localeCompare(b)),
      },
      refinedAt: now().toISOString(),
    };
    await atomicWrite(profilePath, Buffer.from(canonicalJson(profileCandidate)), 0o600);
    await checkpoint("profile-installed");

    const currentAgents = originalAgents.exists
      ? originalAgents.bytes.toString("utf8")
      : "";
    const block = renderGlobalBlock(profilePath, repository.path);
    agentsCandidate = replaceOrAppendGlobalBlock(currentAgents, block);
    await atomicWrite(agentsPath, Buffer.from(agentsCandidate), originalAgents.mode ?? 0o644);
    await checkpoint("global-block-installed");

    projectRevision = await reviseProjectSkills({
      approved: true,
      repoRoot: root,
      homeDir: home,
      selectedSkills: projectSkills,
      globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
      repositoryIdentity: repository,
      now,
      faultInjector: faultInjector
        ? async (phase) => faultInjector(`project:${phase}`)
        : undefined,
    });
    await checkpoint("project-revised");

    for (const entry of inventory.platform) {
      const target = entry.targetPath;
      if (await pathExists(target)) {
        const current = await snapshotTree(target);
        if (current.treeSha256 !== entry.targetTreeSha256) {
          throw new Error(`Global platform Skill drifted before replacement: ${entry.name}`);
        }
        const backup = path.join(backupRoot, "platform", entry.name);
        await rename(target, backup);
        replacedPlatform.push({ entry, backup });
      } else if (entry.targetTreeSha256 !== null) {
        throw new Error(`Global platform Skill disappeared before replacement: ${entry.name}`);
      } else {
        addedPlatform.push(entry);
      }
      await rename(stagedPlatform.get(entry.name), target);
      const installed = await snapshotTree(target);
      if (installed.treeSha256 !== entry.treeSha256) {
        throw new Error(`Global platform projection verification failed: ${entry.name}`);
      }
      await checkpoint(`platform-installed:${entry.name}`);
    }

    await verifyInventorySources(inventory);

    const projectManifest = await readProjectSkillManifest(root);
    if (!projectManifest) {
      throw new Error("Project Skill revision did not create its manifest.");
    }
    const backupManifest = {
      schemaVersion: 2,
      owner: OWNER,
      backupId,
      inventorySha256: inventory.inventorySha256,
      repository,
      catalogSkills: inventory.catalogSkills.map((entry) => ({
        name: entry.name,
        relativePath: entry.relativePath,
        treeSha256: entry.treeSha256,
        fileCount: entry.fileCount,
        totalBytes: entry.totalBytes,
      })),
      platform: inventory.platform.map((entry) => {
        const replaced = replacedPlatform.find((item) => item.entry.name === entry.name);
        return {
          name: entry.name,
          sourcePath: entry.sourcePath,
          targetPath: entry.targetPath,
          originalBackupPath: replaced?.backup ?? null,
          originalTreeSha256: entry.targetTreeSha256,
          installedTreeSha256: entry.treeSha256,
        };
      }),
      originals: {
        profile: {
          exists: originalProfile.exists,
          sha256: originalProfile.sha256,
          mode: originalProfile.mode,
          backupPath: originalProfile.exists
            ? path.join(backupRoot, "original-profile.json")
            : null,
        },
        agents: {
          exists: originalAgents.exists,
          sha256: originalAgents.sha256,
          mode: originalAgents.mode,
          backupPath: originalAgents.exists
            ? path.join(backupRoot, "original-AGENTS.md")
            : null,
        },
        project: Object.fromEntries(
          Object.entries(projectBefore.files).map(([relative, state]) => [
            relative,
            {
              exists: state.exists,
              sha256: state.sha256,
              mode: state.mode,
              backupPath: state.exists
                ? path.join(
                    backupRoot,
                    "project",
                    `${relative.replaceAll("/", "__")}.bak`,
                  )
                : null,
            },
          ]),
        ),
        projectSkills: projectBefore.skills,
      },
      projectAfter: {
        repoRoot: root,
        contractSha256: sha256(
          await readFile(path.join(root, ".harness", "project.json")),
        ),
        ownershipSha256: sha256(
          await readFile(path.join(root, ".harness", "ownership.json")),
        ),
        manifestSha256: sha256(
          await readFile(path.join(root, ".harness", "project-skills.json")),
        ),
        skills: projectManifest.skills.map((entry) => ({
          name: entry.name,
          treeSha256: entry.treeSha256,
        })),
      },
      completedAt: now().toISOString(),
    };
    if (originalProfile.exists) {
      await writeFile(
        path.join(backupRoot, "original-profile.json"),
        originalProfile.bytes,
        { flag: "wx", mode: 0o600 },
      );
    }
    if (originalAgents.exists) {
      await writeFile(
        path.join(backupRoot, "original-AGENTS.md"),
        originalAgents.bytes,
        { flag: "wx", mode: 0o600 },
      );
    }
    for (const [relative, state] of Object.entries(projectBefore.files)) {
      if (!state.exists) continue;
      const backupPath =
        backupManifest.originals.project[relative].backupPath;
      await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
      await writeFile(backupPath, state.bytes, { flag: "wx", mode: 0o600 });
    }
    await atomicWrite(
      path.join(backupRoot, "manifest.json"),
      Buffer.from(canonicalJson(backupManifest)),
      0o600,
    );

    const ownership = {
      schemaVersion: 2,
      owner: OWNER,
      profileSha256: sha256(canonicalJson(profileCandidate)),
      repository,
      managedPlatformSkills: inventory.platform.map((entry) => ({
        name: entry.name,
        sourcePath: entry.sourcePath,
        targetPath: entry.targetPath,
        treeSha256: entry.treeSha256,
        fileCount: entry.fileCount,
        totalBytes: entry.totalBytes,
      })),
      preservedExternalSkills: inventory.preservedExternalSkills.map((entry) => ({
        name: entry.name,
        path: entry.sourcePath,
        observedTreeSha256: entry.treeSha256,
        updatePolicy: "preserve",
      })),
      catalogSkills: backupManifest.catalogSkills,
      managedBlocks: [
        {
          path: agentsPath,
          startMarker: GLOBAL_BLOCK_START,
          endMarker: GLOBAL_BLOCK_END,
          renderedBlockSha256: sha256(
            findGlobalBlock(agentsCandidate),
          ),
          installedFileSha256: sha256(Buffer.from(agentsCandidate)),
        },
      ],
      project: backupManifest.projectAfter,
      backupId,
      completedAt: backupManifest.completedAt,
    };
    await atomicWrite(globalManifestPath, Buffer.from(canonicalJson(ownership)), 0o600);
    await checkpoint("ownership-committed");
    journal = {
      ...journal,
      status: "completed",
      completedAt: now().toISOString(),
      ownershipSha256: sha256(canonicalJson(ownership)),
    };
    await writeSignedJournal(journalPath, journal, provenanceKey);
    return {
      status: "migrated",
      inventorySha256: inventory.inventorySha256,
      repository,
      backupId,
      projectRevision,
      ownershipPath: globalManifestPath,
    };
  } catch (error) {
    let rollbackError = null;
    try {
      for (const entry of [...inventory.platform].reverse()) {
        const target = entry.targetPath;
        if (await pathExists(target)) {
          const current = await snapshotTree(target);
          if (current.treeSha256 === entry.treeSha256) {
            await rm(target, { recursive: true });
          }
        }
        const replaced = replacedPlatform.find((item) => item.entry.name === entry.name);
        if (replaced && (await pathExists(replaced.backup))) {
          if (await pathExists(target)) {
            throw new Error(`Cannot restore platform Skill over changed target: ${entry.name}`);
          }
          await rename(replaced.backup, target);
        }
      }
      await restoreProjectState(
        root,
        projectBefore,
        await readProjectSkillManifest(root),
      );
      await restoreFileState(profilePath, originalProfile);
      await restoreFileState(agentsPath, originalAgents);
      await rm(globalManifestPath, { force: true });
      journal = {
        ...journal,
        status: "rolled-back",
        rolledBackAt: now().toISOString(),
        failure: String(error?.message ?? error),
      };
      await writeSignedJournal(journalPath, journal, provenanceKey);
    } catch (caught) {
      rollbackError = caught;
    }
    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Skill migration failed and requires recovery from ${backupRoot}.`,
      );
    }
    throw error;
  } finally {
    await rm(transactionRoot, { recursive: true, force: true });
    await lock.release();
  }
}

export async function auditSkillPlatformMigration({
  repoRoot,
  homeDir = homedir(),
  repositoryPath,
  gitEnv = process.env,
  execFileImpl = execFile,
}) {
  const home = path.resolve(homeDir);
  const root = path.resolve(repoRoot);
  const manifestPath = globalManifestPathFor(home);
  if (!(await pathExists(manifestPath))) {
    return { status: "unmanaged", issues: ["Global Skill ownership manifest is absent."] };
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const issues = [];
  if (manifest.schemaVersion !== 2 || manifest.owner !== OWNER) {
    issues.push("Global Skill ownership manifest schema or owner is invalid.");
  }
  const managedPlatformNames = (manifest.managedPlatformSkills ?? [])
    .map((entry) => entry?.name)
    .sort((left, right) => String(left).localeCompare(String(right)));
  const expectedPlatformNames = [...GLOBAL_PLATFORM_SKILLS].sort((left, right) =>
    left.localeCompare(right),
  );
  const legacyPlatformNames = [...expectedPlatformNames, "grill-me"].sort(
    (left, right) => left.localeCompare(right),
  );
  if (
    canonicalJson(managedPlatformNames) !== canonicalJson(expectedPlatformNames) &&
    canonicalJson(managedPlatformNames) !== canonicalJson(legacyPlatformNames)
  ) {
    issues.push("Global Skill ownership manifest does not bind the 15 built-in platform Skills (or the supported 16-Skill legacy set).");
  }
  let repository = null;
  try {
    repository = await readSkillRepositoryIdentity(
      repositoryPath ?? manifest.repository?.path,
      { env: gitEnv, execFileImpl },
    );
    for (const field of ["branch", "commit", "tree", "clean"]) {
      if (repository[field] !== manifest.repository?.[field]) {
        issues.push(`Skill catalog repository ${field} drifted.`);
      }
    }
    if (
      canonicalJson(repository.remotes) !==
      canonicalJson(manifest.repository?.remotes ?? [])
    ) {
      issues.push("Skill catalog repository remotes drifted.");
    }
  } catch (error) {
    issues.push(`Skill catalog repository is unavailable: ${error.message}`);
  }
  const profilePath = profilePathFor(home);
  const profile = await readFileState(profilePath, "Skill repository profile");
  if (!profile.exists || profile.sha256 !== manifest.profileSha256) {
    issues.push("Skill repository profile is missing or modified.");
  }
  for (const entry of manifest.managedPlatformSkills ?? []) {
    try {
      const snapshot = await snapshotTree(entry.targetPath);
      if (snapshot.treeSha256 !== entry.treeSha256) {
        issues.push(`Global platform Skill drifted: ${entry.name}`);
      }
    } catch (error) {
      issues.push(`Global platform Skill unavailable: ${entry.name}: ${error.message}`);
    }
  }
  for (const entry of manifest.preservedExternalSkills ?? []) {
    try {
      const snapshot = await snapshotTree(entry.path);
      if (snapshot.treeSha256 !== entry.observedTreeSha256) {
        issues.push(`Preserved external Skill changed: ${entry.name}`);
      }
    } catch (error) {
      issues.push(`Preserved external Skill unavailable: ${entry.name}: ${error.message}`);
    }
  }
  for (const entry of manifest.catalogSkills ?? []) {
    try {
      const source = path.join(
        manifest.repository.path,
        ...entry.relativePath.split("/"),
      );
      const snapshot = await snapshotTree(source);
      if (snapshot.treeSha256 !== entry.treeSha256) {
        issues.push(`Approved catalog Skill drifted: ${entry.name}`);
      }
    } catch (error) {
      issues.push(`Approved catalog Skill unavailable: ${entry.name}: ${error.message}`);
    }
  }
  const agentsState = await readFileState(
    path.join(home, ".codex", "AGENTS.md"),
    "Global AGENTS.md",
  );
  try {
    const block = agentsState.exists
      ? findGlobalBlock(agentsState.bytes.toString("utf8"))
      : null;
    if (
      block === null ||
      sha256(block) !== manifest.managedBlocks?.[0]?.renderedBlockSha256
    ) {
      issues.push("Global Skill repository managed block is missing or modified.");
    }
    if (
      agentsState.exists &&
      agentsState.sha256 !== manifest.managedBlocks?.[0]?.installedFileSha256
    ) {
      issues.push("Global AGENTS.md changed after migration.");
    }
  } catch (error) {
    issues.push(error.message);
  }
  for (const [relative, expectedField] of [
    [".harness/project.json", "contractSha256"],
    [".harness/ownership.json", "ownershipSha256"],
    [".harness/project-skills.json", "manifestSha256"],
  ]) {
    const state = await readFileState(
      path.join(root, ...relative.split("/")),
      relative,
    );
    if (!state.exists || state.sha256 !== manifest.project?.[expectedField]) {
      issues.push(`Project migration state drifted: ${relative}`);
    }
  }
  for (const entry of manifest.project?.skills ?? []) {
    try {
      const snapshot = await snapshotTree(
        path.join(root, ".agents", "skills", entry.name),
      );
      if (snapshot.treeSha256 !== entry.treeSha256) {
        issues.push(`Project Skill snapshot drifted: ${entry.name}`);
      }
    } catch (error) {
      issues.push(`Project Skill snapshot unavailable: ${entry.name}: ${error.message}`);
    }
  }
  return {
    status: issues.length === 0 ? "ready" : "drifted",
    issues,
    manifestPath,
    repository,
    backupId: manifest.backupId,
  };
}

export async function rollbackSkillPlatformMigration({
  approved,
  backupId,
  repoRoot,
  homeDir = homedir(),
}) {
  if (approved !== true) {
    throw new Error("Skill platform rollback requires explicit approval.");
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(String(backupId ?? ""))) {
    throw new Error("Skill platform rollback backup id is invalid.");
  }
  const home = path.resolve(homeDir);
  const root = path.resolve(repoRoot);
  const audit = await auditSkillPlatformMigration({
    repoRoot: root,
    homeDir: home,
  });
  if (audit.status !== "ready") {
    throw new Error(`Skill platform rollback requires intact current ownership: ${audit.issues.join("; ")}`);
  }
  const globalManifestPath = globalManifestPathFor(home);
  const ownership = JSON.parse(await readFile(globalManifestPath, "utf8"));
  if (ownership.backupId !== backupId) {
    throw new Error("Requested backup does not match current Skill platform ownership.");
  }
  const backupRoot = path.join(home, ".agents", "harness", "backups", backupId);
  assertInside(path.join(home, ".agents", "harness", "backups"), backupRoot, "Skill backup");
  const backupManifestPath = path.join(backupRoot, "manifest.json");
  const backup = JSON.parse(await readFile(backupManifestPath, "utf8"));
  if (backup.schemaVersion !== 2 || backup.backupId !== backupId || backup.owner !== OWNER) {
    throw new Error("Skill platform backup manifest is invalid.");
  }
  const transactionId = randomUUID();
  const lock = await acquireGlobalLock(home, transactionId);
  try {
    for (const entry of [...backup.platform].reverse()) {
      const current = await snapshotTree(entry.targetPath);
      if (current.treeSha256 !== entry.installedTreeSha256) {
        throw new Error(`Platform Skill changed after migration: ${entry.name}`);
      }
      await rm(entry.targetPath, { recursive: true });
      if (entry.originalBackupPath) {
        if (!(await pathExists(entry.originalBackupPath))) {
          throw new Error(`Platform Skill backup is missing: ${entry.name}`);
        }
        await rename(entry.originalBackupPath, entry.targetPath);
      }
    }
    const currentProjectManifest = await readProjectSkillManifest(root);
    const before = {
      files: {},
      skills: backup.originals.projectSkills,
    };
    for (const [relative, state] of Object.entries(backup.originals.project)) {
      before.files[relative] = state.exists
        ? {
            exists: true,
            bytes: await readFile(state.backupPath),
            mode: state.mode,
            sha256: state.sha256,
          }
        : { exists: false, bytes: null, mode: null, sha256: null };
    }
    await restoreProjectState(root, before, currentProjectManifest);
    for (const [target, original] of [
      [profilePathFor(home), backup.originals.profile],
      [path.join(home, ".codex", "AGENTS.md"), backup.originals.agents],
    ]) {
      const state = original.exists
        ? {
            exists: true,
            bytes: await readFile(original.backupPath),
            mode: original.mode,
            sha256: original.sha256,
          }
        : { exists: false, bytes: null, mode: null, sha256: null };
      await restoreFileState(target, state);
    }
    await rm(globalManifestPath, { force: true });
    await atomicWrite(
      path.join(backupRoot, "rollback.json"),
      Buffer.from(
        canonicalJson({
          schemaVersion: 1,
          owner: OWNER,
          backupId,
          rolledBackAt: new Date().toISOString(),
        }),
      ),
      0o600,
    );
    return { status: "rolled-back", backupId, backupRoot };
  } finally {
    await lock.release();
  }
}

export const SKILL_PLATFORM_MARKERS = Object.freeze({
  start: GLOBAL_BLOCK_START,
  end: GLOBAL_BLOCK_END,
});
