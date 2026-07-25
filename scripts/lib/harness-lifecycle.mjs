import { existsSync } from "node:fs";
import path from "node:path";

const FULL_SHA1 = /^[a-f0-9]{40}$/;
const WINDOWS_NODE_LAUNCHERS = Object.freeze({
  npm: ["node_modules", "npm", "bin", "npm-cli.js"],
  pnpm: ["node_modules", "corepack", "dist", "pnpm.js"],
});
const LIFECYCLE_COMMANDS = new Set([
  "update",
  "rollback",
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

function assertUpdateArguments(result) {
  if (!result.ccgCommit) {
    throw new Error("update requires --ccg-commit <40-character SHA-1>.");
  }
  if (!FULL_SHA1.test(result.ccgCommit)) {
    throw new Error("CCG commit must be a full 40-character SHA-1.");
  }
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

function clonePackageState(value) {
  if (!value) return null;
  return {
    ...(value.version ? { version: String(value.version) } : {}),
    ...(value.resolved ? { resolved: String(value.resolved) } : {}),
  };
}

export function buildBootstrapOwnership(options) {
  const entries = [];
  if (options.managed?.trellis) {
    if (!options.after?.trellis?.version) {
      throw new Error("Managed Trellis installation has no observed version.");
    }
    entries.push({
      id: "trellis-global",
      kind: "npm-global-package",
      package: "@mindfoldhq/trellis",
      version: String(options.after.trellis.version),
      previous: clonePackageState(options.before?.trellis),
    });
  }
  if (options.managed?.ccg) {
    if (!options.after?.ccg?.version) {
      throw new Error("Managed CCG installation has no observed version.");
    }
    entries.push({
      id: "ccg-link",
      kind: "npm-global-link",
      package: "ccg-workflow",
      version: String(options.after.ccg.version),
      sourcePath: path.resolve(options.ccgSourcePath),
      previous: clonePackageState(options.before?.ccg),
    });
  }
  return {
    schemaVersion: 1,
    repoRoot: path.resolve(options.repoRoot),
    updatedAt: new Date().toISOString(),
    entries,
  };
}

export function buildRestoreAction(entry) {
  if (entry.previous?.resolved?.startsWith("file:")) {
    return {
      operation: "install",
      spec: decodeURIComponent(entry.previous.resolved.slice("file:".length)),
    };
  }
  if (entry.previous?.version) {
    return {
      operation: "install",
      spec: `${entry.package}@${entry.previous.version}`,
    };
  }
  return {
    operation: "uninstall",
    spec: entry.package,
  };
}
