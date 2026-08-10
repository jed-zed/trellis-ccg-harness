import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
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
  markProjectReady,
  migrateProjectProductManager,
  runHarnessInitCli,
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
const THIRD_PARTY_SOURCE_PATH = path.join(
  SKILL_ROOT,
  "assets",
  "third-party-sources.json",
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
  contract.workflow.managedProjectPaths = [
    ".harness/third-party-sources.json",
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
  contract.approval = {
    approvedAt: "2026-07-25T00:00:00.000Z",
    approvedBy: "repository-owner",
  };
  contract.thirdParty.sourceManifestSha256 = sha256(
    canonicalJson(JSON.parse(readFileSync(THIRD_PARTY_SOURCE_PATH, "utf8"))),
  );
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

function setOwnedPolicyProjection(repoRoot, policy, policyVersion) {
  const policyBytes = Buffer.from(policy);
  const block = `${POLICY_START}\n${policy.trim()}\n${POLICY_END}`;
  const agentsPath = path.join(repoRoot, "AGENTS.md");
  const currentAgents = readFileSync(agentsPath, "utf8");
  const start = currentAgents.indexOf(POLICY_START);
  const end = currentAgents.indexOf(POLICY_END, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  writeFileSync(
    agentsPath,
    `${currentAgents.slice(0, start)}${block}${currentAgents.slice(end + POLICY_END.length)}`,
  );
  writeFileSync(path.join(repoRoot, PROJECT_POLICY_PATH), policyBytes);

  const ownershipPath = path.join(
    repoRoot,
    ".harness",
    "ownership.json",
  );
  const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
  const renderedBlockSha256 = sha256(block);
  ownership.policy.policyVersion = policyVersion;
  ownership.policy.sourceSha256 = sha256(policyBytes);
  ownership.policy.renderedBlockSha256 = renderedBlockSha256;
  ownership.managedBlocks[0].renderedBlockSha256 =
    renderedBlockSha256;
  writeFileSync(ownershipPath, canonicalJson(ownership));
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

async function hardKillApplyAtPhase({
  repoRoot,
  contractPath,
  phase,
  rollback = false,
}) {
  const marker = path.join(
    repoRoot,
    `hard-kill-${phase.replaceAll(/[^a-z0-9]+/gi, "-")}`,
  );
  const source = `
    const api = await import(${JSON.stringify(CORE_MODULE)});
    await api.applyProjectContract({
      repoRoot: ${JSON.stringify(repoRoot)},
      contractPath: ${JSON.stringify(contractPath)},
      skillRoot: ${JSON.stringify(SKILL_ROOT)},
      faultInjector: async (currentPhase) => {
        if (
          ${JSON.stringify(rollback)} &&
          currentPhase === "after-target:AGENTS.md"
        ) {
          throw new Error("force rollback before cleanup");
        }
        if (currentPhase === ${JSON.stringify(phase)}) {
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

test("recovery provenance key must stay outside the target repository", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    const keyPath = path.join(value.repoRoot, "project-transaction.key");
    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
        provenanceKeyPath: keyPath,
      }),
      /provenance key.*outside/i,
    );
    assert.equal(existsSync(keyPath), false);
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
    /globalEssential.*chatgpt-pro-sidebar/i,
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

test("product-manager Claude transport defaults to local and validates ssh opt-in", () => {
  const current = approvedContract();
  assert.equal(current.productManager.claudeTransport, "local");
  assert.doesNotThrow(() => validateProjectContract(current));

  const ssh = approvedContract();
  ssh.productManager.claudeTransport = "ssh";
  assert.doesNotThrow(() => validateProjectContract(ssh));

  const legacy = approvedContract();
  delete legacy.productManager.claudeTransport;
  assert.doesNotThrow(() => validateProjectContract(legacy));

  const invalid = approvedContract();
  invalid.productManager.claudeTransport = "automatic";
  assert.throws(
    () => validateProjectContract(invalid),
    /claudeTransport.*local.*ssh/i,
  );

  const secret = approvedContract();
  secret.productManager.sshHost = "example.test";
  assert.throws(
    () => validateProjectContract(secret),
    /credential|secret|invalid schema/i,
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
      ".harness/product-manager.schema.json",
      ".harness/third-party-sources.json",
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
      policyVersion: 8,
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
    assert.match(
      ownership.productManagerSchemaSha256,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(
      existsSync(
        path.join(value.repoRoot, ".harness", "project.schema.json"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(
          value.repoRoot,
          ".harness",
          "product-manager.schema.json",
        ),
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

test("approved contracts adopt an exact existing Harness projection", async () => {
  const value = fixture();
  try {
    const harnessDir = path.join(value.repoRoot, ".harness");
    const policyPath = path.join(value.repoRoot, PROJECT_POLICY_PATH);
    const policy = readFileSync(POLICY_PATH, "utf8");
    const agents = `user rules\n\n${POLICY_START}\n${policy.trim()}\n${POLICY_END}\n`;
    mkdirSync(path.dirname(policyPath), { recursive: true });
    writeFileSync(path.join(harnessDir, "adapter.json"), '{"keep":true}\n');
    writeFileSync(policyPath, policy);
    writeFileSync(path.join(value.repoRoot, "AGENTS.md"), agents);
    const contractPath = writeContract(value.repoRoot, approvedContract());

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });

    assert.equal(result.status, "applied");
    assert.equal(
      readFileSync(path.join(harnessDir, "adapter.json"), "utf8"),
      '{"keep":true}\n',
    );
    assert.equal(readFileSync(policyPath, "utf8"), policy);
    assert.equal(
      readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      agents,
    );
    assert.equal(existsSync(path.join(harnessDir, "project.json")), true);
    assert.equal(existsSync(path.join(harnessDir, "ownership.json")), true);
  } finally {
    value.cleanup();
  }
});

test("project schema installation canonicalizes source line endings", async () => {
  const value = fixture();
  const skill = skillFixture(readFileSync(POLICY_PATH, "utf8"));
  try {
    const sourceSchemaPath = path.join(
      skill.skillRoot,
      "assets",
      "project-contract.schema.json",
    );
    const schema = JSON.parse(readFileSync(sourceSchemaPath, "utf8"));
    writeFileSync(
      sourceSchemaPath,
      `${JSON.stringify(schema, null, 2).replaceAll("\n", "\r\n")}\r\n`,
    );
    const contractPath = writeContract(value.repoRoot, approvedContract());

    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: skill.skillRoot,
    });

    const installedSchema = readFileSync(
      path.join(value.repoRoot, ".harness", "project.schema.json"),
    );
    const expectedSchema = Buffer.from(canonicalJson(schema));
    const ownership = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, ".harness", "ownership.json"),
        "utf8",
      ),
    );
    assert.deepEqual(installedSchema, expectedSchema);
    assert.equal(ownership.schemaSha256, sha256(expectedSchema));
    assert.equal(
      (
        await markProjectReady({
          repoRoot: value.repoRoot,
          skillRoot: skill.skillRoot,
        })
      ).status,
      "ready",
    );
  } finally {
    skill.cleanup();
    value.cleanup();
  }
});

test("legacy noncanonical schema bytes migrate when ownership is intact", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const schemaPath = path.join(
      value.repoRoot,
      ".harness",
      "project.schema.json",
    );
    const ownershipPath = path.join(
      value.repoRoot,
      ".harness",
      "ownership.json",
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const legacySchema = Buffer.from(
      canonicalJson(schema).replaceAll("\n", "\r\n"),
    );
    writeFileSync(schemaPath, legacySchema);
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    ownership.schemaSha256 = sha256(legacySchema);
    writeFileSync(ownershipPath, canonicalJson(ownership));

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });

    const canonicalSchema = Buffer.from(canonicalJson(schema));
    assert.equal(result.status, "upgraded");
    assert.deepEqual(readFileSync(schemaPath), canonicalSchema);
    assert.equal(
      JSON.parse(readFileSync(ownershipPath, "utf8")).schemaSha256,
      sha256(canonicalSchema),
    );
  } finally {
    value.cleanup();
  }
});

test("approved product-manager migration updates owned files and preserves unknown assets", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    await markProjectReady({
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });
    const unknown = path.join(
      value.repoRoot,
      ".harness",
      "user-owned-note.txt",
    );
    writeFileSync(unknown, "preserve me\n");

    const result = await migrateProjectProductManager({
      approved: true,
      allowedProviders: ["codex", "gemini", "claude"],
      coupledSourceUpdate: true,
      repoRoot: value.repoRoot,
      skillRoot: SKILL_ROOT,
    });

    assert.equal(result.status, "ready");
    assert.equal(readFileSync(unknown, "utf8"), "preserve me\n");
    const project = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, ".harness", "project.json"),
        "utf8",
      ),
    );
    assert.equal(project.status, "ready");
    assert.equal(
      project.productManager.stateAuthority,
      "trellis-task-projection",
    );
    assert.equal(
      project.productManager.selectedProviderAuthority,
      "unified-ccg-routing",
    );
    assert.deepEqual(
      project.productManager.allowedProviders,
      ["codex", "gemini", "claude"],
    );
    assert.equal(project.productManager.claudeTransport, "local");
    assert.equal(project.providers.claude.enabled, true);
    assert.equal(project.providers.claude.workspaceWrite, false);
    assert.equal(
      project.source.updatePolicy,
      "coupled-bundle-update-with-current-snapshot-source-fingerprint",
    );
    assert.equal(
      project.source.dependencyPolicy,
      "source-verified-current-snapshot",
    );
  } finally {
    value.cleanup();
  }
});

test("approved contracts are atomically promoted to ready", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });

    const result = await markProjectReady({ repoRoot: value.repoRoot });
    assert.equal(result.status, "ready");
    const projectPath = path.join(value.repoRoot, ".harness", "project.json");
    const ownershipPath = path.join(
      value.repoRoot,
      ".harness",
      "ownership.json",
    );
    const projectBytes = readFileSync(projectPath);
    const project = JSON.parse(projectBytes);
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    assert.equal(project.status, "ready");
    assert.equal(ownership.contractSha256, sha256(projectBytes));

    const repeated = await markProjectReady({ repoRoot: value.repoRoot });
    assert.equal(repeated.status, "unchanged");
    assert.equal(readFileSync(projectPath, "utf8"), projectBytes.toString());
  } finally {
    value.cleanup();
  }
});

test("mark-ready CLI promotes the installed contract", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    let output = "";

    await runHarnessInitCli(
      ["mark-ready", "--repo-root", value.repoRoot],
      { stdout: { write: (chunk) => { output += chunk; } } },
    );

    assert.equal(JSON.parse(output).status, "ready");
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project.json"),
          "utf8",
        ),
      ).status,
      "ready",
    );
  } finally {
    value.cleanup();
  }
});

test("mark-ready preserves every owned file when readiness state drifted", async (t) => {
  const scenarios = [
    {
      name: "contract",
      mutate: (repoRoot) => {
        const target = path.join(repoRoot, ".harness", "project.json");
        const project = JSON.parse(readFileSync(target, "utf8"));
        project.project.purpose = "concurrent edit";
        writeFileSync(target, canonicalJson(project));
      },
    },
    {
      name: "contract formatting",
      mutate: (repoRoot) => {
        const target = path.join(repoRoot, ".harness", "project.json");
        writeFileSync(target, `${readFileSync(target, "utf8")}\n`);
      },
    },
    {
      name: "schema",
      mutate: (repoRoot) => {
        const target = path.join(repoRoot, ".harness", "project.schema.json");
        writeFileSync(target, `${readFileSync(target, "utf8")}\n`);
      },
    },
    {
      name: "policy",
      mutate: (repoRoot) => {
        const target = path.join(repoRoot, PROJECT_POLICY_PATH);
        writeFileSync(target, `${readFileSync(target, "utf8")}\n`);
      },
    },
    {
      name: "AGENTS block",
      mutate: (repoRoot) => {
        const target = path.join(repoRoot, "AGENTS.md");
        writeFileSync(
          target,
          readFileSync(target, "utf8").replace("Ponytail", "Modified"),
        );
      },
    },
    {
      name: "ownership",
      mutate: (repoRoot) => {
        const target = path.join(repoRoot, ".harness", "ownership.json");
        const ownership = JSON.parse(readFileSync(target, "utf8"));
        ownership.owner = "untrusted-owner";
        writeFileSync(target, canonicalJson(ownership));
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const value = fixture();
      try {
        const contractPath = writeContract(value.repoRoot, approvedContract());
        await applyProjectContract({
          repoRoot: value.repoRoot,
          contractPath,
          skillRoot: SKILL_ROOT,
        });
        scenario.mutate(value.repoRoot);
        const tracked = [
          "AGENTS.md",
          ".harness/project.json",
          ".harness/project.schema.json",
          PROJECT_POLICY_PATH.replaceAll("\\", "/"),
          ".harness/ownership.json",
        ];
        const before = new Map(
          tracked.map((entry) => [
            entry,
            readFileSync(path.join(value.repoRoot, ...entry.split("/"))),
          ]),
        );

        await assert.rejects(
          markProjectReady({ repoRoot: value.repoRoot }),
          /contract|schema|policy|AGENTS|ownership|modified|drift/i,
        );
        for (const [entry, bytes] of before) {
          assert.deepEqual(
            readFileSync(path.join(value.repoRoot, ...entry.split("/"))),
            bytes,
          );
        }
      } finally {
        value.cleanup();
      }
    });
  }
});

test("mark-ready rejects coordinated policy and ownership drift", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const policyPath = path.join(value.repoRoot, PROJECT_POLICY_PATH);
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    const ownershipPath = path.join(
      value.repoRoot,
      ".harness",
      "ownership.json",
    );
    const originalPolicy = readFileSync(policyPath, "utf8");
    const changedPolicy = `${originalPolicy.trimEnd()}\ncoordinated drift\n`;
    const changedBlock =
      `${POLICY_START}\n${changedPolicy.trim()}\n${POLICY_END}`;
    writeFileSync(policyPath, changedPolicy);
    writeFileSync(
      agentsPath,
      readFileSync(agentsPath, "utf8").replace(
        `${POLICY_START}\n${originalPolicy.trim()}\n${POLICY_END}`,
        changedBlock,
      ),
    );
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    ownership.policy.sourceSha256 = sha256(Buffer.from(changedPolicy));
    ownership.policy.renderedBlockSha256 = sha256(changedBlock);
    ownership.managedBlocks[0].renderedBlockSha256 = sha256(changedBlock);
    writeFileSync(ownershipPath, canonicalJson(ownership));

    await assert.rejects(
      markProjectReady({ repoRoot: value.repoRoot }),
      /policy|modified|drift/i,
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project.json"),
          "utf8",
        ),
      ).status,
      "approved",
    );
  } finally {
    value.cleanup();
  }
});

test("mark-ready rejects coordinated schema and ownership drift", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const schemaPath = path.join(
      value.repoRoot,
      ".harness",
      "project.schema.json",
    );
    const ownershipPath = path.join(
      value.repoRoot,
      ".harness",
      "ownership.json",
    );
    const changedSchema = `${readFileSync(schemaPath, "utf8")}\n`;
    writeFileSync(schemaPath, changedSchema);
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    ownership.schemaSha256 = sha256(Buffer.from(changedSchema));
    writeFileSync(ownershipPath, canonicalJson(ownership));

    await assert.rejects(
      markProjectReady({ repoRoot: value.repoRoot }),
      /schema|modified|drift/i,
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(value.repoRoot, ".harness", "project.json"),
          "utf8",
        ),
      ).status,
      "approved",
    );
  } finally {
    value.cleanup();
  }
});

test("mark-ready rolls back contract and ownership after a partial failure", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const projectPath = path.join(value.repoRoot, ".harness", "project.json");
    const ownershipPath = path.join(
      value.repoRoot,
      ".harness",
      "ownership.json",
    );
    const beforeProject = readFileSync(projectPath);
    const beforeOwnership = readFileSync(ownershipPath);

    await assert.rejects(
      markProjectReady({
        repoRoot: value.repoRoot,
        faultInjector: async (phase) => {
          if (phase === "after-target:.harness/project.json") {
            throw new Error("simulated readiness failure");
          }
        },
      }),
      /simulated readiness failure/,
    );
    assert.deepEqual(readFileSync(projectPath), beforeProject);
    assert.deepEqual(readFileSync(ownershipPath), beforeOwnership);
    assert.deepEqual(transactionResidue(value.repoRoot), []);
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
    "after-commit-marker",
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

test("hard kills during terminal cleanup leave only recoverable tombstones", async (t) => {
  for (const scenario of [
    {
      name: "committed transaction cleanup",
      phase: "after-commit-terminalize",
      rollback: false,
      expectedStatus: "unchanged",
    },
    {
      name: "rolled-back transaction cleanup",
      phase: "after-rollback-terminalize",
      rollback: true,
      expectedStatus: "applied",
    },
    {
      name: "lock release cleanup",
      phase: "after-lock-terminalize",
      rollback: false,
      expectedStatus: "unchanged",
    },
  ]) {
    await t.test(scenario.name, async () => {
      const value = fixture();
      try {
        const agentsPath = path.join(value.repoRoot, "AGENTS.md");
        writeFileSync(agentsPath, "user rules\n");
        const contractPath = writeContract(
          value.repoRoot,
          approvedContract(),
        );
        await hardKillApplyAtPhase({
          repoRoot: value.repoRoot,
          contractPath,
          phase: scenario.phase,
          rollback: scenario.rollback,
        });

        assert.match(
          transactionResidue(value.repoRoot).join("\n"),
          /\.harness-init-gc-/,
        );
        const result = await applyProjectContract({
          repoRoot: value.repoRoot,
          contractPath,
          skillRoot: SKILL_ROOT,
        });
        assert.equal(result.status, scenario.expectedStatus);
        assert.match(readFileSync(agentsPath, "utf8"), /user rules/);
        assert.match(
          readFileSync(agentsPath, "utf8"),
          /HARNESS-COLLABORATION/,
        );
        assert.deepEqual(transactionResidue(value.repoRoot), []);
      } finally {
        value.cleanup();
      }
    });
  }
});

test("partial terminal-cleanup tombstones are removed without ownership metadata", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    for (const name of [
      ".harness-init-gc-transaction-11111111-1111-4111-8111-111111111111",
      ".harness-init-gc-lock-22222222-2222-4222-8222-222222222222",
      ".harness-init-gc-candidate-33333333-3333-4333-8333-333333333333",
    ]) {
      const directory = path.join(value.repoRoot, name);
      mkdirSync(directory);
      writeFileSync(path.join(directory, "partial"), "interrupted\n");
    }

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    assert.equal(result.status, "applied");
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    value.cleanup();
  }
});

test(
  "AGENTS permission drift aborts compare-and-swap without changing content or mode",
  { skip: process.platform === "win32" },
  async () => {
    const value = fixture();
    try {
      const agentsPath = path.join(value.repoRoot, "AGENTS.md");
      writeFileSync(agentsPath, "user rules\n", { mode: 0o644 });
      const contractPath = writeContract(
        value.repoRoot,
        approvedContract(),
      );

      await assert.rejects(
        applyProjectContract({
          repoRoot: value.repoRoot,
          contractPath,
          skillRoot: SKILL_ROOT,
          faultInjector: async (phase) => {
            if (phase === "before-target:AGENTS.md") {
              chmodSync(agentsPath, 0o600);
            }
          },
        }),
        /drift|changed|compare|AGENTS/i,
      );
      assert.equal(readFileSync(agentsPath, "utf8"), "user rules\n");
      assert.equal(statSync(agentsPath).mode & 0o777, 0o600);
      assert.equal(existsSync(path.join(value.repoRoot, ".harness")), false);
      assert.deepEqual(transactionResidue(value.repoRoot), []);
    } finally {
      value.cleanup();
    }
  },
);

test("the project initializer lock rejects a concurrent apply", async () => {
  const value = fixture();
  const fallbackIdentity =
    `fallback:test:${process.pid}:concurrent-apply`;
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
      readProcessIdentity: async () => fallbackIdentity,
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
        readProcessIdentity: async () => fallbackIdentity,
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

test("repository-authored transaction residue cannot replay against user files", async () => {
  const value = fixture();
  try {
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    writeFileSync(agentsPath, "user rules\n");
    const contractPath = writeContract(value.repoRoot, approvedContract());
    const transactionId = "44444444-4444-4444-8444-444444444444";
    const transactionDirectory = path.join(
      value.repoRoot,
      `.harness-init-txn-${transactionId}`,
    );
    mkdirSync(transactionDirectory);
    writeFileSync(
      path.join(transactionDirectory, "owner.json"),
      canonicalJson({
        schemaVersion: 2,
        pid: 424242,
        processIdentity: "forged-process-instance",
        createdAt: new Date().toISOString(),
        token: transactionId,
        repoRoot: value.repoRoot,
        provenance: {
          schemaVersion: 1,
          algorithm: "hmac-sha256",
          digest: "0".repeat(64),
        },
      }),
    );
    writeFileSync(
      path.join(transactionDirectory, "journal.json"),
      canonicalJson({
        schemaVersion: 2,
        operation: "project-policy-apply",
        id: transactionId,
        repoRoot: value.repoRoot,
        createdAt: new Date().toISOString(),
        preconditions: [],
        createdDirectories: [],
        targets: [],
      }),
    );

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
        isProcessAlive: () => false,
      }),
      /provenance|authentic/i,
    );
    assert.equal(readFileSync(agentsPath, "utf8"), "user rules\n");
    assert.equal(existsSync(transactionDirectory), true);
  } finally {
    value.cleanup();
  }
});

test("tampered authenticated journal is preserved instead of replayed", async () => {
  const value = fixture();
  try {
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    writeFileSync(agentsPath, "user rules\n");
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await hardKillApplyAtPhase({
      repoRoot: value.repoRoot,
      contractPath,
      phase: "after-journal",
    });
    const transactionName = transactionResidue(value.repoRoot).find((entry) =>
      entry.startsWith(".harness-init-txn-"),
    );
    assert.ok(transactionName);
    const journalPath = path.join(
      value.repoRoot,
      transactionName,
      "journal.json",
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.createdAt = "2000-01-01T00:00:00.000Z";
    writeFileSync(journalPath, canonicalJson(journal));

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
        isProcessAlive: () => false,
      }),
      /provenance|authentic/i,
    );
    assert.equal(readFileSync(agentsPath, "utf8"), "user rules\n");
    assert.equal(
      existsSync(path.join(value.repoRoot, transactionName)),
      true,
    );
  } finally {
    value.cleanup();
  }
});

test("a live reused PID does not keep stale initializer state locked", async () => {
  const value = fixture();
  try {
    const agentsPath = path.join(value.repoRoot, "AGENTS.md");
    writeFileSync(agentsPath, "user rules\n");
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await hardKillApplyAtPhase({
      repoRoot: value.repoRoot,
      contractPath,
      phase: "after-journal",
    });
    const transactionName = transactionResidue(value.repoRoot).find((entry) =>
      entry.startsWith(".harness-init-txn-"),
    );
    assert.ok(transactionName);
    const staleOwner = JSON.parse(
      readFileSync(
        path.join(value.repoRoot, transactionName, "owner.json"),
        "utf8",
      ),
    );

    const result = await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
      isProcessAlive: () => true,
      readProcessIdentity: async (pid) =>
        pid === staleOwner.pid
          ? "replacement-process-instance"
          : `current-process-${pid}`,
    });
    assert.equal(result.status, "applied");
    assert.match(readFileSync(agentsPath, "utf8"), /user rules/);
    assert.match(readFileSync(agentsPath, "utf8"), /HARNESS-COLLABORATION/);
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    value.cleanup();
  }
});

test("existing project and schema are transaction preconditions", async (t) => {
  for (const scenario of [
    {
      name: "project contract",
      relativePath: path.join(".harness", "project.json"),
    },
    {
      name: "project schema",
      relativePath: path.join(".harness", "project.schema.json"),
    },
  ]) {
    await t.test(scenario.name, async () => {
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
        const oldPolicy = readFileSync(POLICY_PATH, "utf8").replace(
          "# Harness Collaboration Policy",
          "# Harness Collaboration Policy v1",
        );
        setOwnedPolicyProjection(value.repoRoot, oldPolicy, 1);
        const target = path.join(value.repoRoot, scenario.relativePath);
        const concurrentBytes = `${readFileSync(target, "utf8")}\n`;

        await assert.rejects(
          applyProjectContract({
            repoRoot: value.repoRoot,
            contractPath,
            skillRoot: SKILL_ROOT,
            faultInjector: async (phase) => {
              if (phase === "after-journal") {
                writeFileSync(target, concurrentBytes);
              }
            },
          }),
          /precondition|drift|changed|project|schema/i,
        );
        assert.equal(readFileSync(target, "utf8"), concurrentBytes);
        assert.match(
          readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
          /Collaboration Policy v1/,
        );
        assert.deepEqual(transactionResidue(value.repoRoot), []);
      } finally {
        value.cleanup();
      }
    });
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
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    setOwnedPolicyProjection(value.repoRoot, oldPolicy, 1);
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
    value.cleanup();
  }
});

test("a future policy projection is never downgraded by an older initializer", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const ownershipPath = path.join(
      value.repoRoot,
      ".harness",
      "ownership.json",
    );
    const ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
    ownership.policy.policyVersion = 999;
    writeFileSync(ownershipPath, canonicalJson(ownership));
    const before = {
      agents: readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      policy: readFileSync(
        path.join(value.repoRoot, PROJECT_POLICY_PATH),
        "utf8",
      ),
      ownership: readFileSync(ownershipPath, "utf8"),
    };

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /newer|future|downgrade|policy version/i,
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      before.agents,
    );
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, PROJECT_POLICY_PATH),
        "utf8",
      ),
      before.policy,
    );
    assert.equal(readFileSync(ownershipPath, "utf8"), before.ownership);
    assert.deepEqual(transactionResidue(value.repoRoot), []);
  } finally {
    value.cleanup();
  }
});

test("policy content cannot change without a policy version bump", async () => {
  const value = fixture();
  try {
    const contractPath = writeContract(value.repoRoot, approvedContract());
    await applyProjectContract({
      repoRoot: value.repoRoot,
      contractPath,
      skillRoot: SKILL_ROOT,
    });
    const differentPolicy = readFileSync(POLICY_PATH, "utf8").replace(
      "# Harness Collaboration Policy",
      "# Harness Collaboration Policy without version bump",
    );
    setOwnedPolicyProjection(value.repoRoot, differentPolicy, 8);
    const before = {
      agents: readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      policy: readFileSync(
        path.join(value.repoRoot, PROJECT_POLICY_PATH),
        "utf8",
      ),
      ownership: readFileSync(
        path.join(value.repoRoot, ".harness", "ownership.json"),
        "utf8",
      ),
    };

    await assert.rejects(
      applyProjectContract({
        repoRoot: value.repoRoot,
        contractPath,
        skillRoot: SKILL_ROOT,
      }),
      /content differs|bump the policy version/i,
    );
    assert.equal(
      readFileSync(path.join(value.repoRoot, "AGENTS.md"), "utf8"),
      before.agents,
    );
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, PROJECT_POLICY_PATH),
        "utf8",
      ),
      before.policy,
    );
    assert.equal(
      readFileSync(
        path.join(value.repoRoot, ".harness", "ownership.json"),
        "utf8",
      ),
      before.ownership,
    );
  } finally {
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
    writeFileSync(path.join(harnessDir, "project.json"), '{"keep":true}\n');
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
      readFileSync(path.join(harnessDir, "project.json"), "utf8"),
      '{"keep":true}\n',
    );
  } finally {
    value.cleanup();
  }
});

test("project inspection is read-only and reports discovered manifests", async () => {
  const value = fixture();
  try {
    const facts = await inspectProject(value.repoRoot, {
      homeDir: value.repoRoot,
    });
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
