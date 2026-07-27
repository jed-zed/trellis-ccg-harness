import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acquirePinnedGitSource,
  applyThirdPartyGlobalSkills as applyThirdPartyGlobalSkillsRaw,
  applyThirdPartyProjectSkills as applyThirdPartyProjectSkillsRaw,
  buildThirdPartyApprovalPlan,
  loadThirdPartySourceManifest,
  preflightThirdPartyGlobalApproval as preflightThirdPartyGlobalApprovalRaw,
  recordThirdPartyGlobalApproval as recordThirdPartyGlobalApprovalRaw,
  recoverThirdPartyProjectTransactions,
  recoverThirdPartyTransactions,
  resolveThirdPartyApprovals as resolveThirdPartyApprovalsRaw,
  snapshotThirdPartyTree,
  validateThirdPartySourceManifest,
} from "../.agents/skills/harness-init/scripts/third-party-approval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(
  ROOT,
  ".agents",
  "skills",
  "harness-init",
  "assets",
  "third-party-sources.json",
);

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-third-party-"));
  const homeDir = path.join(root, "home");
  const repoRoot = path.join(root, "project");
  mkdirSync(homeDir);
  mkdirSync(repoRoot);
  return {
    root,
    homeDir,
    repoRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function materializeTrustedGitRoot(root) {
  const commandRoot = path.join(root, "trusted-git");
  mkdirSync(commandRoot, { recursive: true });
  const executable = path.join(
    commandRoot,
    process.platform === "win32" ? "git.exe" : "git",
  );
  copyFileSync(process.execPath, executable);
  return { commandRoot, executable };
}

const approvalPlans = new WeakMap();

function resolveThirdPartyApprovals(input) {
  const approvals = resolveThirdPartyApprovalsRaw(input);
  approvalPlans.set(approvals, input.plan);
  return approvals;
}

function withApprovalContract(input) {
  const approvalPlan = input.approvalPlan ?? approvalPlans.get(input.approvals);
  if (!approvalPlan) {
    throw new Error("Test setup requires the authoritative approval plan.");
  }
  return {
    ...input,
    approvalPlan,
    repoRoot: input.repoRoot ?? approvalPlan.targetRoots.projectSkills,
    strictDataBoundary:
      input.strictDataBoundary ?? approvalPlan.strictDataBoundary,
  };
}

function preflightThirdPartyGlobalApproval(input) {
  return preflightThirdPartyGlobalApprovalRaw(withApprovalContract(input));
}

function recordThirdPartyGlobalApproval(input) {
  return recordThirdPartyGlobalApprovalRaw(withApprovalContract(input));
}

function applyThirdPartyGlobalSkills(input) {
  return applyThirdPartyGlobalSkillsRaw(withApprovalContract(input));
}

function applyThirdPartyProjectSkills(input) {
  return applyThirdPartyProjectSkillsRaw(withApprovalContract(input));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function writeSkill(root, relativePath, name, body = "") {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.join(target, "agents"), { recursive: true });
  writeFileSync(
    path.join(target, "SKILL.md"),
    `---\nname: ${name}\ndescription: fixture ${name}\n---\n\n${body}\n`,
  );
  writeFileSync(
    path.join(target, "agents", "openai.yaml"),
    `interface:\n  display_name: "${name}"\n`,
  );
  return target;
}

async function fixtureManifest(value) {
  const sourceRoot = path.join(value.root, "source");
  mkdirSync(sourceRoot);
  const grillPath = "skills/productivity/grill-me";
  const grillingPath = "skills/productivity/grilling";
  const grill = writeSkill(sourceRoot, grillPath, "grill-me", "Run grilling.");
  const grilling = writeSkill(
    sourceRoot,
    grillingPath,
    "grilling",
    "Ask one question.",
  );
  const grillSnapshot = await snapshotThirdPartyTree(grill);
  const grillingSnapshot = await snapshotThirdPartyTree(grilling);
  const manifest = {
    schemaVersion: 1,
    owner: "trellis-ccg-harness",
    generatedAt: "2026-07-26T00:00:00.000Z",
    approvalDefaults: { selected: false },
    sources: [
      {
        id: "matt-skills",
        repository: "https://example.invalid/matt-skills.git",
        commit: "1111111111111111111111111111111111111111",
        gitTree: "2222222222222222222222222222222222222222",
        license: "MIT",
      },
    ],
    candidates: [
      {
        id: "matt-grilling",
        name: "grill-me + grilling",
        kind: "skill-bundle",
        group: "global-skills",
        purpose: "Fixture global interview bundle.",
        sourceId: "matt-skills",
        approvalDefaults: { selected: false },
        scope: "global",
        paths: [
          {
            name: "grill-me",
            sourcePath: grillPath,
            targetPath: ".agents/skills/grill-me",
            treeSha256: grillSnapshot.treeSha256,
            fileCount: grillSnapshot.fileCount,
            totalBytes: grillSnapshot.totalBytes,
          },
          {
            name: "grilling",
            sourcePath: grillingPath,
            targetPath: ".agents/skills/grilling",
            treeSha256: grillingSnapshot.treeSha256,
            fileCount: grillingSnapshot.fileCount,
            totalBytes: grillingSnapshot.totalBytes,
          },
        ],
        dependencies: [],
        effects: {
          scripts: false,
          hooks: false,
          executables: false,
          network: true,
          dataEgress: "Git source acquisition only.",
        },
        lifecycle: {
          update: "new-explicit-approval",
          rollback: "restore-owned-backup",
          uninstall: "remove-only-owned-unchanged",
        },
        migration: {
          acceptedLegacyTreeSha256: [],
        },
      },
    ],
    exclusions: ["caveman"],
  };
  return {
    manifest,
    manifestSha256: sha256(canonicalJson(manifest)),
    sourceRoot,
  };
}

async function fixtureProjectManifest(value) {
  const fixtureSource = await fixtureManifest(value);
  const projectCandidates = [
    ["fixture-project-grill-me", "grill-me", "skills/productivity/grill-me"],
    ["fixture-project-grilling", "grilling", "skills/productivity/grilling"],
  ].map(([id, name, sourcePath]) => {
    const globalPath = fixtureSource.manifest.candidates[0].paths.find((entry) => entry.name === name);
    return {
      id,
      name,
      kind: "skill",
      group: "project-skills",
      purpose: `Fixture project ${name}.`,
      sourceId: "matt-skills",
      approvalDefaults: { selected: false },
      scope: "project",
      paths: [{ ...globalPath, sourcePath, targetPath: `.agents/skills/${name}` }],
      dependencies: [],
      effects: { scripts: false, hooks: false, executables: false, network: false, dataEgress: "None." },
      lifecycle: { update: "new-explicit-project-approval", rollback: "project-transaction", uninstall: "remove-only-owned-unchanged" },
    };
  });
  fixtureSource.manifest.candidates.push(...projectCandidates);
  fixtureSource.manifestSha256 = sha256(canonicalJson(fixtureSource.manifest));
  return fixtureSource;
}

async function fixtureCavemanManifest(value) {
  const fixtureSource = await fixtureManifest(value);
  const cavemanRoot = path.join(value.root, "caveman-source");
  mkdirSync(cavemanRoot);
  const caveman = writeSkill(cavemanRoot, "skills/caveman", "caveman", "Use concise prose.");
  const snapshot = await snapshotThirdPartyTree(caveman);
  fixtureSource.manifest.sources.push({
    id: "caveman",
    repository: "https://example.invalid/caveman.git",
    commit: "3333333333333333333333333333333333333333",
    gitTree: "4444444444444444444444444444444444444444",
    license: "MIT",
  });
  fixtureSource.manifest.candidates.push({
    id: "caveman",
    name: "caveman",
    kind: "skill",
    group: "global-skills",
    purpose: "Fixture concise prose Skill.",
    sourceId: "caveman",
    approvalDefaults: { selected: false },
    recommended: true,
    scope: "global",
    paths: [{
      name: "caveman",
      sourcePath: "skills/caveman",
      targetPath: ".agents/skills/caveman",
      treeSha256: snapshot.treeSha256,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
    }],
    dependencies: [],
    effects: { scripts: false, hooks: false, executables: false, network: true, dataEgress: "Git source acquisition only." },
    lifecycle: { update: "new-explicit-approval", rollback: "restore-owned-backup", uninstall: "remove-only-owned-unchanged" },
  });
  fixtureSource.manifestSha256 = sha256(canonicalJson(fixtureSource.manifest));
  return { ...fixtureSource, cavemanRoot };
}

test("the public source manifest is immutable, complete, and offers Caveman as opt-in", async () => {
  const loaded = await loadThirdPartySourceManifest({
    manifestPath: MANIFEST_PATH,
  });
  assert.match(loaded.manifestSha256, /^[a-f0-9]{64}$/);
  const caveman = loaded.manifest.candidates.find((entry) => entry.id === "caveman");
  assert.equal(caveman.approvalDefaults.selected, false);
  assert.equal(caveman.recommended, true);
  for (const source of loaded.manifest.sources) {
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.doesNotMatch(JSON.stringify(source), /main|latest|@latest/i);
  }
  assert.equal(
    loaded.manifest.candidates.every((entry) => entry.approvalDefaults?.selected === false),
    true,
  );
  assert.deepEqual(
    new Set(loaded.manifest.candidates.map((entry) => entry.group)),
    new Set([
      "global-skills",
      "global-plugins",
      "project-skills",
      "mcp-cli",
    ]),
  );
});

test("manifest validation rejects mutable selectors", () => {
  assert.throws(
    () =>
      validateThirdPartySourceManifest({
        schemaVersion: 1,
        owner: "trellis-ccg-harness",
        generatedAt: "2026-07-26T00:00:00.000Z",
        approvalDefaults: { selected: false },
        sources: [
          {
            id: "unsafe",
            repository: "https://example.invalid/repo.git",
            commit: "main",
            gitTree: "2222222222222222222222222222222222222222",
            license: "MIT",
          },
        ],
        candidates: [],
        exclusions: ["caveman"],
      }),
    /commit|immutable/i,
  );
});

test("manifest validation rejects credential-bearing and non-HTTPS repositories", () => {
  for (const repository of [
    "https://user:password@example.invalid/repo.git",
    "http://example.invalid/repo.git",
  ]) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    manifest.sources[0].repository = repository;
    assert.throws(
      () => validateThirdPartySourceManifest(manifest),
      /credential-free HTTPS/i,
    );
  }
});

test("manifest validation rejects incomplete or traversing release assets", () => {
  const traversal = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  traversal.sources.find((entry) => entry.id === "ripgrep").assets[0].name =
    "../../ripgrep.exe";
  assert.throws(
    () => validateThirdPartySourceManifest(traversal),
    /safe basename/i,
  );

  const incomplete = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  delete incomplete.sources.find((entry) => entry.id === "ripgrep").assets[0].sha256;
  assert.throws(
    () => validateThirdPartySourceManifest(incomplete),
    /invalid or duplicate asset/i,
  );

  const noRelease = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  delete noRelease.sources.find((entry) => entry.id === "ripgrep").release;
  assert.throws(
    () => validateThirdPartySourceManifest(noRelease),
    /fixed release/i,
  );
});

test("manifest validation rejects a mutable top-level approval default", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.approvalDefaults.selected = true;
  assert.throws(
    () => validateThirdPartySourceManifest(manifest),
    /approvalDefaults.*false/i,
  );
});

test("manifest validation rejects a non-boolean candidate recommendation", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.candidates.find((entry) => entry.id === "caveman").recommended = "yes";
  assert.throws(
    () => validateThirdPartySourceManifest(manifest),
    /recommended.*boolean/i,
  );
});

test("manifest validation rejects a global Skill target outside .agents/skills", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.candidates.find((entry) => entry.id === "matt-grilling").paths[0].targetPath = ".claude/skills/grill-me";
  assert.throws(
    () => validateThirdPartySourceManifest(manifest),
    /must target only \.agents\/skills/i,
  );
});

test("manifest validation rejects traversal that could reach .claude or transaction staging", async () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.candidates.find((entry) => entry.id === "matt-grilling").paths[0].targetPath = ".agents/skills/../../.claude/skills/grill-me";
  assert.throws(
    () => validateThirdPartySourceManifest(manifest),
    /target only \.agents\/skills/i,
  );

  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    source.manifest.candidates.find((entry) => entry.id === "fixture-project-grill-me").paths[0].targetPath = ".agents/skills/..\\..\\.claude\\skills\\grill-me";
    assert.throws(
      () => validateThirdPartySourceManifest(source.manifest),
      /target only \.agents\/skills/i,
    );
  } finally {
    value.cleanup();
  }
});

test("approval planning has four groups and selects no third party by default", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
      strictDataBoundary: false,
    });
    assert.deepEqual(
      plan.groups.map((entry) => entry.id),
      ["global-skills", "global-plugins", "project-skills", "mcp-cli"],
    );
    assert.equal(
      plan.groups.flatMap((entry) => entry.candidates).every((entry) => {
        return entry.selected === false;
      }),
      true,
    );
    const fastContext = plan.groups
      .flatMap((entry) => entry.candidates)
      .find((entry) => entry.id === "fast-context");
    assert.match(fastContext.dataEgress, /Windsurf/i);
    const byId = new Map(
      plan.groups
        .flatMap((entry) => entry.candidates)
        .map((entry) => [entry.id, entry]),
    );
    for (const id of ["codegraph", "fast-context", "context7"]) {
      const candidate = byId.get(id);
      const source = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
        .sources.find((entry) => entry.id === id);
      assert.equal(candidate.source.gitTree, source.gitTree);
      assert.equal(candidate.source.packageIntegrity, source.packageIntegrity);
      assert.deepEqual(candidate.source.packageLock, source.packageLock);
      assert.deepEqual(candidate.source.assets, []);
    }
    const ripgrep = byId.get("ripgrep");
    assert.equal(ripgrep.source.gitTree, "c743701524f65f036cf174d6551918be7dfc0d40");
    assert.deepEqual(
      ripgrep.source.assets.map(({ platform, name, sha256: digest }) => ({
        platform,
        name,
        sha256: digest,
      })),
      JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
        .sources.find((entry) => entry.id === "ripgrep").assets,
    );
    assert.equal(JSON.stringify(plan).includes("packageIntegrity"), true);
    const caveman = plan.groups
      .find((group) => group.id === "global-skills")
      .candidates.find((entry) => entry.id === "caveman");
    assert.equal(caveman.selected, false);
    assert.equal(caveman.recommended, true);
    assert.equal(plan.detected.codegraph.indexPresent, false);
    assert.equal(
      existsSync(path.join(value.repoRoot, ".codegraph")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("approval planning rejects unapproved secret-like manifest fields", async () => {
  const value = fixture();
  try {
    const sourceManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    sourceManifest.sources.find((entry) => entry.id === "context7").apiKey =
      "must-not-appear";
    sourceManifest.candidates.find((entry) => entry.id === "context7").credentials = {
      bearer: "must-not-appear",
    };
    await assert.rejects(
      buildThirdPartyApprovalPlan({
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        manifest: sourceManifest,
      }),
      /unsupported fields/i,
    );
  } finally {
    value.cleanup();
  }
});

test("approval plan digest binds displayed installation observations", async () => {
  const value = fixture();
  const otherRepo = path.join(value.root, "other-project");
  mkdirSync(otherRepo);
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifestPath: MANIFEST_PATH,
    });
    assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
    const originalSha256 = plan.planSha256;
    plan.groups[0].candidates[0].installed = {
      status: "drifted",
      treeSha256: "f".repeat(64),
    };
    assert.throws(
      () => resolveThirdPartyApprovals({
        plan,
        selections: {
          globalSkills: [],
          globalPlugins: [],
          projectSkills: [],
          mcpCli: [],
        },
      }),
      /drifted after presentation/i,
    );
    assert.equal(plan.planSha256, originalSha256);

    const other = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: otherRepo,
      manifestPath: MANIFEST_PATH,
    });
    assert.notEqual(other.planSha256, originalSha256);
  } finally {
    value.cleanup();
  }
});

test("approval plan digest binds canonical command roots, identities, and subprocess config roots", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const { commandRoot, executable } = materializeTrustedGitRoot(value.root);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
      approvedCommandRoots: [commandRoot],
      env: { PATH: commandRoot },
    });
    assert.deepEqual(plan.execution.commandPlan.approvedCommandRoots, [
      path.resolve(commandRoot),
    ]);
    assert.equal(
      plan.execution.commandPlan.commands.git.binding.command,
      path.resolve(executable),
    );
    assert.match(
      plan.execution.commandPlan.commands.git.binding.identity.binary.sha256,
      /^[a-f0-9]{64}$/,
    );
    assert.deepEqual(plan.execution.subprocessConfigRoots, {
      home: path.resolve(value.homeDir),
      userProfile: path.resolve(value.homeDir),
      xdgConfigHome: path.join(path.resolve(value.homeDir), ".config"),
      codexHome: path.join(path.resolve(value.homeDir), ".codex"),
      sourceCache: path.join(
        path.resolve(value.homeDir),
        ".agents",
        "harness",
        "sources",
      ),
      toolCache: path.join(
        path.resolve(value.homeDir),
        ".agents",
        "harness",
        "tools",
      ),
    });
    const originalSha256 = plan.planSha256;
    plan.execution.commandPlan.approvedCommandRoots.push(
      path.join(value.root, "late-root"),
    );
    assert.throws(
      () => resolveThirdPartyApprovals({
        plan,
        selections: {
          globalSkills: [],
          globalPlugins: [],
          projectSkills: [],
          mcpCli: [],
        },
      }),
      /drifted after presentation/i,
    );
    assert.equal(plan.planSha256, originalSha256);
  } finally {
    value.cleanup();
  }
});

test("approval resolution rejects a displayed plan changed after its digest", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifestPath: MANIFEST_PATH,
      strictDataBoundary: true,
    });
    const fastContext = plan.groups
      .flatMap((group) => group.candidates)
      .find((candidate) => candidate.id === "fast-context");
    fastContext.blocked = false;
    fastContext.unavailableReason = null;
    await assert.rejects(
      async () => resolveThirdPartyApprovals({
        plan,
        selections: {
          globalSkills: [],
          globalPlugins: [],
          projectSkills: [],
          mcpCli: ["fast-context"],
        },
      }),
      /plan drifted after presentation/i,
    );
  } finally {
    value.cleanup();
  }
});

test("authoritative strict plan rejects approvals forged from a non-strict plan", async () => {
  const value = fixture();
  try {
    const nonStrictPlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifestPath: MANIFEST_PATH,
      strictDataBoundary: false,
    });
    const forgedApprovals = resolveThirdPartyApprovals({
      plan: nonStrictPlan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: ["fast-context"],
      },
    });
    const strictPlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifestPath: MANIFEST_PATH,
      strictDataBoundary: true,
    });
    await assert.rejects(
      preflightThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        strictDataBoundary: true,
        manifestPath: MANIFEST_PATH,
        approvals: forgedApprovals,
        approvalPlan: strictPlan,
      }),
      /authoritative displayed plan/i,
    );
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        strictDataBoundary: true,
        manifestPath: MANIFEST_PATH,
        approvals: forgedApprovals,
        approvalPlan: strictPlan,
        sourceResolver: async () => {
          throw new Error("must not resolve a source");
        },
      }),
      /authoritative displayed plan/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
  } finally {
    value.cleanup();
  }
});

test("reject-all and partial approvals remain explicit and dependency-safe", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const rejected = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    assert.deepEqual(rejected.approvedActionIds, []);

    const partial = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: ["ponytail.install"],
        projectSkills: ["diagnosing-bugs"],
        mcpCli: ["codegraph"],
      },
    });
    assert.deepEqual(partial.skipped, []);
    assert.equal(partial.approvedActionIds.includes("matt-grilling"), true);
    assert.equal(partial.approvedActionIds.includes("ponytail.hooks"), false);
    assert.equal(partial.approvedActionIds.includes("ponytail.default-full"), false);
    assert.equal(
      partial.approvedActionIds.some((entry) => entry === "codegraph.init"),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("required dependency rejection skips the parent instead of silently installing", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const resolved = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: ["improve-codebase-architecture"],
        mcpCli: [],
      },
    });
    assert.equal(
      resolved.approvedActionIds.includes("improve-codebase-architecture"),
      false,
    );
    assert.deepEqual(
      resolved.skipped.find(
        (entry) => entry.id === "improve-codebase-architecture",
      ).missingDependencies,
      ["codebase-design", "domain-modeling", "grilling"],
    );
  } finally {
    value.cleanup();
  }
});

test("strict data boundaries reject fast-context without blocking other choices", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
      strictDataBoundary: true,
    });
    const resolved = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: ["fast-context", "ripgrep"],
      },
    });
    assert.equal(resolved.approvedActionIds.includes("fast-context"), false);
    assert.equal(resolved.approvedActionIds.includes("ripgrep"), true);
    const fastContext = plan.groups
      .find((group) => group.id === "mcp-cli")
      .candidates.find((candidate) => candidate.id === "fast-context");
    assert.equal(fastContext.blocked, true);
    assert.equal(fastContext.recommended, false);
    assert.match(
      resolved.skipped.find((entry) => entry.id === "fast-context").reason,
      /data boundary/i,
    );
  } finally {
    value.cleanup();
  }
});

test("Skill installers reject forged approvedActionIds that lack explicit selections", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const globalPlan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const globalApprovals = resolveThirdPartyApprovals({
      plan: globalPlan,
      selections: { globalSkills: ["matt-grilling"], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const forgedGlobal = { ...globalApprovals, selections: { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] } };
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true, approvals: forgedGlobal, approvalPlan: globalPlan, homeDir: value.homeDir, manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
      }),
      /not explicitly selected/i,
    );

    const projectPlan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const projectApprovals = resolveThirdPartyApprovals({
      plan: projectPlan,
      selections: { globalSkills: [], globalPlugins: [], projectSkills: ["fixture-project-grill-me"], mcpCli: [] },
    });
    const forgedProject = { ...projectApprovals, selections: { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] } };
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true, approvals: forgedProject, approvalPlan: projectPlan, homeDir: value.homeDir, repoRoot: value.repoRoot, manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
      }),
      /not explicitly selected/i,
    );
  } finally {
    value.cleanup();
  }
});

test("the global interview bundle installs atomically and repeats unchanged", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifest: source.manifest,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const first = await applyThirdPartyGlobalSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      approvalPlan: plan,
      repoRoot: value.repoRoot,
      strictDataBoundary: false,
      sourceResolver: async () => source.sourceRoot,
    });
    assert.equal(first.status, "installed");
    assert.equal(
      existsSync(
        path.join(value.homeDir, ".agents", "skills", "grill-me", "SKILL.md"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(value.homeDir, ".agents", "skills", "grilling", "SKILL.md"),
      ),
      true,
    );
    const second = await applyThirdPartyGlobalSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      approvalPlan: plan,
      repoRoot: value.repoRoot,
      strictDataBoundary: false,
      sourceResolver: async () => source.sourceRoot,
    });
    assert.equal(second.status, "unchanged");
  } finally {
    value.cleanup();
  }
});

test("explicit Caveman approval installs its pinned global Skill, repeats unchanged, and leaves Claude untouched", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const resolver = async ({ source: pinned }) => pinned.id === "caveman" ? source.cavemanRoot : source.sourceRoot;
    const first = await applyThirdPartyGlobalSkills({
      approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest, sourceResolver: resolver,
    });
    assert.equal(first.status, "installed");
    assert.deepEqual(first.approvedSkillIds, ["caveman"]);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "caveman", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
    const second = await applyThirdPartyGlobalSkills({
      approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest, sourceResolver: resolver,
    });
    assert.equal(second.status, "unchanged");
  } finally {
    value.cleanup();
  }
});

test("Caveman refuses a user-owned global Skill collision without replacing bytes", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const collision = path.join(value.homeDir, ".agents", "skills", "caveman");
    mkdirSync(collision, { recursive: true });
    writeFileSync(path.join(collision, "SKILL.md"), "user-owned caveman\n");
    const before = readFileSync(path.join(collision, "SKILL.md"));
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest,
        sourceResolver: async ({ source: pinned }) => pinned.id === "caveman" ? source.cavemanRoot : source.sourceRoot,
      }),
      /user drift|unrecognized/i,
    );
    assert.deepEqual(readFileSync(path.join(collision, "SKILL.md")), before);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("approved global bundles share one ownership-last transaction", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: ["matt-grilling", "caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const result = await applyThirdPartyGlobalSkills({
      approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest,
      sourceResolver: async ({ source: pinned }) => pinned.id === "caveman" ? source.cavemanRoot : source.sourceRoot,
    });
    assert.equal(result.status, "installed");
    assert.deepEqual(result.approvedSkillIds, ["matt-grilling", "caveman"]);
    const ownership = JSON.parse(readFileSync(path.join(value.homeDir, ".agents", "harness", "third-party-installations.json"), "utf8"));
    assert.deepEqual(Object.keys(ownership.installations).sort(), ["caveman", "matt-grilling"]);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "grilling", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "caveman", "SKILL.md")), true);
  } finally {
    value.cleanup();
  }
});

test("a same-process global Skill transaction cannot reenter recovery or mutate", async () => {
  const value = fixture();
  const entered = deferred();
  const resume = deferred();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifest: source.manifest,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["caveman"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const install = () => applyThirdPartyGlobalSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      sourceResolver: async () => source.cavemanRoot,
    });
    const first = applyThirdPartyGlobalSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      sourceResolver: async () => source.cavemanRoot,
      faultInjector: async (phase) => {
        if (phase === "before-activate:caveman:caveman") {
          entered.resolve();
          await resume.promise;
        }
      },
    });
    await entered.promise;
    await assert.rejects(install(), /live process|concurrent recovery/i);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "caveman")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-installations.json")),
      false,
    );
    resume.resolve();
    assert.equal((await first).status, "installed");
  } finally {
    resume.resolve();
    value.cleanup();
  }
});

test("global Skill activation refuses a target created after preflight", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] } });
    const target = path.join(value.homeDir, ".agents", "skills", "caveman");
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest,
        sourceResolver: async () => source.cavemanRoot,
        faultInjector: async (phase) => {
          if (phase === "before-lock") writeSkill(value.homeDir, ".agents/skills/caveman", "caveman", "racing user edit");
        },
      }),
      /changed after preflight/i,
    );
    assert.match(readFileSync(path.join(target, "SKILL.md"), "utf8"), /racing user edit/);
  } finally { value.cleanup(); }
});

test("global Skill activation refuses ownership drift after preflight", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] } });
    const ownershipPath = path.join(value.homeDir, ".agents", "harness", "third-party-installations.json");
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest,
        sourceResolver: async () => source.cavemanRoot,
        faultInjector: async (phase) => {
          if (phase === "before-lock") {
            mkdirSync(path.dirname(ownershipPath), { recursive: true });
            writeFileSync(ownershipPath, `${JSON.stringify({ schemaVersion: 1, owner: "trellis-ccg-harness", installations: { other: {} } }, null, 2)}\n`);
          }
        },
      }),
      /ownership changed after preflight/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "caveman")), false);
  } finally { value.cleanup(); }
});

test("global Skill activation rechecks a target immediately before replacement", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] } });
    const target = path.join(value.homeDir, ".agents", "skills", "caveman");
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest, sourceResolver: async () => source.cavemanRoot,
        faultInjector: async (phase) => {
          if (phase === "before-activate:caveman:caveman") writeSkill(value.homeDir, ".agents/skills/caveman", "caveman", "late racing user edit");
        },
      }),
      /changed after preflight/i,
    );
    assert.match(readFileSync(path.join(target, "SKILL.md"), "utf8"), /late racing user edit/);
  } finally { value.cleanup(); }
});

test("global Skill activation rechecks ownership immediately before commit", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] } });
    const ownershipPath = path.join(value.homeDir, ".agents", "harness", "third-party-installations.json");
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true, approvals, homeDir: value.homeDir, manifest: source.manifest, sourceResolver: async () => source.cavemanRoot,
        faultInjector: async (phase) => {
          if (phase === "before-ownership") writeFileSync(ownershipPath, `${JSON.stringify({ schemaVersion: 1, owner: "trellis-ccg-harness", installations: { user: {} } }, null, 2)}\n`);
        },
      }),
      /ownership changed before commit/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "caveman")), false);
    assert.deepEqual(JSON.parse(readFileSync(ownershipPath, "utf8")).installations, { user: {} });
  } finally { value.cleanup(); }
});

test("legacy grill-me migration refuses user drift and preserves bytes", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const target = path.join(value.homeDir, ".agents", "skills", "grill-me");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "SKILL.md"), "user modified\n");
    const before = readFileSync(path.join(target, "SKILL.md"));
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifest: source.manifest,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: async () => source.sourceRoot,
      }),
      /user|drift|legacy/i,
    );
    assert.deepEqual(readFileSync(path.join(target, "SKILL.md")), before);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grilling")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("an unavailable optional source is reported without partial installation", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifest: source.manifest,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const result = await applyThirdPartyGlobalSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      sourceResolver: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(result.status, "source-unavailable");
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("interrupted bundle state recovers both targets together", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifest: source.manifest,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "installed:grill-me") {
            const error = new Error("simulated hard interruption");
            error.leaveTransactionForRecovery = true;
            throw error;
          }
        },
      }),
      /interruption/i,
    );
    const recovery = await recoverThirdPartyTransactions({
      homeDir: value.homeDir,
      processAlive: async () => false,
    });
    assert.equal(recovery.status, "rolled-back");
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grilling")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("pinned Git acquisition fetches only the approved full commit and validates the cache", async () => {
  const value = fixture();
  try {
    const sourceFixture = await fixtureManifest(value);
    const source = sourceFixture.manifest.sources[0];
    const { commandRoot } = materializeTrustedGitRoot(value.root);
    const approvalPlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: sourceFixture.manifest,
      approvedCommandRoots: [commandRoot],
      env: { PATH: commandRoot },
    });
    const calls = [];
    const fakeGit = async (_command, args) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        return { stdout: args[1] === "HEAD" ? `${source.commit}\n` : `${source.gitTree}\n` };
      }
      return { stdout: "" };
    };
    const cache = await acquirePinnedGitSource({
      approvalPlan,
      homeDir: value.homeDir,
      source,
      execFileImpl: fakeGit,
    });
    assert.equal(
      calls.some((args) => args[0] === "fetch" && args.at(-1) === source.commit),
      true,
    );
    assert.equal(calls.some((args) => args.join(" ").match(/main|latest/i)), false);
    const before = calls.length;
    const repeated = await acquirePinnedGitSource({
      approvalPlan,
      homeDir: value.homeDir,
      source,
      execFileImpl: fakeGit,
    });
    assert.equal(repeated, cache);
    assert.equal(calls.slice(before).some((args) => args[0] === "fetch"), false);
  } finally {
    value.cleanup();
  }
});

test("pinned Git acquisition requires the displayed Git identity and strips caller GIT injection", async () => {
  const value = fixture();
  try {
    const sourceFixture = await fixtureManifest(value);
    const source = sourceFixture.manifest.sources[0];
    const { commandRoot, executable } = materializeTrustedGitRoot(value.root);
    const approvalPlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: sourceFixture.manifest,
      approvedCommandRoots: [commandRoot],
      env: { PATH: commandRoot },
    });
    const calls = [];
    const cache = await acquirePinnedGitSource({
      homeDir: value.homeDir,
      source,
      approvalPlan,
      env: {
        HOME: path.join(value.root, "attacker-home"),
        GIT_DIR: path.join(value.root, "attacker-git-dir"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: path.join(value.root, "attacker-hooks"),
        GIT_SSH_COMMAND: "attacker-command",
        LD_PRELOAD: "attacker.so",
      },
      execFileImpl: async (command, args, options) => {
        calls.push({ command, args, options });
        if (args[0] === "rev-parse") {
          return {
            stdout: args[1] === "HEAD"
              ? `${source.commit}\n`
              : `${source.gitTree}\n`,
          };
        }
        return { stdout: "" };
      },
    });
    assert.equal(existsSync(cache), true);
    assert.ok(calls.length >= 7);
    for (const call of calls) {
      assert.equal(call.command, path.resolve(executable));
      assert.equal(call.options.shell, false);
      assert.equal(call.options.env.HOME, path.resolve(value.homeDir));
      assert.equal(call.options.env.GIT_CONFIG_NOSYSTEM, "1");
      assert.equal(call.options.env.GIT_TERMINAL_PROMPT, "0");
      for (const forbidden of [
        "GIT_DIR",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_KEY_0",
        "GIT_CONFIG_VALUE_0",
        "GIT_SSH_COMMAND",
        "LD_PRELOAD",
      ]) {
        assert.equal(call.options.env[forbidden], undefined);
      }
    }
  } finally {
    value.cleanup();
  }
});

test("project Skills install transactionally with ownership-last, idempotence, and no Claude writes", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: ["fixture-project-grill-me", "fixture-project-grilling"],
        mcpCli: [],
      },
    });
    const first = await applyThirdPartyProjectSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
      approvalPlan: plan,
      strictDataBoundary: false,
      sourceResolver: async () => source.sourceRoot,
    });
    assert.equal(first.status, "installed");
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.repoRoot, ".harness", "third-party-installations.json")), true);
    assert.equal(
      existsSync(path.join(value.repoRoot, ".harness", "third-party-transaction.key")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-transaction.key")),
      true,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    const second = await applyThirdPartyProjectSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
      approvalPlan: plan,
      strictDataBoundary: false,
      sourceResolver: async () => source.sourceRoot,
    });
    assert.equal(second.status, "unchanged");
  } finally {
    value.cleanup();
  }
});

test("a same-process project Skill transaction cannot reenter recovery or mutate", async () => {
  const value = fixture();
  const entered = deferred();
  const resume = deferred();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifest: source.manifest,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: ["fixture-project-grill-me"],
        mcpCli: [],
      },
    });
    const install = () => applyThirdPartyProjectSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
      approvalPlan: plan,
      strictDataBoundary: false,
      sourceResolver: async () => source.sourceRoot,
    });
    const first = applyThirdPartyProjectSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
      sourceResolver: async () => source.sourceRoot,
      faultInjector: async (phase) => {
        if (phase === "before-activate:fixture-project-grill-me:grill-me") {
          entered.resolve();
          await resume.promise;
        }
      },
    });
    await entered.promise;
    await assert.rejects(install(), /live process|concurrent recovery/i);
    assert.equal(
      existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.repoRoot, ".harness", "third-party-installations.json")),
      false,
    );
    resume.resolve();
    assert.equal((await first).status, "installed");
  } finally {
    resume.resolve();
    value.cleanup();
  }
});

test("project Skill activation refuses a target created after preflight", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: [], globalPlugins: [], projectSkills: ["fixture-project-grill-me"], mcpCli: [] } });
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true, approvals, homeDir: value.homeDir, repoRoot: value.repoRoot,
        manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "before-lock") writeSkill(value.repoRoot, ".agents/skills/grill-me", "grill-me", "project racing user edit");
        },
      }),
      /changed after preflight/i,
    );
    assert.match(readFileSync(path.join(value.repoRoot, ".agents", "skills", "grill-me", "SKILL.md"), "utf8"), /project racing user edit/);
  } finally { value.cleanup(); }
});

test("project Skill activation refuses ownership drift after preflight", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: [], globalPlugins: [], projectSkills: ["fixture-project-grill-me"], mcpCli: [] } });
    const ownershipPath = path.join(value.repoRoot, ".harness", "third-party-installations.json");
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true, approvals, homeDir: value.homeDir, repoRoot: value.repoRoot,
        manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "before-lock") {
            mkdirSync(path.dirname(ownershipPath), { recursive: true });
            writeFileSync(ownershipPath, `${JSON.stringify({ schemaVersion: 1, owner: "trellis-ccg-harness", installations: { other: {} } }, null, 2)}\n`);
          }
        },
      }),
      /ownership changed after preflight/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me")), false);
  } finally { value.cleanup(); }
});

test("project Skill activation rechecks a target immediately before replacement", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: [], globalPlugins: [], projectSkills: ["fixture-project-grill-me"], mcpCli: [] } });
    const target = path.join(value.repoRoot, ".agents", "skills", "grill-me");
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true, approvals, homeDir: value.homeDir, repoRoot: value.repoRoot, manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "before-activate:fixture-project-grill-me:grill-me") writeSkill(value.repoRoot, ".agents/skills/grill-me", "grill-me", "late project racing user edit");
        },
      }),
      /changed after preflight/i,
    );
    assert.match(readFileSync(path.join(target, "SKILL.md"), "utf8"), /late project racing user edit/);
  } finally { value.cleanup(); }
});

test("project Skill activation rechecks ownership immediately before commit", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({ plan, selections: { globalSkills: [], globalPlugins: [], projectSkills: ["fixture-project-grill-me"], mcpCli: [] } });
    const ownershipPath = path.join(value.repoRoot, ".harness", "third-party-installations.json");
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true, approvals, homeDir: value.homeDir, repoRoot: value.repoRoot, manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "before-ownership") {
            mkdirSync(path.dirname(ownershipPath), { recursive: true });
            writeFileSync(ownershipPath, `${JSON.stringify({ schemaVersion: 1, owner: "trellis-ccg-harness", installations: { user: {} } }, null, 2)}\n`);
          }
        },
      }),
      /ownership changed before commit/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me")), false);
    assert.deepEqual(JSON.parse(readFileSync(ownershipPath, "utf8")).installations, { user: {} });
  } finally { value.cleanup(); }
});

test("project approval planning observes project Skill drift in repoRoot, not homeDir", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    writeSkill(value.repoRoot, ".agents/skills/grilling", "grilling", "user project drift");
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const candidate = plan.groups
      .find((group) => group.id === "project-skills")
      .candidates.find((entry) => entry.id === "fixture-project-grilling");
    assert.equal(candidate.installed.status, "drifted");
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "grilling")), false);
  } finally {
    value.cleanup();
  }
});

test("project interruption restores its whole approved batch without overwriting user data", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [], globalPlugins: [],
        projectSkills: ["fixture-project-grill-me", "fixture-project-grilling"], mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true, approvals, homeDir: value.homeDir, repoRoot: value.repoRoot,
        manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "installed:fixture-project-grill-me:grill-me") {
            const error = new Error("simulated project interruption");
            error.leaveTransactionForRecovery = true;
            throw error;
          }
        },
      }),
      /interruption/i,
    );
    const recovery = await recoverThirdPartyProjectTransactions({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      processAlive: async () => false,
    });
    assert.equal(recovery.status, "rolled-back");
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "grilling")), false);
  } finally {
    value.cleanup();
  }
});

test("explicit reject-all approval records a canonical source snapshot without secrets", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifestPath: MANIFEST_PATH, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const first = await recordThirdPartyGlobalApproval({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      strictDataBoundary: false,
      manifestPath: MANIFEST_PATH,
      approvals,
      approvalPlan: plan,
    });
    assert.equal(first.status, "recorded");
    const sourcePath = path.join(value.homeDir, ".agents", "harness", "third-party-sources.json");
    const approvalPath = first.approvalPath;
    assert.equal(path.basename(path.dirname(approvalPath)), "third-party-approvals");
    const recorded = JSON.parse(readFileSync(approvalPath, "utf8"));
    assert.deepEqual(recorded.approvedActionIds, []);
    assert.deepEqual(recorded.selections, { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] });
    assert.equal(recorded.planSha256, plan.planSha256);
    assert.equal(recorded.planEvidence.strictDataBoundary, false);
    assert.equal(recorded.planEvidence.targetRoots.projectSkills, value.repoRoot);
    assert.equal(readFileSync(sourcePath, "utf8").includes("@latest"), false);
    assert.match(readFileSync(approvalPath, "utf8"), /sourceManifestSha256/);
    assert.equal((await recordThirdPartyGlobalApproval({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      strictDataBoundary: false,
      manifestPath: MANIFEST_PATH,
      approvals,
      approvalPlan: plan,
    })).status, "unchanged");
    writeFileSync(approvalPath, `${readFileSync(approvalPath, "utf8").trim()}\nuser-drift\n`);
    await assert.rejects(
      recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifestPath: MANIFEST_PATH, approvals }),
      /user-modified|canonical/i,
    );
  } finally {
    value.cleanup();
  }
});

test("approval receipts preserve reject-all and permit a later explicit Caveman approval", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const rejected = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const before = await preflightThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: rejected });
    assert.equal(before.sourceUnchanged, false);
    assert.equal(existsSync(path.join(value.homeDir, ".agents")), false);
    const rejectedReceipt = await recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: rejected });
    const selected = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const selectedPreflight = await preflightThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: selected });
    assert.equal(selectedPreflight.sourceUnchanged, true);
    assert.equal(selectedPreflight.approvalUnchanged, false);
    const selectedReceipt = await recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: selected });
    assert.notEqual(selectedReceipt.approvalPath, rejectedReceipt.approvalPath);
    assert.deepEqual(JSON.parse(readFileSync(rejectedReceipt.approvalPath, "utf8")).approvedActionIds, []);
    const installation = await applyThirdPartyGlobalSkills({
      approved: true,
      approvals: selected,
      homeDir: value.homeDir,
      manifest: source.manifest,
      sourceResolver: async () => source.cavemanRoot,
    });
    assert.equal(installation.status, "installed");
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "caveman", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")), false);
    assert.equal(existsSync(path.join(value.homeDir, ".claude")), false);
  } finally {
    value.cleanup();
  }
});

test("a rewritten, rehashed, and renamed historical approval receipt still fails authentication", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifest: source.manifest, repoRoot: value.repoRoot });
    const rejected = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const selected = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: ["caveman"], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const receipt = await recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: rejected });
    const tamperedBytes = canonicalJson({
      ...selected,
      approvedActionIds: [...selected.approvedActionIds],
      selections: { ...selected.selections },
    });
    writeFileSync(receipt.approvalPath, tamperedBytes);
    const renamedReceipt = path.join(
      path.dirname(receipt.approvalPath),
      `${sha256(tamperedBytes)}.json`,
    );
    renameSync(receipt.approvalPath, renamedReceipt);
    await assert.rejects(
      preflightThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: selected }),
      /unauthenticated|tampered|manual review/i,
    );
  } finally {
    value.cleanup();
  }
});

test("approval receipt recording fails closed while another receipt writer holds the lock", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({ homeDir: value.homeDir, manifestPath: MANIFEST_PATH, repoRoot: value.repoRoot });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] },
    });
    const lock = path.join(value.homeDir, ".agents", "harness", "third-party-approvals.lock");
    mkdirSync(path.dirname(lock), { recursive: true });
    writeFileSync(lock, "another writer\n");
    await assert.rejects(
      recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifestPath: MANIFEST_PATH, approvals }),
      /being recorded/i,
    );
    assert.equal(existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-sources.json")), false);
  } finally {
    value.cleanup();
  }
});

test("approval receipt recording recovers a dead authenticated lock left before writes", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifestPath: MANIFEST_PATH,
        approvals,
        faultInjector: async (phase) => {
          if (phase === "after-approval-lock") {
            const error = new Error("simulated crash after approval lock");
            error.leaveApprovalLockForRecovery = true;
            throw error;
          }
        },
      }),
      /crash after approval lock/i,
    );
    const lock = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "third-party-approvals.lock",
    );
    assert.equal(existsSync(lock), true);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-sources.json")),
      false,
    );
    const recovered = await recordThirdPartyGlobalApproval({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      approvals,
      processAlive: async () => false,
    });
    assert.equal(recovered.status, "recorded");
    assert.equal(existsSync(lock), false);
  } finally {
    value.cleanup();
  }
});

test("approval receipt recording recovers canonical receipt state from a dead writer", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifestPath: MANIFEST_PATH,
        approvals,
        faultInjector: async (phase) => {
          if (phase === "after-approval-receipt") {
            const error = new Error("simulated crash after approval receipt");
            error.leaveApprovalLockForRecovery = true;
            throw error;
          }
        },
      }),
      /crash after approval receipt/i,
    );
    const recovered = await recordThirdPartyGlobalApproval({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      approvals,
      processAlive: async () => false,
    });
    assert.equal(recovered.status, "unchanged");
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-approvals.lock")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("approval receipt stale-lock recovery preserves drift for manual review", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    let receiptPath;
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifestPath: MANIFEST_PATH,
        approvals,
        faultInjector: async (phase, context) => {
          if (phase === "after-approval-receipt") {
            receiptPath = context.approvalTarget;
            const error = new Error("simulated crash before cleanup");
            error.leaveApprovalLockForRecovery = true;
            throw error;
          }
        },
      }),
      /crash before cleanup/i,
    );
    writeFileSync(receiptPath, `${readFileSync(receiptPath, "utf8")}drift\n`);
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifestPath: MANIFEST_PATH,
        approvals,
        processAlive: async () => false,
      }),
      /manual review|user-modified|canonical/i,
    );
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "harness", "third-party-approvals.lock")),
      true,
    );
  } finally {
    value.cleanup();
  }
});

test("npm-backed candidates require an exact package selector and complete pinned lock metadata", () => {
  const missingIntegrity = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  delete missingIntegrity.sources.find((entry) => entry.id === "context7")
    .packageIntegrity;
  assert.throws(
    () => validateThirdPartySourceManifest(missingIntegrity),
    /package.*packageIntegrity.*packageLock together/i,
  );

  const mutableSelector = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  mutableSelector.candidates.find((entry) => entry.id === "context7")
    .packageSelector = "@upstash/context7-mcp@latest";
  assert.throws(
    () => validateThirdPartySourceManifest(mutableSelector),
    /packageSelector must exactly match/i,
  );

  const traversingLock = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  traversingLock.sources.find((entry) => entry.id === "context7")
    .packageLock.path = "../context7.package-lock.json";
  assert.throws(
    () => validateThirdPartySourceManifest(traversingLock),
    /invalid Harness-owned packageLock/i,
  );
});

test("every approval candidate reports bounded installation evidence and an allowed observed status", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifestPath: MANIFEST_PATH,
    });
    const candidates = plan.groups.flatMap((group) => group.candidates);
    const allowedStatuses = new Set([
      "absent",
      "exact",
      "drifted",
      "unowned",
      "manual-pending",
    ]);
    assert.equal(candidates.length > 0, true);
    for (const candidate of candidates) {
      assert.equal(candidate.installed.scope, candidate.scope);
      assert.equal(candidate.installed.expected.sourceId, candidate.sourceId);
      assert.equal(candidate.installed.expected.repository, candidate.repository);
      assert.equal(candidate.installed.expected.commit, candidate.commit);
      assert.equal(candidate.installed.expected.gitTree, candidate.gitTree);
      assert.equal(
        allowedStatuses.has(candidate.installed.observed.status),
        true,
        `${candidate.id} has an unsupported observed status`,
      );
      assert.equal(
        candidate.installed.status,
        candidate.installed.observed.status,
      );
    }
    const ponytailHook = candidates.find(
      (candidate) => candidate.id === "ponytail.hooks",
    );
    assert.equal(ponytailHook.installed.status, "manual-pending");
    const context7 = candidates.find((candidate) => candidate.id === "context7");
    assert.equal(context7.installed.status, "absent");
    assert.match(context7.installed.expected.packageIntegrity, /^sha512-/);
    assert.match(
      context7.installed.expected.packageLockSha256,
      /^[a-f0-9]{64}$/,
    );
  } finally {
    value.cleanup();
  }
});

test("operations reject forged approval evidence when no authoritative plan is supplied", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const forged = structuredClone(approvals);
    forged.planEvidence.strictDataBoundary = true;
    forged.planSha256 = sha256(canonicalJson(forged.planEvidence));
    let sourceResolved = false;
    await assert.rejects(
      applyThirdPartyGlobalSkillsRaw({
        approved: true,
        approvals: forged,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        strictDataBoundary: true,
        manifest: source.manifest,
        sourceResolver: async () => {
          sourceResolved = true;
          return source.sourceRoot;
        },
      }),
      /authoritative plan/i,
    );
    assert.equal(sourceResolved, false);
    await assert.rejects(
      preflightThirdPartyGlobalApprovalRaw({
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        strictDataBoundary: true,
        manifest: source.manifest,
        approvals: forged,
      }),
      /authoritative plan/i,
    );
  } finally {
    value.cleanup();
  }
});

test("global recovery after an ownership write restores both targets and prior ownership", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "after-ownership-write") {
            const error = new Error("simulated crash after global ownership write");
            error.leaveTransactionForRecovery = true;
            throw error;
          }
        },
      }),
      /global ownership write/i,
    );
    const ownership = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "third-party-installations.json",
    );
    assert.equal(existsSync(ownership), true);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")),
      true,
    );
    const recovered = await recoverThirdPartyTransactions({
      homeDir: value.homeDir,
      processAlive: async () => false,
    });
    assert.equal(recovered.status, "rolled-back");
    assert.equal(existsSync(ownership), false);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grilling")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("project recovery after an ownership write restores both targets and prior ownership", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [
          "fixture-project-grill-me",
          "fixture-project-grilling",
        ],
        mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        manifest: source.manifest,
        sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (phase === "after-ownership-write") {
            const error = new Error("simulated crash after project ownership write");
            error.leaveTransactionForRecovery = true;
            throw error;
          }
        },
      }),
      /project ownership write/i,
    );
    const ownership = path.join(
      value.repoRoot,
      ".harness",
      "third-party-installations.json",
    );
    assert.equal(existsSync(ownership), true);
    const recovered = await recoverThirdPartyProjectTransactions({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      processAlive: async () => false,
    });
    assert.equal(recovered.status, "rolled-back");
    assert.equal(existsSync(ownership), false);
    assert.equal(
      existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.repoRoot, ".agents", "skills", "grilling")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("approval atomic creation never replaces a post-preflight source collision", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const collisionBytes = "{\"attacker\":true}\n";
    let collisionPath;
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifest: source.manifest,
        approvals,
        faultInjector: async (phase, context) => {
          if (phase === "before-source-manifest-write") {
            collisionPath = context.sourceTarget;
            writeFileSync(collisionPath, collisionBytes, { flag: "wx" });
          }
        },
      }),
      /EEXIST|exist/i,
    );
    assert.equal(readFileSync(collisionPath, "utf8"), collisionBytes);
  } finally {
    value.cleanup();
  }
});

test("approval atomic creation never replaces a post-preflight receipt collision", async () => {
  const value = fixture();
  try {
    const source = await fixtureManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const collisionBytes = "{\"attacker\":true}\n";
    let collisionPath;
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifest: source.manifest,
        approvals,
        faultInjector: async (phase, context) => {
          if (phase === "before-approval-receipt-write") {
            collisionPath = context.approvalTarget;
            writeFileSync(collisionPath, collisionBytes, { flag: "wx" });
          }
        },
      }),
      /EEXIST|exist/i,
    );
    assert.equal(readFileSync(collisionPath, "utf8"), collisionBytes);
  } finally {
    value.cleanup();
  }
});

test("global Skill create-only publish preserves a target raced into its reservation slot", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["caveman"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const target = path.join(value.homeDir, ".agents", "skills", "caveman");
    const collision = "user-owned reservation collision\n";
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: async () => source.cavemanRoot,
        faultInjector: async (phase) => {
          if (phase === "before-target-reserve:caveman:caveman") {
            mkdirSync(target, { recursive: true });
            writeFileSync(path.join(target, "USER.txt"), collision);
          }
        },
      }),
      /collision|not transaction-owned|refusing overwrite/i,
    );
    assert.equal(readFileSync(path.join(target, "USER.txt"), "utf8"), collision);
  } finally {
    value.cleanup();
  }
});

test("project Skill create-only publish preserves a target raced into its reservation slot", async () => {
  const value = fixture();
  try {
    const source = await fixtureProjectManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: ["fixture-project-grill-me"],
        mcpCli: [],
      },
    });
    const target = path.join(value.repoRoot, ".agents", "skills", "grill-me");
    const collision = "project user-owned reservation collision\n";
    await assert.rejects(
      applyThirdPartyProjectSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        manifest: source.manifest,
        sourceResolver: async () => source.sourceRoot,
        faultInjector: async (phase) => {
          if (
            phase ===
            "before-target-reserve:fixture-project-grill-me:grill-me"
          ) {
            mkdirSync(target, { recursive: true });
            writeFileSync(path.join(target, "USER.txt"), collision);
          }
        },
      }),
      /collision|not transaction-owned|refusing overwrite/i,
    );
    assert.equal(readFileSync(path.join(target, "USER.txt"), "utf8"), collision);
  } finally {
    value.cleanup();
  }
});

test("a hard kill after global target reservation recovers the partial publish", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: ["caveman"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: async () => source.cavemanRoot,
        faultInjector: async (phase) => {
          if (phase === "mid-publish:caveman:caveman") {
            const error = new Error("simulated mid-publish hard kill");
            error.leaveTransactionForRecovery = true;
            throw error;
          }
        },
      }),
      /mid-publish hard kill/i,
    );
    const target = path.join(value.homeDir, ".agents", "skills", "caveman");
    assert.equal(existsSync(target), true);
    const recovered = await recoverThirdPartyTransactions({
      homeDir: value.homeDir,
      processAlive: async () => false,
    });
    assert.equal(recovered.status, "rolled-back");
    assert.equal(existsSync(target), false);
  } finally {
    value.cleanup();
  }
});

test("ownership create-only publish preserves a post-claim collision", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const resolver = async ({ source: entry }) =>
      entry.id === "caveman" ? source.cavemanRoot : source.sourceRoot;
    const initialPlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const initialApprovals = resolveThirdPartyApprovals({
      plan: initialPlan,
      selections: {
        globalSkills: ["caveman"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    assert.equal((await applyThirdPartyGlobalSkills({
      approved: true,
      approvals: initialApprovals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      sourceResolver: resolver,
    })).status, "installed");
    const updatePlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const updateApprovals = resolveThirdPartyApprovals({
      plan: updatePlan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const collision = "user-owned ownership collision\n";
    let ownershipPath;
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals: updateApprovals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: resolver,
        faultInjector: async (phase, context) => {
          if (phase === "after-ownership-claim") {
            ownershipPath = context.target;
            writeFileSync(ownershipPath, collision, { flag: "wx" });
          }
        },
      }),
      /ownership.*drifted|recovery also failed|refusing overwrite/i,
    );
    assert.equal(readFileSync(ownershipPath, "utf8"), collision);
  } finally {
    value.cleanup();
  }
});

test("a hard kill after ownership claim restores the prior ownership record", async () => {
  const value = fixture();
  try {
    const source = await fixtureCavemanManifest(value);
    const resolver = async ({ source: entry }) =>
      entry.id === "caveman" ? source.cavemanRoot : source.sourceRoot;
    const initialPlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const initialApprovals = resolveThirdPartyApprovals({
      plan: initialPlan,
      selections: {
        globalSkills: ["caveman"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    assert.equal((await applyThirdPartyGlobalSkills({
      approved: true,
      approvals: initialApprovals,
      homeDir: value.homeDir,
      manifest: source.manifest,
      sourceResolver: resolver,
    })).status, "installed");
    const ownershipPath = path.join(
      value.homeDir,
      ".agents",
      "harness",
      "third-party-installations.json",
    );
    const before = readFileSync(ownershipPath);
    const updatePlan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
    });
    const updateApprovals = resolveThirdPartyApprovals({
      plan: updatePlan,
      selections: {
        globalSkills: ["matt-grilling"],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    await assert.rejects(
      applyThirdPartyGlobalSkills({
        approved: true,
        approvals: updateApprovals,
        homeDir: value.homeDir,
        manifest: source.manifest,
        sourceResolver: resolver,
        faultInjector: async (phase) => {
          if (phase === "after-ownership-claim") {
            const error = new Error("simulated ownership-claim hard kill");
            error.leaveTransactionForRecovery = true;
            throw error;
          }
        },
      }),
      /ownership-claim hard kill/i,
    );
    assert.equal(existsSync(ownershipPath), false);
    const recovered = await recoverThirdPartyTransactions({
      homeDir: value.homeDir,
      processAlive: async () => false,
    });
    assert.equal(recovered.status, "rolled-back");
    assert.deepEqual(readFileSync(ownershipPath), before);
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "grill-me")),
      false,
    );
    assert.equal(
      existsSync(path.join(value.homeDir, ".agents", "skills", "caveman")),
      true,
    );
  } finally {
    value.cleanup();
  }
});

test("atomic lock release never removes a replacement created after claim", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    const replacement = "replacement lock owned by another writer\n";
    let lockPath;
    const result = await recordThirdPartyGlobalApproval({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      approvals,
      faultInjector: async (phase, context) => {
        if (phase === "after-approval-lock-claim") {
          lockPath = context.lockPath;
          writeFileSync(lockPath, replacement, { flag: "wx" });
        }
      },
    });
    assert.equal(result.status, "recorded");
    assert.equal(readFileSync(lockPath, "utf8"), replacement);
  } finally {
    value.cleanup();
  }
});

test("a hard kill after lock claim is recovered before the next writer", async () => {
  const value = fixture();
  try {
    const plan = await buildThirdPartyApprovalPlan({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      repoRoot: value.repoRoot,
    });
    const approvals = resolveThirdPartyApprovals({
      plan,
      selections: {
        globalSkills: [],
        globalPlugins: [],
        projectSkills: [],
        mcpCli: [],
      },
    });
    let claimPath;
    await assert.rejects(
      recordThirdPartyGlobalApproval({
        homeDir: value.homeDir,
        manifestPath: MANIFEST_PATH,
        approvals,
        faultInjector: async (phase, context) => {
          if (phase === "after-approval-lock-claim") {
            claimPath = context.claimPath;
            const error = new Error("simulated lock-release hard kill");
            error.leaveLockClaimForRecovery = true;
            throw error;
          }
        },
      }),
      /lock-release hard kill/i,
    );
    assert.equal(existsSync(claimPath), true);
    const recovered = await recordThirdPartyGlobalApproval({
      homeDir: value.homeDir,
      manifestPath: MANIFEST_PATH,
      approvals,
    });
    assert.equal(recovered.status, "unchanged");
    assert.equal(existsSync(claimPath), false);
    assert.equal(existsSync(path.dirname(claimPath)), false);
  } finally {
    value.cleanup();
  }
});

test("pinned Git acquisition rejects a PATH-prepended untrusted fake Git", async () => {
  const value = fixture();
  try {
    const sourceFixture = await fixtureManifest(value);
    const source = sourceFixture.manifest.sources[0];
    const fakeDirectory = path.join(value.root, "fake-bin");
    mkdirSync(fakeDirectory);
    const fakeGit = path.join(
      fakeDirectory,
      process.platform === "win32" ? "git.exe" : "git",
    );
    writeFileSync(fakeGit, "not a trusted native executable\n");
    const approvalPlan = await buildThirdPartyApprovalPlan({
      manifest: sourceFixture.manifest,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      discoverCommandRoots: true,
      env: {
        PATH: fakeDirectory,
        Path: fakeDirectory,
      },
    });
    let invoked = false;
    await assert.rejects(
      acquirePinnedGitSource({
        approvalPlan,
        homeDir: value.homeDir,
        source,
        env: {
          ...process.env,
          PATH: fakeDirectory,
          Path: fakeDirectory,
        },
        execFileImpl: async () => {
          invoked = true;
          return { stdout: "" };
        },
      }),
      /trusted absolute Git command binding|explicitly approved native installation root/i,
    );
    assert.equal(invoked, false);
  } finally {
    value.cleanup();
  }
});
