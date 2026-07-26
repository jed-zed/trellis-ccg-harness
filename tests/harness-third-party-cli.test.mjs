import assert from "node:assert/strict";
import { cpSync } from "node:fs";
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
  runHarnessInitCli,
  saveSkillRepositoryProfile,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";
import {
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
    let resolverCalled = false;
    const result = await runHarnessInitCli(
        [...base, "--third-party-global-skills", "matt-grilling"],
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
    assert.equal(candidateQuestions.length, 8);
    assert.equal(
      candidateQuestions.every(
        (entry) =>
          entry.recommended === "yes" &&
          entry.options[0] === "no" &&
          entry.options[1] === "yes" &&
          /install is recommended.*unselected until.*yes/is.test(entry.question),
      ),
      true,
    );
    assert.deepEqual(result.thirdParty.approvals.approvedActionIds, []);
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
    assert.equal(questions.some((entry) => entry.recommended === "yes"), true);
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
