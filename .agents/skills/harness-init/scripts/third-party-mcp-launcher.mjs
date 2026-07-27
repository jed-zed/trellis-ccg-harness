import { createHash } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fingerprintPinnedNpmTool } from "./third-party-global-actions.mjs";
import { minimalCommandEnvironment } from "./trusted-command-resolver.mjs";

const OWNER = "trellis-ccg-harness";
const CANDIDATE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const HEX_64 = /^[a-f0-9]{64}$/i;
const DEFAULT_SOURCE_MANIFEST = fileURLToPath(new URL("../assets/third-party-sources.json", import.meta.url));

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(root, target, label) {
  if (!inside(root, target)) throw new Error(`${label} escapes its approved root.`);
}

function assertAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.resolve(value);
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !HEX_64.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value.toLowerCase();
}

async function lstatRequired(target, label) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  }
}

async function realNonLinkedDirectory(target, label) {
  const details = await lstatRequired(target, label);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-linked directory.`);
  }
  // Canonicalizing an OS-managed linked ancestor is safe because every
  // subsequent ownership and containment check uses this physical root.
  // The Harness home itself and all managed descendants are still checked for
  // links before they are read or executed.
  return path.resolve(await realpath(target));
}

function mapPathBelowRoot(root, target, label, { rootAliases = [] } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = assertAbsolutePath(target, label);
  let relative = null;
  for (const candidateRoot of [resolvedRoot, ...rootAliases.map((value) => path.resolve(value))]) {
    if (inside(candidateRoot, resolvedTarget)) {
      relative = path.relative(candidateRoot, resolvedTarget);
      break;
    }
  }
  if (relative === null) throw new Error(`${label} escapes its approved root.`);
  return path.resolve(resolvedRoot, relative);
}

async function assertRealPathBelow(root, target, label, options = {}) {
  const resolvedRoot = path.resolve(root);
  const canonicalTarget = mapPathBelowRoot(root, target, label, options);
  const relative = path.relative(resolvedRoot, canonicalTarget);
  let current = resolvedRoot;
  const rootDetails = await lstatRequired(current, "Harness home");
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error("Harness home must be a real non-linked directory.");
  }
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const details = await lstatRequired(current, label);
    if (details.isSymbolicLink()) throw new Error(`${label} contains a symbolic link or reparse point.`);
  }
  return current;
}

async function readRegularJson(target, label) {
  const details = await lstatRequired(target, label);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-linked file.`);
  }
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON.`);
    throw error;
  }
}

async function readTrustedMcpCandidate({ manifestPath, candidateId, manifestDigest }) {
  const manifest = await readRegularJson(manifestPath, "Third-party MCP source manifest");
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.owner !== OWNER ||
    !Array.isArray(manifest.sources) ||
    !Array.isArray(manifest.candidates)
  ) {
    throw new Error("Third-party MCP source manifest is invalid.");
  }
  if (sha256(canonicalJson(manifest)) !== manifestDigest) {
    throw new Error("Third-party MCP source manifest digest does not match ownership.");
  }
  const candidate = manifest.candidates.find((entry) => entry?.id === candidateId);
  if (!candidate || candidate.group !== "mcp-cli") {
    throw new Error(`Candidate ${candidateId} is not authorized by the trusted MCP manifest.`);
  }
  const source = manifest.sources.find((entry) => entry?.id === candidate.sourceId);
  if (!source || typeof source.release !== "string" || !/^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(source.release)) {
    throw new Error(`Candidate ${candidateId} has no immutable package release in the trusted MCP manifest.`);
  }
  if (typeof candidate.packageSelector !== "string" || typeof candidate.entrypoint !== "string" || !candidate.entrypoint) {
    throw new Error(`Candidate ${candidateId} has an invalid package entrypoint in the trusted MCP manifest.`);
  }
  if (typeof source.packageIntegrity !== "string" || !source.packageIntegrity.startsWith("sha512-")) {
    throw new Error(`Candidate ${candidateId} has no pinned package integrity in the trusted MCP manifest.`);
  }
  if (
    typeof source.packageLock?.path !== "string" ||
    !HEX_64.test(String(source.packageLock?.sha256 ?? "")) ||
    source.packageLock?.lockfileVersion !== 3 ||
    !Number.isSafeInteger(source.packageLock?.packageCount) ||
    source.packageLock.packageCount < 1
  ) {
    throw new Error(`Candidate ${candidateId} has no complete pinned package lock in the trusted MCP manifest.`);
  }
  return { candidate, source };
}

function parseExactPackageSelector(selector) {
  const match = /^(?<name>(?:@[^/@]+\/)?[^@/]+)@(?<version>\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?)$/.exec(selector);
  if (!match?.groups) throw new Error("Pinned package selector is not exact and immutable.");
  return match.groups;
}

/**
 * This is byte-for-byte compatible with third-party-global-actions.mjs's
 * `fingerprintPinnedNpmTool` policy.  Npm's unused `.bin` shims are the sole
 * permitted links; the wrapper never invokes them.
 */
export async function fingerprintPinnedMcpTree(root) {
  return fingerprintPinnedNpmTool(root);
}

async function verifyOwnedNodeMcp({
  homeDir,
  homeAliases = [],
  candidateId,
  ownership,
  manifestPath,
}) {
  if (
    ownership?.schemaVersion !== 1 ||
    ownership.owner !== OWNER ||
    !ownership.actions ||
    typeof ownership.actions !== "object" ||
    Array.isArray(ownership.actions)
  ) {
    throw new Error("Third-party MCP ownership record is invalid.");
  }

  const manifestDigest = assertDigest(ownership.sourceManifestSha256, "Ownership source manifest digest");
  const action = ownership.actions[candidateId];
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error(`Candidate ${candidateId} is not authorized by Harness ownership.`);
  }
  if (action.packageInstalled !== true || action.mcpConfigured !== true) {
    throw new Error(`Candidate ${candidateId} was not explicitly approved and configured as an MCP.`);
  }
  if (assertDigest(action.sourceManifestSha256, "Candidate source manifest digest") !== manifestDigest) {
    throw new Error(`Candidate ${candidateId} source manifest digest does not match ownership.`);
  }
  const { candidate, source } = await readTrustedMcpCandidate({ manifestPath, candidateId, manifestDigest });
  if (
    action.packageSelector !== candidate.packageSelector ||
    action.packageIntegrity !== source.packageIntegrity ||
    action.packageLockSha256 !== source.packageLock.sha256
  ) {
    throw new Error(`Candidate ${candidateId} package ownership does not match the trusted MCP manifest.`);
  }
  const target = assertAbsolutePath(action.target, `Candidate ${candidateId} installation target`);
  const expectedTarget = path.join(homeDir, ".agents", "harness", "tools", candidateId, source.release);
  const mappedTarget = mapPathBelowRoot(
    homeDir,
    target,
    `Candidate ${candidateId} installation target`,
    { rootAliases: homeAliases },
  );
  if (path.resolve(mappedTarget) !== path.resolve(expectedTarget)) {
    throw new Error(`Candidate ${candidateId} installation target does not match the trusted MCP manifest.`);
  }
  const canonicalTarget = await assertRealPathBelow(
    homeDir,
    target,
    `Candidate ${candidateId} installation target`,
    { rootAliases: homeAliases },
  );
  const targetDetails = await lstatRequired(canonicalTarget, `Candidate ${candidateId} installation target`);
  if (!targetDetails.isDirectory() || targetDetails.isSymbolicLink()) {
    throw new Error(`Candidate ${candidateId} installation target must be a real non-linked directory.`);
  }

  const command = assertAbsolutePath(action.command, `Candidate ${candidateId} command`);
  const commandDetails = await lstatRequired(command, `Candidate ${candidateId} command`);
  if (
    !commandDetails.isFile() ||
    commandDetails.isSymbolicLink() ||
    commandDetails.nlink > 1
  ) {
    throw new Error(`Candidate ${candidateId} command must be a regular non-linked file.`);
  }
  const nodeCommand = path.resolve(await realpath(process.execPath));
  const recordedCommand = path.resolve(await realpath(command));
  if (recordedCommand !== nodeCommand) {
    throw new Error(`Candidate ${candidateId} command is not this trusted Node runtime.`);
  }
  if (!Array.isArray(action.commandArgs) || action.commandArgs.length !== 1) {
    throw new Error(`Candidate ${candidateId} command arguments must contain exactly one owned entrypoint.`);
  }
  const entrypoint = assertAbsolutePath(action.commandArgs[0], `Candidate ${candidateId} entrypoint`);
  const canonicalEntrypoint = await assertRealPathBelow(
    homeDir,
    entrypoint,
    `Candidate ${candidateId} entrypoint`,
    { rootAliases: homeAliases },
  );
  assertInside(canonicalTarget, canonicalEntrypoint, `Candidate ${candidateId} entrypoint`);
  const entrypointDetails = await lstatRequired(canonicalEntrypoint, `Candidate ${candidateId} entrypoint`);
  if (!entrypointDetails.isFile() || entrypointDetails.isSymbolicLink() || entrypointDetails.nlink > 1) {
    throw new Error(`Candidate ${candidateId} entrypoint is not a regular non-linked file.`);
  }

  const { name, version } = parseExactPackageSelector(action.packageSelector);
  const packagePath = path.join(target, "node_modules", ...name.split("/"));
  assertInside(target, packagePath, `Candidate ${candidateId} package path`);
  const canonicalPackagePath = await assertRealPathBelow(
    homeDir,
    packagePath,
    `Candidate ${candidateId} package path`,
    { rootAliases: homeAliases },
  );
  const packageJson = await readRegularJson(path.join(packagePath, "package.json"), `Candidate ${candidateId} package identity`);
  if (packageJson.name !== name || packageJson.version !== version) {
    throw new Error(`Candidate ${candidateId} package identity drifted from its exact selector.`);
  }
  const bin = packageJson.bin;
  const binRelative = typeof bin === "string" ? bin : bin?.[candidate.entrypoint];
  if (typeof binRelative !== "string" || !binRelative) {
    throw new Error(`Candidate ${candidateId} package has no trusted entrypoint.`);
  }
  const expectedEntrypoint = path.resolve(canonicalPackagePath, binRelative);
  assertInside(canonicalPackagePath, expectedEntrypoint, `Candidate ${candidateId} trusted entrypoint`);
  if (path.resolve(canonicalEntrypoint) !== expectedEntrypoint) {
    throw new Error(`Candidate ${candidateId} entrypoint does not match the trusted package metadata.`);
  }
  const lockSegments = source.packageLock.path.replaceAll("\\", "/").split("/");
  if (
    lockSegments.length < 2 ||
    lockSegments[0] !== "npm-locks" ||
    lockSegments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Candidate ${candidateId} pinned package lock path is unsafe.`);
  }
  const approvedLockPath = path.resolve(path.dirname(manifestPath), ...lockSegments);
  assertInside(path.dirname(manifestPath), approvedLockPath, `Candidate ${candidateId} pinned package lock`);
  const approvedLockDetails = await lstatRequired(approvedLockPath, `Candidate ${candidateId} pinned package lock`);
  if (
    !approvedLockDetails.isFile() ||
    approvedLockDetails.isSymbolicLink() ||
    approvedLockDetails.nlink > 1
  ) {
    throw new Error(`Candidate ${candidateId} pinned package lock is unsafe.`);
  }
  const approvedLockBytes = await readFile(approvedLockPath);
  if (sha256(approvedLockBytes) !== source.packageLock.sha256) {
    throw new Error(`Candidate ${candidateId} pinned package lock digest drifted from the trusted manifest.`);
  }
  const approvedLock = JSON.parse(approvedLockBytes.toString("utf8"));
  const approvedEntries = Object.entries(approvedLock?.packages ?? {}).filter(([key]) => key);
  if (
    approvedLock?.lockfileVersion !== source.packageLock.lockfileVersion ||
    approvedEntries.length !== source.packageLock.packageCount ||
    approvedLock?.packages?.[""]?.dependencies?.[name] !== version ||
    approvedEntries.some(([, entry]) =>
      entry?.link === true ||
      typeof entry?.resolved !== "string" ||
      !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved) ||
      typeof entry?.integrity !== "string" ||
      !entry.integrity.startsWith("sha512-")
    )
  ) {
    throw new Error(`Candidate ${candidateId} pinned package lock is incomplete.`);
  }
  const installedLockPath = path.join(target, "package-lock.json");
  const installedLockDetails = await lstatRequired(installedLockPath, `Candidate ${candidateId} package lock`);
  if (
    !installedLockDetails.isFile() ||
    installedLockDetails.isSymbolicLink() ||
    installedLockDetails.nlink > 1
  ) {
    throw new Error(`Candidate ${candidateId} installed package lock is unsafe.`);
  }
  const installedLockBytes = await readFile(installedLockPath);
  if (sha256(installedLockBytes) !== source.packageLock.sha256) {
    throw new Error(`Candidate ${candidateId} installed package lock drifted from its approved artifact.`);
  }
  const lock = JSON.parse(installedLockBytes.toString("utf8"));
  const locked = lock?.packages?.[`node_modules/${name}`];
  if (!locked || locked.version !== version || locked.integrity !== action.packageIntegrity) {
    throw new Error(`Candidate ${candidateId} package lock drifted from its ownership record.`);
  }

  const treeSha256 = assertDigest(action.treeSha256, `Candidate ${candidateId} tree fingerprint`);
  const actualTreeSha256 = await fingerprintPinnedMcpTree(target);
  if (actualTreeSha256 !== treeSha256) {
    throw new Error(`Candidate ${candidateId} installed files drifted from the Harness-owned package fingerprint.`);
  }
  return { command, commandArgs: [entrypoint], target, manifestDigest, treeSha256 };
}

/**
 * Validates an owned, explicitly configured MCP package immediately before
 * launching it.  The launcher performs no installation, network request, or
 * `.claude` access; it only proxies stdio to the exact pinned entrypoint.
 */
export async function launchThirdPartyMcp({
  homeDir,
  candidateId,
  spawnImpl = nodeSpawn,
  env = process.env,
} = {}) {
  const requestedHome = assertAbsolutePath(homeDir, "Harness home");
  if (typeof candidateId !== "string" || !CANDIDATE_ID.test(candidateId)) {
    throw new Error("Candidate id is invalid.");
  }
  if (typeof spawnImpl !== "function") throw new Error("MCP launcher requires a spawn implementation.");

  const canonicalHome = await realNonLinkedDirectory(requestedHome, "Harness home");
  const ownershipPath = path.join(canonicalHome, ".agents", "harness", "third-party-global-actions.json");
  await assertRealPathBelow(canonicalHome, ownershipPath, "Third-party MCP ownership record");
  const ownership = await readRegularJson(ownershipPath, "Third-party MCP ownership record");
  const launch = await verifyOwnedNodeMcp({
    homeDir: canonicalHome,
    homeAliases: [requestedHome],
    candidateId,
    ownership,
    manifestPath: DEFAULT_SOURCE_MANIFEST,
  });

  // No shell, no interpolated command line, no output capture, and no raw
  // inherited environment. Injection variables such as NODE_OPTIONS,
  // NODE_PATH, loader hooks, and archive options are deliberately absent.
  return spawnImpl(launch.command, launch.commandArgs, {
    cwd: launch.target,
    env: minimalCommandEnvironment(env),
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
}

export function parseThirdPartyMcpLauncherArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--home" && flag !== "--candidate") {
      throw new Error(`Unknown third-party MCP launcher argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Third-party MCP launcher requires one value for ${flag}.`);
    }
    values.set(flag, value);
    index += 1;
  }
  if (values.size !== 2) {
    throw new Error("Usage: node third-party-mcp-launcher.mjs --home <absolute-home> --candidate <id>");
  }
  return { homeDir: assertAbsolutePath(values.get("--home"), "Harness home"), candidateId: values.get("--candidate") };
}

async function main() {
  const options = parseThirdPartyMcpLauncherArgs(process.argv.slice(2));
  const child = await launchThirdPartyMcp(options);
  child.once("error", () => {
    process.stderr.write("Third-party MCP launcher could not start the approved process.\n");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (Number.isInteger(code) ? code : 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write("Third-party MCP launcher refused the requested configuration.\n");
    process.exitCode = 1;
  });
}
