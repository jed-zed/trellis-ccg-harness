import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyProjectContract,
  auditSkillPlatformMigration,
  applySkillPlatformMigration,
  discoverSkillCatalog,
  GLOBAL_PLATFORM_SKILLS,
  HARNESS_PROJECTED_SKILLS,
  inspectProject,
  installProjectSkills,
  isPortableAbsolutePath,
  loadSkillRepositoryProfile,
  markProjectReady,
  planSkillPlatformMigration,
  reviseReadyProjectSkills,
  rollbackSkillPlatformMigration,
  runHarnessInitCli,
  saveSkillRepositoryProfile,
  seedPersonalSkillRepository,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";

const ALL_GLOBAL_PLATFORM_SKILLS = [...GLOBAL_PLATFORM_SKILLS].sort((left, right) =>
  left.localeCompare(right),
);
const THIRD_PARTY_SOURCE = JSON.parse(
  readFileSync(
    new URL(
      "../.agents/skills/harness-init/assets/third-party-sources.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const THIRD_PARTY_SOURCE_SHA256 = createHash("sha256")
  .update(`${JSON.stringify(THIRD_PARTY_SOURCE, null, 2)}\n`)
  .digest("hex");

test("Project Skill manifest paths remain recognizable across host platforms", () => {
  assert.equal(isPortableAbsolutePath("I:\\skills\\catalog"), true);
  assert.equal(isPortableAbsolutePath("/opt/skills/catalog"), true);
  assert.equal(isPortableAbsolutePath("skills/catalog"), false);
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-skill-profile-"));
  const homeDir = path.join(root, "home");
  const repoRoot = path.join(root, "project");
  const skillRepository = path.join(root, "skill-library");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(skillRepository, { recursive: true });
  writeFileSync(path.join(repoRoot, "package.json"), '{"private":true}\n');
  return {
    homeDir,
    repoRoot,
    root,
    skillRepository,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeSkill(repository, relativeDirectory, name, description) {
  const directory = path.join(repository, relativeDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: "${description}"`,
      "---",
      "",
      `# ${name}`,
      "",
    ].join("\n"),
  );
  return directory;
}

function initializeProjectContract(
  repoRoot,
  selectedSkills = ["test-first"],
) {
  const harnessDirectory = path.join(repoRoot, ".harness");
  mkdirSync(harnessDirectory, { recursive: true });
  const contract = JSON.parse(
    readFileSync(
      new URL(
        "../.agents/skills/harness-init/assets/project-contract.template.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  contract.status = "approved";
  contract.project = {
    name: "skill-fixture",
    purpose: "Exercise approved project Skill provisioning.",
    repositoryRoot: ".",
    adoptionMode: "existing-codebase",
  };
  contract.workflow.taskLifecycle = ["planned", "verified"];
  contract.workflow.managedProjectPaths = [
    ".harness/third-party-sources.json",
    ...selectedSkills.map((name) => `.agents/skills/${name}`),
  ];
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
    reason: `Selected for ${name} project work.`,
  }));
  contract.thirdParty.sourceManifestSha256 = THIRD_PARTY_SOURCE_SHA256;
  contract.approval = {
    approvedAt: "2026-07-25T00:00:00.000Z",
    approvedBy: "repository-owner",
  };
  writeFileSync(
    path.join(harnessDirectory, "project.json"),
    `${JSON.stringify(contract, null, 2)}\n`,
  );
}

test("approved first-run Skill refinement persists and is reused by inspection", async () => {
  const value = fixture();
  try {
    const profile = await saveSkillRepositoryProfile({
      approved: true,
      excludedSkills: ["cloud-production-deploy"],
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
      homeDir: value.homeDir,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
      repositoryPath: value.skillRepository,
      selectionGuidance: [
        "Prefer test-first and review Skills for implementation work.",
      ],
    });

    assert.equal(profile.schemaVersion, 1);
    assert.equal(
      profile.repositoryPath,
      await realpath(value.skillRepository),
    );
    assert.deepEqual(profile.globalEssentialSkills, ALL_GLOBAL_PLATFORM_SKILLS);
    assert.equal(profile.selection.installMode, "copy");
    assert.equal(profile.selection.approvalRequired, true);
    assert.equal(profile.refinedAt, "2026-07-25T12:00:00.000Z");

    const loaded = await loadSkillRepositoryProfile({
      homeDir: value.homeDir,
    });
    assert.deepEqual(loaded, profile);
    assert.equal(
      existsSync(
        path.join(
          value.homeDir,
          ".agents",
          "harness",
          "skill-repository.json",
        ),
      ),
      true,
    );

    const facts = await inspectProject(value.repoRoot, {
      homeDir: value.homeDir,
    });
    assert.deepEqual(facts.skillRepository, {
      configured: true,
      path: await realpath(value.skillRepository),
      available: true,
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
    });

    await assert.rejects(
      saveSkillRepositoryProfile({
        approved: true,
        excludedSkills: ["harness-init"],
        globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
        homeDir: value.homeDir,
        repositoryPath: value.skillRepository,
      }),
      /global essential.*excluded|both/i,
    );

    const activeGlobalRoot = path.join(
      value.homeDir,
      ".agents",
      "skills",
    );
    mkdirSync(activeGlobalRoot, { recursive: true });
    const homeAlias = path.join(value.root, "home-alias");
    symlinkSync(
      value.homeDir,
      homeAlias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      saveSkillRepositoryProfile({
        approved: true,
        globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
        homeDir: homeAlias,
        repositoryPath: activeGlobalRoot,
      }),
      /dedicated|active global/i,
    );
  } finally {
    value.cleanup();
  }
});

test("saved Skill repository availability requires a directory", async () => {
  const value = fixture();
  try {
    await saveSkillRepositoryProfile({
      approved: true,
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });
    rmSync(value.skillRepository, { recursive: true, force: true });
    writeFileSync(value.skillRepository, "not a Skill repository\n");

    const facts = await inspectProject(value.repoRoot, {
      homeDir: value.homeDir,
    });
    assert.equal(facts.skillRepository.configured, true);
    assert.equal(facts.skillRepository.available, false);
  } finally {
    value.cleanup();
  }
});

test("Skill profile storage rejects a linked user configuration directory", async () => {
  const value = fixture();
  try {
    const external = path.join(value.root, "external-profile-storage");
    mkdirSync(external, { recursive: true });
    symlinkSync(
      external,
      path.join(value.homeDir, ".agents"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
      saveSkillRepositoryProfile({
        approved: true,
        globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
        homeDir: value.homeDir,
        repositoryPath: value.skillRepository,
      }),
      /symbolic link|reparse/i,
    );
    assert.equal(
      existsSync(path.join(external, "harness", "skill-repository.json")),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("Skill catalog discovers nested valid Skills with stable identities", async () => {
  const value = fixture();
  try {
    writeSkill(
      value.skillRepository,
      "quality/test-first",
      "test-first",
      "Use when implementing a feature or bugfix.",
    );
    writeSkill(
      value.skillRepository,
      "frontend/react-review",
      "react-review",
      "Use when reviewing React component changes.",
    );

    const catalog = await discoverSkillCatalog({
      repositoryPath: value.skillRepository,
    });

    assert.deepEqual(
      catalog.map(({ name, relativePath }) => ({ name, relativePath })),
      [
        {
          name: "react-review",
          relativePath: "frontend/react-review",
        },
        {
          name: "test-first",
          relativePath: "quality/test-first",
        },
      ],
    );
    assert.match(catalog[0].description, /^Use when/);
    assert.match(catalog[0].skillSha256, /^[a-f0-9]{64}$/);
  } finally {
    value.cleanup();
  }
});

test("Skill catalog rejects duplicate names and symbolic-link entries", async () => {
  const value = fixture();
  try {
    writeSkill(
      value.skillRepository,
      "one",
      "duplicate-skill",
      "Use when testing duplicate detection.",
    );
    writeSkill(
      value.skillRepository,
      "two",
      "duplicate-skill",
      "Use when testing duplicate detection again.",
    );
    await assert.rejects(
      discoverSkillCatalog({ repositoryPath: value.skillRepository }),
      /duplicate/i,
    );

    rmSync(path.join(value.skillRepository, "two"), {
      recursive: true,
      force: true,
    });
    const external = path.join(value.root, "external-skill");
    writeSkill(
      external,
      ".",
      "linked-skill",
      "Use when a link should be rejected.",
    );
    symlinkSync(
      external,
      path.join(value.skillRepository, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      discoverSkillCatalog({ repositoryPath: value.skillRepository }),
      /symbolic link|reparse/i,
    );
  } finally {
    value.cleanup();
  }
});

test("approved Skill selection installs owned project copies and is repeatable", async () => {
  const value = fixture();
  try {
    initializeProjectContract(value.repoRoot);
    const source = writeSkill(
      value.skillRepository,
      "quality/test-first",
      "test-first",
      "Use when implementing a feature or bugfix.",
    );
    mkdirSync(path.join(source, "references"));
    writeFileSync(
      path.join(source, "references", "checklist.md"),
      "# Test checklist\n",
    );
    writeSkill(
      value.skillRepository,
      "general/harness-init",
      "harness-init",
      "Use when initializing a Harness project.",
    );
    await saveSkillRepositoryProfile({
      approved: true,
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });

    const result = await installProjectSkills({
      approved: true,
      homeDir: value.homeDir,
      now: () => new Date("2026-07-25T13:00:00.000Z"),
      repoRoot: value.repoRoot,
      selectedSkills: ["test-first"],
    });

    assert.equal(result.status, "installed");
    assert.equal(
      readFileSync(
        path.join(
          value.repoRoot,
          ".agents",
          "skills",
          "test-first",
          "references",
          "checklist.md",
        ),
        "utf8",
      ),
      "# Test checklist\n",
    );
    const manifest = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, ".harness", "project-skills.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.status, "ready");
    assert.equal(manifest.installedAt, "2026-07-25T13:00:00.000Z");
    assert.equal("repositoryPath" in manifest, false);
    assert.deepEqual(
      manifest.skills.map(({ name, targetPath }) => ({ name, targetPath })),
      [
        {
          name: "test-first",
          targetPath: ".agents/skills/test-first",
        },
      ],
    );
    assert.match(manifest.profileSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.skills[0].treeSha256, /^[a-f0-9]{64}$/);

    const repeated = await installProjectSkills({
      approved: true,
      homeDir: value.homeDir,
      repoRoot: value.repoRoot,
      selectedSkills: ["test-first"],
    });
    assert.equal(repeated.status, "unchanged");

    rmSync(
      path.join(value.repoRoot, ".agents", "skills", "test-first"),
      { recursive: true, force: true },
    );
    await assert.rejects(
      installProjectSkills({
        approved: true,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        selectedSkills: ["test-first"],
      }),
      /missing|drift/i,
    );
  } finally {
    value.cleanup();
  }
});

test("project Skill install rejects essentials, exclusions, and user collisions", async () => {
  const value = fixture();
  try {
    initializeProjectContract(value.repoRoot);
    writeSkill(
      value.skillRepository,
      "quality/test-first",
      "test-first",
      "Use when implementing a feature or bugfix.",
    );
    writeSkill(
      value.skillRepository,
      "general/harness-init",
      "harness-init",
      "Use when initializing a Harness project.",
    );
    await saveSkillRepositoryProfile({
      approved: true,
      excludedSkills: ["test-first"],
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });

    await assert.rejects(
      installProjectSkills({
        approved: true,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        selectedSkills: ["harness-init"],
      }),
      /global essential/i,
    );
    await assert.rejects(
      installProjectSkills({
        approved: true,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        selectedSkills: ["test-first"],
      }),
      /excluded/i,
    );

    const target = path.join(
      value.repoRoot,
      ".agents",
      "skills",
      "test-first",
    );
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "user.txt"), "keep\n");
    await saveSkillRepositoryProfile({
      approved: true,
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });
    await assert.rejects(
      installProjectSkills({
        approved: true,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        selectedSkills: ["test-first"],
      }),
      /user-owned|collision/i,
    );
    assert.equal(readFileSync(path.join(target, "user.txt"), "utf8"), "keep\n");
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".harness", "project-skills.json"),
      ),
      false,
    );
  } finally {
    value.cleanup();
  }
});

test("project Skill install rejects a structurally incomplete contract", async () => {
  const value = fixture();
  try {
    const harnessDirectory = path.join(value.repoRoot, ".harness");
    mkdirSync(harnessDirectory, { recursive: true });
    writeFileSync(
      path.join(harnessDirectory, "project.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          status: "approved",
          workflow: {
            managedProjectPaths: [".agents/skills/test-first"],
          },
          skills: {
            globalPolicy: "minimal-essential-only",
            globalEssential: ALL_GLOBAL_PLATFORM_SKILLS,
            repositoryProfile: "user-saved",
            selectionMode: "recommend-and-approve",
            installMode: "copy",
            projectSelection: [
              {
                name: "test-first",
                reason: "Needed for implementation work.",
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    writeSkill(
      value.skillRepository,
      "quality/test-first",
      "test-first",
      "Use when implementing a feature or bugfix.",
    );
    await saveSkillRepositoryProfile({
      approved: true,
      globalEssentialSkills: ALL_GLOBAL_PLATFORM_SKILLS,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });

    await assert.rejects(
      installProjectSkills({
        approved: true,
        homeDir: value.homeDir,
        repoRoot: value.repoRoot,
        selectedSkills: ["test-first"],
      }),
      /project.*object|invalid schema|authorities/i,
    );
  } finally {
    value.cleanup();
  }
});

test("CLI configures once, catalogs from the saved path, and installs an approved selection", async () => {
  const value = fixture();
  try {
    initializeProjectContract(value.repoRoot);
    writeSkill(
      value.skillRepository,
      "quality/test-first",
      "test-first",
      "Use when implementing a feature or bugfix.",
    );
    const writes = [];
    const stdout = {
      write: (chunk) => writes.push(String(chunk)),
    };

    await runHarnessInitCli(
      [
        "configure-skills",
        "--repository",
        value.skillRepository,
        "--global-essential",
        GLOBAL_PLATFORM_SKILLS.join(","),
        "--guidance",
        "Prefer test-first Skills.",
        "--exclude",
        "cloud-production-deploy",
        "--approved",
      ],
      {
        homeDir: value.homeDir,
        now: () => new Date("2026-07-25T14:00:00.000Z"),
        stdout,
      },
    );
    const catalog = await runHarnessInitCli(["catalog-skills"], {
      homeDir: value.homeDir,
      stdout,
    });
    assert.equal(catalog.reusedSavedPath, true);
    assert.deepEqual(
      catalog.skills.map(({ name }) => name),
      ["test-first"],
    );

    const installed = await runHarnessInitCli(
      [
        "install-skills",
        "--repo-root",
        value.repoRoot,
        "--skills",
        "test-first",
        "--approved",
      ],
      {
        homeDir: value.homeDir,
        now: () => new Date("2026-07-25T14:30:00.000Z"),
        stdout,
      },
    );
    assert.equal(installed.status, "installed");
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
    assert.equal(writes.length, 3);
  } finally {
    value.cleanup();
  }
});

test("Skill platform migration exposes read-only planning and transactional lifecycle APIs", async () => {
  assert.equal(typeof planSkillPlatformMigration, "function");
  assert.equal(typeof seedPersonalSkillRepository, "function");
  assert.equal(typeof reviseReadyProjectSkills, "function");
  assert.equal(typeof applySkillPlatformMigration, "function");
  assert.equal(typeof auditSkillPlatformMigration, "function");
  assert.equal(typeof rollbackSkillPlatformMigration, "function");
});

function initializeCatalog(repository, gitEnv) {
  writeSkill(repository, "quality/test-first", "test-first", "Use when adding focused tests.");
  writeSkill(
    repository,
    "architecture/review-notes",
    "review-notes",
    "Use when recording architecture review findings.",
  );
  writeSkill(repository, "optional/unused", "unused-example", "Use only when explicitly selected.");
  execFileSync("git", ["init", "-b", "main"], { cwd: repository, env: gitEnv });
  execFileSync("git", ["add", "--all"], { cwd: repository, env: gitEnv });
  execFileSync("git", ["commit", "-m", "test: initialize explicit catalog"], {
    cwd: repository,
    env: gitEnv,
  });
}

function populateSkillPlatformFixture(value, gitEnv) {
  const harnessRoot = path.join(value.repoRoot, ".agents", "skills");
  const agentsRoot = path.join(value.homeDir, ".agents", "skills");
  for (const name of HARNESS_PROJECTED_SKILLS) {
    writeSkill(
      harnessRoot,
      name,
      name,
      `Use when running canonical Harness platform workflow ${name}.`,
    );
  }
  for (const name of HARNESS_PROJECTED_SKILLS
    .slice(0, 10)
    .filter((name) => name !== "grill-me")) {
    writeSkill(
      agentsRoot,
      name,
      name,
      `Use when obsolete global platform workflow ${name} runs.`,
    );
  }
  writeSkill(
    agentsRoot,
    "grill-me",
    "grill-me",
    "Use when running canonical Harness platform workflow grill-me.",
  );
  mkdirSync(path.join(value.homeDir, ".codex"), { recursive: true });
  writeFileSync(
    path.join(value.homeDir, ".codex", "AGENTS.md"),
    "# Existing global instructions\n",
  );
  initializeCatalog(value.skillRepository, gitEnv);
  const preserved = path.join(value.root, "preserved-state");
  mkdirSync(preserved);
  writeFileSync(path.join(preserved, "keep.txt"), "preserve exactly\n");
  return { agentsRoot, harnessRoot, preserved };
}

async function initializeReadyFixtureProject(value) {
  initializeProjectContract(value.repoRoot, []);
  const approvedContract = path.join(value.root, "approved-project.json");
  writeFileSync(
    approvedContract,
    readFileSync(path.join(value.repoRoot, ".harness", "project.json")),
  );
  rmSync(path.join(value.repoRoot, ".harness"), {
    recursive: true,
    force: true,
  });
  await applyProjectContract({
    repoRoot: value.repoRoot,
    contractPath: approvedContract,
    skillRoot: path.resolve(".agents", "skills", "harness-init"),
  });
  await markProjectReady({ repoRoot: value.repoRoot });
}

test("platform migration uses an explicit arbitrary catalog and approved project subset", async () => {
  const value = fixture();
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Harness Tests",
    GIT_AUTHOR_EMAIL: "harness-tests@example.invalid",
    GIT_COMMITTER_NAME: "Harness Tests",
    GIT_COMMITTER_EMAIL: "harness-tests@example.invalid",
  };
  const selected = ["review-notes", "test-first"];
  try {
    const roots = populateSkillPlatformFixture(value, gitEnv);
    await initializeReadyFixtureProject(value);
    await saveSkillRepositoryProfile({
      approved: true,
      globalEssentialSkills: [...GLOBAL_PLATFORM_SKILLS],
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });
    const preservedBefore = readFileSync(path.join(roots.preserved, "keep.txt"), "utf8");

    const inventory = await planSkillPlatformMigration({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
      projectSkills: selected,
      preservedPaths: [roots.preserved],
    });
    assert.equal(inventory.platform.length, 15);
    assert.equal(inventory.catalog.length, 3);
    assert.deepEqual(
      inventory.catalogSkills.map((entry) => entry.name),
      ["review-notes", "test-first"],
    );
    assert.equal(inventory.platform.filter((entry) => entry.action === "replace").length, 10);
    assert.equal(inventory.platform.filter((entry) => entry.action === "add").length, 5);
    assert.equal(inventory.platform.filter((entry) => entry.action === "preserve").length, 0);

    const emptySelection = await planSkillPlatformMigration({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
      projectSkills: [],
      preservedPaths: [roots.preserved],
    });
    assert.deepEqual(emptySelection.catalogSkills, []);

    const driftTarget = path.join(value.skillRepository, "quality", "test-first", "SKILL.md");
    const driftOriginal = readFileSync(driftTarget);
    writeFileSync(driftTarget, Buffer.concat([driftOriginal, Buffer.from("\n# drift\n")]));
    await assert.rejects(
      applySkillPlatformMigration({
        approved: true,
        expectedInventorySha256: inventory.inventorySha256,
        repoRoot: value.repoRoot,
        homeDir: value.homeDir,
        repositoryPath: value.skillRepository,
        projectSkills: selected,
        preservedPaths: [roots.preserved],
        gitEnv,
      }),
      /inventory|drift/i,
    );
    writeFileSync(driftTarget, driftOriginal);

    const result = await applySkillPlatformMigration({
      approved: true,
      expectedInventorySha256: inventory.inventorySha256,
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
      projectSkills: selected,
      preservedPaths: [roots.preserved],
      gitEnv,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
    });
    assert.equal(result.status, "migrated");
    assert.equal(readFileSync(path.join(roots.preserved, "keep.txt"), "utf8"), preservedBefore);
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "review-notes", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "test-first", "SKILL.md")), true);
    assert.equal(existsSync(path.join(value.skillRepository, "optional", "unused", "SKILL.md")), true);

    const globalOwnership = JSON.parse(
      readFileSync(path.join(value.homeDir, ".agents", "harness", "global-skills.json"), "utf8"),
    );
    assert.equal(globalOwnership.schemaVersion, 2);
    assert.equal(globalOwnership.managedPlatformSkills.length, 15);
    assert.deepEqual(
      globalOwnership.catalogSkills.map((entry) => entry.name),
      ["review-notes", "test-first"],
    );

    const audit = await auditSkillPlatformMigration({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
      gitEnv,
    });
    assert.deepEqual(audit.issues, []);
    assert.equal(audit.status, "ready");
    const repeated = await applySkillPlatformMigration({
      approved: true,
      expectedInventorySha256: inventory.inventorySha256,
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
      projectSkills: selected,
      preservedPaths: [roots.preserved],
      gitEnv,
    });
    assert.equal(repeated.status, "unchanged");

    const globalAgentsPath = path.join(value.homeDir, ".codex", "AGENTS.md");
    const globalAgentsBytes = readFileSync(globalAgentsPath);
    writeFileSync(globalAgentsPath, Buffer.concat([globalAgentsBytes, Buffer.from("\nuser edit\n")]));
    await assert.rejects(
      rollbackSkillPlatformMigration({
        approved: true,
        backupId: result.backupId,
        repoRoot: value.repoRoot,
        homeDir: value.homeDir,
      }),
      /intact|modified|drift/i,
    );
    writeFileSync(globalAgentsPath, globalAgentsBytes);

    const rolledBack = await rollbackSkillPlatformMigration({
      approved: true,
      backupId: result.backupId,
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
    });
    assert.equal(rolledBack.status, "rolled-back");
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "review-notes")), false);
    assert.equal(existsSync(path.join(value.repoRoot, ".agents", "skills", "test-first")), false);
    const afterRollback = await auditSkillPlatformMigration({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
      gitEnv,
    });
    assert.equal(afterRollback.status, "unmanaged");
  } finally {
    value.cleanup();
  }
});

test("platform migration preserves a user-owned legacy grill-me projection", async () => {
  const value = fixture();
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Harness Tests",
    GIT_AUTHOR_EMAIL: "harness-tests@example.invalid",
    GIT_COMMITTER_NAME: "Harness Tests",
    GIT_COMMITTER_EMAIL: "harness-tests@example.invalid",
  };
  try {
    const roots = populateSkillPlatformFixture(value, gitEnv);
    const target = path.join(roots.agentsRoot, "grill-me", "SKILL.md");
    writeSkill(roots.agentsRoot, "grill-me", "grill-me", "User-customized clarification workflow.");
    const original = readFileSync(target, "utf8");
    const inventory = await planSkillPlatformMigration({
      repoRoot: value.repoRoot,
      homeDir: value.homeDir,
      repositoryPath: value.skillRepository,
    });
    assert.equal(inventory.platform.some((entry) => entry.name === "grill-me"), false);
    assert.equal(readFileSync(target, "utf8"), original);
  } finally {
    value.cleanup();
  }
});
