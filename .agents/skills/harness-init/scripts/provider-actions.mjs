import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  open,
  opendir,
  readFile,
  readlink,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadGlobalInitState } from "./guided-init.mjs";
import { resolveTrustedCommand } from "./trusted-command-resolver.mjs";

const OWNER = "trellis-ccg-harness/provider-actions";
const PLAN_SCHEMA_VERSION = 1;
const AUTH_ONLY_LOGIN_GUIDANCE = Object.freeze({
  codex: ["login"],
  grok: ["login"],
});
const CLAUDE_FINGERPRINT_LIMITS = Object.freeze({
  maxDepth: 128,
  maxEntries: 100_000,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stateDigest(state) {
  return sha256(canonicalJson(state));
}

function planDigest(plan) {
  return sha256(canonicalJson(plan));
}

async function commandFor({
  provider,
  action,
  resolveCommand = resolveTrustedCommand,
}) {
  if (action === "install") {
    return {
      kind: "manual-only",
      reason: "provider-install-requires-separate-manual-approval",
    };
  }
  if (action !== "login") {
    throw new Error("Provider action plan must be a pending install or login action.");
  }
  const args = AUTH_ONLY_LOGIN_GUIDANCE[provider];
  if (!args) {
    return {
      kind: "manual-only",
      reason: "provider-login-is-not-executable-by-harness",
    };
  }
  let binding;
  try {
    binding = await resolveCommand(provider);
  } catch {
    return {
      kind: "manual-only",
      reason: "provider-command-source-untrusted",
    };
  }
  return {
    kind: "manual-only",
    reason: "provider-login-execution-not-provably-immutable",
    command: [binding.command, ...binding.argsPrefix, ...args],
    binding,
  };
}

async function realDirectory(directory, label) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const resolved = await realpath(directory);
  const details = await lstat(resolved);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return resolved;
}

function assertPendingAction(state, provider, action) {
  if (typeof provider !== "string" || typeof action !== "string") {
    throw new Error("Provider action requires explicit provider and action values.");
  }
  const pending = state.pendingProviderActions.find(
    (entry) => entry.provider === provider && entry.action === action,
  );
  if (!pending) {
    throw new Error("Provider action is not an exact pending action in trusted Global Init state.");
  }
  if (pending.pending !== true || pending.executed !== false || pending.requiresSeparateApproval !== true) {
    throw new Error("Provider pending action is not separately approvable.");
  }
  return pending;
}

async function sourcePlan({
  homeDir,
  provider,
  action,
  repoRoot = null,
  resolveCommand,
}) {
  const home = await realDirectory(homeDir, "User home");
  const repository =
    repoRoot === null
      ? home
      : await realDirectory(repoRoot, "Repository root");
  const state = await loadGlobalInitState({ homeDir: home });
  if (!state) throw new Error("Trusted Global Init state is required before provider actions.");
  assertPendingAction(state, provider, action);
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    owner: OWNER,
    homeDir: home,
    repoRoot: repository,
    globalInitStateSha256: stateDigest(state),
    provider,
    action,
    execution: await commandFor({ provider, action, resolveCommand }),
  };
}

/**
 * Creates a read-only, canonical action plan from the current trusted
 * Global Init state. The returned digest deliberately excludes itself.
 */
export async function planProviderAction({
  homeDir = os.homedir(),
  provider,
  action,
  repoRoot = null,
  resolveCommand = resolveTrustedCommand,
} = {}) {
  const plan = await sourcePlan({
    homeDir,
    provider,
    action,
    repoRoot,
    resolveCommand,
  });
  return { ...plan, planSha256: planDigest(plan) };
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

function fingerprintContext({ onSymlinkTargetBound = null } = {}) {
  return {
    activeRealPaths: new Set(),
    visitedRealPaths: new Set(),
    entries: 0,
    onSymlinkTargetBound,
    totalBytes: 0,
  };
}

function normalizedRealPath(target) {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function recordFingerprintEntry(context, entry) {
  context.entries += 1;
  if (context.entries > CLAUDE_FINGERPRINT_LIMITS.maxEntries) {
    throw new Error("Protected .claude boundary exceeds the safe fingerprint entry limit.");
  }
  return entry;
}

function assertFingerprintDepth(depth) {
  if (depth > CLAUDE_FINGERPRINT_LIMITS.maxDepth) {
    throw new Error("Protected .claude boundary exceeds the safe fingerprint depth limit.");
  }
}

function sameOpenedFile(expected, actual) {
  return (
    actual.isFile() &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.size === expected.size &&
    actual.mtimeMs === expected.mtimeMs
  );
}

function sameSymlinkIdentity(expected, actual) {
  return (
    actual.isSymbolicLink() &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.mode === expected.mode &&
    actual.mtimeMs === expected.mtimeMs &&
    actual.ctimeMs === expected.ctimeMs
  );
}

async function hashFingerprintFile(target, details, context) {
  if (
    !Number.isSafeInteger(details.size) ||
    details.size < 0 ||
    details.size > CLAUDE_FINGERPRINT_LIMITS.maxFileBytes
  ) {
    throw new Error("Protected .claude file exceeds the safe fingerprint file-size limit.");
  }
  if (
    context.totalBytes + details.size >
    CLAUDE_FINGERPRINT_LIMITS.maxTotalBytes
  ) {
    throw new Error("Protected .claude boundary exceeds the safe fingerprint byte limit.");
  }

  const handle = await open(target, "r");
  try {
    const opened = await handle.stat();
    if (!sameOpenedFile(details, opened)) {
      throw new Error("Protected .claude file changed while its fingerprint was opened.");
    }
    const digest = createHash("sha256");
    let bytesRead = 0;
    const stream = createReadStream(null, {
      fd: handle.fd,
      autoClose: false,
    });
    for await (const chunk of stream) {
      bytesRead += chunk.length;
      if (
        bytesRead > details.size ||
        context.totalBytes + bytesRead >
          CLAUDE_FINGERPRINT_LIMITS.maxTotalBytes
      ) {
        throw new Error("Protected .claude file changed while it was fingerprinted.");
      }
      digest.update(chunk);
    }
    const after = await handle.stat();
    if (bytesRead !== details.size || !sameOpenedFile(details, after)) {
      throw new Error("Protected .claude file changed while it was fingerprinted.");
    }
    context.totalBytes += bytesRead;
    return digest.digest("hex");
  } finally {
    await handle.close();
  }
}

async function fingerprintConcreteEntry(
  target,
  relative,
  details,
  context,
  depth,
) {
  assertFingerprintDepth(depth);
  const canonicalTarget = path.resolve(await realpath(target));
  const realKey = normalizedRealPath(canonicalTarget);
  if (context.activeRealPaths.has(realKey)) {
    return [
      recordFingerprintEntry(context, {
        relative,
        type: "reachable-cycle",
        realTarget: canonicalTarget,
      }),
    ];
  }
  if (context.visitedRealPaths.has(realKey)) {
    return [
      recordFingerprintEntry(context, {
        relative,
        type: "reachable-alias",
        realTarget: canonicalTarget,
      }),
    ];
  }
  context.visitedRealPaths.add(realKey);

  if (details.isFile()) {
    return [
      recordFingerprintEntry(context, {
        relative,
        type: "file",
        mode: details.mode,
        size: details.size,
        sha256: await hashFingerprintFile(canonicalTarget, details, context),
      }),
    ];
  }
  if (!details.isDirectory()) {
    return [
      recordFingerprintEntry(context, {
        relative,
        type: "other",
        mode: details.mode,
        size: details.size,
        realTarget: canonicalTarget,
      }),
    ];
  }

  const entries = [
    recordFingerprintEntry(context, {
      relative,
      type: "directory",
      mode: details.mode,
      realTarget: canonicalTarget,
    }),
  ];
  context.activeRealPaths.add(realKey);
  try {
    const children = [];
    const directory = await opendir(canonicalTarget);
    for await (const child of directory) {
      if (
        children.length >=
        CLAUDE_FINGERPRINT_LIMITS.maxEntries - context.entries
      ) {
        throw new Error(
          "Protected .claude boundary exceeds the safe fingerprint entry limit.",
        );
      }
      children.push(child);
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      entries.push(
        ...(await fingerprintEntry(
          path.join(canonicalTarget, child.name),
          relative ? path.posix.join(relative, child.name) : child.name,
          context,
          depth + 1,
        )),
      );
    }
  } finally {
    context.activeRealPaths.delete(realKey);
  }
  return entries;
}

async function fingerprintEntry(
  target,
  relative = "",
  context = fingerprintContext(),
  depth = 0,
) {
  assertFingerprintDepth(depth);
  const details = await lstat(target);
  if (!details.isSymbolicLink()) {
    return fingerprintConcreteEntry(target, relative, details, context, depth);
  }

  const linkTarget = await readlink(target);
  const linkEntry = {
    relative,
    type: "symlink",
    mode: details.mode,
    linkTarget,
  };
  let reachableTarget;
  try {
    reachableTarget = path.resolve(await realpath(target));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return [
      recordFingerprintEntry(context, {
        ...linkEntry,
        reachableState: "missing",
      }),
    ];
  }
  const reachableRelative = relative
    ? path.posix.join(relative, "<reachable>")
    : "<reachable>";
  if (context.onSymlinkTargetBound) {
    await context.onSymlinkTargetBound({
      linkPath: target,
      linkTarget,
      realTarget: reachableTarget,
    });
  }
  const reachableEntries = await fingerprintConcreteEntry(
    reachableTarget,
    reachableRelative,
    await lstat(reachableTarget),
    context,
    depth + 1,
  );
  const [afterDetails, afterLinkTarget, afterReachableTarget] =
    await Promise.all([
      lstat(target),
      readlink(target),
      realpath(target),
    ]);
  if (
    !sameSymlinkIdentity(details, afterDetails) ||
    afterLinkTarget !== linkTarget ||
    normalizedRealPath(afterReachableTarget) !==
      normalizedRealPath(reachableTarget)
  ) {
    throw new Error(
      "Protected .claude link changed while its reachable target was fingerprinted.",
    );
  }
  return [
    recordFingerprintEntry(context, {
      ...linkEntry,
      reachableState: "present",
      realTarget: reachableTarget,
    }),
    ...reachableEntries,
  ];
}

export async function fingerprintProtectedClaudeBoundary(
  root,
  { onSymlinkTargetBound = null } = {},
) {
  const target = path.join(root, ".claude");
  if (!(await pathExists(target))) {
    return { state: "absent", sha256: sha256("absent"), entryCount: 0 };
  }
  const entries = await fingerprintEntry(
    target,
    "",
    fingerprintContext({ onSymlinkTargetBound }),
  );
  return {
    state: entries[0]?.type ?? "unknown",
    sha256: sha256(canonicalJson(entries)),
    entryCount: entries.length,
  };
}

/**
 * Revalidates the separately approved action plan, then refuses automatic
 * execution. Provider login remains a manual terminal action because the
 * complete CLI dependency tree and verify-to-spawn interval are not attested.
 */
export async function executeProviderAction({
  homeDir = os.homedir(),
  provider,
  action,
  planSha256,
  approved,
  repoRoot = null,
  resolveCommand = resolveTrustedCommand,
} = {}) {
  if (approved !== true) {
    throw new Error("Provider action execution requires approved=true.");
  }
  if (typeof planSha256 !== "string" || !/^[a-f0-9]{64}$/.test(planSha256)) {
    throw new Error("Provider action execution requires an exact planSha256.");
  }
  const plan = await planProviderAction({
    homeDir,
    provider,
    action,
    repoRoot,
    resolveCommand,
  });
  if (plan.planSha256 !== planSha256) {
    throw new Error("Provider action plan drifted; create and approve a new plan before execution.");
  }
  return {
    status: "manual-only",
    executed: false,
    planSha256,
    provider: plan.provider,
    action: plan.action,
    execution: plan.execution,
  };
}

export const providerActionConstants = Object.freeze({
  owner: OWNER,
  authOnlyLoginGuidance: AUTH_ONLY_LOGIN_GUIDANCE,
});
