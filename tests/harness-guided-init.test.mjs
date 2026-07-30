import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyProjectContract,
  GLOBAL_PLATFORM_SKILLS,
  inspectProviderCliStatuses,
  markProjectReady,
  reviseReadyProjectSkills,
  runGlobalInit as runGlobalInitRaw,
  runHarnessInitCli as runHarnessInitCliRaw,
  runProjectInit as runProjectInitRaw,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";
import {
  buildThirdPartyApprovalPlan,
} from "../.agents/skills/harness-init/scripts/third-party-approval.mjs";
import {
  runProviderStatusCommand,
} from "../.agents/skills/harness-init/scripts/guided-init.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.join(ROOT, ".agents", "skills", "harness-init");
const TEMPLATE_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "project-contract.template.json",
);
const THIRD_PARTY_SOURCE_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "third-party-sources.json",
);
const THIRD_PARTY_MANIFEST = JSON.parse(
  readFileSync(THIRD_PARTY_SOURCE_PATH, "utf8"),
);
const THIRD_PARTY_SOURCE_SHA256 = createHash("sha256")
  .update(
    `${JSON.stringify(
      THIRD_PARTY_MANIFEST,
      null,
      2,
    )}\n`,
  )
  .digest("hex");

async function waitForFixtureFile(target, child) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (existsSync(target)) return;
    if (child.exitCode !== null) {
      throw new Error(
        `Child exited before writing ${target} (exit ${child.exitCode}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${target}.`);
}

function testCommandRoots(homeDir) {
  const root = path.join(path.dirname(homeDir), "trusted-test-commands");
  const packageRoot = path.join(root, "node_modules");
  const nativeRoot = path.join(root, "bin");
  for (const [packageName, binName] of [
    ["npm", "npm"],
    ["@openai/codex", "codex"],
  ]) {
    const target = path.join(packageRoot, ...packageName.split("/"));
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, `${binName}.js`), "#!/usr/bin/env node\n");
    writeFileSync(
      path.join(target, "package.json"),
      JSON.stringify({
        name: packageName,
        version: "1.0.0-test",
        bin: { [binName]: `${binName}.js` },
      }),
    );
  }
  mkdirSync(nativeRoot, { recursive: true });
  for (const name of ["git", "powershell", "tar"]) {
    const target = path.join(
      nativeRoot,
      process.platform === "win32" ? `${name}.exe` : name,
    );
    if (!existsSync(target)) copyFileSync(process.execPath, target);
  }
  return { packageRoot, nativeRoot };
}

async function testThirdPartyPlanBuilder({
  homeDir,
  repoRoot,
  skillRoot,
  strictDataBoundary,
}) {
  const roots = testCommandRoots(homeDir);
  return buildThirdPartyApprovalPlan({
    approvedCommandRoots: [roots.nativeRoot],
    approvedPackageRoots: [roots.packageRoot],
    discoverCommandRoots: false,
    env: { PATH: roots.nativeRoot },
    homeDir,
    manifestPath: path.join(skillRoot, "assets", "third-party-sources.json"),
    repoRoot,
    strictDataBoundary,
  });
}

async function runGlobalInit(options) {
  const thirdPartyApprovalPlan =
    options.thirdPartyApprovalPlan ??
    (await testThirdPartyPlanBuilder({
      homeDir: options.homeDir,
      repoRoot: process.cwd(),
      skillRoot: options.skillRoot ?? SKILL_ROOT,
      strictDataBoundary: options.strictDataBoundary ?? false,
    }));
  return runGlobalInitRaw({
    thirdPartyPlanBuilder: testThirdPartyPlanBuilder,
    ...options,
    thirdPartyApprovalPlan,
    thirdPartyPlanSha256:
      options.thirdPartyPlanSha256 ?? thirdPartyApprovalPlan.planSha256,
  });
}

async function runProjectInit(options) {
  const contract = JSON.parse(readFileSync(options.contractPath, "utf8"));
  const thirdPartyApprovalPlan =
    options.thirdPartyApprovalPlan ??
    (await testThirdPartyPlanBuilder({
      homeDir: options.homeDir,
      repoRoot: options.repoRoot,
      skillRoot: options.skillRoot ?? SKILL_ROOT,
      strictDataBoundary:
        options.strictDataBoundary === true ||
        contract.security.strictDataBoundary === true,
    }));
  return runProjectInitRaw({
    thirdPartyPlanBuilder: testThirdPartyPlanBuilder,
    ...options,
    thirdPartyApprovalPlan,
    thirdPartyPlanSha256:
      options.thirdPartyPlanSha256 ?? thirdPartyApprovalPlan.planSha256,
  });
}

function runHarnessInitCli(argv, options = {}) {
  return runHarnessInitCliRaw(argv, {
    thirdPartyPlanBuilder: testThirdPartyPlanBuilder,
    ...options,
  });
}

async function resolveTestProviderActionCommand(logicalName) {
  return {
    logicalName,
    command: process.execPath,
    argsPrefix: [`fixture-${logicalName}.mjs`],
    identity: { kind: "test-command", logicalName },
  };
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-guided-init-"));
  const homeDir = path.join(root, "home");
  const repoRoot = path.join(root, "project");
  mkdirSync(homeDir);
  mkdirSync(repoRoot);
  writeFileSync(path.join(repoRoot, "package.json"), '{"private":true}\n');
  return {
    root,
    homeDir,
    repoRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeCatalogSkill(repository, name, description) {
  const target = path.join(repository, name);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    path.join(target, "SKILL.md"),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`,
  );
}

function initializeGitRepository(repository) {
  execFileSync("git", ["init", "-b", "main", repository], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", repository, "add", "."], { stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-C",
      repository,
      "-c",
      "user.name=Harness Tests",
      "-c",
      "user.email=harness-tests@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    { stdio: "ignore" },
  );
}

function addGitRemote(repository, url) {
  execFileSync("git", ["-C", repository, "remote", "add", "origin", url], {
    stdio: "ignore",
  });
}

function windowsShortPath(target) {
  if (/[\s&|<>()^!]/.test(target)) {
    return null;
  }
  return execFileSync(
    "cmd.exe",
    ["/d", "/c", `for %I in (${target}) do @echo %~sI`],
    { encoding: "utf8" },
  ).trim();
}

function approvedContract(repoRoot, selectedSkills = []) {
  const contract = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  contract.status = "approved";
  contract.project = {
    name: "guided-fixture",
    purpose: "Exercise the approved Project Init path.",
    repositoryRoot: ".",
    adoptionMode: "existing-codebase",
  };
  contract.workflow.taskLifecycle = ["planned", "implementing", "verified"];
  contract.workflow.managedProjectPaths = selectedSkills.length
    ? [
        ".harness/third-party-sources.json",
        ".harness/project-skills.json",
        ...selectedSkills.map((name) => `.agents/skills/${name}`),
      ]
    : [".harness/third-party-sources.json"];
  contract.qualityGates.requiredLocalCommands = ["node --test"];
  contract.qualityGates.requiredCiChecks = ["test"];
  contract.qualityGates.definitionOfDone = ["Required gates pass"];
  contract.security.dataClassification = "internal";
  contract.security.networkPolicy = "offline-by-default";
  contract.security.strictDataBoundary = false;
  contract.source.dependencyPolicy = "locked";
  contract.source.updatePolicy = "explicit-version";
  contract.source.rollbackPolicy = "transactional";
  contract.source.uninstallPolicy = "ownership-aware";
  contract.skills.globalEssential = [...GLOBAL_PLATFORM_SKILLS];
  contract.skills.projectSelection = selectedSkills.map((name) => ({
    name,
    reason: `Approved for the ${name} fixture.`,
  }));
  contract.thirdParty.sourceManifestSha256 = THIRD_PARTY_SOURCE_SHA256;
  contract.approval = {
    approvedAt: "2026-07-26T00:00:00.000Z",
    approvedBy: "repository-owner",
  };
  const contractPath = path.join(repoRoot, "approved-contract.json");
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  return contractPath;
}

const PROVIDER_LATER = {
  codex: "later",
  gemini: "later",
  grok: "later",
  claude: "skip",
};

test("Global Init installs all bundled platform Skills into an isolated home and is idempotent", async () => {
  const value = fixture();
  try {
    const first = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(first.status, "initialized");
    assert.equal(first.platform.installedSkills.length, 14);
    assert.equal(
      first.platform.installedSkills.includes("chatgpt-pro-sidebar"),
      true,
    );
    assert.equal(first.thirdParty.globalActions.status, "skipped");
    assert.equal(
      existsSync(
        path.join(
          value.homeDir,
          ".agents",
          "harness",
          "third-party-global-actions.json",
        ),
      ),
      false,
    );
    for (const name of GLOBAL_PLATFORM_SKILLS) {
      const target = path.join(
        value.homeDir,
        ".agents",
        "skills",
        name,
        "SKILL.md",
      );
      assert.equal(existsSync(target), true, name);
    }
    const manifestPath = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "global-skills.json",
    );
    const manifestBefore = readFileSync(manifestPath);
    const second = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(second.status, "unchanged");
    assert.deepEqual(readFileSync(manifestPath), manifestBefore);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("Global Init keeps Ponytail installation manual when host mutation is not create-only", async () => {
  const value = fixture();
  try {
    const sourceRoot = path.join(value.root, "ponytail-pinned");
    mkdirSync(sourceRoot);
    const ponytailCandidate = THIRD_PARTY_MANIFEST.candidates.find(
      (entry) => entry.id === "ponytail.install",
    );
    const ponytailSource = THIRD_PARTY_MANIFEST.sources.find(
      (entry) => entry.id === ponytailCandidate.sourceId,
    );
    const marketplaceName =
      `harness-ponytail-${ponytailSource.commit.slice(0, 12)}`;
    const marketplaceRoot = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "marketplaces",
      "ponytail",
      ponytailSource.commit,
    );
    mkdirSync(path.join(sourceRoot, ".codex-plugin"));
    writeFileSync(
      path.join(sourceRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "ponytail",
        version: ponytailSource.release,
        license: ponytailSource.license,
      }),
    );
    const commands = [];
    let marketplaceAddedInHost = false;
    let ponytailInstalledInHost = false;
    const result = await runGlobalInit({
      allowNetwork: true,
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
      thirdPartyGlobalPlugins: ["ponytail.install", "ponytail.hooks"],
      thirdPartyMcpCli: [],
      thirdPartyGlobalSkills: [],
      thirdPartySourceSha256: THIRD_PARTY_SOURCE_SHA256,
      thirdPartySourceResolver: async () => sourceRoot,
      thirdPartyRunCommand: async (command, args) => {
        commands.push({ command, args });
        if (command === "git") {
          return {
            stdout: `${ponytailCandidate.sourceGitTree}\n`,
            exitCode: 0,
          };
        }
        if (
          command === "codex" &&
          args.slice(0, 4).join(" ") ===
            "plugin marketplace list --json"
        ) {
          return {
            stdout: JSON.stringify({
              marketplaces: marketplaceAddedInHost
                ? [{ name: marketplaceName, root: marketplaceRoot }]
                : [],
            }),
            exitCode: 0,
          };
        }
        if (
          command === "codex" &&
          args.slice(0, 4).join(" ") === "plugin list --available --json"
        ) {
          return {
            stdout: JSON.stringify({
              installed: ponytailInstalledInHost
                ? [{
                  pluginId: `ponytail@${marketplaceName}`,
                  name: "ponytail",
                  marketplaceName,
                  version: ponytailSource.release,
                  installed: true,
                  source: { source: "local", path: sourceRoot },
                }]
                : [],
            }),
            exitCode: 0,
          };
        }
        if (
          command === "codex" &&
          args.slice(0, 3).join(" ") === "plugin marketplace add"
        ) {
          marketplaceAddedInHost = true;
        }
        if (
          command === "codex" &&
          args.slice(0, 2).join(" ") === "plugin add"
        ) {
          ponytailInstalledInHost = true;
        }
        return { stdout: "", exitCode: 0 };
      },
    });
    assert.equal(result.status, "needs-third-party-actions");
    assert.deepEqual(result.pendingThirdPartyActions.map((entry) => entry.id), [
      "ponytail.install",
    ]);
    assert.deepEqual(result.failedThirdPartyActions, []);
    assert.match(
      result.pendingThirdPartyActions[0].reason,
      /atomic create-only.*not proven non-overwriting/i,
    );
    // Read-only inventory is allowed, but neither host marketplace nor plugin
    // state may be mutated when Codex lacks create-only semantics.
    assert.equal(commands.filter((entry) => entry.command === "codex").length, 2);
    assert.equal(marketplaceAddedInHost, false);
    assert.equal(ponytailInstalledInHost, false);
  } finally {
    value.cleanup();
  }
});

test("Global Init never reports a failed approved third-party action as initialized", async () => {
  const value = fixture();
  try {
    const result = await runGlobalInit({
      allowNetwork: true,
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
      thirdPartyGlobalPlugins: [],
      thirdPartyMcpCli: ["codegraph"],
      thirdPartyGlobalSkills: [],
      thirdPartySourceSha256: THIRD_PARTY_SOURCE_SHA256,
      thirdPartyRunCommand: async () => {
        throw new Error("simulated exact package acquisition failure");
      },
    });
    assert.equal(result.status, "third-party-actions-failed");
    assert.deepEqual(result.failedThirdPartyActions.map((entry) => entry.id), [
      "codegraph",
    ]);
    assert.equal(result.pendingThirdPartyActions.length, 0);
    assert.match(result.failedThirdPartyActions[0].error, /simulated/i);
  } finally {
    value.cleanup();
  }
});

test("Global Init never reports an approved third-party Skill source failure as initialized", async () => {
  const value = fixture();
  try {
    const result = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed", gemini: "not-installed", grok: "not-installed", claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
      thirdPartyGlobalPlugins: [],
      thirdPartyMcpCli: [],
      thirdPartyGlobalSkills: ["matt-grilling"],
      thirdPartySourceSha256: THIRD_PARTY_SOURCE_SHA256,
      thirdPartySourceResolver: async () => {
        throw new Error("simulated pinned Skill source outage");
      },
    });
    assert.equal(result.status, "third-party-skills-failed");
    assert.equal(result.failedThirdPartyGlobalSkills[0].id, "matt-grilling");
    assert.match(result.failedThirdPartyGlobalSkills[0].error, /outage/i);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")), false);
  } finally {
    value.cleanup();
  }
});

test("Global Init reports the actual approved Caveman Skill when its source is unavailable", async () => {
  const value = fixture();
  try {
    const result = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed", gemini: "not-installed", grok: "not-installed", claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
      thirdPartyGlobalPlugins: [],
      thirdPartyMcpCli: [],
      thirdPartyGlobalSkills: ["caveman"],
      thirdPartySourceSha256: THIRD_PARTY_SOURCE_SHA256,
      thirdPartySourceResolver: async () => {
        throw new Error("simulated pinned Caveman source outage");
      },
    });
    assert.equal(result.status, "third-party-skills-failed");
    assert.deepEqual(result.failedThirdPartyGlobalSkills.map((entry) => entry.id), ["caveman"]);
    assert.match(result.failedThirdPartyGlobalSkills[0].error, /Caveman source outage/i);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "caveman")), false);
  } finally {
    value.cleanup();
  }
});

test("Project Init never reports an approved third-party Skill source failure as awaiting gates", async () => {
  const value = fixture();
  try {
    const contractPath = approvedContract(value.repoRoot);
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.thirdParty.projectSkills = ["diagnosing-bugs"];
    contract.workflow.managedProjectPaths = [
      ".agents/skills/diagnosing-bugs",
      ".harness/third-party-installations.json",
      ".harness/third-party-sources.json",
    ];
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const result = await runProjectInit({
      approved: true,
      contractPath,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      selectedSkills: [],
      skillRoot: SKILL_ROOT,
      thirdPartyProjectSkills: ["diagnosing-bugs"],
      thirdPartySourceSha256: THIRD_PARTY_SOURCE_SHA256,
      thirdPartySourceResolver: async () => {
        throw new Error("simulated pinned project Skill source outage");
      },
    });
    assert.equal(result.status, "third-party-project-skills-failed");
    assert.match(result.failedThirdPartyProjectSkills[0].error, /outage/i);
    assert.equal(result.next.action, "resolve-third-party-project-skill-failure");
  } finally {
    value.cleanup();
  }
});

test("direct Project Init still rejects a draft contract without mutating the project", async () => {
  const value = fixture();
  try {
    const contractPath = approvedContract(value.repoRoot);
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.status = "draft";
    contract.approval = { approvedAt: null, approvedBy: null };
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    await assert.rejects(
      runProjectInit({
        approved: true,
        contractPath,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        selectedSkills: [],
        skillRoot: SKILL_ROOT,
        thirdPartyProjectSkills: [],
        thirdPartySourceSha256: THIRD_PARTY_SOURCE_SHA256,
      }),
      /status approved/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
  } finally {
    value.cleanup();
  }
});

test("Global Init fails closed on a fresh platform Skill collision", async () => {
  const value = fixture();
  try {
    const collision = path.join(
      value.homeDir,
      ".agents",
      "skills",
      "harness-init",
    );
    mkdirSync(collision, { recursive: true });
    writeFileSync(path.join(collision, "SKILL.md"), "user-owned\n");
    await assert.rejects(
      runGlobalInit({
        approved: true,
        catalogMode: "skip",
        homeDir: value.homeDir,
        providerActions: PROVIDER_LATER,
        providerStatusOverrides: {
          codex: "not-installed",
          gemini: "not-installed",
          grok: "not-installed",
          claude: "not-installed",
        },
        skillRoot: SKILL_ROOT,
      }),
      /collision|user-owned/i,
    );
    assert.equal(
      readFileSync(path.join(collision, "SKILL.md"), "utf8"),
      "user-owned\n",
    );
  } finally {
    value.cleanup();
  }
});

test("Global Init accepts the legacy 15-Skill ownership manifest without replacing grill-me", async () => {
  const value = fixture();
  try {
    await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const legacySkill = path.join(
      value.homeDir,
      ".agents",
      "skills",
      "grill-me",
    );
    mkdirSync(legacySkill, { recursive: true });
    const legacyDefinition = "---\nname: grill-me\ndescription: \"Legacy user-owned workflow.\"\n---\n";
    writeFileSync(path.join(legacySkill, "SKILL.md"), legacyDefinition);
    const manifestPath = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "global-skills.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.managedPlatformSkills.push({
      name: "grill-me",
      targetPath: legacySkill,
      treeSha256: "legacy-user-owned",
      fileCount: 1,
      totalBytes: Buffer.byteLength(legacyDefinition),
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const repeated = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(repeated.status, "unchanged");
    assert.equal(readFileSync(path.join(legacySkill, "SKILL.md"), "utf8"), legacyDefinition);
  } finally {
    value.cleanup();
  }
});

test("Global Init preserves an intact legacy Skill-platform migration manifest", async () => {
  const value = fixture();
  try {
    await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const manifestPath = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "global-skills.json",
    );
    const direct = JSON.parse(readFileSync(manifestPath, "utf8"));
    const legacy = {
      schemaVersion: 1,
      owner: "trellis-ccg-harness",
      profileSha256: "a".repeat(64),
      repository: {
        path: path.join(value.root, "catalog"),
        commit: "b".repeat(40),
        tree: "c".repeat(40),
      },
      managedPlatformSkills: direct.managedPlatformSkills.map((entry) => ({
        ...entry,
        sourcePath: path.join(SKILL_ROOT, entry.name),
      })),
      preservedExternalSkills: [],
      managedBlocks: [],
      project: {},
      backupId: "legacy-backup",
    };
    writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
    const before = readFileSync(manifestPath);

    const repeated = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(repeated.platform.ownershipMode, "skill-platform-migration");
    assert.deepEqual(readFileSync(manifestPath), before);

    writeFileSync(
      path.join(
        value.homeDir,
        ".agents",
        "skills",
        "harness-init",
        "SKILL.md",
      ),
      "drifted\n",
    );
    await assert.rejects(
      runGlobalInit({
        approved: true,
        catalogMode: "skip",
        homeDir: value.homeDir,
        providerActions: PROVIDER_LATER,
        providerStatusOverrides: {
          codex: "not-installed",
          gemini: "not-installed",
          grok: "not-installed",
          claude: "not-installed",
        },
        skillRoot: SKILL_ROOT,
      }),
      /Managed global platform Skill drifted: harness-init/i,
    );
  } finally {
    value.cleanup();
  }
});

test("Global Init records local catalog paths canonically and supports skip", async () => {
  const value = fixture();
  try {
    const repository = path.join(value.root, "catalog");
    mkdirSync(repository);
    writeCatalogSkill(repository, "test-first", "Use when tests lead changes.");
    initializeGitRepository(repository);
    const local = await runGlobalInit({
      approved: true,
      catalogMode: "local",
      catalogPath: repository,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "authenticated",
        gemini: "installed-unauthenticated",
        grok: "authentication-unknown",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(local.catalog.mode, "local");
    const profile = JSON.parse(
      readFileSync(
        path.join(
          value.homeDir,
          ".agents",
          "harness",
          "skill-repository.json",
        ),
        "utf8",
      ),
    );
    assert.equal(profile.repositoryPath, await realpath(repository));
    assert.equal(JSON.stringify(profile).includes("remote"), false);

    const contractPath = approvedContract(value.repoRoot, ["test-first"]);
    const project = await runProjectInit({
      approved: true,
      contractPath,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      selectedSkills: ["test-first"],
      skillRoot: SKILL_ROOT,
    });
    assert.equal(project.status, "approved-awaiting-gates");
    assert.deepEqual(project.next, {
      action: "run-approved-quality-gates-then-mark-ready",
      command: `node scripts/harness-init.mjs mark-ready --repo-root "${path.resolve(value.repoRoot)}"`,
    });
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project.json"),
          "utf8",
        ),
      ).status,
      "approved",
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".agents",
          "skills",
          "test-first",
          "SKILL.md",
        ),
      ),
      true,
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project-skills.json"),
          "utf8",
        ),
      ).managedPaths,
      [
        ".harness/project-skills.json",
        ".agents/skills/test-first",
      ],
    );
    const qualityGateExitCode = 0;
    assert.equal(qualityGateExitCode, 0);
    const readiness = await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(readiness.status, "ready");
  } finally {
    value.cleanup();
  }
});

test("ready Project Skill revision accepts a credential-free saved catalog remote and keeps generic reasons", async () => {
  const value = fixture();
  try {
    const repository = path.join(value.root, "remote-catalog");
    mkdirSync(repository);
    writeCatalogSkill(repository, "test-first", "Use when tests lead changes.");
    writeCatalogSkill(
      repository,
      "docs-helper",
      "Use when project documentation must stay current.",
    );
    initializeGitRepository(repository);
    addGitRemote(repository, "https://example.invalid/skills/catalog.git");
    await runGlobalInit({
      approved: true,
      catalogMode: "local",
      catalogPath: repository,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "authenticated",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const contractPath = approvedContract(value.repoRoot, ["test-first"]);
    await applyProjectContract({
      contractPath,
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });

    const revision = await reviseReadyProjectSkills({
      approved: true,
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      selectedSkills: ["test-first", "docs-helper"],
      globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(revision.status, "revised");
    const contract = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, ".harness", "project.json"),
        "utf8",
      ),
    );
    assert.deepEqual(contract.skills.projectSelection, [
      {
        name: "docs-helper",
        reason: "Approved as a project-specific Skill for this repository.",
      },
      {
        name: "test-first",
        reason: "Approved for the test-first fixture.",
      },
    ]);
    const manifest = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, ".harness", "project-skills.json"),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.repository.remotes, [
      {
        name: "origin",
        url: "https://example.invalid/skills/catalog.git",
      },
    ]);
    assert.equal(JSON.stringify(contract).includes("Caveman"), false);

    writeCatalogSkill(
      repository,
      "docs-helper",
      "Use when revised project documentation must stay current.",
    );
    execFileSync("git", ["-C", repository, "add", "."], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-C",
        repository,
        "-c",
        "user.name=Harness Tests",
        "-c",
        "user.email=harness-tests@example.invalid",
        "commit",
        "-m",
        "revise docs helper",
      ],
      { stdio: "ignore" },
    );
    await assert.rejects(
      reviseReadyProjectSkills({
        approved: true,
        repoRoot: value.repoRoot,
        homeDir: value.homeDir,
        selectedSkills: ["test-first", "docs-helper"],
        globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
        skillRoot: SKILL_ROOT,
      }),
      /explicit replacement approval/i,
    );
    const replacement = await reviseReadyProjectSkills({
      approved: true,
      replaceExisting: true,
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      selectedSkills: ["test-first", "docs-helper"],
      globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(replacement.status, "revised");
    assert.match(
      readFileSync(
        path.join(
          value.repoRoot,
          ".agents",
          "skills",
          "docs-helper",
          "SKILL.md",
        ),
        "utf8",
      ),
      /revised project documentation/,
    );
  } finally {
    value.cleanup();
  }
});

test("ready Project Skill revision rejects ignored files that are absent from the claimed commit", async () => {
  const value = fixture();
  try {
    const repository = path.join(value.root, "ignored-file-catalog");
    mkdirSync(repository);
    writeCatalogSkill(repository, "test-first", "Use when tests lead changes.");
    writeCatalogSkill(
      repository,
      "docs-helper",
      "Use when project documentation must stay current.",
    );
    writeFileSync(
      path.join(repository, ".gitignore"),
      "docs-helper/ignored-runtime.txt\n",
    );
    initializeGitRepository(repository);
    await runGlobalInit({
      approved: true,
      catalogMode: "local",
      catalogPath: repository,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "authenticated",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const contractPath = approvedContract(value.repoRoot, ["test-first"]);
    await applyProjectContract({
      contractPath,
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    writeFileSync(
      path.join(repository, "docs-helper", "ignored-runtime.txt"),
      "not committed\n",
    );

    await assert.rejects(
      reviseReadyProjectSkills({
        approved: true,
        repoRoot: value.repoRoot,
        homeDir: value.homeDir,
        selectedSkills: ["test-first", "docs-helper"],
        globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
        skillRoot: SKILL_ROOT,
      }),
      /not fully tracked by repository commit/i,
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".agents",
          "skills",
          "docs-helper",
          "ignored-runtime.txt",
        ),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("ready Project Skill revision recovers a hard kill after the journaled directory replacement", async () => {
  const value = fixture();
  let child;
  try {
    const repository = path.join(value.root, "recoverable-catalog");
    mkdirSync(repository);
    writeCatalogSkill(repository, "test-first", "Use when tests lead changes.");
    initializeGitRepository(repository);
    await runGlobalInit({
      approved: true,
      catalogMode: "local",
      catalogPath: repository,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "authenticated",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const contractPath = approvedContract(value.repoRoot, ["test-first"]);
    await applyProjectContract({
      contractPath,
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });

    writeCatalogSkill(
      repository,
      "test-first",
      "Use when revised tests lead changes.",
    );
    execFileSync("git", ["-C", repository, "add", "."], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-C",
        repository,
        "-c",
        "user.name=Harness Tests",
        "-c",
        "user.email=harness-tests@example.invalid",
        "commit",
        "-m",
        "revise test-first",
      ],
      { stdio: "ignore" },
    );

    const marker = path.join(value.root, "directory-replaced.marker");
    const coreModule = pathToFileURL(
      path.join(
        ROOT,
        ".agents",
        "skills",
        "harness-init",
        "scripts",
        "harness-init-core.mjs",
      ),
    ).href;
    const source = `
      const api = await import(${JSON.stringify(coreModule)});
      await api.reviseReadyProjectSkills({
        approved: true,
        replaceExisting: true,
        repoRoot: ${JSON.stringify(value.repoRoot)},
        homeDir: ${JSON.stringify(value.homeDir)},
        selectedSkills: ["test-first"],
        globalEssentialSkills: api.GLOBAL_PLATFORM_SKILLS,
        skillRoot: ${JSON.stringify(SKILL_ROOT)},
        faultInjector: async (phase) => {
          if (phase === "after-directory:.agents/skills/test-first") {
            await (await import("node:fs/promises")).writeFile(
              ${JSON.stringify(marker)},
              "ready\\n",
            );
            setInterval(() => {}, 1000);
            await new Promise(() => {});
          }
        },
      });
    `;
    child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForFixtureFile(marker, child);
    child.kill("SIGKILL");
    await once(child, "exit");
    child = null;

    const recovered = await reviseReadyProjectSkills({
      approved: true,
      replaceExisting: true,
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      selectedSkills: ["test-first"],
      globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(recovered.status, "revised");
    assert.match(
      readFileSync(
        path.join(
          value.repoRoot,
          ".agents",
          "skills",
          "test-first",
          "SKILL.md",
        ),
        "utf8",
      ),
      /revised tests lead changes/,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    value.cleanup();
  }
});

test("ready Project Skill revision rejects a credential-bearing catalog remote without mutation", async () => {
  const value = fixture();
  try {
    const repository = path.join(value.root, "credential-catalog");
    mkdirSync(repository);
    writeCatalogSkill(repository, "test-first", "Use when tests lead changes.");
    initializeGitRepository(repository);
    addGitRemote(
      repository,
      "https://catalog-user:catalog-secret@example.invalid/skills.git",
    );
    await runGlobalInit({
      approved: true,
      catalogMode: "local",
      catalogPath: repository,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "authenticated",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const contractPath = approvedContract(value.repoRoot);
    await applyProjectContract({
      contractPath,
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    const contractBefore = readFileSync(
      path.join(value.repoRoot, ".harness", "project.json"),
    );
    const ownershipBefore = readFileSync(
      path.join(value.repoRoot, ".harness", "ownership.json"),
    );

    await assert.rejects(
      reviseReadyProjectSkills({
        approved: true,
        repoRoot: value.repoRoot,
        homeDir: value.homeDir,
        selectedSkills: ["test-first"],
        globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
        skillRoot: SKILL_ROOT,
      }),
      /credentials|credential-free/i,
    );
    assert.deepEqual(
      readFileSync(path.join(value.repoRoot, ".harness", "project.json")),
      contractBefore,
    );
    assert.deepEqual(
      readFileSync(path.join(value.repoRoot, ".harness", "ownership.json")),
      ownershipBefore,
    );
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".agents", "skills", "test-first"),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("catalog clone requires network approval, rejects credential URLs, and accepts a local bare substitute", async () => {
  const value = fixture();
  try {
    const source = path.join(value.root, "catalog-source");
    const bare = path.join(value.root, "catalog.git");
    mkdirSync(source);
    writeCatalogSkill(source, "test-first", "Use when tests lead changes.");
    initializeGitRepository(source);
    execFileSync("git", ["clone", "--bare", source, bare], { stdio: "ignore" });
    const destination = path.join(value.root, "catalog-clone");

    await assert.rejects(
      runGlobalInit({
        approved: true,
        catalogMode: "clone",
        catalogPath: destination,
        catalogUrl: bare,
        homeDir: value.homeDir,
        providerActions: PROVIDER_LATER,
        providerStatusOverrides: {
          codex: "not-installed",
          gemini: "not-installed",
          grok: "not-installed",
          claude: "not-installed",
        },
        skillRoot: SKILL_ROOT,
      }),
      /allow-network|network approval/i,
    );
    await assert.rejects(
      runGlobalInit({
        allowNetwork: true,
        approved: true,
        catalogMode: "clone",
        catalogPath: destination,
        catalogUrl: "https://user:secret@example.invalid/catalog.git",
        homeDir: value.homeDir,
        providerActions: PROVIDER_LATER,
        providerStatusOverrides: {
          codex: "not-installed",
          gemini: "not-installed",
          grok: "not-installed",
          claude: "not-installed",
        },
        skillRoot: SKILL_ROOT,
      }),
      /credential/i,
    );
    await assert.rejects(
      runGlobalInit({
        allowNetwork: true,
        approved: true,
        catalogMode: "clone",
        catalogPath: destination,
        catalogUrl: "https://example.invalid/catalog.git?token=secret",
        homeDir: value.homeDir,
        providerActions: PROVIDER_LATER,
        providerStatusOverrides: {
          codex: "not-installed",
          gemini: "not-installed",
          grok: "not-installed",
          claude: "not-installed",
        },
        skillRoot: SKILL_ROOT,
      }),
      /credential|query/i,
    );
    const cloned = await runGlobalInit({
      allowNetwork: true,
      approved: true,
      catalogMode: "clone",
      catalogPath: destination,
      catalogUrl: bare,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(cloned.catalog.mode, "clone");
    assert.equal(cloned.catalog.repositoryPath, await realpath(destination));
    assert.equal(existsSync(path.join(destination, "test-first", "SKILL.md")), true);
    const repeated = await runGlobalInit({
      allowNetwork: true,
      approved: true,
      catalogMode: "clone",
      catalogPath: destination,
      catalogUrl: bare,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(repeated.status, "unchanged");
    assert.equal(repeated.catalog.status, "reused");
  } finally {
    value.cleanup();
  }
});

test("Global Init reuses a clone when a Windows retry uses its 8.3 catalog path", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows 8.3 paths are required for this regression.");
    return;
  }
  const value = fixture();
  try {
    const source = path.join(value.root, "catalog-source");
    const bare = path.join(value.root, "catalog.git");
    const destination = path.join(value.root, "catalog-clone");
    mkdirSync(source);
    writeCatalogSkill(source, "test-first", "Use when tests lead changes.");
    initializeGitRepository(source);
    execFileSync("git", ["clone", "--bare", source, bare], { stdio: "ignore" });

    await runGlobalInit({
      allowNetwork: true,
      approved: true,
      catalogMode: "clone",
      catalogPath: destination,
      catalogUrl: bare,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const shortDestination = windowsShortPath(destination);
    if (
      !shortDestination ||
      path.resolve(shortDestination).toLowerCase() ===
        path.resolve(destination).toLowerCase()
    ) {
      t.skip("The test volume does not expose a distinct Windows 8.3 path.");
      return;
    }

    const repeated = await runGlobalInit({
      allowNetwork: true,
      approved: true,
      catalogMode: "clone",
      catalogPath: shortDestination,
      catalogUrl: bare,
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(repeated.status, "unchanged");
    assert.equal(repeated.catalog.status, "reused");
    assert.equal(repeated.catalog.repositoryPath, await realpath(destination));
  } finally {
    value.cleanup();
  }
});

test("provider status commands receive only a minimal non-injectable environment", async () => {
  const value = fixture();
  try {
    const calls = [];
    const result = await runProviderStatusCommand(
      "codex",
      ["--version"],
      {
        environment: {
          HOME: value.homeDir,
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          PATH: "C:\\poisoned-path",
          NODE_OPTIONS: "--require C:\\inject.js",
          Node_Path: "C:\\inject-modules",
          LD_PRELOAD: "/tmp/inject.so",
          DYLD_INSERT_LIBRARIES: "/tmp/inject.dylib",
          GIT_CONFIG_GLOBAL: "C:\\inject.gitconfig",
          GIT_SSH_COMMAND: "inject-command",
          UNRELATED_SECRET: "must-not-pass",
        },
        execFileImpl: async (command, args, options) => {
          calls.push({ command, args, options });
          return { stdout: "codex 1.0", stderr: "" };
        },
        resolveCommand: async (logicalName) => ({
          logicalName,
          command: process.execPath,
          argsPrefix: ["fixture-status.mjs"],
          identity: { kind: "test-command", logicalName },
        }),
        verifyCommand: async () => {},
      },
    );
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls[0].args, ["fixture-status.mjs", "--version"]);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.env.HOME, value.homeDir);
    assert.equal(calls[0].options.env.LANG, "C.UTF-8");
    assert.equal(calls[0].options.env.LC_ALL, "C.UTF-8");
    const environmentNames = Object.keys(calls[0].options.env).map((name) =>
      name.toUpperCase(),
    );
    for (const forbidden of [
      "PATH",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "GIT_CONFIG_GLOBAL",
      "GIT_SSH_COMMAND",
      "UNRELATED_SECRET",
    ]) {
      assert.equal(environmentNames.includes(forbidden), false);
    }
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("provider status normalization is read-only and exposes install/login/later choices", async () => {
  const calls = [];
  const statuses = await inspectProviderCliStatuses({
    runCommand: async (command, args) => {
      calls.push([command, args]);
      if (command === "codex" && args[0] === "--version") {
        return { exitCode: 0, stdout: "codex 1.0", stderr: "" };
      }
      if (command === "codex") {
        return { exitCode: 0, stdout: "Logged in", stderr: "" };
      }
      if (command === "gemini" && args[0] === "--version") {
        return { exitCode: 0, stdout: "gemini 1.0", stderr: "" };
      }
      if (command === "grok" && args[0] === "--version") {
        return { exitCode: 0, stdout: "grok 1.0", stderr: "" };
      }
      return { exitCode: 127, stdout: "", stderr: "not found" };
    },
  });
  assert.equal(statuses.codex.status, "authenticated");
  assert.deepEqual(statuses.codex.choices, ["keep", "later"]);
  assert.equal(statuses.gemini.status, "authentication-unknown");
  assert.deepEqual(statuses.gemini.choices, ["login", "check", "later"]);
  assert.equal(statuses.grok.status, "authentication-unknown");
  assert.deepEqual(statuses.grok.choices, ["login", "check", "later"]);
  assert.equal(statuses.claude.status, "manual-only");
  assert.deepEqual(
    statuses.claude.choices,
    ["skip", "install", "login", "later"],
  );
  assert.equal(statuses.claude.recommendedAction, "skip");
  assert.deepEqual(
    calls.filter(([command]) => command === "claude"),
    [],
  );
  assert.equal(
    calls.some(
      ([, args]) =>
        args.includes("login") &&
        !args.includes("status"),
    ),
    false,
  );
  assert.deepEqual(
    calls.filter(([command]) => command === "gemini"),
    [["gemini", ["--version"]]],
  );
  assert.deepEqual(
    calls.filter(([command]) => command === "grok"),
    [["grok", ["--version"]]],
  );
});

test("Project Init applies an approved no-catalog contract and leaves readiness until gates pass", async () => {
  const value = fixture();
  try {
    await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: PROVIDER_LATER,
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "not-installed",
      },
      skillRoot: SKILL_ROOT,
    });
    const contractPath = approvedContract(value.repoRoot);
    const result = await runProjectInit({
      approved: true,
      contractPath,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      selectedSkills: [],
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "approved-awaiting-gates");
    assert.match(result.next.command, /mark-ready/);
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project.json"),
          "utf8",
        ),
      ).status,
      "approved",
    );
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    const qualityGateExitCode = 0;
    assert.equal(qualityGateExitCode, 0);
    const readiness = await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(readiness.status, "ready");
  } finally {
    value.cleanup();
  }
});

test("provider install/login selections become pending actions and can resolve without changing platform or catalog", async () => {
  const value = fixture();
  try {
    const pending = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: {
        codex: "install",
        gemini: "login",
        grok: "login",
        claude: "login",
      },
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "authentication-unknown",
        grok: "authentication-unknown",
        claude: "authentication-unknown",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(pending.status, "needs-provider-actions");
    assert.equal(pending.zeroClaudeProfile, false);
    assert.deepEqual(
      pending.pendingProviderActions.map(({ provider, action }) => [
        provider,
        action,
      ]),
      [
        ["codex", "install"],
        ["gemini", "login"],
        ["grok", "login"],
        ["claude", "login"],
      ],
    );
    for (const action of pending.pendingProviderActions) {
      assert.equal(action.requiresSeparateApproval, true);
      assert.equal(action.executed, false);
      assert.ok(action.guidance);
    }
    assert.deepEqual(
      pending.pendingProviderActions.find(
        ({ provider }) => provider === "grok",
      ).guidance,
      {
        kind: "command",
        command: ["grok", "login"],
      },
    );
    assert.deepEqual(
      pending.pendingProviderActions.find(
        ({ provider }) => provider === "gemini",
      ).guidance,
      {
        kind: "official-documentation",
        reference: "Google Gemini CLI authentication documentation",
      },
    );
    assert.deepEqual(
      pending.pendingProviderActions.find(
        ({ provider }) => provider === "claude",
      ).exitsZeroClaudeProfile,
      true,
    );
    const manifestPath = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "global-skills.json",
    );
    const manifestBefore = readFileSync(manifestPath);
    const statePath = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "global-init.json",
    );
    const stateBefore = JSON.parse(readFileSync(statePath, "utf8"));

    const resolved = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: {
        codex: "keep",
        gemini: "keep",
        grok: "later",
        claude: "later",
      },
      providerStatusOverrides: {
        codex: "authenticated",
        gemini: "authenticated",
        grok: "authentication-unknown",
        claude: "authentication-unknown",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(resolved.status, "initialized");
    assert.deepEqual(resolved.pendingProviderActions, []);
    assert.equal(resolved.zeroClaudeProfile, false);
    assert.deepEqual(readFileSync(manifestPath), manifestBefore);
    const stateAfter = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(stateAfter.catalog, stateBefore.catalog);
    assert.equal(
      stateAfter.platformManifestPath,
      stateBefore.platformManifestPath,
    );
    assert.deepEqual(stateAfter.providerActions, {
      codex: "keep",
      gemini: "keep",
      grok: "later",
      claude: "later",
    });
    assert.equal(stateAfter.zeroClaudeProfile, false);

    const resolvedStateBytes = readFileSync(statePath);
    await assert.rejects(
      runGlobalInit({
        approved: true,
        catalogMode: "skip",
        homeDir: value.homeDir,
        providerActions: {
          codex: "keep",
          gemini: "keep",
          grok: "login",
          claude: "later",
        },
        providerStatusOverrides: {
          codex: "authenticated",
          gemini: "authenticated",
          grok: "authentication-unknown",
          claude: "authentication-unknown",
        },
        skillRoot: SKILL_ROOT,
      }),
      /transition is not allowed/i,
    );
    assert.deepEqual(readFileSync(statePath), resolvedStateBytes);
  } finally {
    value.cleanup();
  }
});

test("provider state permits manual install to advance to a separately approved login", async () => {
  const value = fixture();
  try {
    await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: {
        codex: "install",
        gemini: "later",
        grok: "later",
        claude: "skip",
      },
      providerStatusOverrides: {
        codex: "not-installed",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "manual-only",
      },
      skillRoot: SKILL_ROOT,
    });
    const advanced = await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: {
        codex: "login",
        gemini: "later",
        grok: "later",
        claude: "skip",
      },
      providerStatusOverrides: {
        codex: "authentication-unknown",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "manual-only",
      },
      skillRoot: SKILL_ROOT,
    });
    assert.equal(advanced.status, "needs-provider-actions");
    assert.deepEqual(
      advanced.pendingProviderActions.map(({ provider, action }) => [
        provider,
        action,
      ]),
      [["codex", "login"]],
    );
  } finally {
    value.cleanup();
  }
});

test("provider action CLI requires a read-only plan and a second default-cancel approval", async () => {
  const value = fixture();
  const output = [];
  const calls = [];
  try {
    await runGlobalInit({
      approved: true,
      catalogMode: "skip",
      homeDir: value.homeDir,
      providerActions: {
        codex: "login",
        gemini: "later",
        grok: "later",
        claude: "skip",
      },
      providerStatusOverrides: {
        codex: "authentication-unknown",
        gemini: "not-installed",
        grok: "not-installed",
        claude: "manual-only",
      },
      skillRoot: SKILL_ROOT,
    });
    await assert.rejects(
      runHarnessInitCli([
        "provider-action-plan",
        "--home-dir",
        value.homeDir,
        "--provider",
        "codex",
        "--action",
        "login",
      ]),
      /requires explicit --repo-root/i,
    );
    const plan = await runHarnessInitCli(
      [
        "provider-action-plan",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
        "--provider",
        "codex",
        "--action",
        "login",
      ],
      {
        providerActionResolveCommand:
          resolveTestProviderActionCommand,
        skillRoot: SKILL_ROOT,
        stdout: { write(chunk) { output.push(String(chunk)); } },
      },
    );
    assert.equal(plan.execution.kind, "manual-only");
    assert.equal(
      plan.execution.reason,
      "provider-login-execution-not-provably-immutable",
    );
    assert.deepEqual(
      plan.execution.command,
      [process.execPath, "fixture-codex.mjs", "login"],
    );
    assert.match(plan.planSha256, /^[a-f0-9]{64}$/);

    const executed = await runHarnessInitCli(
      [
        "provider-action-run",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
        "--provider",
        "codex",
        "--action",
        "login",
        "--plan-sha256",
        plan.planSha256,
        "--approved",
      ],
      {
        promptChoice: async (question) => {
          assert.deepEqual(question.options, ["cancel", "show-guide"]);
          assert.equal(question.recommended, "cancel");
          return "show-guide";
        },
        providerActionRunCommand: async (command, args, options) => {
          calls.push({ command, args, options });
          return { exitCode: 0, signal: null };
        },
        providerActionResolveCommand:
          resolveTestProviderActionCommand,
        providerActionVerifyCommand: async () => {},
        skillRoot: SKILL_ROOT,
        stdout: { write(chunk) { output.push(String(chunk)); } },
      },
    );
    assert.equal(executed.status, "manual-only");
    assert.equal(executed.executed, false);
    assert.deepEqual(executed.execution.command, [
      process.execPath,
      "fixture-codex.mjs",
      "login",
    ]);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);

    await assert.rejects(
      runHarnessInitCli([
        "provider-action-run",
        "--non-interactive",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
        "--provider",
        "codex",
        "--action",
        "login",
        "--plan-sha256",
        plan.planSha256,
        "--approved",
      ]),
      /refuses non-interactive execution/i,
    );
  } finally {
    value.cleanup();
  }
});

test("non-interactive CLI requires complete flags and never reads stdin", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      runHarnessInitCli(
        [
          "global-init",
          "--non-interactive",
          "--home-dir",
          value.homeDir,
          "--catalog-mode",
          "skip",
          "--approved",
        ],
        {
          skillRoot: SKILL_ROOT,
          stdin: {
            isTTY: false,
            once() {
              throw new Error("stdin must not be read");
            },
          },
          stdout: { write() {} },
        },
      ),
      /provider-actions/i,
    );
  } finally {
    value.cleanup();
  }
});

test("explicit global-init CLI succeeds without stdin and exported instructions require native structured choices", async () => {
  const value = fixture();
  const output = [];
  try {
    const result = await runHarnessInitCli(
      [
        "global-init",
        "--non-interactive",
        "--home-dir",
        value.homeDir,
        "--catalog-mode",
        "skip",
        "--provider-actions",
        "codex=later,gemini=later,grok=later,claude=skip",
        "--third-party-global-skills",
        "none",
        "--third-party-global-plugins",
        "none",
        "--third-party-mcp-cli",
        "none",
        "--third-party-source-sha256",
        THIRD_PARTY_SOURCE_SHA256,
        "--approved",
      ],
      {
        providerRunCommand: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "not installed",
        }),
        skillRoot: SKILL_ROOT,
        stdin: {
          isTTY: false,
          once() {
            throw new Error("stdin must not be read");
          },
        },
        stdout: {
          write(value) {
            output.push(String(value));
          },
        },
      },
    );
    assert.equal(result.status, "initialized");
    assert.equal(JSON.parse(output.join("")).status, "initialized");
    const skill = readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
    assert.match(skill, /global-init/);
    assert.match(skill, /project-init/);
    assert.match(skill, /native structured-choice control/i);
    assert.match(skill, /one numbered TTY\s+choice at a time/i);
    assert.match(skill, /never reads stdin/i);
    assert.match(skill, /--home-dir/);
  } finally {
    value.cleanup();
  }
});
