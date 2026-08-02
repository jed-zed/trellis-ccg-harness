import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
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
  applyProductManagerReview,
  presentProductManagerGate,
  determineProductManagerFinalEligibility,
  prepareProductManagerReview,
  readProductManagerState,
  respondToProductManagerGate,
  runInstalledProductManagerReview,
  syncProductManagerPlan,
  writeProductManagerState,
} from "../scripts/lib/harness-adapter.mjs";
import { resolvePython } from "../scripts/lib/python-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_SNAPSHOT_FILES = Object.freeze([]);
const TEST_WORKSPACE_SNAPSHOT = Object.freeze({
  policy_version: "1",
  sha256: createHash("sha256").update(JSON.stringify({
    dirty: false,
    files: TEST_SNAPSHOT_FILES,
    git_head: "4".repeat(40),
    policy_version: "1",
  })).digest("hex"),
  file_count: 0,
  total_bytes: 0,
  git_head: "4".repeat(40),
  dirty: false,
});

function prepareReview(repoRoot, taskDirectory, options) {
  return prepareProductManagerReview(repoRoot, taskDirectory, {
    ...options,
    workspaceSnapshot: TEST_WORKSPACE_SNAPSHOT,
    claudeTransport: "local",
  });
}

function fixture(name) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), `harness-pm-e2e-${name}-`));
  const taskDir = path.join(
    repoRoot,
    ".trellis",
    "tasks",
    "07-27-product-manager",
  );
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    path.join(taskDir, "task.json"),
    `${JSON.stringify({
      id: "product-manager",
      title: "Product manager E2E",
      status: "in_progress",
    })}\n`,
  );
  writeFileSync(path.join(taskDir, "prd.md"), "# Product outcome\n");
  writeFileSync(path.join(taskDir, "design.md"), "# Design\n");
  writeFileSync(
    path.join(taskDir, "implement.md"),
    [
      "# Implement",
      "",
      "| Milestone | Title | Weight |",
      "| --- | --- | --- |",
      "| M1 | Contract | 50 |",
      "| M2 | Delivery | 50 |",
      "",
      "## M1：Contract",
      "",
      "## M2：Delivery",
      "",
    ].join("\n"),
  );
  return {
    repoRoot,
    taskDir,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function fakeProviderResponse(
  prepared,
  {
    verdict = "accepted",
    risks = [],
    nextAction = "Continue the canonical Trellis plan.",
  } = {},
) {
  return {
    contract_version: prepared.input.contract_version,
    task_id: prepared.input.task_id,
    trigger_type: prepared.input.trigger_type,
    checkpoint_id: prepared.input.checkpoint_id,
    plan_revision: prepared.input.plan_revision,
    input_digest: prepared.input.input_digest,
    evidence_digest: prepared.input.evidence_digest,
    invocation_key: prepared.invocationKey,
    verdict,
    facts: [],
    hypotheses: [],
    findings: [],
    evidence_refs: prepared.input.evidence_refs,
    progress: {
      implementation: 0,
      product_acceptance: 0,
      health: risks.length > 0 ? "yellow" : "green",
      reasons: [],
    },
    risks,
    recommended_next_action: nextAction,
    process_adjustments: [],
    material_change_proposal: null,
    reopen_request: null,
    user_acceptance_summary: `${prepared.input.checkpoint_id} reviewed by fake provider.`,
    provider_identity: {
      provider: "codex",
      model: "fake-offline",
      cli_version: "fake-offline",
    },
    generated_at: new Date().toISOString(),
  };
}

function configureInstalledRuntime(value) {
  mkdirSync(path.join(value.repoRoot, ".harness"), { recursive: true });
  writeFileSync(
    path.join(value.repoRoot, ".harness", "project.json"),
    `${JSON.stringify({ productManager: { claudeTransport: "local" } })}\n`,
  );
  writeFileSync(
    path.join(value.repoRoot, ".harness", "adapter.json"),
    `${JSON.stringify({
      productManager: {
        allowedProviders: ["codex"],
        providerCapabilities: {
          codex: {
            readOnly: true,
            workspaceWrite: false,
            terminal: false,
            subagents: false,
            network: "explicit-per-call",
            paid: "explicit-per-call",
          },
        },
      },
    })}\n`,
  );
  writeFileSync(
    path.join(value.repoRoot, "harness.sources.json"),
    `${JSON.stringify({ ccg: { version: "3.4.1" } })}\n`,
  );
}

function installedRuntimeOptions(
  value,
  prepared,
  {
    driftArtifact = false,
    rawOutput = null,
    snapshotOutput = null,
    assertProviderLockAvailable = false,
  } = {},
) {
  const command = path.join(value.repoRoot, "fake-ccg.exe");
  let calls = 0;
  return {
    responseFile: path.join(value.taskDir, "fake-provider-response.json"),
    discoverRoots: async () => ({
      approvedPackageRoots: [],
      approvedCommandRoots: [],
    }),
    resolveCommand: async () => ({
      command,
      argsPrefix: [],
    }),
    runner: (_command, args) => {
      calls++;
      if (args.includes("--version")) {
        return { status: 0, stdout: "ccg-workflow 3.4.1", stderr: "" };
      }
      if (args.includes("snapshot")) {
        if (snapshotOutput !== null) {
          return { status: 0, stdout: snapshotOutput, stderr: "" };
        }
        const snapshotBase = path.join(
          value.taskDir,
          ".ccg-evidence",
          "product-manager",
          "snapshots",
          "fake",
        );
        const snapshotRoot = path.join(snapshotBase, "root");
        const manifestPath = path.join(snapshotBase, "manifest.json");
        mkdirSync(snapshotRoot, { recursive: true });
        writeFileSync(
          manifestPath,
          `${JSON.stringify({ ...TEST_WORKSPACE_SNAPSHOT, files: TEST_SNAPSHOT_FILES })}\n`,
        );
        return {
          status: 0,
          stdout: JSON.stringify({
            protocol_version: "1",
            snapshot_root: snapshotRoot,
            manifest_path: manifestPath,
            workspace_snapshot: TEST_WORKSPACE_SNAPSHOT,
          }),
          stderr: "",
        };
      }
      if (assertProviderLockAvailable) {
        const providerLockPath = path.join(
          value.taskDir,
          ".ccg-evidence",
          "product-manager",
          "locks",
          `${prepared.invocationKey}.lock`,
        );
        mkdirSync(path.dirname(providerLockPath), { recursive: true });
        writeFileSync(providerLockPath, "ccg-provider-lock\n", { flag: "wx" });
        rmSync(providerLockPath, { force: true });
      }
      if (driftArtifact) {
        writeFileSync(
          path.join(value.taskDir, "design.md"),
          "# Design changed while the provider was running\n",
        );
      }
      return {
        status: 0,
        stdout: rawOutput ?? JSON.stringify(fakeProviderResponse(prepared)),
        stderr: "",
      };
    },
    callCount: () => calls,
  };
}

function review(value, triggerType, checkpointId, evidenceRefs, options = {}) {
  const prepared = prepareReview(
    value.repoRoot,
    value.taskDir,
    {
      triggerType,
      checkpointId,
      evidenceRefs,
      grillHandoff: options.grillHandoff ?? null,
    },
  );
  const response = fakeProviderResponse(prepared, options);
  return applyProductManagerReview(value.taskDir, prepared, response);
}

function respond(value, response) {
  let state = readProductManagerState(value.taskDir);
  state = presentProductManagerGate(value.taskDir, {
    expectedRevision: state.stateRevision,
  });
  return respondToProductManagerGate(value.taskDir, {
    response,
    expectedRevision: state.stateRevision,
  });
}

function passFinalGates(value) {
  const state = readProductManagerState(value.taskDir);
  state.finalReview.requiredGatesPassed = true;
  state.finalReview.blockers = [];
  return writeProductManagerState(
    value.taskDir,
    state,
    state.stateRevision,
  );
}

function finishAndArchiveTrellisFixture(value) {
  const taskPath = path.join(value.taskDir, "task.json");
  const task = JSON.parse(readFileSync(taskPath, "utf8"));
  task.status = "completed";
  writeFileSync(taskPath, `${JSON.stringify(task)}\n`);
  const archiveRoot = path.join(value.repoRoot, ".trellis", "tasks", "archive");
  mkdirSync(archiveRoot, { recursive: true });
  const archived = path.join(archiveRoot, path.basename(value.taskDir));
  renameSync(value.taskDir, archived);
  return archived;
}

function runLifecycle({ mergeFinal }) {
  const value = fixture(mergeFinal ? "merged" : "separate");
  try {
    syncProductManagerPlan(value.taskDir);

    review(value, "INTAKE_REVIEW", "INTAKE", ["fake:intake"], {
      grillHandoff: {
        artifact: "GRILL_HANDOFF",
        confirmed_decisions: ["Keep Trellis as lifecycle authority."],
      },
    });
    assert.equal(readProductManagerState(value.taskDir).currentGate, null);

    review(value, "PLAN_REVIEW", "PLAN", ["fake:plan"]);
    assert.equal(readProductManagerState(value.taskDir).currentGate, null);

    review(value, "MILESTONE_REVIEW", "M1", ["fake:m1"]);
    assert.equal(
      readProductManagerState(value.taskDir).currentGate.status,
      "awaiting_user_acceptance",
    );
    respond(value, "验收不通过：需要补充可见验证");
    assert.equal(
      readProductManagerState(value.taskDir).milestones[0].status,
      "in_progress",
    );

    review(value, "MILESTONE_REVIEW", "M1", ["fake:m1-remediated"]);
    respond(value, "验收通过");
    assert.equal(
      readProductManagerState(value.taskDir).milestones[0].status,
      "completed",
    );

    review(value, "DRIFT_REVIEW", "DRIFT-1", ["fake:drift"], {
      verdict: "needs_user_decision",
      risks: [{ kind: "scope-risk" }],
      nextAction: "Wait for the user's explicit scope decision.",
    });
    assert.equal(
      readProductManagerState(value.taskDir).currentGate.kind,
      "decision",
    );
    respond(value, "忽略风险并继续");

    const lastEvidence = ["fake:m2"];
    review(value, "MILESTONE_REVIEW", "M2", lastEvidence);
    if (mergeFinal) {
      review(value, "FINAL_REVIEW", "M2", lastEvidence);
      assert.equal(
        readProductManagerState(value.taskDir).currentGate.kind,
        "merged",
      );
    } else {
      respond(value, "验收通过");
      review(value, "FINAL_REVIEW", "FINAL", ["fake:final"]);
      assert.equal(
        readProductManagerState(value.taskDir).currentGate.kind,
        "final",
      );
    }

    passFinalGates(value);
    respond(value, "验收通过");
    const state = readProductManagerState(value.taskDir);
    const eligibility = determineProductManagerFinalEligibility(state);
    assert.deepEqual(eligibility, {
      eligible: true,
      conclusion: "completed_with_overrides",
      reasons: ["DRIFT-1:user_overridden"],
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(value.taskDir, "task.json"), "utf8"))
        .status,
      "in_progress",
      "the product-manager path must not complete the Trellis task",
    );
    const archived = finishAndArchiveTrellisFixture(value);
    assert.equal(
      JSON.parse(readFileSync(path.join(archived, "task.json"), "utf8")).status,
      "completed",
    );
    return state.finalReview.mergedWithMilestone;
  } finally {
    value.cleanup();
  }
}

test("fake provider E2E covers hard stops, resume, merged final acceptance, and Trellis archive", () => {
  assert.equal(runLifecycle({ mergeFinal: true }), "M2");
});

test("fake provider E2E keeps final acceptance separate when the milestone was already accepted", () => {
  assert.equal(runLifecycle({ mergeFinal: false }), null);
});

test("Codex hook injects the tracked pending gate and exactly three responses", () => {
  const value = fixture("hook");
  try {
    syncProductManagerPlan(value.taskDir);
    review(value, "MILESTONE_REVIEW", "M1", ["fake:hook"]);
    const python = resolvePython();
    const hookPath = path.join(
      ROOT,
      ".codex",
      "hooks",
      "inject-workflow-state.py",
    );
    const program = [
      "import importlib.util, pathlib, sys",
      "spec = importlib.util.spec_from_file_location('hook', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "print(module.load_product_manager_gate(pathlib.Path(sys.argv[2])) or '')",
    ].join("\n");
    const result = spawnSync(
      python.command,
      [...python.argsPrefix, "-c", program, hookPath, value.taskDir],
      {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 30_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HARD STOP/);
    assert.match(result.stdout, /Checkpoint: M1/);
    for (const response of [
      "验收通过",
      "验收不通过：原因",
      "忽略风险并继续",
    ]) {
      assert.equal(result.stdout.split(response).length - 1, 1);
    }
  } finally {
    value.cleanup();
  }
});

test("installed review writes the complete ignored call evidence and projection revision", async () => {
  const value = fixture("installed-evidence");
  try {
    configureInstalledRuntime(value);
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareReview(
      value.repoRoot,
      value.taskDir,
      {
        triggerType: "MILESTONE_REVIEW",
        checkpointId: "M1",
        evidenceRefs: ["fake:installed"],
      },
    );
    const runtime = installedRuntimeOptions(value, prepared, {
      assertProviderLockAvailable: true,
    });
    const projected = await runInstalledProductManagerReview(
      value.repoRoot,
      value.taskDir,
      {
        triggerType: "MILESTONE_REVIEW",
        checkpointId: "M1",
        evidenceRefs: ["fake:installed"],
        ...runtime,
      },
    );
    assert.equal(runtime.callCount(), 3);
    assert.equal(
      existsSync(path.join(value.taskDir, ".ccg-evidence", "product-manager", "snapshots", "fake", "root")),
      false,
    );
    const callRoot = path.join(
      value.taskDir,
      ".ccg-evidence",
      "product-manager",
      "calls",
      prepared.invocationKey,
    );
    for (const file of [
      "input.json",
      "provider-request.json",
      "response.raw",
      "result.json",
      "status.json",
    ]) {
      assert.ok(readFileSync(path.join(callRoot, file), "utf8").length > 0);
    }
    const status = JSON.parse(
      readFileSync(path.join(callRoot, "status.json"), "utf8"),
    );
    assert.equal(status.status, "completed");
    assert.equal(
      status.canonical_projection_revision,
      projected.stateRevision,
    );
  } finally {
    value.cleanup();
  }
});

test("invalid offline snapshot output fails before the provider review starts", async () => {
  const value = fixture("installed-invalid-snapshot");
  try {
    configureInstalledRuntime(value);
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareReview(value.repoRoot, value.taskDir, {
      triggerType: "MILESTONE_REVIEW",
      checkpointId: "M1",
    });
    const runtime = installedRuntimeOptions(value, prepared, {
      snapshotOutput: "not-json",
    });
    await assert.rejects(
      runInstalledProductManagerReview(value.repoRoot, value.taskDir, {
        triggerType: "MILESTONE_REVIEW",
        checkpointId: "M1",
        ...runtime,
      }),
      /snapshot.*malformed JSON/i,
    );
    assert.equal(runtime.callCount(), 2);
  } finally {
    value.cleanup();
  }
});

test("unsafe offline snapshot manifest is rejected and cleaned up", async () => {
  const value = fixture("installed-unsafe-snapshot");
  try {
    configureInstalledRuntime(value);
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareReview(value.repoRoot, value.taskDir, {
      triggerType: "MILESTONE_REVIEW",
      checkpointId: "M1",
    });
    const snapshotBase = path.join(
      value.taskDir,
      ".ccg-evidence",
      "product-manager",
      "snapshots",
      "unsafe",
    );
    const snapshotRoot = path.join(snapshotBase, "root");
    const manifestPath = path.join(snapshotBase, "manifest.json");
    const files = [{ bytes: 0, path: "../secret", sha256: "0".repeat(64) }];
    const workspaceSnapshot = {
      policy_version: "1",
      sha256: createHash("sha256").update(JSON.stringify({
        dirty: false,
        files,
        git_head: "4".repeat(40),
        policy_version: "1",
      })).digest("hex"),
      file_count: 1,
      total_bytes: 0,
      git_head: "4".repeat(40),
      dirty: false,
    };
    mkdirSync(snapshotRoot, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify({ ...workspaceSnapshot, files })}\n`);
    const runtime = installedRuntimeOptions(value, prepared, {
      snapshotOutput: JSON.stringify({
        protocol_version: "1",
        snapshot_root: snapshotRoot,
        manifest_path: manifestPath,
        workspace_snapshot: workspaceSnapshot,
      }),
    });
    await assert.rejects(
      runInstalledProductManagerReview(value.repoRoot, value.taskDir, {
        triggerType: "MILESTONE_REVIEW",
        checkpointId: "M1",
        ...runtime,
      }),
      /snapshot file 0 is malformed/i,
    );
    assert.equal(runtime.callCount(), 2);
    assert.equal(existsSync(snapshotBase), false);
  } finally {
    value.cleanup();
  }
});

test("late installed response is retained as raw stale audit without projecting state", async () => {
  const value = fixture("installed-stale");
  try {
    configureInstalledRuntime(value);
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareReview(
      value.repoRoot,
      value.taskDir,
      {
        triggerType: "MILESTONE_REVIEW",
        checkpointId: "M1",
        evidenceRefs: ["fake:stale"],
      },
    );
    const runtime = installedRuntimeOptions(value, prepared, {
      driftArtifact: true,
    });
    await assert.rejects(
      runInstalledProductManagerReview(
        value.repoRoot,
        value.taskDir,
        {
          triggerType: "MILESTONE_REVIEW",
          checkpointId: "M1",
          evidenceRefs: ["fake:stale"],
          ...runtime,
        },
      ),
      /stale/i,
    );
    const callRoot = path.join(
      value.taskDir,
      ".ccg-evidence",
      "product-manager",
      "calls",
      prepared.invocationKey,
    );
    assert.ok(readFileSync(path.join(callRoot, "response.raw"), "utf8").length > 0);
    assert.equal(
      JSON.parse(readFileSync(path.join(callRoot, "status.json"), "utf8")).status,
      "stale",
    );
    assert.equal(
      readProductManagerState(value.taskDir).milestones[0].status,
      "not_started",
    );
  } finally {
    value.cleanup();
  }
});

test("malformed installed response is redacted into raw audit before JSON parsing fails", async () => {
  const value = fixture("installed-malformed");
  try {
    configureInstalledRuntime(value);
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareReview(
      value.repoRoot,
      value.taskDir,
      {
        triggerType: "MILESTONE_REVIEW",
        checkpointId: "M1",
        evidenceRefs: ["fake:malformed"],
      },
    );
    const secret = "raw-provider-secret";
    const runtime = installedRuntimeOptions(value, prepared, {
      rawOutput: `provider preface Bearer ${secret}\n{not-json}`,
    });
    await assert.rejects(
      runInstalledProductManagerReview(
        value.repoRoot,
        value.taskDir,
        {
          triggerType: "MILESTONE_REVIEW",
          checkpointId: "M1",
          evidenceRefs: ["fake:malformed"],
          ...runtime,
        },
      ),
      /malformed JSON/i,
    );
    const callRoot = path.join(
      value.taskDir,
      ".ccg-evidence",
      "product-manager",
      "calls",
      prepared.invocationKey,
    );
    const raw = readFileSync(path.join(callRoot, "response.raw"), "utf8");
    assert.match(raw, /provider preface/);
    assert.doesNotMatch(raw, new RegExp(secret));
    assert.match(raw, /\[REDACTED\]/);
    assert.equal(
      JSON.parse(readFileSync(path.join(callRoot, "status.json"), "utf8")).status,
      "failed",
    );
    assert.equal(
      readProductManagerState(value.taskDir).milestones[0].status,
      "not_started",
    );
  } finally {
    value.cleanup();
  }
});
