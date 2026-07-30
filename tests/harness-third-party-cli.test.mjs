import assert from "node:assert/strict";
import { copyFileSync, cpSync } from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runHarnessInitCli as runHarnessInitCliRaw,
  saveSkillRepositoryProfile,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";
import {
  buildThirdPartyApprovalPlan,
  loadThirdPartySourceManifest,
  snapshotThirdPartyTree,
} from "../.agents/skills/harness-init/scripts/third-party-approval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.join(ROOT, ".agents", "skills", "harness-init");
const SOURCE_MANIFEST = path.join(
  SKILL_ROOT,
  "assets",
  "third-party-sources.json",
);
const PUBLIC_CONTRACT = path.join(
  ROOT,
  "tests",
  "fixtures",
  "public-baseline-approved-contract.json",
);
const AI_INSTALL = path.join(ROOT, "AI_INSTALL.md");

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

function runHarnessInitCli(argv, options = {}) {
  return runHarnessInitCliRaw(argv, {
    thirdPartyPlanBuilder: testThirdPartyPlanBuilder,
    ...options,
  });
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-third-party-cli-"));
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

const missingProvider = async () => ({
  exitCode: 127,
  stdout: "",
  stderr: "not installed",
});

function draftContract() {
  const contract = JSON.parse(readFileSync(PUBLIC_CONTRACT, "utf8"));
  contract.status = "draft";
  contract.workflow.managedProjectPaths = [];
  contract.skills.projectSelection = [];
  contract.thirdParty = {
    sourceManifestSha256: null,
    globalSkills: [],
    globalPlugins: [],
    projectSkills: [],
    mcpCli: [],
    excluded: [],
  };
  contract.approval = { approvedAt: null, approvedBy: null };
  return contract;
}

async function thirdPartyProjectFixture(value, { candidates = [] } = {}) {
  const skillRoot = path.join(value.root, "harness-init");
  const sourceRoot = path.join(value.root, "third-party-source");
  cpSync(SKILL_ROOT, skillRoot, { recursive: true });
  mkdirSync(sourceRoot);
  const sourceCandidates = [];
  for (const entry of candidates) {
    const sourcePath = path.join(sourceRoot, entry.id);
    mkdirSync(sourcePath);
    writeFileSync(
      path.join(sourcePath, "SKILL.md"),
      `---\nname: ${entry.id}\ndescription: "Test third-party Skill."\n---\n`,
    );
    const snapshot = await snapshotThirdPartyTree(sourcePath);
    sourceCandidates.push({
      id: entry.id,
      name: entry.id,
      group: "project-skills",
      sourceId: "test-source",
      purpose: "Exercise explicit project approval.",
      scope: "project-local",
      approvalDefaults: { selected: false },
      recommended: entry.recommended ?? true,
      dependencies: entry.dependencies ?? [],
      paths: [
        {
          name: entry.id,
          sourcePath: entry.id,
          targetPath: `.agents/skills/${entry.id}`,
          treeSha256: snapshot.treeSha256,
          fileCount: snapshot.fileCount,
          totalBytes: snapshot.totalBytes,
        },
      ],
      effects: {
        scripts: false,
        hooks: false,
        executables: false,
        network: false,
        dataEgress: "none",
      },
      strictDataBoundaryAllowed: entry.strictDataBoundaryAllowed ?? true,
      lifecycle: {
        update: "explicit",
        rollback: "transactional",
        uninstall: "ownership-aware",
      },
    });
  }
  const manifest = {
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    approvalDefaults: { selected: false },
    sources: [
      {
        id: "test-source",
        repository: "https://example.invalid/test-source.git",
        commit: "1111111111111111111111111111111111111111",
        gitTree: "2222222222222222222222222222222222222222",
        license: "MIT",
      },
    ],
    candidates: sourceCandidates,
    exclusions: [],
  };
  const manifestPath = path.join(skillRoot, "assets", "third-party-sources.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const loaded = await loadThirdPartySourceManifest({ manifestPath });
  return {
    manifestSha256: loaded.manifestSha256,
    skillRoot,
    sourceRoot,
  };
}

test("third-party-plan is read-only and every candidate is unselected", async () => {
  const value = fixture();
  try {
    const result = await runHarnessInitCli(
      [
        "third-party-plan",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    assert.deepEqual(
      result.groups.map((group) => group.id),
      ["global-skills", "global-plugins", "project-skills", "mcp-cli"],
    );
    assert.equal(
      result.groups
        .flatMap((group) => group.candidates)
        .every((candidate) => candidate.selected === false),
      true,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".codegraph")), false);
  } finally {
    value.cleanup();
  }
});

test("package and README expose the human and AI add-on entry points", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts.addons,
    "node ./scripts/harness-init.mjs addons",
  );
  assert.equal(existsSync(AI_INSTALL), true);
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /AI_INSTALL\.md/);
  assert.match(readme, /pnpm addons/);
  const aiInstall = readFileSync(AI_INSTALL, "utf8");
  assert.match(
    aiInstall,
    /\.agents\/skills\/harness-init\/assets\/third-party-sources\.json/,
  );
  assert.match(aiInstall, /--third-party-global-skills/);
  assert.match(aiInstall, /--third-party-global-plugins/);
  assert.match(aiInstall, /--third-party-mcp-cli/);
  assert.match(aiInstall, /--third-party-source-sha256/);
  assert.match(aiInstall, /--third-party-plan-sha256/);
  for (const name of ["Context7", "Playwright", "DeepWiki", "Exa"]) {
    assert.match(readme, new RegExp(name, "i"));
    assert.match(aiInstall, new RegExp(name, "i"));
  }
  assert.match(readme, /https:\/\/mcp\.deepwiki\.com\/mcp/i);
  assert.match(aiInstall, /https:\/\/mcp\.deepwiki\.com\/mcp/i);
  assert.match(readme, /https:\/\/dashboard\.exa\.ai\/api-keys/i);
  assert.match(aiInstall, /https:\/\/dashboard\.exa\.ai\/api-keys/i);
  assert.match(aiInstall, /ccg config mcp/i);
});

test("addons status is read-only, global-only, and machine-readable", async () => {
  const value = fixture();
  try {
    const result = await runHarnessInitCli(
      [
        "addons",
        "--status",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    assert.equal(result.command, "addons");
    assert.equal(result.mode, "status");
    assert.match(result.sourceManifestSha256, /^[a-f0-9]{64}$/);
    assert.match(result.planSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.id),
      [
        "matt-grilling",
        "caveman",
        "ponytail.install",
        "ponytail.hooks",
        "ponytail.default-full",
        "codegraph",
        "fast-context",
        "context7",
        "playwright",
        "deepwiki",
        "exa",
        "ripgrep",
      ],
    );
    assert.equal(
      result.candidates.every(
        (candidate) =>
          candidate.group !== "project-skills" &&
          candidate.selected === false &&
          typeof candidate.status === "string" &&
          typeof candidate.effects.network === "boolean",
      ),
      true,
    );
    assert.equal(
      result.candidates.find((candidate) => candidate.id === "ponytail.hooks")
        .status,
      "blocked",
    );
    for (const id of ["context7", "playwright", "deepwiki", "exa"]) {
      const candidate = result.candidates.find((entry) => entry.id === id);
      assert.equal(candidate.kind, "ccg-managed-mcp");
      assert.deepEqual(candidate.action, {
        status: "ccg-managed",
        command: "ccg config mcp",
        guidance: candidate.action.guidance,
      });
      assert.equal(candidate.selected, false);
      assert.equal(candidate.recommended, true);
    }
    assert.equal(
      result.candidates.find((candidate) => candidate.id === "deepwiki")
        .source.endpoint,
      "https://mcp.deepwiki.com/mcp",
    );
    assert.equal(
      result.candidates.find((candidate) => candidate.id === "exa")
        .source.accessGuide,
      "https://dashboard.exa.ai/api-keys",
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".codegraph")), false);
  } finally {
    value.cleanup();
  }
});

test("addons plan-only binds explicit selections without mutation", async () => {
  const value = fixture();
  try {
    const result = await runHarnessInitCli(
      [
        "addons",
        "--plan-only",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
        "--third-party-global-skills",
        "caveman",
        "--third-party-global-plugins",
        "none",
        "--third-party-mcp-cli",
        "none",
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    assert.equal(result.mode, "plan");
    assert.deepEqual(result.selections, {
      globalSkills: ["caveman"],
      globalPlugins: [],
      mcpCli: [],
    });
    assert.deepEqual(result.approvals.approvedActionIds, ["caveman"]);
    assert.deepEqual(result.networkCandidateIds, ["caveman"]);
    assert.equal(
      result.approvals.planSha256,
      result.planSha256,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("addons read-only modes reject approval flags and incomplete selections", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      runHarnessInitCli(
        [
          "addons",
          "--status",
          "--home-dir",
          value.homeDir,
          "--approved",
        ],
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /status.*read-only|approved/i,
    );
    await assert.rejects(
      runHarnessInitCli(
        [
          "addons",
          "--plan-only",
          "--home-dir",
          value.homeDir,
          "--third-party-global-skills",
          "none",
        ],
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /third-party-global-plugins/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("addons non-interactive apply requires exact approval digests before mutation", async () => {
  const value = fixture();
  try {
    await assert.rejects(
      runHarnessInitCli(
        [
          "addons",
          "--non-interactive",
          "--home-dir",
          value.homeDir,
          "--repo-root",
          value.repoRoot,
          "--third-party-global-skills",
          "caveman",
          "--third-party-global-plugins",
          "none",
          "--third-party-mcp-cli",
          "none",
          "--approved",
        ],
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /third-party-source-sha256/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("interactive addons recommends all candidates while defaulting every choice to skip", async () => {
  const value = fixture();
  const questions = [];
  try {
    const result = await runHarnessInitCli(
      [
        "addons",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
      ],
      {
        promptChoice: async (question) => {
          questions.push(question);
          return "no";
        },
        skillRoot: SKILL_ROOT,
        stdout: { write() {} },
      },
    );
    assert.equal(result.status, "skipped");
    assert.equal(result.mode, "interactive");
    assert.equal(questions.length, 12);
    assert.equal(
      questions.every(
        (question) =>
          question.options[0] === "no" &&
          question.recommended === "no" &&
          question.defaultOption === "no" &&
          /Recommended: yes/i.test(question.question) &&
          /Default: skip/i.test(question.question),
      ),
      true,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("strict addons planning reports blocked data-egress candidates", async () => {
  const value = fixture();
  try {
    const status = await runHarnessInitCli(
      [
        "addons",
        "--status",
        "--strict-data-boundary",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    for (const id of ["fast-context", "context7"]) {
      const candidate = status.candidates.find((entry) => entry.id === id);
      assert.equal(candidate.status, "blocked");
      assert.equal(candidate.selectable, false);
      assert.match(candidate.reason, /strict data boundary/i);
    }
    await assert.rejects(
      runHarnessInitCli(
        [
          "addons",
          "--plan-only",
          "--strict-data-boundary",
          "--home-dir",
          value.homeDir,
          "--repo-root",
          value.repoRoot,
          "--third-party-global-skills",
          "none",
          "--third-party-global-plugins",
          "none",
          "--third-party-mcp-cli",
          "fast-context",
        ],
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /fast-context.*blocked|strict data boundary/i,
    );
  } finally {
    value.cleanup();
  }
});

test("addons planning enforces Ponytail dependencies and permits one transaction", async () => {
  const value = fixture();
  try {
    const base = [
      "addons",
      "--plan-only",
      "--home-dir",
      value.homeDir,
      "--repo-root",
      value.repoRoot,
      "--third-party-global-skills",
      "none",
      "--third-party-mcp-cli",
      "none",
    ];
    await assert.rejects(
      runHarnessInitCli(
        [
          ...base,
          "--third-party-global-plugins",
          "ponytail.hooks",
        ],
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /ponytail\.hooks.*blocked|dependencies/i,
    );
    const plan = await runHarnessInitCli(
      [
        ...base,
        "--third-party-global-plugins",
        "ponytail.install,ponytail.hooks,ponytail.default-full",
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    assert.deepEqual(plan.approvals.approvedActionIds, [
      "ponytail.install",
      "ponytail.hooks",
      "ponytail.default-full",
    ]);
    assert.deepEqual(plan.networkCandidateIds, ["ponytail.install"]);
  } finally {
    value.cleanup();
  }
});

test("addons planning exposes drift and refuses overwrite", async () => {
  const value = fixture();
  try {
    const target = path.join(value.homeDir, ".agents", "skills", "caveman");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "SKILL.md"), "user-owned drift\n");
    const status = await runHarnessInitCli(
      [
        "addons",
        "--status",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    const caveman = status.candidates.find(
      (candidate) => candidate.id === "caveman",
    );
    assert.equal(caveman.status, "drifted");
    assert.equal(caveman.selectable, false);
    await assert.rejects(
      runHarnessInitCli(
        [
          "addons",
          "--plan-only",
          "--home-dir",
          value.homeDir,
          "--repo-root",
          value.repoRoot,
          "--third-party-global-skills",
          "caveman",
          "--third-party-global-plugins",
          "none",
          "--third-party-mcp-cli",
          "none",
        ],
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /caveman.*drifted/i,
    );
    assert.equal(
      readFileSync(path.join(target, "SKILL.md"), "utf8"),
      "user-owned drift\n",
    );
  } finally {
    value.cleanup();
  }
});

test("addons apply rejects stale digests and missing network approval before mutation", async () => {
  const value = fixture();
  try {
    const plan = await runHarnessInitCli(
      [
        "addons",
        "--plan-only",
        "--home-dir",
        value.homeDir,
        "--repo-root",
        value.repoRoot,
        "--third-party-global-skills",
        "caveman",
        "--third-party-global-plugins",
        "none",
        "--third-party-mcp-cli",
        "none",
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    const apply = [
      "addons",
      "--non-interactive",
      "--home-dir",
      value.homeDir,
      "--repo-root",
      value.repoRoot,
      "--third-party-global-skills",
      "caveman",
      "--third-party-global-plugins",
      "none",
      "--third-party-mcp-cli",
      "none",
      "--third-party-source-sha256",
      plan.sourceManifestSha256,
      "--third-party-plan-sha256",
      plan.planSha256,
      "--approved",
    ];
    await assert.rejects(
      runHarnessInitCli(
        apply.map((entry) =>
          entry === plan.planSha256 ? "0".repeat(64) : entry,
        ),
        { skillRoot: SKILL_ROOT, stdout: { write() {} } },
      ),
      /plan SHA-256 differs/i,
    );
    await assert.rejects(
      runHarnessInitCli(apply, {
        skillRoot: SKILL_ROOT,
        stdout: { write() {} },
      }),
      /allow-third-party-network/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("interactive addons rebuilds the plan after approval and rejects TOCTOU drift", async () => {
  const value = fixture();
  let buildCount = 0;
  try {
    await assert.rejects(
      runHarnessInitCli(
        [
          "addons",
          "--home-dir",
          value.homeDir,
          "--repo-root",
          value.repoRoot,
        ],
        {
          promptChoice: async (question) => {
            if (question.question.startsWith("Approve Caveman")) return "yes";
            if (question.question.startsWith("Approve network acquisition")) {
              return "yes";
            }
            if (question.question.startsWith("Approve installation")) {
              return "approve";
            }
            return "no";
          },
          skillRoot: SKILL_ROOT,
          stdout: { write() {} },
          thirdPartyPlanBuilder: async (options) => {
            buildCount += 1;
            const plan = await testThirdPartyPlanBuilder(options);
            if (buildCount === 2) {
              return { ...plan, planSha256: "f".repeat(64) };
            }
            return plan;
          },
        },
      ),
      /plan drifted after presentation/i,
    );
    assert.equal(buildCount, 2);
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("non-interactive Global Init requires explicit reject-all selections and records them", async () => {
  const value = fixture();
  try {
    const { manifestSha256 } = await loadThirdPartySourceManifest({
      manifestPath: SOURCE_MANIFEST,
    });
    await assert.rejects(
      runHarnessInitCli(
        [
          "global-init",
          "--non-interactive",
          "--home-dir",
          value.homeDir,
          "--catalog-mode",
          "skip",
          "--provider-actions",
          "codex=later,gemini=later,grok=later,claude=skip",
          "--approved",
        ],
        { providerRunCommand: missingProvider, skillRoot: SKILL_ROOT },
      ),
      /third-party-global-skills/i,
    );

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
        manifestSha256,
        "--approved",
      ],
      {
        providerRunCommand: missingProvider,
        skillRoot: SKILL_ROOT,
        stdout: { write() {} },
      },
    );
    assert.deepEqual(result.thirdParty.approvals.approvedActionIds, []);
    assert.equal(existsSync(result.thirdParty.record.approvalPath), true);
    assert.equal(path.basename(path.dirname(result.thirdParty.record.approvalPath)), "third-party-approvals");
    assert.equal(
      existsSync(
        path.join(value.homeDir, ".agents", "skills", "grill-me"),
      ),
      false,
    );
    assert.equal(
      existsSync(
        path.join(value.homeDir, ".agents", "skills", "grilling"),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("Global Init CLI records a later explicit selection after reject-all before third-party source work", async () => {
  const value = fixture();
  try {
    const { manifestSha256 } = await loadThirdPartySourceManifest({ manifestPath: SOURCE_MANIFEST });
    const base = [
      "global-init", "--non-interactive", "--home-dir", value.homeDir,
      "--catalog-mode", "skip",
      "--provider-actions", "codex=later,gemini=later,grok=later,claude=skip",
      "--third-party-global-plugins", "none",
      "--third-party-mcp-cli", "none",
      "--third-party-source-sha256", manifestSha256,
      "--approved",
    ];
    await runHarnessInitCli(
      [...base, "--third-party-global-skills", "none"],
      { providerRunCommand: missingProvider, skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    await assert.rejects(
      runHarnessInitCli(
        [...base, "--third-party-global-skills", "matt-grilling"],
        {
          providerRunCommand: missingProvider,
          skillRoot: SKILL_ROOT,
          stdout: { write() {} },
        },
      ),
      /third-party-plan-sha256/i,
    );
    const plan = await testThirdPartyPlanBuilder({
      homeDir: value.homeDir,
      repoRoot: ROOT,
      skillRoot: SKILL_ROOT,
      strictDataBoundary: false,
    });
    let resolverCalled = false;
    const result = await runHarnessInitCli(
        [
          ...base,
          "--third-party-global-skills",
          "matt-grilling",
          "--third-party-plan-sha256",
          plan.planSha256,
        ],
        {
          providerRunCommand: missingProvider,
          skillRoot: SKILL_ROOT,
          stdout: { write() {} },
          thirdPartySourceResolver: async () => {
            resolverCalled = true;
            return value.root;
          },
        },
    );
    assert.equal(result.status, "third-party-skills-failed");
    assert.equal(resolverCalled, true);
    assert.equal(existsSync(result.thirdParty.record.approvalPath), true);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")), false);
  } finally {
    value.cleanup();
  }
});

test("interactive Global Init recommends every global candidate but keeps explicit no unselected", async () => {
  const value = fixture();
  const questions = [];
  try {
    const result = await runHarnessInitCli(
      ["global-init", "--home-dir", value.homeDir],
      {
        providerRunCommand: missingProvider,
        skillRoot: SKILL_ROOT,
        stdout: { write() {} },
        promptChoice: async (question) => {
          questions.push(question);
          if (question.question.startsWith("Choose the personal Skill")) {
            return "skip";
          }
          if (question.question.startsWith("Choose the ")) {
            return question.options.includes("later") ? "later" : "skip";
          }
          if (question.question.startsWith("Approve Global Init")) {
            return "approve";
          }
          return "no";
        },
      },
    );
    const candidateQuestions = questions.filter(
      (entry) =>
        entry.question.startsWith("Approve ") &&
        !entry.question.startsWith("Approve Global Init"),
    );
    assert.equal(candidateQuestions.length, 12);
    assert.equal(
      candidateQuestions.every(
        (entry) =>
          entry.recommended === "no" &&
          entry.defaultOption === "no" &&
          entry.options[0] === "no" &&
          entry.options[1] === "yes" &&
          /install is recommended.*unselected until.*yes/is.test(entry.question),
      ),
      true,
    );
    for (const label of ["Global Skills", "Global Plugins", "MCP / CLI"]) {
      assert.equal(
        candidateQuestions.some((entry) =>
          entry.question.includes(`Approval group: ${label}`),
        ),
        true,
      );
    }
    assert.match(
      candidateQuestions.find((entry) =>
        entry.question.startsWith("Approve grill-me + grilling"),
      ).question,
      /skills\/productivity\/grill-me -> \.agents\/skills\/grill-me/i,
    );
    assert.equal(
      candidateQuestions.every((entry) =>
        /Source manifest SHA-256: [a-f0-9]{64}/i.test(entry.question),
      ),
      true,
    );
    assert.equal(
      candidateQuestions.every((entry) =>
        /Existing installation: status=(?:absent|exact|drifted|unowned|manual-pending); scope=/i.test(
          entry.question,
        ),
      ),
      true,
    );
    for (const name of [
      "CodeGraph",
      "fast-context",
      "Context7",
      "Playwright",
      "Exa",
    ]) {
      const candidate = candidateQuestions.find((entry) =>
        entry.question.startsWith(`Approve ${name}`),
      );
      assert.match(candidate.question, /Source Git tree: [a-f0-9]{40}/i);
      assert.match(candidate.question, /Package SRI: sha512-/i);
    }
    for (const name of ["Context7", "Playwright", "DeepWiki", "Exa"]) {
      const candidate = candidateQuestions.find((entry) =>
        entry.question.startsWith(`Approve ${name}`),
      );
      assert.match(
        candidate.question,
        /CCG handoff: status=ccg-managed; command=ccg config mcp/i,
      );
    }
    assert.match(
      candidateQuestions.find((entry) =>
        entry.question.startsWith("Approve DeepWiki"),
      ).question,
      /Endpoint: https:\/\/mcp\.deepwiki\.com\/mcp.*remote-service-no-local-sri/is,
    );
    assert.match(
      candidateQuestions.find((entry) =>
        entry.question.startsWith("Approve Exa"),
      ).question,
      /API key page: https:\/\/dashboard\.exa\.ai\/api-keys/i,
    );
    assert.match(
      candidateQuestions.find((entry) =>
        entry.question.startsWith("Approve ripgrep"),
      ).question,
      /Release assets:.*SHA-256=[a-f0-9]{64}/is,
    );
    const finalApproval = questions.find((entry) =>
      entry.question.startsWith("Approve Global Init"),
    );
    assert.match(finalApproval.question, /Third-party plan SHA-256: [a-f0-9]{64}/i);
    assert.match(finalApproval.question, /Approved package roots:/i);
    assert.match(finalApproval.question, /Subprocess configuration roots:/i);
    assert.match(finalApproval.question, /Command identities:/i);
    assert.deepEqual(result.thirdParty.approvals.approvedActionIds, []);
  } finally {
    value.cleanup();
  }
});

test("interactive third-party network approval is separate, default-no, and declines only selected downloads", async () => {
  const value = fixture();
  const questions = [];
  let resolverCalls = 0;
  try {
    const result = await runHarnessInitCli(
      ["global-init", "--home-dir", value.homeDir],
      {
        providerRunCommand: missingProvider,
        skillRoot: SKILL_ROOT,
        stdout: { write() {} },
        thirdPartySourceResolver: async () => {
          resolverCalls += 1;
          return value.root;
        },
        promptChoice: async (question) => {
          questions.push(question);
          if (question.question.startsWith("Choose the personal Skill")) {
            return "skip";
          }
          if (question.question.startsWith("Choose the ")) {
            return question.options.includes("later") ? "later" : "skip";
          }
          if (question.question.startsWith("Approve Caveman")) {
            return "yes";
          }
          if (question.question.startsWith("Approve network acquisition")) {
            assert.deepEqual(question.options, ["no", "yes"]);
            assert.equal(question.recommended, "no");
            assert.match(
              question.question,
              /caveman.*github\.com.*@\s*[a-f0-9]{40}/is,
            );
            assert.match(question.question, /Source manifest SHA-256: [a-f0-9]{64}/i);
            return "no";
          }
          if (question.question.startsWith("Approve Global Init")) {
            return "approve";
          }
          return "no";
        },
      },
    );
    assert.equal(resolverCalls, 0);
    assert.deepEqual(result.thirdParty.approvals.approvedActionIds, []);
    assert.equal(
      questions.some((entry) =>
        entry.question.startsWith("Approve network acquisition"),
      ),
      true,
    );
    assert.equal(result.status, "initialized");
  } finally {
    value.cleanup();
  }
});

test("strict data boundary presents fast-context as blocked with no yes option", async () => {
  const value = fixture();
  const questions = [];
  try {
    await runHarnessInitCli(
      ["global-init", "--home-dir", value.homeDir, "--strict-data-boundary"],
      {
        providerRunCommand: missingProvider,
        skillRoot: SKILL_ROOT,
        stdout: { write() {} },
        promptChoice: async (question) => {
          questions.push(question);
          if (question.question.startsWith("Choose the personal Skill")) return "skip";
          if (question.question.startsWith("Choose the ")) return question.options.includes("later") ? "later" : "skip";
          if (question.question.startsWith("Approve Global Init")) return "approve";
          return "no";
        },
      },
    );
    const fastContext = questions.find((entry) => entry.question.includes("fast-context"));
    assert.deepEqual(fastContext.options, ["no"]);
    assert.equal(fastContext.recommended, "no");
    assert.match(fastContext.question, /Status: BLOCKED/i);
  } finally {
    value.cleanup();
  }
});

test("Project Init binds an explicit empty third-party selection to the approved contract", async () => {
  const value = fixture();
  try {
    const { manifestSha256 } = await loadThirdPartySourceManifest({
      manifestPath: SOURCE_MANIFEST,
    });
    const contract = JSON.parse(readFileSync(PUBLIC_CONTRACT, "utf8"));
    contract.thirdParty.sourceManifestSha256 = manifestSha256;
    const contractPath = path.join(value.root, "approved-contract.json");
    writeFileSync(
      contractPath,
      `${JSON.stringify(contract, null, 2)}\n`,
    );

    const result = await runHarnessInitCli(
      [
        "project-init",
        "--non-interactive",
        "--repo-root",
        value.repoRoot,
        "--home-dir",
        value.homeDir,
        "--contract",
        contractPath,
        "--no-project-skills",
        "--third-party-project-skills",
        "none",
        "--third-party-source-sha256",
        manifestSha256,
        "--approved",
      ],
      { skillRoot: SKILL_ROOT, stdout: { write() {} } },
    );
    assert.equal(result.status, "approved-awaiting-gates");
    assert.deepEqual(result.thirdParty.approvals.approvedActionIds, []);
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".harness",
          "third-party-sources.json",
        ),
      ),
      true,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("interactive Project Init compiles explicit third-party yes into an approved contract before installation", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [{ id: "demo-third-party" }],
    });
    const catalogRoot = path.join(value.root, "catalog");
    const catalogSkill = path.join(catalogRoot, "react-helper");
    mkdirSync(catalogSkill, { recursive: true });
    writeFileSync(
      path.join(catalogSkill, "SKILL.md"),
      '---\nname: react-helper\ndescription: "React project helper."\n---\n',
    );
    writeFileSync(
      path.join(value.repoRoot, "package.json"),
      '{"dependencies":{"react":"18.3.1"}}\n',
    );
    await saveSkillRepositoryProfile({
      approved: true,
      globalEssentialSkills: draftContract().skills.globalEssential,
      homeDir: value.homeDir,
      repositoryPath: catalogRoot,
      selectionGuidance: ["Select only project-relevant Skills."],
    });
    const contractPath = path.join(value.root, "draft-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(draftContract(), null, 2)}\n`);
    const questions = [];
    const result = await runHarnessInitCli(
      [
        "project-init",
        "--repo-root",
        value.repoRoot,
        "--home-dir",
        value.homeDir,
        "--contract",
        contractPath,
      ],
      {
        now: () => new Date("2026-07-26T12:00:00.000Z"),
        promptChoice: async (question) => {
          questions.push(question);
          if (question.question.startsWith("Approve catalog Skill react-helper")) return "yes";
          if (question.question.startsWith("Approve demo-third-party")) return "yes";
          if (question.question.startsWith("Approve Project Init")) return "approve";
          return "no";
        },
        skillRoot: thirdParty.skillRoot,
        stdout: { write() {} },
        thirdPartySourceResolver: async () => thirdParty.sourceRoot,
      },
    );
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    assert.equal(result.status, "approved-awaiting-gates");
    assert.equal(contract.status, "approved");
    assert.equal(contract.approval.approvedBy, "interactive-user");
    assert.equal(
      contract.thirdParty.sourceManifestSha256,
      thirdParty.manifestSha256,
    );
    assert.deepEqual(contract.thirdParty.projectSkills, ["demo-third-party"]);
    assert.deepEqual(contract.skills.projectSelection, [
      { name: "react-helper", reason: "matches react" },
    ]);
    assert.deepEqual(contract.workflow.managedProjectPaths, [
      ".agents/skills/demo-third-party",
      ".agents/skills/react-helper",
      ".harness/project-skills.json",
      ".harness/third-party-installations.json",
      ".harness/third-party-sources.json",
    ]);
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".agents", "skills", "demo-third-party", "SKILL.md"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".agents", "skills", "react-helper", "SKILL.md"),
      ),
      true,
    );
    const selectionQuestions = questions.filter(
      (entry) =>
        entry.question.startsWith("Approve catalog Skill ") ||
        entry.question.startsWith("Approve demo-third-party"),
    );
    assert.equal(
      selectionQuestions.every((entry) => entry.recommended === "no"),
      true,
    );
    const finalApproval = questions.find((entry) =>
      entry.question.startsWith("Approve Project Init"),
    );
    assert.equal(finalApproval.recommended, "approve");
    assert.match(finalApproval.question, /Third-party plan SHA-256: [a-f0-9]{64}/i);
    assert.match(finalApproval.question, /Subprocess configuration roots:/i);
    assert.match(finalApproval.question, /Command identities:/i);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("interactive approved contract never offers an unapproved third-party yes", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [{ id: "demo-third-party" }],
    });
    const contract = draftContract();
    contract.status = "approved";
    contract.thirdParty.sourceManifestSha256 = thirdParty.manifestSha256;
    contract.workflow.managedProjectPaths = [".harness/third-party-sources.json"];
    contract.approval = {
      approvedAt: "2026-07-26T12:00:00.000Z",
      approvedBy: "test-user",
    };
    const contractPath = path.join(value.root, "approved-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const questions = [];
    const result = await runHarnessInitCli(
      [
        "project-init",
        "--repo-root",
        value.repoRoot,
        "--home-dir",
        value.homeDir,
        "--contract",
        contractPath,
      ],
      {
        promptChoice: async (question) => {
          questions.push(question);
          return "approve";
        },
        skillRoot: thirdParty.skillRoot,
        stdout: { write() {} },
      },
    );
    assert.equal(result.status, "approved-awaiting-gates");
    assert.equal(
      questions.some((entry) => entry.question.startsWith("Approve demo-third-party")),
      false,
    );
    assert.equal(
      questions.some((entry) => entry.question.startsWith("Confirm execution")),
      true,
    );
    const confirmation = questions.find((entry) =>
      entry.question.startsWith("Confirm execution"),
    );
    assert.match(confirmation.question, /Third-party plan SHA-256: [a-f0-9]{64}/i);
    assert.match(confirmation.question, /Subprocess configuration roots:/i);
    assert.equal(
      existsSync(path.join(value.repoRoot, ".agents", "skills", "demo-third-party")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("interactive draft Project Init cancel leaves its contract and project untouched", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [{ id: "demo-third-party" }],
    });
    const contractPath = path.join(value.root, "draft-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(draftContract(), null, 2)}\n`);
    const original = readFileSync(contractPath, "utf8");
    await assert.rejects(
      runHarnessInitCli(
        [
          "project-init",
          "--repo-root",
          value.repoRoot,
          "--home-dir",
          value.homeDir,
          "--contract",
          contractPath,
        ],
        {
          promptChoice: async (question) =>
            question.question.startsWith("Approve Project Init")
              ? "cancel"
              : "no",
          skillRoot: thirdParty.skillRoot,
          stdout: { write() {} },
        },
      ),
      /approval was declined/i,
    );
    assert.equal(readFileSync(contractPath, "utf8"), original);
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("interactive draft Project Init refuses a contract changed after discovery", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [{ id: "demo-third-party" }],
    });
    const contractPath = path.join(value.root, "draft-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(draftContract(), null, 2)}\n`);
    await assert.rejects(
      runHarnessInitCli(
        [
          "project-init",
          "--repo-root",
          value.repoRoot,
          "--home-dir",
          value.homeDir,
          "--contract",
          contractPath,
        ],
        {
          promptChoice: async (question) => {
            if (question.question.startsWith("Approve Project Init")) {
              writeFileSync(contractPath, `${JSON.stringify(draftContract(), null, 2)}\n `);
              return "approve";
            }
            return "no";
          },
          skillRoot: thirdParty.skillRoot,
          stdout: { write() {} },
        },
      ),
      /drifted after discovery/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("draft Project Init missing dependency and strict boundary leave the contract untouched", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [
        { id: "dependent-skill", dependencies: ["dependency-skill"] },
        { id: "dependency-skill" },
        { id: "boundary-blocked", strictDataBoundaryAllowed: false },
      ],
    });
    const contractPath = path.join(value.root, "draft-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(draftContract(), null, 2)}\n`);
    const original = readFileSync(contractPath, "utf8");
    await assert.rejects(
      runHarnessInitCli(
        [
          "project-init",
          "--repo-root",
          value.repoRoot,
          "--home-dir",
          value.homeDir,
          "--contract",
          contractPath,
        ],
        {
          promptChoice: async (question) => {
            if (question.question.startsWith("Approve dependent-skill")) return "yes";
            if (question.question.startsWith("Approve Project Init")) return "cancel";
            return "no";
          },
          skillRoot: thirdParty.skillRoot,
          stdout: { write() {} },
        },
      ),
      /requires explicitly selected project dependencies/i,
    );
    assert.equal(readFileSync(contractPath, "utf8"), original);
    await assert.rejects(
      runHarnessInitCli(
        [
          "project-init",
          "--repo-root",
          value.repoRoot,
          "--home-dir",
          value.homeDir,
          "--contract",
          contractPath,
          "--third-party-project-skills",
          "boundary-blocked",
          "--strict-data-boundary",
        ],
        {
          promptChoice: async () => "approve",
          skillRoot: thirdParty.skillRoot,
          stdout: { write() {} },
        },
      ),
      /cannot be approved|strict data boundary/i,
    );
    assert.equal(readFileSync(contractPath, "utf8"), original);
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("draft contract strict data boundary blocks fast-context without a CLI flag", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [
        { id: "fast-context", strictDataBoundaryAllowed: false },
      ],
    });
    const contract = draftContract();
    contract.security.strictDataBoundary = true;
    const contractPath = path.join(value.root, "draft-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const original = readFileSync(contractPath, "utf8");
    const questions = [];

    await assert.rejects(
      runHarnessInitCli(
        [
          "project-init",
          "--repo-root",
          value.repoRoot,
          "--home-dir",
          value.homeDir,
          "--contract",
          contractPath,
        ],
        {
          promptChoice: async (question) => {
            questions.push(question);
            return question.question.startsWith("Approve fast-context")
              ? "yes"
              : "no";
          },
          skillRoot: thirdParty.skillRoot,
          stdout: { write() {} },
        },
      ),
      /cannot be approved|strict data boundary/i,
    );

    const fastContext = questions.find((entry) =>
      entry.question.startsWith("Approve fast-context"),
    );
    assert.deepEqual(fastContext.options, ["no"]);
    assert.equal(fastContext.recommended, "no");
    assert.match(fastContext.question, /BLOCKED|strict data boundary/i);
    assert.equal(readFileSync(contractPath, "utf8"), original);
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("approved strict contract cannot execute a boundary-blocked exact selection", async () => {
  const value = fixture();
  try {
    const thirdParty = await thirdPartyProjectFixture(value, {
      candidates: [
        { id: "fast-context", strictDataBoundaryAllowed: false },
      ],
    });
    const contract = draftContract();
    contract.status = "approved";
    contract.security.strictDataBoundary = true;
    contract.thirdParty.sourceManifestSha256 = thirdParty.manifestSha256;
    contract.thirdParty.projectSkills = ["fast-context"];
    contract.workflow.managedProjectPaths = [
      ".agents/skills/fast-context",
      ".harness/third-party-installations.json",
      ".harness/third-party-sources.json",
    ];
    contract.approval = {
      approvedAt: "2026-07-26T12:00:00.000Z",
      approvedBy: "test-user",
    };
    const contractPath = path.join(value.root, "approved-contract.json");
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const plan = await testThirdPartyPlanBuilder({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      skillRoot: thirdParty.skillRoot,
      strictDataBoundary: true,
    });

    await assert.rejects(
      runHarnessInitCli(
        [
          "project-init",
          "--non-interactive",
          "--approved",
          "--repo-root",
          value.repoRoot,
          "--home-dir",
          value.homeDir,
          "--contract",
          contractPath,
          "--no-project-skills",
          "--third-party-project-skills",
          "fast-context",
          "--third-party-source-sha256",
          thirdParty.manifestSha256,
          "--third-party-plan-sha256",
          plan.planSha256,
        ],
        {
          skillRoot: thirdParty.skillRoot,
          stdout: { write() {} },
        },
      ),
      /cannot be honored.*effective security policy/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".agents", "skills", "fast-context"),
      ),
      false,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
  } finally {
    value.cleanup();
  }
});
