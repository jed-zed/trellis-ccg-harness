import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
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
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  GLOBAL_PLATFORM_SKILLS,
  PREVIOUS_GLOBAL_PLATFORM_SKILL_SETS,
  upgradeLegacySkillPlatformDefaults,
} from "./skill-platform-migration.mjs";
import {
  assertTrustedCommandUnchanged,
  minimalCommandEnvironment,
  resolveTrustedCommand,
} from "./trusted-command-resolver.mjs";

const execFile = promisify(execFileCallback);
const OWNER = "trellis-ccg-harness";
const GLOBAL_MANIFEST_RELATIVE = ".agents/harness/global-skills.json";
const GLOBAL_STATE_RELATIVE = ".agents/harness/global-init.json";
const PROVIDER_NAMES = Object.freeze(["codex", "gemini", "grok", "claude"]);
const PROVIDER_STATUSES = new Set([
  "not-installed",
  "authentication-unknown",
  "installed-unauthenticated",
  "authenticated",
  "manual-only",
  "skipped",
]);
const PROVIDER_COMMANDS = Object.freeze({
  codex: {
    command: "codex",
    versionArgs: ["--version"],
    authProbeArgs: ["login", "status"],
  },
  gemini: {
    command: "gemini",
    versionArgs: ["--version"],
    authProbeArgs: null,
  },
  grok: {
    command: "grok",
    versionArgs: ["--version"],
    authProbeArgs: null,
  },
});

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function assertInside(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes its approved root: ${target}`);
  }
}

async function assertRealDirectory(target, label) {
  const details = await lstat(target);
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${target}`);
  }
  return realpath(target);
}

async function ensureDirectoryChain(root, target, { create = false } = {}) {
  const canonicalRoot = await assertRealDirectory(root, "User home");
  const resolvedTarget = path.resolve(target);
  assertInside(canonicalRoot, resolvedTarget, "Managed directory");
  const relative = path.relative(canonicalRoot, resolvedTarget);
  let current = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink() || !details.isDirectory()) {
        throw new Error(
          `Managed directory contains a link or non-directory: ${current}`,
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT" || !create) throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  return canonicalRoot;
}

async function snapshotTree(sourceRoot, { copyTo = null } = {}) {
  const root = await assertRealDirectory(sourceRoot, "Skill tree");
  const files = [];
  let totalBytes = 0;
  if (copyTo) {
    await mkdir(copyTo, { mode: 0o700 });
  }
  const visit = async (directory, relativeDirectory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const source = path.join(directory, entry.name);
      const relative = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill tree contains a link: ${source}`);
      }
      if (entry.isDirectory()) {
        const destination = copyTo
          ? path.join(copyTo, ...relative.split("/"))
          : null;
        if (destination) await mkdir(destination, { mode: 0o700 });
        await visit(source, relative);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Skill tree contains a special file: ${source}`);
      }
      const details = await lstat(source);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw new Error(`Skill tree changed during inspection: ${source}`);
      }
      const bytes = await readFile(source);
      totalBytes += bytes.length;
      files.push({
        path: relative,
        size: bytes.length,
        sha256: sha256(bytes),
      });
      if (copyTo) {
        const destination = path.join(copyTo, ...relative.split("/"));
        await writeFile(destination, bytes, {
          flag: "wx",
          mode: details.mode & 0o777,
        });
      }
    }
  };
  await visit(root, "");
  if (!files.some((entry) => entry.path === "SKILL.md")) {
    throw new Error(`Skill tree has no SKILL.md: ${root}`);
  }
  return {
    treeSha256: sha256(canonicalJson(files)),
    fileCount: files.length,
    totalBytes,
  };
}

function globalManifestPath(homeDir) {
  const target = path.join(
    path.resolve(homeDir),
    ...GLOBAL_MANIFEST_RELATIVE.split("/"),
  );
  assertInside(homeDir, target, "Global Skill ownership manifest");
  return target;
}

function globalStatePath(homeDir) {
  const target = path.join(
    path.resolve(homeDir),
    ...GLOBAL_STATE_RELATIVE.split("/"),
  );
  assertInside(homeDir, target, "Global Init state");
  return target;
}

async function readRegularJson(target, label) {
  const details = await lstat(target);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error(`${label} must be a regular non-linked file.`);
  }
  return JSON.parse(await readFile(target, "utf8"));
}

async function describePlatformSources(platformSkillsRoot) {
  const sourceRoot = await assertRealDirectory(
    platformSkillsRoot,
    "Bundled platform Skill root",
  );
  const skills = [];
  for (const name of GLOBAL_PLATFORM_SKILLS) {
    const sourcePath = path.join(sourceRoot, name);
    const snapshot = await snapshotTree(sourcePath);
    skills.push({ name, sourcePath, ...snapshot });
  }
  return { sourceRoot, skills };
}

function validateGlobalManifest(manifest) {
  const directManifest =
    manifest?.schemaVersion === 1 &&
    manifest.owner === OWNER &&
    manifest.installMode === "copy" &&
    Array.isArray(manifest.managedPlatformSkills);
  const migrationManifest =
    [1, 2].includes(manifest?.schemaVersion) &&
    manifest?.owner === OWNER &&
    manifest.installMode === undefined &&
    /^[a-f0-9]{64}$/.test(String(manifest.profileSha256 ?? "")) &&
    path.isAbsolute(String(manifest.repository?.path ?? "")) &&
    /^[a-f0-9]{40}$/.test(String(manifest.repository?.commit ?? "")) &&
    /^[a-f0-9]{40}$/.test(String(manifest.repository?.tree ?? "")) &&
    Array.isArray(manifest.managedPlatformSkills) &&
    Array.isArray(manifest.preservedExternalSkills) &&
    Array.isArray(manifest.managedBlocks) &&
    manifest.project &&
    /^[A-Za-z0-9_.:-]+$/.test(String(manifest.backupId ?? ""));
  if (!directManifest && !migrationManifest) {
    throw new Error("Global Skill ownership manifest is invalid.");
  }
  const names = manifest.managedPlatformSkills
    .map((entry) => entry?.name)
    .sort((left, right) => String(left).localeCompare(String(right)));
  const expected = [...GLOBAL_PLATFORM_SKILLS].sort((left, right) =>
    left.localeCompare(right),
  );
  const legacyExpected = [...expected, "grill-me"].sort((left, right) =>
    left.localeCompare(right),
  );
  const current =
    canonicalJson(names) === canonicalJson(expected) ||
    canonicalJson(names) === canonicalJson(legacyExpected);
  const upgradeRequired = PREVIOUS_GLOBAL_PLATFORM_SKILL_SETS.some(
    (previous) => {
      const previousExpected = [...previous].sort((left, right) =>
        left.localeCompare(right),
      );
      const previousLegacyExpected = [...previous, "grill-me"].sort(
        (left, right) => left.localeCompare(right),
      );
      return (
        canonicalJson(names) === canonicalJson(previousExpected) ||
        canonicalJson(names) === canonicalJson(previousLegacyExpected)
      );
    },
  );
  if (!current && !upgradeRequired) {
    throw new Error("Global Skill ownership manifest has an invalid Skill set.");
  }
  return {
    manifest,
    mode: migrationManifest ? "skill-platform-migration" : "global-init",
    upgradeRequired,
  };
}

async function replaceGlobalManifestCas(target, originalBytes, nextBytes) {
  const temporary = path.join(
    path.dirname(target),
    `.global-skills-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, nextBytes, { flag: "wx", mode: 0o600 });
  try {
    const current = await readFile(target);
    if (!current.equals(originalBytes)) {
      throw new Error(
        "Global Skill ownership manifest changed concurrently; refusing upgrade.",
      );
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function installBundledPlatformSkills({
  approved,
  homeDir,
  platformSkillsRoot,
  now = () => new Date(),
}) {
  if (approved !== true) {
    throw new Error("Global platform Skill installation requires --approved.");
  }
  const home = await assertRealDirectory(
    path.resolve(homeDir),
    "User home",
  );
  const targetRoot = path.join(home, ".agents", "skills");
  const manifestPath = globalManifestPath(home);
  const sources = await describePlatformSources(platformSkillsRoot);

  if (await pathExists(manifestPath)) {
    const originalManifestBytes = await readFile(manifestPath);
    const validated = validateGlobalManifest(
      await readRegularJson(manifestPath, "Global Skill ownership manifest"),
    );
    const { manifest, upgradeRequired } = validated;
    const ownedNames = new Set(
      manifest.managedPlatformSkills.map((entry) => entry.name),
    );
    for (const source of sources.skills) {
      const owned = manifest.managedPlatformSkills.find(
        (entry) => entry.name === source.name,
      );
      if (!owned && upgradeRequired) continue;
      const expectedTarget = path.join(targetRoot, source.name);
      if (
        path.resolve(owned?.targetPath ?? "") !== path.resolve(expectedTarget) ||
        !path.isAbsolute(String(owned?.sourcePath ?? source.sourcePath)) ||
        !/^[a-f0-9]{64}$/.test(String(owned?.treeSha256 ?? "")) ||
        !Number.isInteger(owned?.fileCount) ||
        owned.fileCount < 1 ||
        !Number.isInteger(owned?.totalBytes) ||
        owned.totalBytes < 1 ||
        (
          validated.mode === "global-init" &&
          owned.treeSha256 !== source.treeSha256
        )
      ) {
        throw new Error(
          `Bundled platform Skill source or ownership changed: ${source.name}`,
        );
      }
      const installed = await snapshotTree(expectedTarget);
      if (installed.treeSha256 !== owned.treeSha256) {
        throw new Error(
          `Managed global platform Skill drifted: ${source.name}`,
        );
      }
    }
    if (upgradeRequired) {
      if (validated.mode !== "global-init") {
        return upgradeLegacySkillPlatformDefaults({
          approved,
          homeDir: home,
          now,
          platformSkillsRoot,
        });
      }
      const addedSources = sources.skills.filter(
        (source) => !ownedNames.has(source.name),
      );
      for (const source of addedSources) {
        const target = path.join(targetRoot, source.name);
        if (await pathExists(target)) {
          throw new Error(
            `Legacy global Skill upgrade target collision is user-owned: ${target}`,
          );
        }
      }
      const harnessRoot = path.dirname(manifestPath);
      const stageRoot = path.join(
        harnessRoot,
        `.global-upgrade-stage-${randomUUID()}`,
      );
      await mkdir(stageRoot, { mode: 0o700 });
      const installed = [];
      try {
        for (const source of addedSources) {
          const staged = path.join(stageRoot, source.name);
          const stagedSnapshot = await snapshotTree(source.sourcePath, {
            copyTo: staged,
          });
          if (stagedSnapshot.treeSha256 !== source.treeSha256) {
            throw new Error(
              `Bundled platform Skill changed while staging: ${source.name}`,
            );
          }
        }
        for (const source of addedSources) {
          const target = path.join(targetRoot, source.name);
          if (await pathExists(target)) {
            throw new Error(
              `Global Skill target appeared during upgrade: ${source.name}`,
            );
          }
          await rename(path.join(stageRoot, source.name), target);
          installed.push({ source, target });
        }
        const upgradedManifest = {
          ...manifest,
          managedPlatformSkills: [
            ...manifest.managedPlatformSkills,
            ...addedSources.map((source) => ({
              name: source.name,
              targetPath: path.join(targetRoot, source.name),
              treeSha256: source.treeSha256,
              fileCount: source.fileCount,
              totalBytes: source.totalBytes,
            })),
          ],
        };
        await replaceGlobalManifestCas(
          manifestPath,
          originalManifestBytes,
          Buffer.from(canonicalJson(upgradedManifest)),
        );
      } catch (error) {
        const rollbackErrors = [];
        for (const { source, target } of installed.reverse()) {
          try {
            const current = await snapshotTree(target);
            if (current.treeSha256 !== source.treeSha256) {
              throw new Error(
                `Installed global Skill changed before rollback: ${source.name}`,
              );
            }
            await rm(target, { recursive: true });
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Global Skill upgrade failed and could not be fully rolled back.",
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
        ownershipMode: validated.mode,
      };
    }
    return {
      status: "unchanged",
      manifestPath,
      installedSkills: [...GLOBAL_PLATFORM_SKILLS],
      ownershipMode: validated.mode,
    };
  }

  await ensureDirectoryChain(home, targetRoot, { create: true });
  for (const source of sources.skills) {
    const target = path.join(targetRoot, source.name);
    if (await pathExists(target)) {
      throw new Error(
        `Fresh global Skill target collision is user-owned: ${target}`,
      );
    }
  }
  const harnessRoot = path.dirname(manifestPath);
  await ensureDirectoryChain(home, harnessRoot, { create: true });
  const stageRoot = path.join(harnessRoot, `.global-init-stage-${randomUUID()}`);
  await mkdir(stageRoot, { mode: 0o700 });
  const installedTargets = [];
  let manifestCommitted = false;
  try {
    for (const source of sources.skills) {
      const staged = path.join(stageRoot, source.name);
      const stagedSnapshot = await snapshotTree(source.sourcePath, {
        copyTo: staged,
      });
      if (stagedSnapshot.treeSha256 !== source.treeSha256) {
        throw new Error(
          `Bundled platform Skill changed while staging: ${source.name}`,
        );
      }
    }
    for (const source of sources.skills) {
      const target = path.join(targetRoot, source.name);
      if (await pathExists(target)) {
        throw new Error(
          `Global Skill target appeared during installation: ${source.name}`,
        );
      }
      await rename(path.join(stageRoot, source.name), target);
      installedTargets.push(target);
    }
    const manifest = {
      schemaVersion: 1,
      owner: OWNER,
      installMode: "copy",
      installedAt: now().toISOString(),
      managedPlatformSkills: sources.skills.map((source) => ({
        name: source.name,
        targetPath: path.join(targetRoot, source.name),
        treeSha256: source.treeSha256,
        fileCount: source.fileCount,
        totalBytes: source.totalBytes,
      })),
    };
    await writeFile(manifestPath, canonicalJson(manifest), {
      flag: "wx",
      mode: 0o600,
    });
    manifestCommitted = true;
  } catch (error) {
    if (!manifestCommitted) {
      for (const target of installedTargets.reverse()) {
        await rm(target, { recursive: true, force: true });
      }
    }
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
  return {
    status: "installed",
    manifestPath,
    installedSkills: [...GLOBAL_PLATFORM_SKILLS],
  };
}

export function assertCloneSourceHasNoCredentials(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("catalog clone requires a non-empty source.");
  }
  const source = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    let parsed;
    try {
      parsed = new URL(source);
    } catch {
      throw new Error("Catalog clone URL is invalid.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Catalog clone URLs must not contain credentials.");
    }
    if (parsed.search || parsed.hash) {
      throw new Error(
        "Catalog clone URLs must not contain query or fragment credentials.",
      );
    }
  }
  if (/^[^/\\\s]+:[^/@\s]+@[^/\s]+/.test(source)) {
    throw new Error("Catalog clone URLs must not contain credentials.");
  }
  return source;
}

async function assertGitWorkingTree(repositoryPath, execFileImpl = execFile) {
  const canonical = await assertRealDirectory(
    repositoryPath,
    "Personal Skill catalog",
  );
  try {
    const result = await execFileImpl(
      "git",
      ["-C", canonical, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8", windowsHide: true },
    );
    if (String(result?.stdout ?? "").trim() !== "true") {
      throw new Error("not a work tree");
    }
  } catch {
    throw new Error(
      `Personal Skill catalog must be an existing Git working tree: ${canonical}`,
    );
  }
  return canonical;
}

export async function preparePersonalSkillCatalog({
  allowExistingClone = false,
  allowNetwork = false,
  catalogMode,
  catalogPath,
  catalogUrl,
  execFileImpl = execFile,
}) {
  if (!["skip", "local", "clone"].includes(catalogMode)) {
    throw new Error("Catalog mode must be skip, local, or clone.");
  }
  if (catalogMode === "skip") {
    if (catalogPath || catalogUrl) {
      throw new Error("Skipped catalog mode must not receive a path or URL.");
    }
    return { mode: "skip", repositoryPath: null, status: "skipped" };
  }
  if (!catalogPath) {
    throw new Error(`${catalogMode} catalog mode requires --repository.`);
  }
  const destination = path.resolve(catalogPath);
  if (catalogMode === "local") {
    if (catalogUrl) {
      throw new Error("Local catalog mode must not receive a clone URL.");
    }
    return {
      mode: "local",
      repositoryPath: await assertGitWorkingTree(destination, execFileImpl),
      status: "selected",
    };
  }
  if (allowNetwork !== true) {
    throw new Error(
      "Catalog clone requires a separate --allow-catalog-network approval.",
    );
  }
  const source = assertCloneSourceHasNoCredentials(catalogUrl);
  if (await pathExists(destination)) {
    if (allowExistingClone) {
      return {
        mode: "clone",
        repositoryPath: await assertGitWorkingTree(
          destination,
          execFileImpl,
        ),
        status: "reused",
      };
    }
    throw new Error(
      `Catalog clone destination already exists and is user-owned: ${destination}`,
    );
  }
  const parent = path.dirname(destination);
  await assertRealDirectory(parent, "Catalog clone destination parent");
  const stage = path.join(parent, `.catalog-clone-${randomUUID()}`);
  try {
    await execFileImpl("git", ["clone", "--", source, stage], {
      encoding: "utf8",
      windowsHide: true,
    });
    await assertGitWorkingTree(stage, execFileImpl);
    if (await pathExists(destination)) {
      throw new Error(
        `Catalog clone destination appeared and is user-owned: ${destination}`,
      );
    }
    await rename(stage, destination);
    return {
      mode: "clone",
      repositoryPath: await assertGitWorkingTree(destination, execFileImpl),
      status: "cloned",
    };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function runProviderStatusCommand(
  command,
  args,
  {
    environment = process.env,
    execFileImpl = execFile,
    resolveCommand = resolveTrustedCommand,
    verifyCommand = assertTrustedCommandUnchanged,
  } = {},
) {
  try {
    const binding = await resolveCommand(command);
    await verifyCommand(binding);
    const result = await execFileImpl(
      binding.command,
      [...binding.argsPrefix, ...args],
      {
        encoding: "utf8",
        env: minimalCommandEnvironment(environment),
        timeout: 5_000,
        windowsHide: true,
        shell: false,
      },
    );
    return {
      exitCode: 0,
      stdout: String(result?.stdout ?? ""),
      stderr: String(result?.stderr ?? ""),
    };
  } catch (error) {
    return {
      exitCode: error?.code === "ENOENT" ? 127 : Number(error?.code) || 1,
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? error?.message ?? ""),
    };
  }
}

function providerChoices(name, status) {
  if (name === "claude") {
    if (status === "manual-only") {
      return {
        choices: ["skip", "install", "login", "later"],
        recommendedAction: "skip",
      };
    }
    if (status === "skipped") {
      return { choices: ["skip"], recommendedAction: "skip" };
    }
    if (status === "authenticated") {
      return {
        choices: ["keep", "skip", "later"],
        recommendedAction: "skip",
      };
    }
    if (status === "installed-unauthenticated") {
      return {
        choices: ["skip", "login", "later"],
        recommendedAction: "skip",
      };
    }
    if (status === "not-installed") {
      return {
        choices: ["skip", "install", "later"],
        recommendedAction: "skip",
      };
    }
    return {
      choices: ["skip", "login", "check", "later"],
      recommendedAction: "skip",
    };
  }
  if (status === "not-installed") {
    return {
      choices: ["install", "later"],
      recommendedAction: name === "codex" ? "install" : "later",
    };
  }
  if (status === "installed-unauthenticated") {
    return { choices: ["login", "later"], recommendedAction: "later" };
  }
  if (status === "authenticated") {
    return { choices: ["keep", "later"], recommendedAction: "keep" };
  }
  return {
    choices: ["login", "check", "later"],
    recommendedAction: "later",
  };
}

function normalizeOverrideStatuses(overrides) {
  if (!overrides) return null;
  const result = {};
  for (const name of PROVIDER_NAMES) {
    const status = overrides[name];
    if (!PROVIDER_STATUSES.has(status)) {
      throw new Error(`Provider status override is invalid for ${name}.`);
    }
    result[name] = {
      status,
      installed:
        status === "manual-only"
          ? null
          : !["not-installed", "skipped"].includes(status),
      authenticated:
        status === "authenticated"
          ? true
          : status === "installed-unauthenticated"
            ? false
            : null,
      ...providerChoices(name, status),
    };
  }
  return result;
}

export async function inspectProviderCliStatuses({
  runCommand = runProviderStatusCommand,
  statusOverrides = null,
} = {}) {
  const overridden = normalizeOverrideStatuses(statusOverrides);
  if (overridden) return overridden;
  const statuses = {};
  for (const name of PROVIDER_NAMES) {
    if (name === "claude") {
      const status = "manual-only";
      statuses[name] = {
        status,
        installed: null,
        authenticated: null,
        ...providerChoices(name, status),
      };
      continue;
    }
    const definition = PROVIDER_COMMANDS[name];
    const version = await runCommand(
      definition.command,
      definition.versionArgs,
    );
    if (version.exitCode !== 0) {
      const status = "not-installed";
      statuses[name] = {
        status,
        installed: false,
        authenticated: null,
        ...providerChoices(name, status),
      };
      continue;
    }
    if (definition.authProbeArgs === null) {
      const status = "authentication-unknown";
      statuses[name] = {
        status,
        installed: true,
        authenticated: null,
        ...providerChoices(name, status),
      };
      continue;
    }
    const auth = await runCommand(
      definition.command,
      definition.authProbeArgs,
    );
    const output = `${auth.stdout ?? ""}\n${auth.stderr ?? ""}`;
    let status = "authentication-unknown";
    if (
      /not\s+(?:logged|signed)\s+in|unauthenticated|login required/i.test(
        output,
      )
    ) {
      status = "installed-unauthenticated";
    } else if (
      auth.exitCode === 0 &&
      /logged\s+in|signed\s+in|authenticated/i.test(output)
    ) {
      status = "authenticated";
    }
    statuses[name] = {
      status,
      installed: true,
      authenticated:
        status === "authenticated"
          ? true
          : status === "installed-unauthenticated"
            ? false
            : null,
      ...providerChoices(name, status),
    };
  }
  return statuses;
}

export function validateProviderActions(actions) {
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    throw new Error("Global Init requires explicit --provider-actions.");
  }
  const names = Object.keys(actions).sort((left, right) =>
    left.localeCompare(right),
  );
  const expectedNames = [...PROVIDER_NAMES].sort((left, right) =>
    left.localeCompare(right),
  );
  if (canonicalJson(names) !== canonicalJson(expectedNames)) {
    throw new Error(
      "Global Init provider actions must name codex, gemini, grok, and claude exactly.",
    );
  }
  const result = {};
  for (const name of PROVIDER_NAMES) {
    const action = actions[name];
    if (!["keep", "later", "skip", "install", "login", "check"].includes(action)) {
      throw new Error(`Provider action is missing or invalid for ${name}.`);
    }
    result[name] = action;
  }
  return result;
}

const PROVIDER_GUIDANCE = Object.freeze({
  codex: {
    install: {
      kind: "official-documentation",
      reference: "OpenAI Codex CLI installation documentation",
    },
    login: {
      kind: "command",
      command: ["codex", "login"],
    },
    check: {
      kind: "command",
      command: ["codex", "login", "status"],
    },
  },
  gemini: {
    install: {
      kind: "official-documentation",
      reference: "Google Gemini CLI installation documentation",
    },
    login: {
      kind: "official-documentation",
      reference: "Google Gemini CLI authentication documentation",
    },
    check: {
      kind: "official-documentation",
      reference: "Google Gemini CLI authentication documentation",
    },
  },
  grok: {
    install: {
      kind: "official-documentation",
      reference: "xAI Grok CLI installation documentation",
    },
    login: {
      kind: "command",
      command: ["grok", "login"],
    },
    check: {
      kind: "official-documentation",
      reference: "xAI Grok CLI authentication documentation",
    },
  },
  claude: {
    install: {
      kind: "official-documentation",
      reference: "Anthropic Claude Code installation documentation",
    },
    login: {
      kind: "official-documentation",
      reference: "Anthropic Claude Code authentication documentation",
    },
    check: {
      kind: "official-documentation",
      reference: "Anthropic Claude Code authentication documentation",
    },
  },
});

export function describeProviderAction(provider, action, providerStatus) {
  const requiresSeparateApproval = ["install", "login"].includes(action);
  return {
    provider,
    status: providerStatus,
    action,
    pending: requiresSeparateApproval,
    executed: false,
    requiresSeparateApproval,
    guidance: PROVIDER_GUIDANCE[provider]?.[action] ?? {
      kind: "none",
      reference: "No external provider action is requested.",
    },
    exitsZeroClaudeProfile:
      provider === "claude" &&
      ["install", "login", "keep"].includes(action),
  };
}

function validateProviderActionTransition(existingActions, nextActions) {
  for (const name of PROVIDER_NAMES) {
    const previous = existingActions[name];
    const next = nextActions[name];
    if (previous === next) continue;
    if (
      ["install", "login"].includes(previous) &&
      ["keep", "later"].includes(next)
    ) {
      continue;
    }
    if (previous === "install" && next === "login") {
      continue;
    }
    throw new Error(
      `Global Init provider action transition is not allowed: ` +
        `${name} ${previous} -> ${next}.`,
    );
  }
}

function validateGlobalInitState(state) {
  if (
    state?.schemaVersion !== 1 ||
    state.owner !== OWNER ||
    typeof state.platformManifestPath !== "string" ||
    !path.isAbsolute(state.platformManifestPath) ||
    !["skip", "local", "clone"].includes(state.catalog?.mode) ||
    !Object.hasOwn(state.catalog, "repositoryPath") ||
    !Array.isArray(state.pendingProviderActions) ||
    typeof state.zeroClaudeProfile !== "boolean"
  ) {
    throw new Error("Global Init state is invalid.");
  }
  if (
    (state.catalog.mode === "skip" &&
      state.catalog.repositoryPath !== null) ||
    (state.catalog.mode !== "skip" &&
      (typeof state.catalog.repositoryPath !== "string" ||
        !path.isAbsolute(state.catalog.repositoryPath)))
  ) {
    throw new Error("Global Init catalog state is invalid.");
  }
  validateProviderActions(state.providerActions);
  const expectedPending = new Map(
    Object.entries(state.providerActions)
      .filter(([, action]) => ["install", "login"].includes(action))
      .map(([provider, action]) => [provider, action]),
  );
  for (const entry of state.pendingProviderActions) {
    if (
      !entry ||
      expectedPending.get(entry.provider) !== entry.action ||
      entry.pending !== true ||
      entry.executed !== false ||
      entry.requiresSeparateApproval !== true
    ) {
      throw new Error("Global Init pending provider action is invalid.");
    }
    expectedPending.delete(entry.provider);
  }
  if (expectedPending.size > 0) {
    throw new Error("Global Init pending provider actions are incomplete.");
  }
  return state;
}

async function replaceGlobalStateCas(target, originalBytes, nextBytes) {
  const temporary = path.join(
    path.dirname(target),
    `.global-init-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, nextBytes, { flag: "wx", mode: 0o600 });
  try {
    const current = await readFile(target);
    if (!current.equals(originalBytes)) {
      throw new Error(
        "Global Init state changed concurrently; refusing provider update.",
      );
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function recordGlobalInitState({
  catalog,
  homeDir,
  pendingProviderActions,
  platformManifestPath,
  providerActions,
}) {
  const home = await assertRealDirectory(homeDir, "User home");
  const target = globalStatePath(home);
  const parent = path.dirname(target);
  await ensureDirectoryChain(home, parent, { create: true });
  let existing = null;
  let existingBytes = null;
  if (await pathExists(target)) {
    const details = await lstat(target);
    if (details.isSymbolicLink() || !details.isFile()) {
      throw new Error(
        "Global Init state must be a regular non-linked file.",
      );
    }
    existingBytes = await readFile(target);
    existing = validateGlobalInitState(
      JSON.parse(existingBytes.toString("utf8")),
    );
    if (
      existing.platformManifestPath !== platformManifestPath ||
      canonicalJson(existing.catalog) !==
        canonicalJson({
          mode: catalog.mode,
          repositoryPath: catalog.repositoryPath,
        })
    ) {
      throw new Error(
        "Existing Global Init platform or catalog identity changed.",
      );
    }
    validateProviderActionTransition(
      existing.providerActions,
      providerActions,
    );
  }
  const zeroClaudeProfile =
    existing?.zeroClaudeProfile === false
      ? false
      : !["install", "login", "keep"].includes(providerActions.claude);
  const state = {
    schemaVersion: 1,
    owner: OWNER,
    platformManifestPath,
    catalog: {
      mode: catalog.mode,
      repositoryPath: catalog.repositoryPath,
    },
    providerActions,
    pendingProviderActions,
    zeroClaudeProfile,
  };
  validateGlobalInitState(state);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(state)) {
      await replaceGlobalStateCas(
        target,
        existingBytes,
        Buffer.from(canonicalJson(state)),
      );
      return { status: "updated", statePath: target, state };
    }
    return { status: "unchanged", statePath: target, state };
  }
  await writeFile(target, canonicalJson(state), { flag: "wx", mode: 0o600 });
  return { status: "recorded", statePath: target, state };
}

export async function loadGlobalInitState({ homeDir }) {
  const home = await assertRealDirectory(homeDir, "User home");
  const target = globalStatePath(home);
  if (!(await pathExists(target))) return null;
  const state = await readRegularJson(target, "Global Init state");
  return validateGlobalInitState(state);
}

export function detectTechnologyStack(manifests, packageManifest = null) {
  const stack = new Set();
  if (
    manifests.some((entry) =>
      ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"].includes(
        entry,
      ),
    )
  ) {
    stack.add("node");
  }
  if (
    manifests.some((entry) =>
      ["pyproject.toml", "requirements.txt"].includes(entry),
    )
  ) {
    stack.add("python");
  }
  if (manifests.includes("go.mod")) stack.add("go");
  if (manifests.includes("Cargo.toml")) stack.add("rust");
  if (
    manifests.some((entry) =>
      ["pom.xml", "build.gradle", "build.gradle.kts"].includes(entry),
    )
  ) {
    stack.add("java");
  }
  const packageText = packageManifest
    ? JSON.stringify(packageManifest).toLowerCase()
    : "";
  for (const framework of ["react", "vue", "next", "nuxt", "svelte"]) {
    if (packageText.includes(`"${framework}`)) stack.add(framework);
  }
  return [...stack].sort((left, right) => left.localeCompare(right));
}

export function recommendProjectSkillsFromCatalog({
  catalog,
  technologyStack,
}) {
  const recommendations = [];
  const stackText = technologyStack.join(" ");
  for (const skill of catalog) {
    const haystack =
      `${skill.name} ${skill.description ?? ""}`.toLocaleLowerCase("en-US");
    const reasons = [];
    for (const technology of technologyStack) {
      if (haystack.includes(technology.toLocaleLowerCase("en-US"))) {
        reasons.push(`matches ${technology}`);
      }
    }
    if (
      /(?:^|-)tdd(?:-|$)|test-driven|testing/.test(haystack) &&
      technologyStack.length > 0
    ) {
      reasons.push(`supports tests for ${stackText}`);
    }
    if (reasons.length > 0) {
      recommendations.push({
        name: skill.name,
        reason: [...new Set(reasons)].join("; "),
      });
    }
  }
  return recommendations.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export const GUIDED_INIT_PROVIDER_NAMES = PROVIDER_NAMES;
