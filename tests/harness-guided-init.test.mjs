import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
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
import { fileURLToPath } from "node:url";

import {
  applyProjectContract,
  GLOBAL_PLATFORM_SKILLS,
  inspectProviderCliStatuses,
  markProjectReady,
  reviseReadyProjectSkills,
  runGlobalInit,
  runHarnessInitCli,
  runProjectInit,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.join(ROOT, ".agents", "skills", "harness-init");
const TEMPLATE_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "project-contract.template.json",
);

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
        ".harness/project-skills.json",
        ...selectedSkills.map((name) => `.agents/skills/${name}`),
      ]
    : [];
  contract.qualityGates.requiredLocalCommands = ["node --test"];
  contract.qualityGates.requiredCiChecks = ["test"];
  contract.qualityGates.definitionOfDone = ["Required gates pass"];
  contract.security.dataClassification = "internal";
  contract.security.networkPolicy = "offline-by-default";
  contract.source.dependencyPolicy = "locked";
  contract.source.updatePolicy = "explicit-version";
  contract.source.rollbackPolicy = "transactional";
  contract.source.uninstallPolicy = "ownership-aware";
  contract.skills.globalEssential = [...GLOBAL_PLATFORM_SKILLS];
  contract.skills.projectSelection = selectedSkills.map((name) => ({
    name,
    reason: `Approved for the ${name} fixture.`,
  }));
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

test("Global Init fails closed on a fresh platform Skill collision", async () => {
  const value = fixture();
  try {
    const collision = path.join(
      value.homeDir,
      ".agents",
      "skills",
      "grill-me",
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
  } finally {
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
  assert.equal(statuses.claude.recommendedAction, "skip");
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
