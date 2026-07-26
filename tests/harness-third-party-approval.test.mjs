import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  acquirePinnedGitSource,
  applyThirdPartyGlobalSkills,
  applyThirdPartyProjectSkills,
  buildThirdPartyApprovalPlan,
  loadThirdPartySourceManifest,
  preflightThirdPartyGlobalApproval,
  recordThirdPartyGlobalApproval,
  recoverThirdPartyProjectTransactions,
  recoverThirdPartyTransactions,
  resolveThirdPartyApprovals,
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
        approved: true, approvals: forgedGlobal, homeDir: value.homeDir, manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
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
        approved: true, approvals: forgedProject, homeDir: value.homeDir, repoRoot: value.repoRoot, manifest: source.manifest, sourceResolver: async () => source.sourceRoot,
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
    const source = {
      id: "fixture-source",
      repository: "https://example.invalid/fixture.git",
      commit: "1111111111111111111111111111111111111111",
      gitTree: "2222222222222222222222222222222222222222",
      license: "MIT",
    };
    const calls = [];
    const fakeGit = async (_command, args) => {
      calls.push(args);
      if (args[0] === "rev-parse") {
        return { stdout: args[1] === "HEAD" ? `${source.commit}\n` : `${source.gitTree}\n` };
      }
      return { stdout: "" };
    };
    const cache = await acquirePinnedGitSource({ homeDir: value.homeDir, source, execFileImpl: fakeGit });
    assert.equal(
      calls.some((args) => args[0] === "fetch" && args.at(-1) === source.commit),
      true,
    );
    assert.equal(calls.some((args) => args.join(" ").match(/main|latest/i)), false);
    const before = calls.length;
    const repeated = await acquirePinnedGitSource({ homeDir: value.homeDir, source, execFileImpl: fakeGit });
    assert.equal(repeated, cache);
    assert.equal(calls.slice(before).some((args) => args[0] === "fetch"), false);
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
      sourceResolver: async () => source.sourceRoot,
    });
    assert.equal(first.status, "installed");
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "grill-me", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.repoRoot, ".harness", "third-party-installations.json")), true);
    assert.equal(existsSync(path.join(value.repoRoot, ".claude")), false);
    const second = await applyThirdPartyProjectSkills({
      approved: true,
      approvals,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      manifest: source.manifest,
      sourceResolver: async () => source.sourceRoot,
    });
    assert.equal(second.status, "unchanged");
  } finally {
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
    const recovery = await recoverThirdPartyProjectTransactions({ repoRoot: value.repoRoot });
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
    const first = await recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifestPath: MANIFEST_PATH, approvals });
    assert.equal(first.status, "recorded");
    const sourcePath = path.join(value.homeDir, ".agents", "harness", "third-party-sources.json");
    const approvalPath = first.approvalPath;
    assert.equal(path.basename(path.dirname(approvalPath)), "third-party-approvals");
    const recorded = JSON.parse(readFileSync(approvalPath, "utf8"));
    assert.deepEqual(recorded.approvedActionIds, []);
    assert.deepEqual(recorded.selections, { globalSkills: [], globalPlugins: [], projectSkills: [], mcpCli: [] });
    assert.equal(readFileSync(sourcePath, "utf8").includes("@latest"), false);
    assert.match(readFileSync(approvalPath, "utf8"), /sourceManifestSha256/);
    assert.equal((await recordThirdPartyGlobalApproval({ homeDir: value.homeDir, manifestPath: MANIFEST_PATH, approvals })).status, "unchanged");
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

test("a rewritten historical approval receipt blocks every later decision", async () => {
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
    writeFileSync(receipt.approvalPath, canonicalJson({
      ...selected,
      approvedActionIds: [...selected.approvedActionIds],
      selections: { ...selected.selections },
    }));
    await assert.rejects(
      preflightThirdPartyGlobalApproval({ homeDir: value.homeDir, manifest: source.manifest, approvals: selected }),
      /filename.*digest|unsafe audit/i,
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
