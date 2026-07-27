import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const EXACT_VERSION = /^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/;
const SAFE_COMMAND_ENV = new Set([
  "ALL_PROXY",
  "CI",
  "CODEX_HOME",
  "COLORTERM",
  "FORCE_COLOR",
  "GEMINI_HOME",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LANGUAGE",
  "NO_COLOR",
  "NO_PROXY",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]);
const FORBIDDEN_COMMAND_ENV = new Set([
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "TAR_OPTIONS",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left, right, platform = process.platform) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function minimalCommandEnvironment(env = {}) {
  const clean = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    const upper = name.toUpperCase();
    if (
      typeof value !== "string" ||
      FORBIDDEN_COMMAND_ENV.has(upper) ||
      upper.startsWith("DYLD_") ||
      (!SAFE_COMMAND_ENV.has(upper) && !upper.startsWith("LC_"))
    ) {
      continue;
    }
    clean[name] = value;
  }
  return clean;
}

async function regularNonLinkedFile(target, label, { allowHardLinks = false } = {}) {
  const absolute = path.resolve(target);
  const details = await lstat(absolute);
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    (!allowHardLinks && details.nlink > 1)
  ) {
    throw new Error(`${label} must be a regular non-linked file.`);
  }
  return absolute;
}

async function realNonLinkedDirectory(target, label) {
  const absolute = path.resolve(target);
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-linked directory.`);
  }
  const real = path.resolve(await realpath(absolute));
  if (!samePath(absolute, real)) {
    throw new Error(`${label} must not be reached through a linked parent.`);
  }
  return real;
}

async function fileIdentity(target, label, options) {
  const absolute = await regularNonLinkedFile(target, label, options);
  const bytes = await readFile(absolute);
  return {
    path: absolute,
    realPath: path.resolve(await realpath(absolute)),
    size: bytes.length,
    sha256: sha256(bytes),
  };
}

async function nativeBinaryIdentity(target, label, platform) {
  // OS-managed executables are often hard-linked (for example System32 tar or
  // Git's cmd/bin projections). Their containing trusted root and byte digest,
  // rather than link count, establish the command identity.
  const identity = await fileIdentity(target, label, { allowHardLinks: true });
  const bytes = await readFile(identity.path);
  const isPe = bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
  const isElf = bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
  const magic = bytes.length >= 4 ? bytes.readUInt32BE(0) : 0;
  const isMachO = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]).has(magic);
  if ((platform === "win32" && !isPe) || (platform !== "win32" && !isElf && !isMachO)) {
    throw new Error(`${label} is not a trusted native executable.`);
  }
  return identity;
}

async function packageTreeIdentity(packageRoot, label) {
  const root = await realNonLinkedDirectory(packageRoot, `${label} package root`);
  const records = [];
  let totalSize = 0;
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        const linkText = await readlink(target);
        if (path.isAbsolute(linkText)) {
          throw new Error(`${label} package tree contains an absolute symbolic link: ${relative}.`);
        }
        const resolvedTarget = path.resolve(path.dirname(target), linkText);
        const realTarget = path.resolve(await realpath(target));
        if (!inside(root, resolvedTarget) || !inside(root, realTarget)) {
          throw new Error(`${label} package tree link escapes its trusted root: ${relative}.`);
        }
        records.push(
          `l\0${relative}\0${linkText.split(path.sep).join("/")}\0${path.relative(root, realTarget).split(path.sep).join("/")}`,
        );
        continue;
      }
      const real = path.resolve(await realpath(target));
      if (!inside(root, real)) {
        throw new Error(`${label} package tree resolves outside its package: ${relative}.`);
      }
      if (details.isDirectory()) {
        records.push(`d\0${relative}\0${details.mode & 0o777}`);
        await visit(target);
        continue;
      }
      if (!details.isFile() || details.nlink > 1) {
        throw new Error(`${label} package tree contains a non-regular or linked file: ${relative}.`);
      }
      const bytes = await readFile(target);
      totalSize += bytes.length;
      records.push(
        `f\0${relative}\0${details.mode & 0o777}\0${bytes.length}\0${sha256(bytes)}`,
      );
    }
  };
  await visit(root);
  return {
    root: path.resolve(packageRoot),
    realRoot: root,
    entryCount: records.length,
    totalSize,
    treeSha256: sha256(JSON.stringify(records)),
  };
}

async function trustedNodeRuntime(nodePath) {
  if (!samePath(nodePath, process.execPath)) {
    throw new Error("Trusted Node runtime must be the current process.execPath.");
  }
  const node = await fileIdentity(process.execPath, "Trusted Node runtime");
  if (!samePath(node.path, node.realPath)) {
    throw new Error("Trusted Node runtime must not be reached through a link.");
  }
  const installRoot = await realNonLinkedDirectory(
    path.dirname(node.path),
    "Trusted Node installation root",
  );
  if (!inside(installRoot, node.realPath)) {
    throw new Error("Trusted Node runtime escapes its installation root.");
  }
  return { node, installRoot };
}

async function nodePackageCommand({
  node,
  trustedRoot,
  packageRoot,
  packageName,
  binName,
  label,
}) {
  const root = path.resolve(packageRoot);
  let realRoot;
  try {
    realRoot = await realNonLinkedDirectory(root, `${label} package root`);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!inside(trustedRoot, realRoot)) {
    throw new Error(`${label} package root resolves outside its trusted package root.`);
  }
  const packageJsonPath = path.join(root, "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(await regularNonLinkedFile(packageJsonPath, `${label} package identity`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    packageJson?.name !== packageName ||
    !EXACT_VERSION.test(String(packageJson.version ?? ""))
  ) {
    throw new Error(`${label} package identity is not exact.`);
  }
  const bin = packageJson.bin;
  const relativeEntrypoint = typeof bin === "string" ? bin : bin?.[binName];
  if (typeof relativeEntrypoint !== "string" || !relativeEntrypoint) {
    throw new Error(`${label} package has no declared ${binName} entrypoint.`);
  }
  const entrypoint = path.resolve(root, relativeEntrypoint);
  if (!inside(root, entrypoint)) throw new Error(`${label} package entrypoint escapes its package.`);
  const [script, identity, packageTree] = await Promise.all([
    fileIdentity(entrypoint, `${label} entrypoint`),
    fileIdentity(packageJsonPath, `${label} package identity`),
    packageTreeIdentity(trustedRoot, `${label} dependency surface`),
  ]);
  if (
    !inside(realRoot, script.realPath) ||
    !inside(realRoot, identity.realPath)
  ) {
    throw new Error(`${label} package identity or entrypoint resolves outside its package.`);
  }
  return {
    logicalName: binName,
    command: node.realPath,
    argsPrefix: [script.realPath],
    identity: {
      kind: "node-package-bin",
      packageName,
      packageVersion: packageJson.version,
      node,
      entrypoint: script,
      packageJson: identity,
      packageTree,
    },
  };
}

function pathDirectories(env) {
  return String(env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function normalizeApprovedRoots(values, label) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`${label} must be an array of absolute paths.`);
  return values.map((value) => {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new Error(`${label} must contain only absolute paths.`);
    }
    return path.resolve(value);
  });
}

function deduplicatePaths(values, platform) {
  const seen = new Set();
  return values.filter((value) => {
    const resolved = path.resolve(value);
    const key = platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function canonicalApprovedRoots(values, label, platform) {
  const roots = [];
  for (const candidate of deduplicatePaths(
    normalizeApprovedRoots(values, label),
    platform,
  )) {
    roots.push(await realNonLinkedDirectory(candidate, label));
  }
  return roots;
}

async function trustedNodePackageRoots({ node, platform, approvedPackageRoots }) {
  const nodeDirectory = path.dirname(node.path);
  const candidates = [
    ...normalizeApprovedRoots(approvedPackageRoots, "Approved package roots"),
    path.join(nodeDirectory, "node_modules"),
  ];
  if (path.basename(nodeDirectory).toLowerCase() === "bin") {
    candidates.push(path.join(path.dirname(nodeDirectory), "lib", "node_modules"));
  }
  const roots = [];
  for (const candidate of deduplicatePaths(candidates, platform)) {
    try {
      roots.push(await realNonLinkedDirectory(candidate, "Trusted Node package root"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return roots;
}

function packagePath(root, packageName) {
  return path.join(root, ...packageName.split("/"));
}

async function resolveNodePackage({
  nodePath,
  env,
  platform,
  approvedPackageRoots,
  packageName,
  binName,
  label,
}) {
  const runtime = await trustedNodeRuntime(nodePath);
  const roots = await trustedNodePackageRoots({
    node: runtime.node,
    platform,
    approvedPackageRoots,
  });
  for (const root of roots) {
    try {
      const resolved = await nodePackageCommand({
        node: runtime.node,
        trustedRoot: root,
        packageRoot: packagePath(root, packageName),
        packageName,
        binName,
        label,
      });
      if (resolved) return resolved;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function trustedNativeRoots({ platform, approvedCommandRoots }) {
  return canonicalApprovedRoots(
    approvedCommandRoots,
    "Approved native installation root",
    platform,
  );
}

function withinAnyRoot(target, roots) {
  return roots.some((root) => inside(root, target));
}

async function resolveNativeFromTrustedRoots({
  logicalName,
  executableNames,
  env,
  platform,
  approvedCommandRoots,
}) {
  const roots = await trustedNativeRoots({
    platform,
    approvedCommandRoots,
  });
  if (roots.length === 0) {
    throw new Error(`${logicalName} requires an explicitly approved native installation root.`);
  }
  const candidateDirectories = deduplicatePaths(
    [...roots, ...pathDirectories(env)],
    platform,
  );
  for (const directory of candidateDirectories) {
    let realDirectory;
    try {
      realDirectory = await realNonLinkedDirectory(directory, `${logicalName} PATH directory`);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!withinAnyRoot(realDirectory, roots)) continue;
    for (const executableName of executableNames) {
      const executable = path.join(realDirectory, executableName);
      try {
        const binary = await nativeBinaryIdentity(executable, `${logicalName} executable`, platform);
        if (!withinAnyRoot(binary.realPath, roots)) {
          throw new Error(`${logicalName} executable resolves outside its approved installation roots.`);
        }
        return {
          logicalName,
          command: binary.realPath,
          argsPrefix: [],
          identity: {
            kind: "native-binary",
            binary,
          },
        };
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  throw new Error(`Cannot resolve ${logicalName} inside a trusted installation root.`);
}

function executableNamesFor(logicalName, platform) {
  return platform === "win32" ? [`${logicalName}.exe`] : [logicalName];
}

const NODE_PACKAGE_COMMANDS = Object.freeze({
  npm: { packageName: "npm" },
  codex: { packageName: "@openai/codex" },
  gemini: { packageName: "@google/gemini-cli" },
});

export async function discoverTrustedCommandRoots(logicalNames, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const names = [...new Set(logicalNames)].sort();
  const approvedPackageRoots = [];
  const approvedCommandRoots = [];
  for (const directory of pathDirectories(env)) {
    let canonicalDirectory;
    try {
      canonicalDirectory = await realNonLinkedDirectory(
        directory,
        "Discovered command directory",
      );
    } catch {
      continue;
    }
    const packageRoot = path.join(canonicalDirectory, "node_modules");
    for (const name of names) {
      const packageName = NODE_PACKAGE_COMMANDS[name]?.packageName;
      if (!packageName) continue;
      try {
        const packageJson = path.join(
          packagePath(packageRoot, packageName),
          "package.json",
        );
        const details = await lstat(packageJson);
        if (details.isFile() && !details.isSymbolicLink()) {
          approvedPackageRoots.push(packageRoot);
          break;
        }
      } catch {
        // A PATH directory without the requested package is not a candidate.
      }
    }
    for (const name of names) {
      if (NODE_PACKAGE_COMMANDS[name] && name !== "codex") continue;
      for (const executableName of executableNamesFor(name, platform)) {
        try {
          await nativeBinaryIdentity(
            path.join(canonicalDirectory, executableName),
            `${name} discovered executable`,
            platform,
          );
          approvedCommandRoots.push(canonicalDirectory);
          break;
        } catch {
          // Only native executables with a valid host format are proposed.
        }
      }
    }
  }
  return {
    approvedPackageRoots: deduplicatePaths(approvedPackageRoots, platform),
    approvedCommandRoots: deduplicatePaths(approvedCommandRoots, platform),
  };
}

function commandPlanRecord(binding) {
  return {
    status: "bound",
    binding: structuredClone(binding),
  };
}

function commandResolutionReason(error) {
  return String(error?.message ?? error ?? "Command is unavailable.")
    .replace(/\s+/g, " ")
    .slice(0, 320);
}

export async function planTrustedCommands(logicalNames, {
  env = process.env,
  platform = process.platform,
  approvedPackageRoots,
  approvedCommandRoots,
} = {}) {
  const names = [...new Set(logicalNames)].sort();
  const canonicalPackageRoots = await canonicalApprovedRoots(
    approvedPackageRoots,
    "Approved package root",
    platform,
  );
  const canonicalCommandRoots = await canonicalApprovedRoots(
    approvedCommandRoots,
    "Approved command root",
    platform,
  );
  const commands = {};
  const effectivePackageRoots = new Set();
  for (const logicalName of names) {
    try {
      const binding = await resolveTrustedCommand(logicalName, {
        env,
        platform,
        approvedPackageRoots: canonicalPackageRoots,
        approvedCommandRoots: canonicalCommandRoots,
      });
      commands[logicalName] = commandPlanRecord(binding);
      if (binding.identity.kind === "node-package-bin") {
        effectivePackageRoots.add(binding.identity.packageTree.realRoot);
      }
    } catch (error) {
      commands[logicalName] = {
        status: "manual-pending",
        reason: commandResolutionReason(error),
      };
    }
  }
  return {
    schemaVersion: 1,
    platform,
    approvedPackageRoots: canonicalPackageRoots,
    approvedCommandRoots: canonicalCommandRoots,
    effectivePackageRoots: [...effectivePackageRoots].sort(),
    commands,
  };
}

async function resolveNpm({ nodePath, env, platform, approvedPackageRoots }) {
  const resolved = await resolveNodePackage({
    nodePath,
    env,
    platform,
    approvedPackageRoots,
    packageName: "npm",
    binName: "npm",
    label: "npm CLI",
  });
  if (resolved) return resolved;
  throw new Error("Cannot resolve npm from the trusted Node installation roots.");
}

async function resolveCodex({
  nodePath,
  env,
  platform,
  approvedPackageRoots,
  approvedCommandRoots,
}) {
  const resolved = await resolveNodePackage({
    nodePath,
    env,
    platform,
    approvedPackageRoots,
    packageName: "@openai/codex",
    binName: "codex",
    label: "Codex CLI",
  });
  if (resolved) return resolved;
  return resolveNativeFromTrustedRoots({
    logicalName: "codex",
    executableNames: [platform === "win32" ? "codex.exe" : "codex"],
    env,
    platform,
    approvedCommandRoots,
  });
}

async function resolveGemini({ nodePath, env, platform, approvedPackageRoots }) {
  const resolved = await resolveNodePackage({
    nodePath,
    env,
    platform,
    approvedPackageRoots,
    packageName: "@google/gemini-cli",
    binName: "gemini",
    label: "Gemini CLI",
  });
  if (resolved) return resolved;
  throw new Error("Cannot resolve Gemini from a trusted Node package root.");
}

async function resolveGrok({ env, platform, approvedCommandRoots }) {
  return resolveNativeFromTrustedRoots({
    logicalName: "grok",
    executableNames: [platform === "win32" ? "grok.exe" : "grok"],
    env,
    platform,
    approvedCommandRoots,
  });
}

async function resolveSystemTool(logicalName, { env, platform, approvedCommandRoots }) {
  const executableNames = platform === "win32"
    ? [`${logicalName}.exe`]
    : [logicalName];
  return resolveNativeFromTrustedRoots({
    logicalName,
    executableNames,
    env,
    platform,
    approvedCommandRoots,
  });
}

export async function resolveTrustedCommand(logicalName, {
  env = process.env,
  platform = process.platform,
  nodePath = process.execPath,
  approvedPackageRoots,
  approvedCommandRoots,
} = {}) {
  if (logicalName === "npm") {
    return resolveNpm({ nodePath, env, platform, approvedPackageRoots });
  }
  if (logicalName === "codex") {
    return resolveCodex({
      nodePath,
      env,
      platform,
      approvedPackageRoots,
      approvedCommandRoots,
    });
  }
  if (logicalName === "gemini") {
    return resolveGemini({ nodePath, env, platform, approvedPackageRoots });
  }
  if (logicalName === "grok") {
    return resolveGrok({ env, platform, approvedCommandRoots });
  }
  if (
    logicalName === "git" ||
    logicalName === "powershell" ||
    logicalName === "pwsh" ||
    logicalName === "tar"
  ) {
    return resolveSystemTool(logicalName, { env, platform, approvedCommandRoots });
  }
  throw new Error(`Unsupported trusted command: ${logicalName}.`);
}

/*
 * The resolvers above intentionally do not treat arbitrary PATH entries as
 * trust anchors. PATH is used only to find candidates that are already under a
 * standard OS/Node installation root or an explicit caller-approved root.
 */

async function assertIdentityFile(current, label, options) {
  const actual = await fileIdentity(current.path, label, options);
  if (
    actual.realPath !== current.realPath ||
    actual.size !== current.size ||
    actual.sha256 !== current.sha256
  ) {
    throw new Error(`${label} changed after the command plan was bound.`);
  }
}

async function assertPackageTreeUnchanged(current, label) {
  const actual = await packageTreeIdentity(current.root, label);
  if (
    !samePath(actual.realRoot, current.realRoot) ||
    actual.entryCount !== current.entryCount ||
    actual.totalSize !== current.totalSize ||
    actual.treeSha256 !== current.treeSha256
  ) {
    throw new Error(`${label} changed after the command plan was bound.`);
  }
}

export async function assertTrustedCommandUnchanged(binding) {
  if (binding.identity.kind === "node-package-bin") {
    await assertIdentityFile(binding.identity.node, `${binding.logicalName} Node runtime`);
    await assertIdentityFile(binding.identity.entrypoint, `${binding.logicalName} entrypoint`);
    await assertIdentityFile(binding.identity.packageJson, `${binding.logicalName} package identity`);
    await assertPackageTreeUnchanged(
      binding.identity.packageTree,
      `${binding.logicalName} package tree`,
    );
    return;
  }
  if (binding.identity.kind === "native-binary") {
    await assertIdentityFile(
      binding.identity.binary,
      `${binding.logicalName} executable`,
      { allowHardLinks: true },
    );
    return;
  }
  throw new Error(`${binding.logicalName} has an unsupported trusted command identity.`);
}

function boundCommandSet(bindings, baseEnvironment) {
  return {
    identities: Object.fromEntries(
      Object.entries(bindings).map(([name, binding]) => [name, binding.identity]),
    ),
    bindings: structuredClone(bindings),
    async run(logicalName, args, execOptions = {}) {
      const binding = bindings[logicalName];
      if (!binding) throw new Error(`Command ${logicalName} was not part of the approved command plan.`);
      if (execOptions.shell !== undefined && execOptions.shell !== false) {
        throw new Error("Trusted command execution forbids shell mode.");
      }
      await assertTrustedCommandUnchanged(binding);
      const { env: requestedEnvironment = {}, ...safeExecOptions } = execOptions;
      const commandEnvironment = minimalCommandEnvironment({
        ...baseEnvironment,
        ...requestedEnvironment,
      });
      return execFile(
        binding.command,
        [...binding.argsPrefix, ...args],
        {
          ...safeExecOptions,
          env: commandEnvironment,
          shell: false,
          windowsHide: true,
        },
      );
    },
  };
}

export async function bindPlannedTrustedCommands(commandPlan, {
  env = process.env,
  platform = process.platform,
} = {}) {
  if (
    !commandPlan ||
    commandPlan.schemaVersion !== 1 ||
    commandPlan.platform !== platform ||
    !commandPlan.commands ||
    typeof commandPlan.commands !== "object" ||
    Array.isArray(commandPlan.commands)
  ) {
    throw new Error("Trusted command plan is invalid for the current platform.");
  }
  const names = Object.keys(commandPlan.commands).sort();
  const current = await planTrustedCommands(names, {
    env,
    platform,
    approvedPackageRoots: commandPlan.approvedPackageRoots,
    approvedCommandRoots: commandPlan.approvedCommandRoots,
  });
  if (JSON.stringify(current) !== JSON.stringify(commandPlan)) {
    throw new Error("Trusted command identities or canonical roots drifted after approval.");
  }
  const bindings = {};
  const unavailable = {};
  for (const name of names) {
    const record = commandPlan.commands[name];
    if (record.status === "bound") {
      bindings[name] = structuredClone(record.binding);
      await assertTrustedCommandUnchanged(bindings[name]);
    } else {
      unavailable[name] = record.reason;
    }
  }
  return {
    ...boundCommandSet(bindings, minimalCommandEnvironment(env)),
    unavailable,
  };
}

export async function bindTrustedCommands(logicalNames, options = {}) {
  const bindings = {};
  const baseEnvironment = minimalCommandEnvironment(options.env ?? process.env);
  for (const logicalName of [...new Set(logicalNames)]) {
    bindings[logicalName] = await resolveTrustedCommand(logicalName, options);
  }
  return boundCommandSet(bindings, baseEnvironment);
}
