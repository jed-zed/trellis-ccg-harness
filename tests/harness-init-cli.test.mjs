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
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyProjectContract,
  exportHarnessInitSkill,
  inspectProject,
  validateProjectContract,
} from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.join(ROOT, ".agents", "skills", "harness-init");
const TEMPLATE_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "project-contract.template.json",
);

function fixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "harness-init-"));
  writeFileSync(path.join(repoRoot, "package.json"), '{"private":true}\n');
  return {
    repoRoot,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function approvedContract() {
  const contract = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  contract.status = "approved";
  contract.project = {
    name: "fixture-project",
    purpose: "Exercise deterministic Harness initialization.",
    repositoryRoot: ".",
    adoptionMode: "existing-codebase",
  };
  contract.workflow.taskLifecycle = ["planned", "implementing", "verified"];
  contract.qualityGates.requiredLocalCommands = ["node --test"];
  contract.qualityGates.requiredCiChecks = ["test"];
  contract.qualityGates.definitionOfDone = ["Required gates pass"];
  contract.security.dataClassification = "internal";
  contract.security.networkPolicy = "offline-by-default";
  contract.source.dependencyPolicy = "locked";
  contract.source.updatePolicy = "explicit-version";
  contract.source.rollbackPolicy = "transactional";
  contract.source.uninstallPolicy = "ownership-aware";
  contract.approval = {
    approvedAt: "2026-07-25T00:00:00.000Z",
    approvedBy: "repository-owner",
  };
  return contract;
}

function writeContract(repoRoot, contract) {
  const contractPath = path.join(repoRoot, "approved-contract.json");
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  return contractPath;
}

test("draft contracts are rejected without mutating the project", async () => {
  const value = fixture();
  try {
    const contract = approvedContract();
    contract.status = "draft";
    contract.approval = { approvedAt: null, approvedBy: null };
    const contractPath = writeContract(value.repoRoot, contract);

    assert.doesNotThrow(() => validateProjectContract(contract));
    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /approved/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
  } finally {
    value.cleanup();
  }
});

test("project Skill contracts enforce minimal globals and owned targets", () => {
  const missingGlobal = approvedContract();
  missingGlobal.skills.globalEssential = ["harness-init"];
  assert.throws(
    () => validateProjectContract(missingGlobal),
    /globalEssential.*grill-me/i,
  );

  const duplicateGlobal = approvedContract();
  duplicateGlobal.skills.projectSelection = [
    {
      name: "harness-init",
      reason: "Must remain global.",
    },
  ];
  duplicateGlobal.workflow.managedProjectPaths = [
    ".agents/skills/harness-init",
  ];
  assert.throws(
    () => validateProjectContract(duplicateGlobal),
    /global essential/i,
  );

  const unmanagedTarget = approvedContract();
  unmanagedTarget.skills.projectSelection = [
    {
      name: "test-first",
      reason: "Needed for implementation work.",
    },
  ];
  assert.throws(
    () => validateProjectContract(unmanagedTarget),
    /managedProjectPaths.*test-first/i,
  );
});

test("approved contracts atomically create the owned Harness contract", async () => {
  const value = fixture();
  try {
    const contract = approvedContract();
    const contractPath = writeContract(value.repoRoot, contract);
    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });

    assert.equal(result.status, "applied");
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project.json"),
          "utf8",
        ),
      ),
      contract,
    );
    const ownership = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, ".harness", "ownership.json"),
        "utf8",
      ),
    );
    assert.deepEqual(ownership.managedPaths, [
      ".harness/ownership.json",
      ".harness/project.json",
      ".harness/project.schema.json",
    ]);
    assert.match(ownership.contractSha256, /^[a-f0-9]{64}$/);
    assert.match(ownership.schemaSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".harness", "project.schema.json"),
      ),
      true,
    );

    const repeated = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(repeated.status, "unchanged");
  } finally {
    value.cleanup();
  }
});

test("idempotent contract apply verifies ownership and schema identities", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(
      value.repoRoot,
      approvedContract(),
    );
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const harnessDir = path.join(value.repoRoot, ".harness");
    const ownershipPath = path.join(harnessDir, "ownership.json");
    const schemaPath = path.join(
      harnessDir,
      "project.schema.json",
    );
    const ownershipBytes = readFileSync(ownershipPath, "utf8");
    const schemaBytes = readFileSync(schemaPath);

    const ownership = JSON.parse(ownershipBytes);
    ownership.owner = "untrusted-owner";
    writeFileSync(
      ownershipPath,
      `${JSON.stringify(ownership, null, 2)}\n`,
    );
    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /ownership|owner|collision/i,
    );

    writeFileSync(ownershipPath, ownershipBytes);
    writeFileSync(schemaPath, `${schemaBytes}\n{"tampered":true}\n`);
    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /schema|identity|collision/i,
    );
  } finally {
    value.cleanup();
  }
});

test("credential-looking keys or values are rejected before mutation", async () => {
  const value = fixture();
  try {
    const contract = approvedContract();
    contract.providers.grok.apiKey = "sk-not-allowed-in-contract";
    const contractPath = writeContract(value.repoRoot, contract);
    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /credential|secret/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
  } finally {
    value.cleanup();
  }
});

test("existing user-owned Harness state is preserved on collision", async () => {
  const value = fixture();
  try {
    const harnessDir = path.join(value.repoRoot, ".harness");
    mkdirSync(harnessDir);
    writeFileSync(path.join(harnessDir, "user.txt"), "keep\n");
    const contractPath = writeContract(value.repoRoot, approvedContract());

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /user-owned|already exists|collision/i,
    );
    assert.equal(
      readFileSync(path.join(harnessDir, "user.txt"), "utf8"),
      "keep\n",
    );
  } finally {
    value.cleanup();
  }
});

test("project inspection is read-only and reports discovered manifests", async () => {
  const value = fixture();
  try {
    const facts = await inspectProject(value.repoRoot);
    assert.equal(facts.repositoryRoot, path.resolve(value.repoRoot));
    assert.deepEqual(facts.manifests, ["package.json"]);
    assert.equal(facts.harnessState, "absent");
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
  } finally {
    value.cleanup();
  }
});

test("skill export is portable and refuses to overwrite a collision", async () => {
  const value = fixture();
  try {
    const result = await exportHarnessInitSkill({
      sourceSkillRoot: SKILL_ROOT,
      targetRepo: value.repoRoot,
    });
    const targetSkill = path.join(
      value.repoRoot,
      ".agents",
      "skills",
      "harness-init",
    );
    assert.equal(result.status, "exported");
    assert.equal(
      existsSync(path.join(targetSkill, "scripts", "harness-init-core.mjs")),
      true,
    );

    await assert.rejects(
      exportHarnessInitSkill({
        sourceSkillRoot: SKILL_ROOT,
        targetRepo: value.repoRoot,
      }),
      /already exists|collision/i,
    );
    assert.equal(
      (await readFile(path.join(targetSkill, "SKILL.md"), "utf8")).length > 0,
      true,
    );
  } finally {
    value.cleanup();
  }
});

test("skill export rejects a linked target parent without escaping the repo", async () => {
  const value = fixture();
  const outside = mkdtempSync(path.join(tmpdir(), "harness-init-outside-"));
  const sentinel = path.join(outside, "sentinel.txt");
  try {
    writeFileSync(sentinel, "unchanged\n");
    mkdirSync(path.join(value.repoRoot, ".agents"), { recursive: true });
    symlinkSync(
      outside,
      path.join(value.repoRoot, ".agents", "skills"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
      exportHarnessInitSkill({
        sourceSkillRoot: SKILL_ROOT,
        targetRepo: value.repoRoot,
      }),
      /symbolic link|junction|reparse point|outside/i,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "unchanged\n");
    assert.equal(existsSync(path.join(outside, "harness-init")), false);
  } finally {
    value.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});
