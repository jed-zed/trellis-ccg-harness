import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLifecycleArgs, inspectGlobalPackage, resolvePackageManagerInvocation, globalPackageRootFromNpmPrefix } from "../scripts/lib/harness-lifecycle.mjs";
import { verifyCcgPackageArchive } from "../scripts/ccg-runtime.mjs";

const PACKAGE = "@jed-zed/ccg-codex-workflow";
const VERSION = "3.4.16-localarchive.5";
const lifecycle = fileURLToPath(new URL("../scripts/harness-lifecycle.mjs", import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "harness-runtime-migration-"));
  const prefix = path.join(root, "prefix");
  const project = path.join(root, "project");
  const source = path.join(project, "components", "ccg-workflow");
  const globalRoot = globalPackageRootFromNpmPrefix(prefix, { platform: process.platform });
  const env = { ...process.env, NPM_CONFIG_PREFIX: prefix, NPM_CONFIG_CACHE: path.join(root, "cache"), NPM_CONFIG_USERCONFIG: path.join(root, "empty.npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(root, "empty-global.npmrc"), NPM_CONFIG_UPDATE_NOTIFIER: "false", CCG_HOST: "codex" };
  delete env.CLAUDECODE;
  await mkdir(path.join(source, "bin"), { recursive: true });
  await writeFile(env.NPM_CONFIG_USERCONFIG, "");
  await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "");
  const invoke = (command, args, status = 0) => {
    const result = spawnSync(command, args, { env, cwd: root, encoding: "utf8", shell: false, timeout: 60000 });
    assert.equal(result.status, status, [result.error, result.stdout, result.stderr].filter(Boolean).join("\n"));
    return result;
  };
  const stage = (command, args = [], status = 0) => invoke(process.execPath, [lifecycle, command, "--repo-root", project, ...args], status);
  const npm = args => { const call = resolvePackageManagerInvocation("npm", [...args, "--prefix", prefix, "--offline", "--ignore-scripts", "--no-audit", "--no-fund"]); return invoke(call.command, call.args); };
  const publish = async (packageName, version) => {
    const command = packageName === PACKAGE ? "ccg-codex" : "ccg";
    await writeFile(path.join(project, "harness.sources.json"), JSON.stringify({ trellis: { version: "0.6.16" }, ccg: { package: packageName, version, snapshotPath: "components/ccg-workflow" } }));
    await writeFile(path.join(source, "package.json"), JSON.stringify({ name: packageName, version, bin: { [command]: "bin/ccg.mjs" } }));
    await writeFile(path.join(source, "bin", "ccg.mjs"), `#!/usr/bin/env node\nconsole.log('${command}/${version}')\n`);
  };
  await publish("ccg-workflow", "3.4.15");
  stage("bootstrap-begin", ["--manage-ccg"]);
  npm(["install", "-g", "--install-links=true", "--install-strategy=nested", source]);
  stage("bootstrap-runtime-checkpoint");
  stage("bootstrap-complete");
  const baselineOwnership = await readFile(path.join(project, ".harness-cache", "ownership.json"));
  const baselineRuntime = await inspectGlobalPackage(globalRoot, "ccg-workflow");
  await publish(PACKAGE, VERSION);
  const planBytes = stage("ccg-runtime-migration-plan").stdout;
  const planPath = path.join(root, "migration.json");
  await writeFile(planPath, planBytes);
  const planFlags = ["--ccg-migration-plan", planPath, "--ccg-migration-plan-sha256", sha(planBytes)];
  return { root, prefix, project, source, globalRoot, stage, npm, publish, baselineOwnership, baselineRuntime, planPath, planFlags };
}

async function dispose(f) {
  assert.ok(path.resolve(f.root).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(f.root, { recursive: true, force: true });
}

test("owned runtime namespace migration requires a pinned reviewed plan", () => {
  assert.equal(parseLifecycleArgs(["ccg-runtime-migration-plan"]).command, "ccg-runtime-migration-plan");
  assert.throws(() => parseLifecycleArgs(["bootstrap-begin", "--manage-ccg", "--ccg-migration-plan", "plan.json"]), /sha256|digest/);
  const result = parseLifecycleArgs(["bootstrap-begin", "--manage-ccg", "--ccg-migration-plan", "plan.json", "--ccg-migration-plan-sha256", "a".repeat(64)]);
  assert.equal(result.ccgMigrationPlanSha256, "a".repeat(64));
});

test("actual offline namespace install, repeat and stock handoff preserve the legacy owner and later user edits", async () => {
  const f = await fixture();
  try {
    f.stage("bootstrap-begin", ["--manage-ccg"], 1);
    f.stage("bootstrap-begin", ["--manage-ccg", ...f.planFlags]);
    f.npm(["install", "-g", "--install-links=true", "--install-strategy=nested", f.source]);
    f.stage("bootstrap-runtime-checkpoint");
    f.stage("bootstrap-complete");
    let ownership = JSON.parse(await readFile(path.join(f.project, ".harness-cache", "ownership.json")));
    assert.equal(ownership.entries.find(entry => entry.id === "ccg-link").package, PACKAGE);
    assert.equal(ownership.entries.find(entry => entry.id === "ccg-legacy-retained").disposition, "retained");
    assert.deepEqual(await inspectGlobalPackage(f.globalRoot, "ccg-workflow"), f.baselineRuntime);
    f.stage("bootstrap-begin", ["--manage-ccg"]);
    f.npm(["install", "-g", "--install-links=true", "--install-strategy=nested", f.source]);
    f.stage("bootstrap-runtime-checkpoint");
    f.stage("bootstrap-complete");
    const recipientPath = path.join(f.root, "stock-plan.json");
    const recipient = { kind: "ccg-stock-npm-prefix-file-plan", prefix: f.prefix, stageReceiptSha256: "a".repeat(64), baselineManifestSha256: "b".repeat(64), rows: [{ path: "node_modules/ccg-workflow/package.json", action: "replace" }] };
    const recipientBytes = JSON.stringify(recipient);
    await writeFile(recipientPath, recipientBytes);
    const releaseBytes = f.stage("ccg-legacy-disposition-plan", ["--recipient-plan", recipientPath, "--recipient-plan-sha256", sha(recipientBytes)]).stdout;
    const releasePath = path.join(f.root, "release.json");
    await writeFile(releasePath, releaseBytes);
    const releaseFlags = ["--ccg-migration-plan", releasePath, "--ccg-migration-plan-sha256", sha(releaseBytes)];
    await writeFile(recipientPath, `${recipientBytes}\n`);
    f.stage("ccg-legacy-disposition", releaseFlags, 1);
    await writeFile(recipientPath, recipientBytes);
    f.stage("ccg-legacy-disposition", releaseFlags);
    assert.deepEqual(await inspectGlobalPackage(f.globalRoot, "ccg-workflow"), f.baselineRuntime);
    // The official installation has a separate file transaction; this fixture's
    // real npm install proves the released slot no longer asserts its identity.
    const stock = path.join(f.root, "stock-source");
    await mkdir(path.join(stock, "bin"), { recursive: true });
    await writeFile(path.join(stock, "package.json"), JSON.stringify({ name: "ccg-workflow", version: "3.6.7", bin: { ccg: "bin/ccg.mjs" } }));
    await writeFile(path.join(stock, "bin", "ccg.mjs"), "#!/usr/bin/env node\nconsole.log('ccg/3.6.7')\n");
    f.npm(["install", "-g", "--install-links=true", stock]);
    f.stage("ccg-legacy-disposition", releaseFlags); // Exact disposition receipt is idempotent.
    f.stage("bootstrap-begin", ["--manage-ccg"]);
    f.npm(["install", "-g", "--install-links=true", "--install-strategy=nested", f.source]);
    f.stage("bootstrap-runtime-checkpoint");
    f.stage("bootstrap-complete");
    const stockBefore = await inspectGlobalPackage(f.globalRoot, "ccg-workflow");
    const scopedPath = path.join(f.globalRoot, ...PACKAGE.split("/"));
    const entry = path.join(scopedPath, "bin", "ccg.mjs");
    const original = await readFile(entry);
    await writeFile(entry, "// later user edit\n");
    f.stage("uninstall", [], 2);
    assert.equal(await readFile(entry, "utf8"), "// later user edit\n");
    assert.deepEqual(await inspectGlobalPackage(f.globalRoot, "ccg-workflow"), stockBefore);
    await writeFile(entry, original);
    f.stage("uninstall");
    assert.equal(await inspectGlobalPackage(f.globalRoot, PACKAGE), null);
    assert.deepEqual(await inspectGlobalPackage(f.globalRoot, "ccg-workflow"), stockBefore);
    ownership = JSON.parse(await readFile(path.join(f.project, ".harness-cache", "ownership.json")));
    assert.equal(ownership.entries.length, 1);
    assert.equal(ownership.entries[0].disposition, "released-for-stock-claude");
  } finally { await dispose(f); }
});

test("migration rejects drift, foreign aliases and user-edited checkpoint rollback without mutation", async () => {
  const f = await fixture();
  try {
    const pending = path.join(f.project, ".harness-cache", "bootstrap-pending.json");
    const legacyCli = path.join(f.globalRoot, "ccg-workflow", "bin", "ccg.mjs");
    const original = await readFile(legacyCli);
    await writeFile(legacyCli, "// legacy user edit\n");
    f.stage("bootstrap-begin", ["--manage-ccg", ...f.planFlags], 1);
    await assert.rejects(access(pending));
    await writeFile(legacyCli, original);
    const alias = process.platform === "win32" ? path.join(f.prefix, "ccg-codex.cmd") : path.join(f.prefix, "bin", "ccg-codex");
    await mkdir(path.dirname(alias), { recursive: true });
    await writeFile(alias, "foreign namespace\n");
    f.stage("ccg-runtime-migration-plan", [], 1);
    assert.equal(await readFile(alias, "utf8"), "foreign namespace\n");
    await rm(alias);
    f.stage("bootstrap-begin", ["--manage-ccg", ...f.planFlags]);
    f.npm(["install", "-g", "--install-links=true", "--install-strategy=nested", f.source]);
    f.stage("bootstrap-runtime-checkpoint");
    const scopedCli = path.join(f.globalRoot, ...PACKAGE.split("/"), "bin", "ccg.mjs");
    const checkpoint = await readFile(scopedCli);
    await writeFile(scopedCli, "// checkpoint user edit\n");
    f.stage("bootstrap-abort", [], 1);
    assert.equal(await readFile(scopedCli, "utf8"), "// checkpoint user edit\n");
    assert.deepEqual(await readFile(path.join(f.project, ".harness-cache", "ownership.json")), f.baselineOwnership);
    await writeFile(scopedCli, checkpoint);
    f.stage("bootstrap-abort");
    assert.equal(await inspectGlobalPackage(f.globalRoot, PACKAGE), null);
    assert.deepEqual(await inspectGlobalPackage(f.globalRoot, "ccg-workflow"), f.baselineRuntime);
    assert.deepEqual(await readFile(path.join(f.project, ".harness-cache", "ownership.json")), f.baselineOwnership);
  } finally { await dispose(f); }
});

test("pinned npm archive verifies actual package identity before runtime mutation", async () => {
  const f = await fixture();
  try {
    const archiveName = JSON.parse(f.npm(["pack", f.source, "--pack-destination", f.root, "--json"]).stdout)[0].filename;
    const archive = path.join(f.root, archiveName);
    const archiveSha = sha(await readFile(archive));
    const expected = { ccg: { package: PACKAGE, version: VERSION } };
    assert.equal((await verifyCcgPackageArchive(archive, archiveSha, expected)).command, "ccg-codex");
    await assert.rejects(verifyCcgPackageArchive(archive, "0".repeat(64), expected), /SHA-256 mismatch/);
    await assert.rejects(verifyCcgPackageArchive(archive, archiveSha, { ccg: { package: "ccg-workflow", version: VERSION } }), /identity/);
    await assert.rejects(verifyCcgPackageArchive(archive, archiveSha, { ccg: { package: PACKAGE, version: "9.0.0" } }), /identity/);
    const identity = f.stage("ccg-runtime-migration-plan").stdout;
    assert.equal(JSON.parse(identity).targetVersion, VERSION);
    assert.deepEqual(await readFile(path.join(f.project, ".harness-cache", "ownership.json")), f.baselineOwnership);
  } finally { await dispose(f); }
});
