import assert from "node:assert/strict";
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
  discoverSkillCatalog,
  inspectProject,
  installProjectSkills,
  loadSkillRepositoryProfile,
  runHarnessInitCli,
  saveSkillRepositoryProfile,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";

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
  contract.workflow.managedProjectPaths = selectedSkills.map(
    (name) => `.agents/skills/${name}`,
  );
  contract.qualityGates.requiredLocalCommands = ["node --test"];
  contract.qualityGates.requiredCiChecks = ["test"];
  contract.qualityGates.definitionOfDone = ["Required gates pass"];
  contract.security.dataClassification = "internal";
  contract.security.networkPolicy = "offline-by-default";
  contract.source.dependencyPolicy = "locked";
  contract.source.updatePolicy = "explicit-version";
  contract.source.rollbackPolicy = "transactional";
  contract.source.uninstallPolicy = "ownership-aware";
  contract.skills.projectSelection = selectedSkills.map((name) => ({
    name,
    reason: `Selected for ${name} project work.`,
  }));
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
      globalEssentialSkills: ["harness-init", "grill-me"],
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
    assert.deepEqual(profile.globalEssentialSkills, [
      "grill-me",
      "harness-init",
    ]);
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
      globalEssentialSkills: ["grill-me", "harness-init"],
    });

    await assert.rejects(
      saveSkillRepositoryProfile({
        approved: true,
        excludedSkills: ["grill-me"],
        globalEssentialSkills: ["harness-init", "grill-me"],
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
    await assert.rejects(
      saveSkillRepositoryProfile({
        approved: true,
        globalEssentialSkills: ["harness-init", "grill-me"],
        homeDir: value.homeDir,
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
      globalEssentialSkills: ["harness-init", "grill-me"],
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
        globalEssentialSkills: ["harness-init", "grill-me"],
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
      globalEssentialSkills: ["harness-init", "grill-me"],
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
      globalEssentialSkills: ["harness-init", "grill-me"],
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
      globalEssentialSkills: ["harness-init", "grill-me"],
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
            globalEssential: ["grill-me", "harness-init"],
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
      globalEssentialSkills: ["harness-init", "grill-me"],
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
        "harness-init,grill-me",
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
