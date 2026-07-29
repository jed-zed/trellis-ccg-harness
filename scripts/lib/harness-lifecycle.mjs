import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  buildContentIdentity,
  contentIdentitiesEqual,
} from "./harness-fs.mjs";

const FULL_SHA1 = /^[a-f0-9]{40}$/;
const NUMERIC_IDENTIFIER = String.raw`(?:0|[1-9]\d*)`;
const TEXT_IDENTIFIER =
  String.raw`(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const PRERELEASE_IDENTIFIER =
  `(?:${NUMERIC_IDENTIFIER}|${TEXT_IDENTIFIER})`;
const SEMANTIC_VERSION = new RegExp(
  `^(${NUMERIC_IDENTIFIER})\\.(${NUMERIC_IDENTIFIER})\\.`
    + `(${NUMERIC_IDENTIFIER})(?:-((?:${PRERELEASE_IDENTIFIER})`
    + `(?:\\.${PRERELEASE_IDENTIFIER})*))?$`,
);
const WINDOWS_NODE_LAUNCHERS = Object.freeze({
  npm: ["node_modules", "npm", "bin", "npm-cli.js"],
  pnpm: ["node_modules", "corepack", "dist", "pnpm.js"],
});
const LIFECYCLE_COMMANDS = new Set([
  "update",
  "rollback",
  "recover",
  "uninstall",
  "bootstrap-begin",
  "bootstrap-complete",
  "bootstrap-abort",
]);

export function parseSparseArchiveExclusions(value) {
  const exclusions = [];
  for (const rawLine of String(value ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("!")) continue;
    if (!line.startsWith("!/")) {
      throw new Error(
        `Sparse archive exclusions must use repository-rooted literal paths: ${line}`,
      );
    }
    const relativePath = line.slice(2).replaceAll("\\", "/");
    if (
      !relativePath ||
      /[*?[\]\x00-\x1f\x7f]/.test(relativePath) ||
      path.posix.isAbsolute(relativePath)
    ) {
      throw new Error(
        `Sparse archive exclusions must be literal paths: ${line}`,
      );
    }
    const normalized = path.posix.normalize(relativePath);
    if (
      normalized !== relativePath ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new Error(`Sparse archive exclusion would escape the source tree: ${line}`);
    }
    exclusions.push(normalized);
  }
  return [...new Set(exclusions)].sort();
}

export function assertSparseExclusionsUnchanged(exclusions, changedPaths) {
  if (exclusions.length > 0) {
    throw new Error(
      "Full component replacement cannot preserve sparse archive "
      + `exclusions; refusing update: ${exclusions.join(", ")}.`,
    );
  }
  const changed = new Set(
    (changedPaths ?? [])
      .map((value) => String(value).trim().replaceAll("\\", "/"))
      .filter(Boolean),
  );
  const violations = exclusions.filter(
    (excluded) =>
      changed.has(excluded) ||
      [...changed].some((entry) => entry.startsWith(`${excluded}/`)),
  );
  if (violations.length > 0) {
    throw new Error(
      `A sparse-excluded path changed in the target commit: ${violations.join(", ")}.`,
    );
  }
  return [...exclusions];
}

export function assertNoIgnoredComponentState(paths) {
  const ignored = [...new Set(
    (paths ?? [])
      .map((value) => String(value).trim().replaceAll("\\", "/"))
      .filter(Boolean),
  )].sort();
  if (ignored.length > 0) {
    const preview = ignored.slice(0, 10).join(", ");
    const suffix = ignored.length > 10
      ? `, and ${ignored.length - 10} more`
      : "";
    throw new Error(
      "Refusing CCG replacement because ignored live component state "
      + `cannot be preserved transactionally: ${preview}${suffix}.`,
    );
  }
  return ignored;
}

export function resolvePackageManagerInvocation(
  command,
  args,
  options = {},
) {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const fileExists = options.fileExists ?? existsSync;
  const launcher = WINDOWS_NODE_LAUNCHERS[command];
  if (platform !== "win32" || !launcher) {
    return { command, args };
  }

  const cliPath = path.win32.join(
    path.win32.dirname(execPath),
    ...launcher,
  );
  if (!fileExists(cliPath)) {
    throw new Error(
      `Could not locate the Windows ${command} CLI beside Node.js: ${cliPath}`,
    );
  }
  return {
    command: execPath,
    args: [cliPath, ...args],
  };
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function applyLifecycleOption(result, args, index, command) {
  const option = args[index];
  if (option === "--repo-root") {
    result.repoRoot = path.resolve(requireValue(args, index, option));
    return index + 1;
  }
  if (option === "--ccg-commit") {
    result.ccgCommit = requireValue(args, index, option).toLowerCase();
    return index + 1;
  }
  if (option === "--trellis-version") {
    result.trellisVersion = requireValue(args, index, option);
    return index + 1;
  }
  if (option === "--source-checkout") {
    result.sourceCheckout = path.resolve(requireValue(args, index, option));
    return index + 1;
  }
  if (option === "--manage-trellis") {
    result.manageTrellis = true;
    return index;
  }
  if (option === "--manage-ccg") {
    result.manageCcg = true;
    return index;
  }
  throw new Error(`Unknown option for ${command}: ${option}`);
}

function assertCcgUpdateArguments(result) {
  if (result.ccgCommit !== null && !FULL_SHA1.test(result.ccgCommit)) {
    throw new Error("CCG commit must be a full 40-character SHA-1.");
  }
  if (result.ccgCommit === null && result.sourceCheckout === null) {
    throw new Error(
      "CCG update requires --source-checkout <clean-checkout> or "
      + "--ccg-commit <40-character SHA-1>.",
    );
  }
}

function assertTrellisUpdateArguments(result) {
  if (!SEMANTIC_VERSION.test(result.trellisVersion)) {
    throw new Error("Trellis version must be an exact semantic version.");
  }
  if (result.sourceCheckout) {
    throw new Error("--source-checkout is only valid for a CCG update.");
  }
}

function assertUpdateArguments(result) {
  const targets = [
    result.ccgCommit || result.sourceCheckout ? "ccg" : null,
    result.trellisVersion ? "trellis" : null,
  ].filter(Boolean);
  if (targets.length === 0) {
    throw new Error(
      "update requires --source-checkout <clean-checkout>, "
      + "--ccg-commit <40-character SHA-1>, or "
      + "--trellis-version <semantic-version>.",
    );
  }
  if (targets.length > 1) {
    throw new Error(
      "Update one source per separate transaction; do not combine CCG and Trellis targets.",
    );
  }
  if (targets[0] === "ccg") return assertCcgUpdateArguments(result);
  return assertTrellisUpdateArguments(result);
}

export function parseLifecycleArgs(argv) {
  const [command, ...args] = argv;
  if (!LIFECYCLE_COMMANDS.has(command)) {
    throw new Error(`Unknown Harness lifecycle command: ${command ?? "(missing)"}.`);
  }

  const result = {
    command,
    repoRoot: process.cwd(),
    ccgCommit: null,
    trellisVersion: null,
    sourceCheckout: null,
    manageTrellis: false,
    manageCcg: false,
  };
  for (let index = 0; index < args.length; index++) {
    index = applyLifecycleOption(result, args, index, command);
  }

  result.repoRoot = path.resolve(result.repoRoot);
  if (command === "update") assertUpdateArguments(result);
  return result;
}

function parseSemanticVersion(value) {
  const match = SEMANTIC_VERSION.exec(String(value));
  if (!match) {
    throw new Error(`Invalid semantic version: ${value}.`);
  }
  return {
    core: match.slice(1, 4),
    prerelease: match[4] ? match[4].split(".") : null,
  };
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareCoreIdentifiers(a, b) {
  for (let index = 0; index < 3; index++) {
    const compared = compareNumericIdentifiers(a.core[index], b.core[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return compareNumericIdentifiers(left, right);
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : 1;
}

function comparePrereleaseIdentifiers(a, b) {
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    return comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
  }
  return 0;
}

export function compareSemanticVersions(left, right) {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  return compareCoreIdentifiers(a, b) || comparePrereleaseIdentifiers(a, b);
}

export function updateTrellisProvenanceText(
  readme,
  previousVersion,
  nextVersion,
) {
  if (
    !SEMANTIC_VERSION.test(String(previousVersion)) ||
    !SEMANTIC_VERSION.test(String(nextVersion))
  ) {
    throw new Error("Trellis provenance versions must be exact semantic versions.");
  }
  const marker = `@mindfoldhq/trellis@${previousVersion}`;
  const occurrences = String(readme).split(marker).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `README must contain the previous Trellis provenance marker exactly once; found ${occurrences}.`,
    );
  }
  return String(readme).replace(
    marker,
    `@mindfoldhq/trellis@${nextVersion}`,
  );
}

function normalizeRepository(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error(`${label} must be a credential-free HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL.`);
  }
  return parsed.href.replace(/\.git\/?$/i, "").replace(/\/$/, "").toLowerCase();
}

function assertSha(value, label) {
  const normalized = String(value).toLowerCase();
  if (!FULL_SHA1.test(normalized)) {
    throw new Error(`${label} must be a full 40-character SHA-1.`);
  }
  return normalized;
}

export function validateUpdateSource({ expected, actual }) {
  const expectedRepository = normalizeRepository(
    expected.repository,
    "Expected repository",
  );
  const actualRepository = normalizeRepository(
    actual.repository,
    "Actual repository",
  );
  if (actualRepository !== expectedRepository) {
    throw new Error(
      `Authoritative repository mismatch: expected ${expected.repository}, got ${actual.repository}.`,
    );
  }

  const expectedCommit = assertSha(expected.commit, "Expected commit");
  const actualCommit = assertSha(actual.commit, "Actual commit");
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `Authoritative commit mismatch: expected ${expectedCommit}, got ${actualCommit}.`,
    );
  }

  const expectedTree = assertSha(expected.gitTree, "Expected Git tree");
  const actualTree = assertSha(actual.gitTree, "Actual Git tree");
  if (actualTree !== expectedTree) {
    throw new Error(
      `Authoritative Git tree mismatch: expected ${expectedTree}, got ${actualTree}.`,
    );
  }

  return {
    repository: expected.repository,
    commit: expectedCommit,
    gitTree: expectedTree,
  };
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value)).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function packageEntryPath(globalRoot, packageName) {
  if (!["ccg-workflow", "@mindfoldhq/trellis"].includes(packageName)) {
    throw new Error(`Unsupported global package: ${packageName}.`);
  }
  return path.join(path.resolve(globalRoot), ...packageName.split("/"));
}

export function globalPackageRootFromNpmPrefix(prefix, options = {}) {
  const configuredPrefix = String(prefix ?? "").trim();
  if (!configuredPrefix) return null;
  if (configuredPrefix.includes("\0")) {
    throw new Error("NPM global prefix must not contain a NUL character.");
  }
  const canonicalPrefix = path.resolve(configuredPrefix);
  return options.platform === "win32"
    ? path.join(canonicalPrefix, "node_modules")
    : path.join(canonicalPrefix, "lib", "node_modules");
}

function filesystemIdentity(details) {
  return {
    dev: String(details.dev),
    ino: String(details.ino),
    birthtimeNs: String(details.birthtimeNs),
  };
}

export async function inspectGlobalPackage(globalRoot, packageName) {
  const entryPath = packageEntryPath(globalRoot, packageName);
  let entryDetails;
  try {
    entryDetails = await lstat(entryPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!entryDetails.isDirectory() && !entryDetails.isSymbolicLink()) {
    throw new Error(`Global package entry is not a directory or link: ${entryPath}`);
  }
  const canonicalPath = await realpath(entryPath);
  const packageBytes = await readFile(path.join(canonicalPath, "package.json"));
  const manifest = JSON.parse(packageBytes.toString("utf8"));
  if (
    manifest.name !== packageName ||
    typeof manifest.version !== "string" ||
    manifest.version.length === 0
  ) {
    throw new Error(`Global package manifest is invalid: ${entryPath}`);
  }
  const isLink = entryDetails.isSymbolicLink();
  const contentIdentity = isLink
    ? null
    : await buildContentIdentity(canonicalPath);
  return {
    version: manifest.version,
    entryPath: path.resolve(entryPath),
    entryIdentity: filesystemIdentity(entryDetails),
    packageJsonSha256: createHash("sha256").update(packageBytes).digest("hex"),
    ...(isLink
      ? { sourcePath: path.resolve(canonicalPath) }
      : { contentIdentity }),
  };
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

export function validateGlobalPackageSnapshot(value, label = "Global package") {
  if (value === null) return value;
  assertExactKeys(
    value,
    ["version", "entryPath", "entryIdentity", "packageJsonSha256"],
    ["sourcePath", "contentIdentity"],
    label,
  );
  assertExactKeys(
    value.entryIdentity,
    ["dev", "ino", "birthtimeNs"],
    [],
    `${label} filesystem identity`,
  );
  if (
    typeof value.version !== "string" ||
    !path.isAbsolute(value.entryPath) ||
    (value.sourcePath !== undefined && !path.isAbsolute(value.sourcePath)) ||
    !["dev", "ino", "birthtimeNs"].every(
      (key) => /^\d+$/.test(value.entryIdentity[key]),
    ) ||
    !/^[a-f0-9]{64}$/.test(value.packageJsonSha256)
  ) {
    throw new Error(`${label} fingerprint is invalid.`);
  }
  if (value.sourcePath !== undefined) {
    if (value.contentIdentity !== undefined) {
      throw new Error(
        `${label} link fingerprint cannot include a copied tree identity.`,
      );
    }
  } else {
    assertExactKeys(
      value.contentIdentity,
      ["algorithm", "digest", "entryCount"],
      [],
      `${label} content identity`,
    );
    if (
      value.contentIdentity.algorithm !== "sha256-tree-v1" ||
      !/^[a-f0-9]{64}$/.test(value.contentIdentity.digest) ||
      !Number.isSafeInteger(value.contentIdentity.entryCount) ||
      value.contentIdentity.entryCount < 1
    ) {
      throw new Error(`${label} content identity is invalid.`);
    }
  }
  return value;
}

export function globalPackageSnapshotsEqual(left, right) {
  if (left === null || right === null) return left === right;
  validateGlobalPackageSnapshot(left, "Left global package");
  validateGlobalPackageSnapshot(right, "Right global package");
  const sameEntry = (
    normalizedPath(left.entryPath) === normalizedPath(right.entryPath) &&
    left.entryIdentity.dev === right.entryIdentity.dev &&
    left.entryIdentity.ino === right.entryIdentity.ino &&
    left.entryIdentity.birthtimeNs === right.entryIdentity.birthtimeNs
  );
  if (left.sourcePath !== undefined || right.sourcePath !== undefined) {
    return (
      sameEntry &&
      left.sourcePath !== undefined &&
      right.sourcePath !== undefined &&
      normalizedPath(left.sourcePath) === normalizedPath(right.sourcePath)
    );
  }
  return (
    sameEntry &&
    left.version === right.version &&
    left.packageJsonSha256 === right.packageJsonSha256 &&
    contentIdentitiesEqual(left.contentIdentity, right.contentIdentity)
  );
}

export function assertManagedCcgRuntimePackage(ownershipEntry, observed) {
  if (
    ownershipEntry?.id !== "ccg-link" ||
    ownershipEntry.kind !== "npm-global-package" ||
    !observed ||
    observed.sourcePath !== undefined
  ) {
    throw new Error(
      "Harness-owned global CCG runtime must remain a packaged installation.",
    );
  }
  return observed;
}

function buildOwnershipEntry({
  id,
  kind,
  packageName,
  before,
  after,
  previousEntry,
}) {
  validateGlobalPackageSnapshot(before, `${id} previous package`);
  validateGlobalPackageSnapshot(after, `${id} installed package`);
  if (!after) {
    throw new Error(`Managed global package is missing after bootstrap: ${id}.`);
  }
  if (
    previousEntry &&
    !globalPackageSnapshotsEqual(
      before,
      previousEntry.installedByHarness,
    )
  ) {
    throw new Error(
      `Global package ${id} changed after Harness management; refusing adoption.`,
    );
  }
  return {
    id,
    kind,
    package: packageName,
    originalBeforeFirstManagement: previousEntry
      ? previousEntry.originalBeforeFirstManagement
      : before,
    installedByHarness: after,
  };
}

function canMigrateLegacyCcgLink(entry, observed, ccgSourcePath) {
  return (
    entry?.id === "ccg-link" &&
    entry.kind === "npm-global-link" &&
    entry.package === "ccg-workflow" &&
    entry.installedByHarness?.sourcePath !== undefined &&
    observed?.sourcePath !== undefined &&
    normalizedPath(entry.installedByHarness.sourcePath) ===
      normalizedPath(ccgSourcePath) &&
    normalizedPath(observed.sourcePath) === normalizedPath(ccgSourcePath) &&
    normalizedPath(entry.installedByHarness.entryPath) ===
      normalizedPath(observed.entryPath)
  );
}

export function buildBootstrapOwnership(options) {
  const entries = [];
  const previousById = new Map(
    (options.existingOwnership?.entries ?? []).map((entry) => [
      entry.id,
      entry,
    ]),
  );
  if (options.managed?.trellis) {
    if (
      options.before?.trellis &&
      !previousById.has("trellis-global")
    ) {
      throw new Error(
        "Refusing first-time adoption of a pre-existing ordinary Trellis "
        + "global package because Harness cannot exactly restore a patched "
        + "baseline.",
      );
    }
    entries.push(buildOwnershipEntry({
      id: "trellis-global",
      kind: "npm-global-package",
      packageName: "@mindfoldhq/trellis",
      before: options.before?.trellis ?? null,
      after: options.after?.trellis ?? null,
      previousEntry: previousById.get("trellis-global"),
    }));
  }
  if (options.managed?.ccg) {
    if (!options.after?.ccg || options.after.ccg.sourcePath !== undefined) {
      throw new Error(
        "Managed global CCG package must be a packaged installation, not a link to the Harness component.",
      );
    }
    const recordedCcg = previousById.get("ccg-link");
    const previousCcg = canMigrateLegacyCcgLink(
      recordedCcg,
      options.before?.ccg,
      options.ccgSourcePath,
    )
      ? {
          ...recordedCcg,
          installedByHarness: options.before.ccg,
        }
      : recordedCcg;
    entries.push(buildOwnershipEntry({
      id: "ccg-link",
      kind: "npm-global-package",
      packageName: "ccg-workflow",
      before: options.before?.ccg ?? null,
      after: options.after?.ccg ?? null,
      previousEntry: previousCcg,
    }));
  }
  return {
    schemaVersion: 2,
    repoRoot: path.resolve(options.repoRoot),
    updatedAt: new Date().toISOString(),
    entries,
  };
}

export function buildRestoreAction(entry) {
  validateOwnershipEntry(entry);
  const original = entry.originalBeforeFirstManagement;
  if (original?.sourcePath) {
    return {
      operation: "install",
      spec: original.sourcePath,
    };
  }
  if (original?.version) {
    throw new Error(
      `Harness cannot exactly restore the pre-existing ordinary package `
      + `${entry.package}; refusing version-only rollback.`,
    );
  }
  return {
    operation: "uninstall",
    spec: entry.package,
  };
}

function validateOwnershipEntry(entry) {
  assertExactKeys(
    entry,
    [
      "id",
      "kind",
      "package",
      "originalBeforeFirstManagement",
      "installedByHarness",
    ],
    [],
    "Harness ownership entry",
  );
  const expected = {
    "trellis-global": {
      kind: "npm-global-package",
      package: "@mindfoldhq/trellis",
    },
    "ccg-link": {
      kinds: new Set(["npm-global-link", "npm-global-package"]),
      package: "ccg-workflow",
    },
  }[entry.id];
  if (
    !expected ||
    (expected.kind !== undefined && entry.kind !== expected.kind) ||
    (expected.kinds !== undefined && !expected.kinds.has(entry.kind)) ||
    entry.package !== expected.package
  ) {
    throw new Error("Harness ownership entry target is invalid.");
  }
  validateGlobalPackageSnapshot(
    entry.originalBeforeFirstManagement,
    `${entry.id} original package`,
  );
  validateGlobalPackageSnapshot(
    entry.installedByHarness,
    `${entry.id} installed package`,
  );
  if (
    entry.id === "ccg-link" &&
    (
      (entry.kind === "npm-global-link" &&
        entry.installedByHarness.sourcePath === undefined) ||
      (entry.kind === "npm-global-package" &&
        entry.installedByHarness.sourcePath !== undefined)
    )
  ) {
    throw new Error(
      "Harness CCG ownership kind does not match the installed package shape.",
    );
  }
  return entry;
}

export function validateBootstrapOwnership(value, repoRoot) {
  assertExactKeys(
    value,
    ["schemaVersion", "repoRoot", "updatedAt", "entries"],
    [],
    "Harness ownership",
  );
  if (
    value.schemaVersion !== 2 ||
    normalizedPath(value.repoRoot) !== normalizedPath(repoRoot) ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("Harness ownership record is invalid or unsupported.");
  }
  const ids = new Set();
  for (const entry of value.entries) {
    validateOwnershipEntry(entry);
    if (ids.has(entry.id)) {
      throw new Error(`Harness ownership contains duplicate target ${entry.id}.`);
    }
    ids.add(entry.id);
  }
  return value;
}

export function assertBootstrapOwnershipContinuity(
  ownership,
  before,
  managed,
  repoRoot,
) {
  validateBootstrapOwnership(ownership, repoRoot);
  const beforeById = {
    "trellis-global": before?.trellis ?? null,
    "ccg-link": before?.ccg ?? null,
  };
  const selected = new Set([
    ...(managed?.trellis ? ["trellis-global"] : []),
    ...(managed?.ccg ? ["ccg-link"] : []),
  ]);
  if (
    managed?.trellis &&
    before?.trellis &&
    !ownership.entries.some((entry) => entry.id === "trellis-global")
  ) {
    throw new Error(
      "Refusing first-time adoption of a pre-existing ordinary Trellis "
      + "global package because Harness cannot exactly restore its baseline.",
    );
  }
  for (const entry of ownership.entries) {
    if (
      selected.has(entry.id) &&
      !globalPackageSnapshotsEqual(
        beforeById[entry.id],
        entry.installedByHarness,
      ) &&
      !(
        entry.id === "ccg-link" &&
        canMigrateLegacyCcgLink(
          entry,
          beforeById[entry.id],
          path.join(repoRoot, "components", "ccg-workflow"),
        )
      )
    ) {
      throw new Error(
        `Global package ${entry.id} changed after Harness management; refusing bootstrap.`,
      );
    }
  }
}

export function buildOwnedUninstallPlan(ownership, observations, repoRoot) {
  validateBootstrapOwnership(ownership, repoRoot);
  const remove = [];
  const skip = [];
  for (const entry of ownership.entries) {
    const observed = observations?.[entry.id] ?? null;
    (
      globalPackageSnapshotsEqual(observed, entry.installedByHarness)
        ? remove
        : skip
    ).push(entry);
  }
  return { remove, skip };
}
