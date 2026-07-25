import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

function normalizedPath(value) {
  const resolved = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInsideOrEqual(root, target) {
  const normalizedRoot = normalizedPath(root);
  const normalizedTarget = normalizedPath(target);
  return (
    normalizedTarget === normalizedRoot ||
    normalizedTarget.startsWith(`${normalizedRoot}/`)
  );
}

export function assertLexicallyInside(root, target, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!isInsideOrEqual(resolvedRoot, resolvedTarget)) {
    throw new Error(`${label} must stay inside the Harness repository.`);
  }
  return resolvedTarget;
}

async function lstatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRegularDirectory(details, target, label) {
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw new Error(
      `${label} path component must be a regular directory, not a symbolic link or junction: ${target}`,
    );
  }
}

export async function ensureSafeDirectoryChain(
  root,
  directory,
  label,
  { create = false } = {},
) {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = assertLexicallyInside(
    resolvedRoot,
    directory,
    label,
  );
  const rootDetails = await lstatOrNull(resolvedRoot);
  if (!rootDetails) {
    throw new Error(`${label} root does not exist: ${resolvedRoot}`);
  }
  assertRegularDirectory(rootDetails, resolvedRoot, label);
  const canonicalRoot = await realpath(resolvedRoot);

  const relative = path.relative(resolvedRoot, resolvedDirectory);
  const segments = relative ? relative.split(path.sep) : [];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    let details = await lstatOrNull(current);
    if (!details) {
      if (!create) return false;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      details = await lstat(current);
    }
    assertRegularDirectory(details, current, label);
    const canonicalCurrent = await realpath(current);
    if (!isInsideOrEqual(canonicalRoot, canonicalCurrent)) {
      throw new Error(`${label} resolves outside its canonical root: ${current}`);
    }
  }
  return true;
}

export async function assertSafeRegularFileOrAbsent(
  root,
  target,
  label,
) {
  const resolved = assertLexicallyInside(root, target, label);
  const parentsExist = await ensureSafeDirectoryChain(
    root,
    path.dirname(resolved),
    label,
  );
  if (!parentsExist) return false;
  const details = await lstatOrNull(resolved);
  if (!details) return false;
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error(`${label} must be a regular file: ${resolved}`);
  }
  return true;
}

export async function safeAtomicWrite(root, target, value, label) {
  const resolved = assertLexicallyInside(root, target, label);
  const parent = path.dirname(resolved);
  await ensureSafeDirectoryChain(root, parent, label, { create: true });
  await assertSafeRegularFileOrAbsent(root, resolved, label);
  const temporary = path.join(parent, `.${path.basename(resolved)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(value);
    await handle.sync();
    await handle.close();
    handle = null;
    await ensureSafeDirectoryChain(root, parent, label);
    await assertSafeRegularFileOrAbsent(root, resolved, label);
    await rename(temporary, resolved);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function safeCreateDirectory(root, directory, label) {
  await ensureSafeDirectoryChain(root, directory, label, { create: true });
}

export async function safeRename(root, source, target, label) {
  const resolvedSource = assertLexicallyInside(root, source, `${label} source`);
  const resolvedTarget = assertLexicallyInside(root, target, `${label} target`);
  await ensureSafeDirectoryChain(
    root,
    path.dirname(resolvedSource),
    `${label} source`,
  );
  await ensureSafeDirectoryChain(
    root,
    path.dirname(resolvedTarget),
    `${label} target`,
    { create: true },
  );
  const sourceDetails = await lstatOrNull(resolvedSource);
  if (
    !sourceDetails ||
    sourceDetails.isSymbolicLink() ||
    (!sourceDetails.isDirectory() && !sourceDetails.isFile())
  ) {
    throw new Error(`${label} source must be a regular file or directory.`);
  }
  if (await lstatOrNull(resolvedTarget)) {
    throw new Error(`${label} target already exists: ${resolvedTarget}`);
  }
  await rename(resolvedSource, resolvedTarget);
}

export async function safeRemove(
  root,
  target,
  label,
  { recursive = false } = {},
) {
  const resolved = assertLexicallyInside(root, target, label);
  await ensureSafeDirectoryChain(root, path.dirname(resolved), label);
  const details = await lstatOrNull(resolved);
  if (!details) return;
  if (details.isSymbolicLink()) {
    throw new Error(`${label} cannot remove a symbolic link or junction.`);
  }
  if (details.isDirectory() && !recursive) {
    throw new Error(`${label} requires explicit recursive directory removal.`);
  }
  if (!details.isDirectory() && !details.isFile()) {
    throw new Error(`${label} is not a regular filesystem entry.`);
  }
  const removeRecursively = details.isDirectory();
  await rm(resolved, {
    recursive: removeRecursively,
    force: true,
    ...(removeRecursively ? { maxRetries: 5, retryDelay: 100 } : {}),
  });
}

function modeOf(details) {
  return (details.mode & 0o777).toString(8).padStart(3, "0");
}

function updateIdentity(hash, ...parts) {
  for (const part of parts) {
    hash.update(String(part));
    hash.update("\0");
  }
}

export async function buildContentIdentity(root) {
  const resolvedRoot = path.resolve(root);
  const rootDetails = await lstat(resolvedRoot);
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
    throw new Error(`Content identity root must be a regular directory: ${root}`);
  }

  const hash = createHash("sha256");
  let entryCount = 0;
  const pending = [{ absolute: resolvedRoot, relative: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    const children = await readdir(current.absolute);
    children.sort((left, right) => left.localeCompare(right, "en"));
    for (let index = children.length - 1; index >= 0; index--) {
      const name = children[index];
      const absolute = path.join(current.absolute, name);
      const relative = current.relative
        ? `${current.relative}/${name}`
        : name;
      const details = await lstat(absolute);
      entryCount += 1;
      if (details.isDirectory() && !details.isSymbolicLink()) {
        updateIdentity(hash, "directory", relative, modeOf(details));
        pending.push({ absolute, relative });
      } else if (details.isFile()) {
        const bytes = await readFile(absolute);
        updateIdentity(
          hash,
          "file",
          relative,
          modeOf(details),
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
        );
      } else if (details.isSymbolicLink()) {
        updateIdentity(hash, "symlink", relative, await readlink(absolute));
      } else {
        throw new Error(
          `Content identity encountered a non-regular entry: ${relative}`,
        );
      }
    }
  }
  return {
    algorithm: "sha256-tree-v1",
    digest: hash.digest("hex"),
    entryCount,
  };
}

export function contentIdentitiesEqual(left, right) {
  return (
    left?.algorithm === "sha256-tree-v1" &&
    right?.algorithm === "sha256-tree-v1" &&
    left.digest === right.digest &&
    left.entryCount === right.entryCount
  );
}

export async function fingerprintRegularFile(root, target, label) {
  const exists = await assertSafeRegularFileOrAbsent(root, target, label);
  if (!exists) return { kind: "absent" };
  const details = await lstat(target);
  const bytes = await readFile(target);
  return {
    kind: "file",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    mode: modeOf(details),
  };
}

export function fingerprintsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
