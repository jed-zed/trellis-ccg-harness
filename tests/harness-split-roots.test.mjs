import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveCodexHome } from "../.agents/skills/harness-init/scripts/codex-home.mjs";
import { GLOBAL_PLATFORM_SKILLS, rollbackPlatformSourceUpdate } from "../.agents/skills/harness-init/scripts/skill-platform-migration.mjs";
import { installBundledPlatformSkills, loadGlobalInitState, inspectProviderCliStatuses } from "../.agents/skills/harness-init/scripts/guided-init.mjs";
import { runGlobalInit, runHarnessInitCli } from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";
import { buildThirdPartyApprovalPlan, thirdPartySubprocessEnvironment, verifyThirdPartyApprovalPlanForOperation } from "../.agents/skills/harness-init/scripts/third-party-approval.mjs";
import { runUserStateChecks } from "../scripts/lib/harness-adapter/conflict-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.join(ROOT, ".agents", "skills", "harness-init");
const MANIFEST_PATH = path.join(SKILL_ROOT, "assets", "third-party-sources.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-split-roots-"));
  const homeDir = path.join(root, "agents-user");
  const codexHome = path.join(root, "physical-codex");
  const repoRoot = path.join(root, "project");
  const platformSkillsRoot = path.join(root, "platform");
  for (const dir of [homeDir, codexHome, repoRoot, platformSkillsRoot]) mkdirSync(dir);
  for (const name of GLOBAL_PLATFORM_SKILLS) {
    mkdirSync(path.join(platformSkillsRoot, name));
    writeFileSync(path.join(platformSkillsRoot, name, "SKILL.md"), `---\nname: ${name}\ndescription: Test source\n---\n# Original\n`);
  }
  const sentinel = path.join(codexHome, "auth-sentinel.txt");
  writeFileSync(sentinel, "fixture credentials remain untouched\n");
  return { root, homeDir, codexHome, repoRoot, platformSkillsRoot, sentinel,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
}

async function plan(value, codexHome = value.codexHome) {
  return buildThirdPartyApprovalPlan({ homeDir: value.homeDir, codexHome,
    repoRoot: value.repoRoot, manifestPath: MANIFEST_PATH, env: {},
    approvedCommandRoots: [], approvedPackageRoots: [] });
}

test("split roots preserve an existing AgentsHome junction and reject it as the selected physical root", async () => {
  const value = fixture();
  try {
    const junction = path.join(value.homeDir, ".codex");
    symlinkSync(value.codexHome, junction, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await resolveCodexHome(value.homeDir, value.codexHome), value.codexHome);
    await assert.rejects(resolveCodexHome(value.homeDir), /non-linked/);
    await assert.rejects(resolveCodexHome(value.homeDir, junction), /non-linked/);
    assert.equal(readFileSync(value.sentinel, "utf8"), "fixture credentials remain untouched\n");
    assert.equal(existsSync(junction), true);
  } finally { value.cleanup(); }
});

test("addon plan and subprocess environment bind the physical Codex root and reject a root switch", async () => {
  const value = fixture();
  try {
    const first = await plan(value);
    const other = path.join(value.root, "other-codex"); mkdirSync(other);
    assert.notEqual(first.planSha256, (await plan(value, other)).planSha256);
    const env = thirdPartySubprocessEnvironment(first, {});
    assert.equal(env.HOME, value.homeDir); assert.equal(env.USERPROFILE, value.homeDir);
    assert.equal(env.CODEX_HOME, value.codexHome);
    await assert.rejects(verifyThirdPartyApprovalPlanForOperation({
      approvalPlan: first, homeDir: value.homeDir, codexHome: other, repoRoot: value.repoRoot,
      manifest: JSON.parse(readFileSync(MANIFEST_PATH, "utf8")), manifestSha256: first.sourceManifestSha256,
      strictDataBoundary: false, env: {},
    }), /subprocess configuration roots/);
  } finally { value.cleanup(); }
});

test("Global Init and CLI repeat on split roots without touching physical Codex credentials or Claude", async () => {
  const value = fixture();
  try {
    const cliPlan = await plan(value);
    const options = { approved: true, catalogMode: "skip", homeDir: value.homeDir,
      codexHome: value.codexHome, repoRoot: value.repoRoot, skillRoot: SKILL_ROOT,
      providerActions: Object.fromEntries(["codex", "gemini", "grok", "claude"].map((name) => [name, "later"])),
      providerStatusOverrides: Object.fromEntries(["codex", "gemini", "grok", "claude"].map((name) => [name, "not-installed"])),
      thirdPartyApprovalPlan: cliPlan, thirdPartyPlanSha256: cliPlan.planSha256,
      thirdPartySourceSha256: cliPlan.sourceManifestSha256 };
    assert.equal((await runGlobalInit(options)).status, "initialized");
    assert.equal((await runGlobalInit(options)).status, "unchanged");
    const state = await loadGlobalInitState({ homeDir: value.homeDir, codexHome: value.codexHome });
    assert.equal(state.codexHome, value.codexHome);
    assert.equal(existsSync(path.join(value.homeDir, ".codex")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
    assert.equal(readFileSync(value.sentinel, "utf8"), "fixture credentials remain untouched\n");
    let output = "";
    await runHarnessInitCli(["third-party-plan", "--home-dir", value.homeDir, "--codex-home", value.codexHome, "--repo-root", value.repoRoot], {
      stdout: { write: (bytes) => { output += bytes; } },
      thirdPartyPlanBuilder: ({ homeDir, codexHome, repoRoot }) => plan({ ...value, homeDir, codexHome, repoRoot }),
    });
    assert.equal(JSON.parse(output).execution.subprocessConfigRoots.codexHome, value.codexHome);
  } finally { value.cleanup(); }
});

test("same-count platform source upgrade keeps signed old ownership and refuses rollback over user edits", async () => {
  const value = fixture();
  try {
    const options = { approved: true, ...value };
    const before = await installBundledPlatformSkills(options);
    assert.equal(before.status, "installed");
    const manifestBefore = readFileSync(before.manifestPath);
    const source = path.join(value.platformSkillsRoot, "harness-init", "SKILL.md");
    writeFileSync(source, `${readFileSync(source, "utf8")}\n# Updated\n`);
    const updated = await installBundledPlatformSkills(options);
    assert.equal(updated.status, "upgraded"); assert.ok(updated.sourceUpdateBackupId);
    const backupRoot = path.join(value.homeDir, ".agents", "harness", "source-updates", updated.sourceUpdateBackupId);
    const journal = JSON.parse(readFileSync(path.join(backupRoot, "journal.json"), "utf8"));
    assert.equal(journal.status, "completed"); assert.equal(journal.codexHome, value.codexHome);
    assert.equal(journal.controls[0].beforeSha256, hash(manifestBefore));
    assert.equal(journal.provenance.algorithm, "hmac-sha256");
    assert.equal((await installBundledPlatformSkills(options)).status, "unchanged");
    const target = path.join(value.homeDir, ".agents", "skills", "harness-init", "SKILL.md");
    const installed = readFileSync(target); writeFileSync(target, Buffer.concat([installed, Buffer.from("\n# User edit\n")]));
    const changed = readFileSync(target), receipt = readFileSync(before.manifestPath);
    await assert.rejects(rollbackPlatformSourceUpdate({ approved: true, homeDir: value.homeDir,
      codexHome: value.codexHome, backupId: updated.sourceUpdateBackupId }), /changed after source update/);
    assert.deepEqual(readFileSync(target), changed); assert.deepEqual(readFileSync(before.manifestPath), receipt);
    writeFileSync(target, installed);
    assert.equal((await rollbackPlatformSourceUpdate({ approved: true, homeDir: value.homeDir,
      codexHome: value.codexHome, backupId: updated.sourceUpdateBackupId })).status, "rolled-back");
    assert.deepEqual(readFileSync(before.manifestPath), manifestBefore);
    assert.equal(readFileSync(value.sentinel, "utf8"), "fixture credentials remain untouched\n");
  } finally { value.cleanup(); }
});

test("source-update fault after ownership commits restores the old receipt and platform bytes", async () => {
  const value = fixture();
  try {
    const options = { approved: true, ...value };
    const first = await installBundledPlatformSkills(options), before = readFileSync(first.manifestPath);
    const target = path.join(value.homeDir, ".agents", "skills", "harness-init", "SKILL.md");
    const oldSkill = readFileSync(target);
    const source = path.join(value.platformSkillsRoot, "harness-init", "SKILL.md");
    writeFileSync(source, `${readFileSync(source, "utf8")}\n# New\n`);
    await assert.rejects(installBundledPlatformSkills({ ...options, faultInjector: async (phase) => {
      if (phase === "platform-source-ownership-committed") throw new Error("fixture ownership fault");
    } }), /fixture ownership fault/);
    assert.deepEqual(readFileSync(first.manifestPath), before); assert.deepEqual(readFileSync(target), oldSkill);
  } finally { value.cleanup(); }
});

test("source-update failure preserves a concurrent user edit and its original backup", async () => {
  const value = fixture();
  try {
    const options = { approved: true, ...value };
    const first = await installBundledPlatformSkills(options), before = readFileSync(first.manifestPath);
    const source = path.join(value.platformSkillsRoot, "harness-init", "SKILL.md");
    writeFileSync(source, `${readFileSync(source, "utf8")}\n# New\n`);
    const target = path.join(value.homeDir, ".agents", "skills", "harness-init", "SKILL.md");
    await assert.rejects(installBundledPlatformSkills({ ...options, faultInjector: async (phase) => {
      if (phase === "platform-source-installed:harness-init") {
        writeFileSync(target, "user edit while update fails\n"); throw new Error("fixture concurrent edit");
      }
    } }), /recovery data remains/);
    assert.equal(readFileSync(target, "utf8"), "user edit while update fails\n");
    assert.deepEqual(readFileSync(first.manifestPath), before);
  } finally { value.cleanup(); }
});

test("conflict inspection reads the selected physical root instead of AgentsHome/.codex", () => {
  const value = fixture();
  try {
    const cache = path.join(value.codexHome, "plugins", "cache", "ccg-gptpro-worflow", "ccg", "1.0.0", ".codex-plugin");
    mkdirSync(cache, { recursive: true }); writeFileSync(path.join(cache, "plugin.json"), '{"name":"ccg","version":"1.0.0"}\n');
    writeFileSync(path.join(value.codexHome, "hooks.json"), '{}\n');
    const findings = [];
    runUserStateChecks({ includeUserState: true, homeDir: value.homeDir, codexHome: value.codexHome,
      repoRoot: value.repoRoot, contract: { hooks: { promptEvent: "UserPromptSubmit" } },
      add: (...args) => findings.push(args) });
    assert.equal(findings.find((entry) => entry[0] === "ccg-plugin-cache")[2], "ok");
    assert.equal(existsSync(path.join(value.homeDir, ".codex")), false);
  } finally { value.cleanup(); }
});

test("provider metadata subprocesses keep AgentsHome and physical CODEX_HOME bound", async () => {
  const value = fixture();
  try {
    const observations = [];
    await inspectProviderCliStatuses({ homeDir: value.homeDir, codexHome: value.codexHome,
      runCommand: async (command, args, options) => {
        observations.push({ command, args, environment: options.environment });
        return { exitCode: 0, stdout: args[0] === "login" ? "Logged in\n" : "fixture 1.0.0\n", stderr: "" };
      } });
    for (const observation of observations) {
      assert.equal(observation.environment.HOME, value.homeDir);
      assert.equal(observation.environment.CODEX_HOME, value.codexHome);
    }
    assert.equal(observations.some((entry) => entry.command === "claude"), false);
  } finally { value.cleanup(); }
});

test("source rollback rejects forged journals, wrong roots and altered backups before any target mutation", async () => {
  const value = fixture();
  try {
    const options = { approved: true, ...value };
    await installBundledPlatformSkills(options);
    const source = path.join(value.platformSkillsRoot, "harness-init", "SKILL.md");
    writeFileSync(source, `${readFileSync(source, "utf8")}\n# Source revision\n`);
    const updated = await installBundledPlatformSkills(options);
    const base = { approved: true, homeDir: value.homeDir, codexHome: value.codexHome, backupId: updated.sourceUpdateBackupId };
    const journalPath = path.join(value.homeDir, ".agents", "harness", "source-updates", updated.sourceUpdateBackupId, "journal.json");
    const originalJournal = readFileSync(journalPath), journal = JSON.parse(originalJournal);
    const target = path.join(value.homeDir, ".agents", "skills", "harness-init", "SKILL.md");
    const installed = readFileSync(target), receipt = readFileSync(updated.manifestPath);
    journal.skills[0].path = path.join(value.codexHome, "auth-sentinel.txt");
    writeFileSync(journalPath, JSON.stringify(journal));
    await assert.rejects(rollbackPlatformSourceUpdate(base), /authenticated provenance/);
    writeFileSync(journalPath, originalJournal);
    const other = path.join(value.root, "other-physical-codex"); mkdirSync(other);
    await assert.rejects(rollbackPlatformSourceUpdate({ ...base, codexHome: other }), /selected roots differ/);
    const control = JSON.parse(originalJournal).controls[0];
    const originalBackup = readFileSync(control.backupPath); writeFileSync(control.backupPath, "changed original receipt\n");
    await assert.rejects(rollbackPlatformSourceUpdate(base), /backup drifted/);
    assert.deepEqual(readFileSync(target), installed); assert.deepEqual(readFileSync(updated.manifestPath), receipt);
    writeFileSync(control.backupPath, originalBackup);
    assert.equal((await rollbackPlatformSourceUpdate(base)).status, "rolled-back");
  } finally { value.cleanup(); }
});
