import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSafeDirectoryChain } from "./harness-fs.mjs";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIGEST = /^[a-f0-9]{64}$/;
const normalize = value => {
  const resolved = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

async function plainRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Legacy claim root must be absolute.");
  const root = path.resolve(value);
  let cursor = path.parse(root).root;
  for (const part of ["", ...root.slice(cursor.length).split(path.sep).filter(Boolean)]) {
    if (part) cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Legacy claim root has a link/reparse ancestor; refusing mutation.");
  }
  if (normalize(await realpath(root)) !== normalize(root)) throw new Error("Legacy claim physical root differs; refusing mutation.");
  return root;
}

async function readRecord(root, filename) {
  if (!await ensureSafeDirectoryChain(root, path.dirname(filename), "Legacy claim authority")) return null;
  let info;
  try { info = await lstat(filename); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) {
    throw new Error("Legacy claim authority requires a bounded, link-free regular file.");
  }
  return readFile(filename);
}

export async function assertPendingClaimStateAllowed(repoRoot, pendingOperation = null) {
  if (![null, "bootstrap-resume", "transaction-recover"].includes(pendingOperation)) throw new Error("Unknown internal pending-state operation.");
  const root = await plainRoot(repoRoot);
  for (const [name, permitted] of [["bootstrap-pending.json", "bootstrap-resume"], ["transaction-journal.json", "transaction-recover"]]) {
    if (pendingOperation !== permitted && await readRecord(root, path.join(root, ".harness-cache", name)) !== null) {
      throw new Error(`Incomplete Harness state ${name} holds unrelated writers; resume its exact operation first.`);
    }
  }
}

export async function assertLegacyClaimMutationAllowed(repoRoot, {
  retirementPlanSha256 = null, codeRoot = CODE_ROOT,
} = {}) {
  const root = await plainRoot(repoRoot);
  const control = await plainRoot(codeRoot);
  if (retirementPlanSha256 !== null && !DIGEST.test(retirementPlanSha256)) {
    throw new Error("Internal legacy retirement lock requires an exact plan digest.");
  }
  const sidecarPath = path.join(root, ".harness-cache", "legacy-ccg-claim-retirement.json");
  const sidecar = await readRecord(root, sidecarPath);
  const registryPath = path.join(control, ".harness-cache", "legacy-ccg-claim-authority.json");
  const raw = await readRecord(control, registryPath);
  if (raw === null) {
    if (sidecar !== null) throw new Error("Legacy claim archive has no authority at the fixed new control root; refusing mutation.");
    return;
  }
  let registry;
  try { registry = JSON.parse(raw); } catch { throw new Error("Malformed legacy claim authority; refusing mutation."); }
  const fields = ["schemaVersion", "kind", "planSha256", "transactionDir", "owners"];
  if (!registry || Array.isArray(registry) || Object.keys(registry).length !== fields.length ||
      fields.some(key => !Object.hasOwn(registry, key)) || registry.schemaVersion !== 1 ||
      registry.kind !== "legacy-ccg-claim-authority" || !DIGEST.test(registry.planSha256) ||
      !path.isAbsolute(registry.transactionDir ?? "") ||
      normalize(registry.transactionDir) !== normalize(path.join(control, ".harness-cache", "legacy-ccg-claims", registry.planSha256)) ||
      !Array.isArray(registry.owners) || registry.owners.length < 1 || registry.owners.length > 8) {
    throw new Error("Legacy claim authority has an invalid fixed-root identity; refusing mutation.");
  }
  const seen = new Set();
  for (const owner of registry.owners) {
    if (!owner || Object.keys(owner).length !== 2 || !path.isAbsolute(owner.repoRoot ?? "") ||
        !DIGEST.test(owner.ownershipSha256) || seen.has(normalize(owner.repoRoot)) ||
        normalize(owner.repoRoot) === normalize(control)) {
      throw new Error("Legacy claim authority has an invalid owner declaration; refusing mutation.");
    }
    seen.add(normalize(owner.repoRoot));
  }
  const owner = registry.owners.find(item => normalize(item.repoRoot) === normalize(root));
  if (!owner) {
    if (sidecar !== null) throw new Error("Legacy archive sidecar is outside the fixed authority owner set; refusing mutation.");
    return;
  }
  if (retirementPlanSha256 === registry.planSha256) {
    const receipt = await readRecord(root, path.join(root, ".harness-cache", "ownership.json"));
    if (receipt === null || createHash("sha256").update(receipt).digest("hex") !== owner.ownershipSha256) {
      throw new Error("Original legacy owner receipt changed; metadata-only recovery is held.");
    }
    return;
  }
  throw new Error("Legacy ccg claim retirement archives this old management root. Its original receipt and other claims remain unchanged; use the new controlled root. Pending, missing sidecars and committed retirement all refuse old-root writes.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [option, value, ...extra] = process.argv.slice(2);
  if (option !== "--repo-root" || !value || !path.isAbsolute(value) || (extra.length && (extra.length !== 1 || extra[0] !== "--require-idle"))) {
    process.stderr.write("Expected --repo-root <absolute-root>. No archive bypass option is exposed.\n");
    process.exitCode = 1;
  } else {
    (async () => {
      await assertLegacyClaimMutationAllowed(path.resolve(value));
      if (extra.length) await assertPendingClaimStateAllowed(path.resolve(value));
    })().catch(error => {
      process.stderr.write(`Legacy claim mutation held: ${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
