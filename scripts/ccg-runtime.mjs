import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CCG_RUNTIME_PACKAGES = Object.freeze({
  "ccg-workflow": "ccg",
  "@jed-zed/ccg-codex-workflow": "ccg-codex",
});

export function resolveCcgRuntimePackage(packageName) {
  if (!Object.hasOwn(CCG_RUNTIME_PACKAGES, packageName)) {
    throw new Error(`Unsupported personal CCG package identity: ${packageName}.`);
  }
  return { packageName, command: CCG_RUNTIME_PACKAGES[packageName], entrypoint: "bin/ccg.mjs" };
}

export function validateCcgRuntimePackage(packageManifest, sourceManifest) {
  const target = resolveCcgRuntimePackage(sourceManifest.ccg.package);
  const bins = packageManifest.bin;
  if (packageManifest.name !== target.packageName ||
      packageManifest.version !== sourceManifest.ccg.version ||
      !bins || typeof bins !== "object" || Array.isArray(bins) ||
      Object.keys(bins).length !== 1 ||
      ![target.entrypoint, `./${target.entrypoint}`].includes(bins[target.command])) {
    throw new Error("Personal CCG source/package/bin identity must match exactly.");
  }
  return target;
}

export async function resolveCcgRuntime(repoRoot) {
  const root = path.resolve(repoRoot);
  const sources = JSON.parse(await readFile(path.join(root, "harness.sources.json"), "utf8"));
  const componentRoot = path.resolve(root, String(sources.ccg.snapshotPath));
  const relative = path.relative(root, componentRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Recorded CCG snapshot escapes the Harness repository.");
  }
  const manifest = JSON.parse(await readFile(path.join(componentRoot, "package.json"), "utf8"));
  return { ...validateCcgRuntimePackage(manifest, sources), componentRoot };
}

export async function verifyCcgPackageArchive(filename, expectedSha256, sourceManifest) {
  if (!path.isAbsolute(filename) || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("CCG archive requires an absolute path and exact SHA-256.");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 * 1024) throw new Error("CCG archive must be a bounded regular file.");
  const archive = await readFile(filename);
  if (createHash("sha256").update(archive).digest("hex") !== expectedSha256) throw new Error("CCG archive SHA-256 mismatch.");
  const tar = gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 });
  let packageManifest;
  const paths = new Set();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString("utf8").split("\0")[0];
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join("/").replace(/\/$/, "");
    const type = field(156, 157);
    const sizeText = field(124, 136).trim();
    if (!/^[0-7]+$/.test(sizeText) || !["", "0", "5"].includes(type) ||
        !name.startsWith("package/") || name.includes("\\") || name.includes(":") ||
        name.split("/").some(part => !part || part === "." || part === "..") || paths.has(name)) throw new Error("CCG archive has an unsafe or ambiguous entry.");
    paths.add(name);
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || offset + 512 + size > tar.length) throw new Error("CCG archive is truncated.");
    if (name === "package/package.json") {
      if (type === "5") throw new Error("CCG archive package identity is not a regular file.");
      packageManifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString("utf8"));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!packageManifest) throw new Error("CCG archive package.json is missing.");
  const identity = validateCcgRuntimePackage(packageManifest, sourceManifest);
  if (!paths.has(`package/${identity.entrypoint}`)) throw new Error("CCG archive CLI entrypoint is missing.");
  return { ...identity, version: packageManifest.version, archivePath: filename, archiveSha256: expectedSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 6 && args[0] === "--repo-root" && args[2] === "--archive" && args[4] === "--sha256") {
      await resolveCcgRuntime(args[1]);
      const sources = JSON.parse(await readFile(path.join(path.resolve(args[1]), "harness.sources.json"), "utf8"));
      process.stdout.write(`${JSON.stringify(await verifyCcgPackageArchive(args[3], args[5], sources))}\n`);
    } else {
    if (args.length !== 2 || !["--repo-root", "--package"].includes(args[0])) {
      throw new Error("Use ccg-runtime.mjs --repo-root <path> or --package <name>.");
    }
    const target = args[0] === "--repo-root" ? await resolveCcgRuntime(args[1]) : resolveCcgRuntimePackage(args[1]);
    process.stdout.write(`${JSON.stringify(target)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
