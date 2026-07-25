import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const POLICY_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "collaboration-policy.md",
);
const POLICY_START = "<!-- HARNESS-COLLABORATION:START -->";
const POLICY_END = "<!-- HARNESS-COLLABORATION:END -->";
const CORE_MODULE = pathToFileURL(
  path.join(SKILL_ROOT, "scripts", "harness-init-core.mjs"),
).href;
const PROJECT_POLICY_PATH = path.join(
  ".harness",
  "policies",
  "collaboration-policy.md",
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

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function transactionResidue(repoRoot) {
  return readdirSync(repoRoot).filter((entry) =>
    entry.startsWith(".harness-init-"),
  );
}

async function waitForFile(filePath, child) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(filePath)) {
    if (child.exitCode !== null) {
      throw new Error(`Crash fixture exited before creating ${filePath}.`);
    }
    if (Date.now() >= deadline) {
      child.kill();
      throw new Error(`Timed out waiting for ${filePath}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function skillFixture(policy) {
  const parent = mkdtempSync(path.join(tmpdir(), "harness-init-skill-"));
  const skillRoot = path.join(parent, "harness-init");
  cpSync(SKILL_ROOT, skillRoot, { recursive: true });
  writeFileSync(
    path.join(skillRoot, "assets", "collaboration-policy.md"),
    policy,
  );
  return {
    skillRoot,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
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
    assert.equal(ownership.schemaVersion, 2);
    assert.deepEqual(ownership.managedPaths, [
      ".harness/ownership.json",
      ".harness/policies/collaboration-policy.md",
      ".harness/project.json",
      ".harness/project.schema.json",
    ]);
    assert.deepEqual(ownership.managedBlocks, [
      {
        path: "AGENTS.md",
        startMarker: POLICY_START,
        endMarker: POLICY_END,
        markerFormatVersion: 1,
        renderedBlockSha256: createHash("sha256")
          .update(
            `${POLICY_START}\n${readFileSync(POLICY_PATH, "utf8").trim()}\n${POLICY_END}`,
          )
          .digest("hex"),
      },
    ]);
    assert.deepEqual(ownership.policy, {
      policyVersion: 1,
      markerFormatVersion: 1,
      sourcePath: ".harness/policies/collaboration-policy.md",
      sourceSha256: sha256(readFileSync(POLICY_PATH)),
      renderedBlockSha256:
        ownership.managedBlocks[0].renderedBlockSha256,
    });
    assert.match(
      ownership.managedBlocks[0].renderedBlockSha256,
      /^[a-f0-9]{64}$/,
    );
    assert.match(ownership.contractSha256, /^[a-f0-9]{64}$/);
    assert.match(ownership.schemaSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".harness", "project.schema.json"),
      ),
      true,
    );
    const agents = readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8");
    assert.match(agents, new RegExp(POLICY_START));
    assert.match(agents, new RegExp(POLICY_END));
    assert.match(agents, /Ponytail/);
    assert.match(agents, /Caveman/);
    assert.match(agents, /CodeGraph/);
    assert.match(
      agents,
      /\.harness\/policies\/collaboration-policy\.md/,
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, PROJECT_POLICY_PATH), "utf8"),
      readFileSync(POLICY_PATH, "utf8"),
    );

    const repeated = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(repeated.status, "unchanged");
    assert.equal(
      readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      agents,
    );
    assert.equal(agents.split(POLICY_START).length - 1, 1);
  } finally {
    value.cleanup();
  }
});

test("AGENTS drift after discovery is preserved and aborts the transaction", async () => {
  const value = fixture();
  try {
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    writeFileSync(agentsPath, "original\n");
    const contractPath = writeContract(value.repoRoot, approvedContract());

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
        faultInjector: async (phase) => {
          if (phase === "before-target:AGENTS.md") {
            writeFileSync(agentsPath, "original\nUSER EDIT\n");
          }
        },
      }),
      /drift|changed|compare|AGENTS/i,
    );
    assert.equal(readFileSync(agentsPath, "utf8"), "original\nUSER EDIT\n");
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    value.cleanup();
  }
});

test("every project-policy commit phase rolls back and cleans residue", async (t) => {
  for (const phase of [
    "after-journal",
    "after-target:AGENTS.md",
    "after-target:.harness/policies/collaboration-policy.md",
    "after-target:.harness/project.json",
    "after-target:.harness/project.schema.json",
    "after-target:.harness/ownership.json",
    "before-commit-marker",
  ]) {
    await t.test(phase, async () => {
      const value = fixture();
      try {
        const agentsPath = path.join(value.repoRoot, "AGENTS.md");
        writeFileSync(agentsPath, "user rules\n");
        const contractPath = writeContract(value.repoRoot, approvedContract());
        await assert.rejects(
          applyProjectContract({
            repoRoot: value.repoRoot,
            contractPath,
            skillRoot: SKILL_ROOT,
            faultInjector: async (currentPhase) => {
              if (currentPhase === phase) {
                throw new Error(`injected failure at ${phase}`);
              }
            },
          }),
          new RegExp(`injected failure at ${phase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );
        assert.equal(readFileSync(agentsPath, "utf8"), "user rules\n");
        assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
        assert.deepEqual(transactionResidue(value.repoRoot), []);
      } finally {
        value.cleanup();
      }
    });
  }
});

test("a hard-killed apply is recovered before the next apply", async () => {
  const value = fixture();
  const marker = path.join(value.repoRoot, "hard-kill-ready");
  try {
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    writeFileSync(agentsPath, "user rules\n");
    const contractPath = writeContract(value.repoRoot, approvedContract());
    const source = `
      const api = await import(${JSON.stringify(CORE_MODULE)});
      await api.applyProjectContract({
        repoRoot: ${JSON.stringify(value.repoRoot)},
        contractPath: ${JSON.stringify(contractPath)},
        skillRoot: ${JSON.stringify(SKILL_ROOT)},
        faultInjector: async (phase) => {
          if (phase === "after-target:AGENTS.md") {
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
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForFile(marker, child);
    child.kill("SIGKILL");
    await once(child, "exit");

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "applied");
    assert.match(readFileSync(agentsPath, "utf8"), /user rules/);
    assert.match(readFileSync(agentsPath, "utf8"), /HARNESS-COLLABORATION/);
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    value.cleanup();
  }
});

test("the project initializer lock rejects a concurrent apply", async () => {
  const value = fixture();
  let releaseFirst;
  let signalLocked;
  const locked = new Promise((resolve) => {
    signalLocked = resolve;
  });
  const release = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    const first = applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
      faultInjector: async (phase) => {
        if (phase === "after-journal") {
          signalLocked();
          await release;
        }
      },
    });
    await locked;
    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /initializer|lock|running/i,
    );
    releaseFirst();
    const result = await first;
    assert.equal(result.status, "applied");
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    releaseFirst?.();
    value.cleanup();
  }
});

test("PR #1 ownership migrates without treating absent markers as tampering", async () => {
  const value = fixture();
  try {
    const contract = approvedContract();
    const contractBytes = canonicalJson(contract);
    const contractPath = writeContract(value.repoRoot, contract);
    const harnessDir = path.join(value.repoRoot, ".harness");
    mkdirSync(harnessDir);
    writeFileSync(path.join(harnessDir, "project.json"), contractBytes);
    writeFileSync(
      path.join(harnessDir, "project.schema.json"),
      readFileSync(
        path.join(SKILL_ROOT, "assets", "project-contract.schema.json"),
      ),
    );
    writeFileSync(
      path.join(harnessDir, "ownership.json"),
      canonicalJson({
        schemaVersion: 1,
        owner: "trellis-ccg-harness",
        contractSha256: sha256(contractBytes),
        managedPaths: [
          ".harness/ownership.json",
          ".harness/project.json",
          ".harness/project.schema.json",
        ],
      }),
    );

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "migrated");
    const ownership = JSON.parse(
      readFileSync(path.join(harnessDir, "ownership.json"), "utf8"),
    );
    assert.equal(ownership.schemaVersion, 2);
    assert.equal(
      ownership.policy.sourcePath,
      ".harness/policies/collaboration-policy.md",
    );
    assert.match(
      readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      /HARNESS-COLLABORATION:START/,
    );
  } finally {
    value.cleanup();
  }
});

test("schema-v1 block ownership migrates when its recorded block is intact", async () => {
  const value = fixture();
  try {
    const contract = approvedContract();
    const contractBytes = canonicalJson(contract);
    const contractPath = writeContract(value.repoRoot, contract);
    const policy = readFileSync(POLICY_PATH, "utf8");
    const block = `${POLICY_START}\n${policy.trim()}\n${POLICY_END}`;
    const harnessDir = path.join(value.repoRoot, ".harness");
    mkdirSync(harnessDir);
    writeFileSync(path.join(harnessDir, "project.json"), contractBytes);
    writeFileSync(
      path.join(harnessDir, "project.schema.json"),
      readFileSync(
        path.join(SKILL_ROOT, "assets", "project-contract.schema.json"),
      ),
    );
    writeFileSync(
      path.join(harnessDir, "ownership.json"),
      canonicalJson({
        schemaVersion: 1,
        owner: "trellis-ccg-harness",
        contractSha256: sha256(contractBytes),
        managedPaths: [
          ".harness/ownership.json",
          ".harness/project.json",
          ".harness/project.schema.json",
        ],
        managedBlocks: [
          {
            path: "AGENTS.md",
            startMarker: POLICY_START,
            endMarker: POLICY_END,
            sha256: sha256(block),
          },
        ],
      }),
    );
    writeFileSync(path.join(value.repoRoot, "AGENTS.md"), `${block}\n`);

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "migrated");
    assert.equal(
      JSON.parse(
        readFileSync(path.join(harnessDir, "ownership.json"), "utf8"),
      ).schemaVersion,
      2,
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, PROJECT_POLICY_PATH), "utf8"),
      policy,
    );
  } finally {
    value.cleanup();
  }
});

test("the legacy split state recovers without replacing current AGENTS content", async () => {
  const value = fixture();
  try {
    const contract = approvedContract();
    const contractBytes = canonicalJson(contract);
    const contractPath = writeContract(value.repoRoot, contract);
    const policy = readFileSync(POLICY_PATH, "utf8");
    const block = `${POLICY_START}\n${policy.trim()}\n${POLICY_END}`;
    const harnessDir = path.join(value.repoRoot, ".harness");
    const legacyStage = path.join(
      value.repoRoot,
      ".AGENTS.md.harness-init-11111111-1111-4111-8111-111111111111",
    );
    mkdirSync(harnessDir);
    writeFileSync(path.join(harnessDir, "project.json"), contractBytes);
    writeFileSync(
      path.join(harnessDir, "project.schema.json"),
      readFileSync(
        path.join(SKILL_ROOT, "assets", "project-contract.schema.json"),
      ),
    );
    writeFileSync(
      path.join(harnessDir, "ownership.json"),
      canonicalJson({
        schemaVersion: 1,
        owner: "trellis-ccg-harness",
        contractSha256: sha256(contractBytes),
        managedPaths: [
          ".harness/ownership.json",
          ".harness/project.json",
          ".harness/project.schema.json",
        ],
        managedBlocks: [
          {
            path: "AGENTS.md",
            startMarker: POLICY_START,
            endMarker: POLICY_END,
            sha256: sha256(block),
          },
        ],
      }),
    );
    writeFileSync(
      path.join(value.repoRoot, "AGENTS.md"),
      "user rules\nUSER EDIT AFTER LEGACY READ\n",
    );
    writeFileSync(legacyStage, `user rules\n\n${block}\n`);

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "migrated");
    const agents = readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8");
    assert.match(agents, /USER EDIT AFTER LEGACY READ/);
    assert.match(agents, /HARNESS-COLLABORATION:START/);
    assert.equal(existsSync(legacyStage), false);
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    value.cleanup();
  }
});

test("an untouched older policy projection upgrades to the current asset", async () => {
  const value = fixture();
  const oldPolicy = readFileSync(POLICY_PATH, "utf8").replace(
    "# Harness Collaboration Policy",
    "# Harness Collaboration Policy v1",
  );
  const oldSkill = skillFixture(oldPolicy);
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: oldSkill.skillRoot,
    });
    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "upgraded");
    const agents = readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8");
    assert.doesNotMatch(agents, /Collaboration Policy v1/);
    assert.match(agents, /# Harness Collaboration Policy/);
    assert.equal(
      readFileSync(path.join(value.repoRoot, PROJECT_POLICY_PATH), "utf8"),
      readFileSync(POLICY_PATH, "utf8"),
    );
  } finally {
    oldSkill.cleanup();
    value.cleanup();
  }
});

test("a modified pinned project policy is not overwritten", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const projectPolicyPath = path.join(
      value.repoRoot,
      PROJECT_POLICY_PATH,
    );
    writeFileSync(
      projectPolicyPath,
      `${readFileSync(projectPolicyPath, "utf8")}\nUSER EDIT\n`,
    );
    const edited = readFileSync(projectPolicyPath, "utf8");

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /policy source.*modified|refusing/i,
    );
    assert.equal(readFileSync(projectPolicyPath, "utf8"), edited);
  } finally {
    value.cleanup();
  }
});

test("a user-edited older managed block is not overwritten during upgrade", async () => {
  const value = fixture();
  const oldPolicy = readFileSync(POLICY_PATH, "utf8").replace(
    "# Harness Collaboration Policy",
    "# Harness Collaboration Policy v1",
  );
  const oldSkill = skillFixture(oldPolicy);
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: oldSkill.skillRoot,
    });
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    const edited = readFileSync(agentsPath, "utf8").replace(
      "Apply rules in this order:",
      "Apply my edited rules in this order:",
    );
    writeFileSync(agentsPath, edited);

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /modified|refusing|user/i,
    );
    assert.equal(readFileSync(agentsPath, "utf8"), edited);
  } finally {
    oldSkill.cleanup();
    value.cleanup();
  }
});

test("approved contracts preserve existing AGENTS content", async () => {
  const value = fixture();
  try {
    const original =
      "<!-- TRELLIS:START -->\nTrellis rules\n<!-- TRELLIS:END -->\n\n" +
      "<!-- HARNESS:START -->\nProject Harness rules\n<!-- HARNESS:END -->\n\n" +
      "User rule\n";
    writeFileSync(path.join(value.repoRoot, "AGENTS.md"), original);
    const contractPath = writeContract(value.repoRoot, approvedContract());

    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });

    const agents = readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith(original));
    assert.equal(agents.split("<!-- TRELLIS:START -->").length - 1, 1);
    assert.equal(agents.split("<!-- HARNESS:START -->").length - 1, 1);
    assert.equal(agents.split("Project Harness rules").length - 1, 1);
    assert.equal(agents.split("User rule").length - 1, 1);
    assert.equal(agents.split(POLICY_START).length - 1, 1);
    assert.match(
      agents,
      new RegExp(
        readFileSync(POLICY_PATH, "utf8")
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
  } finally {
    value.cleanup();
  }
});

test("malformed or conflicting collaboration blocks fail without mutation", async (t) => {
  for (const [name, agents] of [
    ["malformed", `${POLICY_START}\nmissing end\n`],
    ["conflicting", `${POLICY_START}\nuser-owned rules\n${POLICY_END}\n`],
  ]) {
    await t.test(name, async () => {
      const value = fixture();
      try {
        const agentsPath = path.join(value.repoRoot, "AGENTS.md");
        writeFileSync(agentsPath, agents);
        const contractPath = writeContract(value.repoRoot, approvedContract());

        await assert.rejects(
          applyProjectContract({
            repoRoot: value.repoRoot,
            contractPath,
            skillRoot: SKILL_ROOT,
          }),
          /AGENTS|collaboration|managed block|collision/i,
        );
        assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
        assert.equal(readFileSync(agentsPath, "utf8"), agents);
      } finally {
        value.cleanup();
      }
    });
  }
});

test("non-regular AGENTS state fails without mutation", async () => {
  const value = fixture();
  try {
    mkdirSync(path.join(value.repoRoot, "AGENTS.md"));
    const contractPath = writeContract(value.repoRoot, approvedContract());

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /AGENTS\.md is not a regular file/i,
    );
    assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
    assert.equal(
      statSync(path.join(value.repoRoot, "AGENTS.md")).isDirectory(),
      true,
    );
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
    assert.equal(
      existsSync(
        path.join(targetSkill, "assets", "collaboration-policy.md"),
      ),
      true,
    );
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: targetSkill,
    });
    assert.match(
      readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      /HARNESS-COLLABORATION:START/,
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
