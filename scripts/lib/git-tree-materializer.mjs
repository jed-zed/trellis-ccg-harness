import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const GIT_FILE_MODES = new Set(["100644", "100755"]);

function normalizeTreePath(value) {
  const relative = String(value ?? "").replaceAll("\\", "/");
  if (
    !relative ||
    relative.includes("\0") ||
    relative.includes("\uFFFD") ||
    path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative === "." ||
    relative === ".." ||
    relative.startsWith("../") ||
    /^[A-Za-z]:/.test(relative) ||
    /[\x00-\x1f\x7f]/.test(relative)
  ) {
    throw new Error(`Git tree contains an unsafe path: ${value}.`);
  }
  return relative;
}

function parseTreeRecord(record) {
  const match = /^([0-7]{6}) ([a-z]+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(
    record,
  );
  if (!match) throw new Error("Git returned an invalid ls-tree record.");
  const [, mode, type, objectId, rawPath] = match;
  if (type !== "blob" || !GIT_FILE_MODES.has(mode)) {
    throw new Error(
      `Git tree entry type or mode is not supported: ${mode} ${type} ${rawPath}.`,
    );
  }
  return {
    path: normalizeTreePath(rawPath),
    mode,
    objectId,
  };
}

export function parseGitTree(value) {
  const records = String(value ?? "").split("\0").filter(Boolean);
  const entries = records.map(parseTreeRecord);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      throw new Error(`Git tree contains a duplicate path: ${entry.path}.`);
    }
    seen.add(entry.path);
  }
  return entries;
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

export function gitTreeManifestSha256(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.mode);
    hash.update("\0");
    hash.update(entry.objectId);
    hash.update("\0");
    hash.update(entry.path);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isAllowedExtra(relative, allowedExtraRoots) {
  return allowedExtraRoots.some(
    (root) => relative === root || relative.startsWith(`${root}/`),
  );
}

async function collectMaterializedFiles(root, allowedExtraRoots) {
  const files = new Map();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length > 0) {
    const current = pending.pop();
    const children = await readdir(current.absolute);
    children.sort((left, right) => left.localeCompare(right, "en"));
    for (let index = children.length - 1; index >= 0; index--) {
      const name = children[index];
      const absolute = path.join(current.absolute, name);
      const relative = normalizeTreePath(
        current.relative ? `${current.relative}/${name}` : name,
      );
      if (isAllowedExtra(relative, allowedExtraRoots)) continue;
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) {
        throw new Error(
          `Materialized Git tree contains a forbidden symbolic link or junction: ${relative}.`,
        );
      }
      if (details.isDirectory()) {
        pending.push({ absolute, relative });
      } else if (details.isFile()) {
        files.set(relative, { absolute, details });
      } else {
        throw new Error(
          `Materialized Git tree contains a non-regular entry: ${relative}.`,
        );
      }
    }
  }
  return files;
}

export async function verifyMaterializedGitTree(
  destination,
  entries,
  { allowedExtraRoots = [] } = {},
) {
  const expected = new Map(entries.map((entry) => [entry.path, entry]));
  const actual = await collectMaterializedFiles(
    path.resolve(destination),
    allowedExtraRoots.map(normalizeTreePath),
  );
  const missing = [...expected.keys()].filter((name) => !actual.has(name));
  const extra = [...actual.keys()].filter((name) => !expected.has(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Materialized Git tree path mismatch`
      + `${missing.length ? `; missing ${missing.slice(0, 10).join(", ")}` : ""}`
      + `${extra.length ? `; extra ${extra.slice(0, 10).join(", ")}` : ""}.`,
    );
  }
  for (const [relative, expectedEntry] of expected) {
    const actualEntry = actual.get(relative);
    const bytes = await readFile(actualEntry.absolute);
    const objectId = gitBlobSha1(bytes);
    if (objectId !== expectedEntry.objectId) {
      throw new Error(`Materialized Git blob mismatch: ${relative}.`);
    }
    if (process.platform !== "win32") {
      const executable = (actualEntry.details.mode & 0o111) !== 0;
      const actualMode = executable ? "100755" : "100644";
      if (actualMode !== expectedEntry.mode) {
        throw new Error(
          `Materialized Git executable mode mismatch: ${relative}.`,
        );
      }
    }
  }
  return {
    files: entries.length,
    manifestSha256: gitTreeManifestSha256(entries),
  };
}

function isExcluded(relative, exclusions) {
  return exclusions.some(
    (excluded) =>
      relative === excluded || relative.startsWith(`${excluded}/`),
  );
}

function parseBatchBlobs(output, entries) {
  if (!Buffer.isBuffer(output)) {
    throw new Error("git cat-file batch output must be binary.");
  }
  const blobs = new Map();
  let offset = 0;
  for (const entry of entries) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error("git cat-file returned a truncated header.");
    const header = output.subarray(offset, newline).toString("utf8");
    const match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
    if (!match || match[1] !== entry.objectId) {
      throw new Error(`git cat-file returned the wrong blob for ${entry.path}.`);
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`git cat-file returned an invalid size for ${entry.path}.`);
    }
    const start = newline + 1;
    const end = start + size;
    if (end >= output.length || output[end] !== 0x0a) {
      throw new Error(`git cat-file returned truncated bytes for ${entry.path}.`);
    }
    const bytes = output.subarray(start, end);
    if (gitBlobSha1(bytes) !== entry.objectId) {
      throw new Error(`git cat-file blob identity mismatch: ${entry.path}.`);
    }
    blobs.set(entry.path, bytes);
    offset = end + 1;
  }
  if (offset !== output.length) {
    throw new Error("git cat-file returned unexpected trailing bytes.");
  }
  return blobs;
}

export async function materializeGitTree({
  checkout,
  commit,
  destination,
  exclusions = [],
  preserveFrom = null,
  execute,
}) {
  const normalizedExclusions = exclusions.map(normalizeTreePath);
  const lsTree = execute(
    "git",
    [
      "-C",
      checkout,
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      commit,
    ],
    { capture: true },
  );
  const treeEntries = parseGitTree(lsTree);
  const entries = treeEntries.filter(
    (entry) => !isExcluded(entry.path, normalizedExclusions),
  );
  if (entries.length === 0) {
    throw new Error("The selected Git tree contains no materializable files.");
  }

  await mkdir(destination, { recursive: false, mode: 0o700 });
  const blobOutput = execute(
    "git",
    ["-C", checkout, "cat-file", "--batch"],
    {
      capture: true,
      encoding: null,
      maxBuffer: 256 * 1024 * 1024,
      input: `${entries.map((entry) => entry.objectId).join("\n")}\n`,
    },
  );
  const blobs = parseBatchBlobs(blobOutput, entries);
  if (preserveFrom) {
    const preserveRoot = path.resolve(preserveFrom);
    for (const entry of treeEntries.filter(
      (candidate) => isExcluded(candidate.path, normalizedExclusions),
    )) {
      const source = path.join(preserveRoot, ...entry.path.split("/"));
      const details = await lstat(source);
      if (details.isSymbolicLink() || !details.isFile()) {
        throw new Error(`Preserved Git path is not a regular file: ${entry.path}.`);
      }
      const bytes = await readFile(source);
      if (gitBlobSha1(bytes) !== entry.objectId) {
        throw new Error(`Preserved Git blob mismatch: ${entry.path}.`);
      }
      if (process.platform !== "win32") {
        const actualMode = (details.mode & 0o111) !== 0 ? "100755" : "100644";
        if (actualMode !== entry.mode) {
          throw new Error(`Preserved Git executable mode mismatch: ${entry.path}.`);
        }
      }
      blobs.set(entry.path, bytes);
    }
  }
  const materializedEntries = preserveFrom ? treeEntries : entries;
  for (const entry of materializedEntries) {
    const target = path.join(destination, ...entry.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, blobs.get(entry.path), {
      flag: "wx",
      mode: entry.mode === "100755" ? 0o755 : 0o644,
    });
    if (process.platform !== "win32") {
      await chmod(target, entry.mode === "100755" ? 0o755 : 0o644);
    }
  }
  return {
    entries: materializedEntries,
    ...(await verifyMaterializedGitTree(destination, materializedEntries)),
  };
}
