import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyProductManagerReview,
  buildProductManagerStatus,
  collectProductManagerSummary,
  prepareProductManagerReview,
  readProductManagerState,
  respondToProductManagerGate,
  syncProductManagerPlan,
  writeProductManagerState,
} from "../scripts/lib/harness-adapter.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harness-pm-state-"));
  const taskDir = path.join(root, ".trellis", "tasks", "07-27-pm");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    path.join(taskDir, "task.json"),
    `${JSON.stringify({ id: "pm", title: "PM task", status: "in_progress" }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(taskDir, "implement.md"),
    [
      "# Plan",
      "",
      "| ID | Phase | Weight |",
      "|---|---|---:|",
      "| M1 | Contract | 20 |",
      "| M2 | Bridge | 30 |",
      "| M3 | Finish | 50 |",
      "",
      "## M1: Contract (20)",
      "## M2: Bridge (30)",
      "## M3: Finish (50)",
      "",
    ].join("\n"),
  );
  return { root, taskDir };
}

function acceptedResponse(prepared) {
  return {
    ...prepared.input,
    invocation_key: prepared.invocationKey,
    verdict: "accepted",
    facts: [],
    hypotheses: [],
    findings: [],
    evidence_refs: prepared.input.evidence_refs,
    progress: {
      implementation: 0,
      product_acceptance: 0,
      health: "green",
      reasons: [],
    },
    risks: [],
    recommended_next_action: "Request user acceptance.",
    process_adjustments: [],
    material_change_proposal: null,
    reopen_request: null,
    user_acceptance_summary: "The checkpoint is ready.",
    provider_identity: {
      provider: "gemini",
      model: "fake",
      cli_version: "test",
    },
    generated_at: "2026-07-27T00:00:00.000Z",
  };
}

test("sync-plan creates one tracked projection without changing Trellis lifecycle", () => {
  const value = fixture();
  try {
    const before = readFileSync(path.join(value.taskDir, "task.json"), "utf8");
    const state = syncProductManagerPlan(value.taskDir);
    assert.equal(state.stateRevision, 1);
    assert.equal(state.planRevision, 1);
    assert.deepEqual(
      state.milestones.map(({ id, weight, status }) => ({ id, weight, status })),
      [
        { id: "M1", weight: 20, status: "not_started" },
        { id: "M2", weight: 30, status: "not_started" },
        { id: "M3", weight: 50, status: "not_started" },
      ],
    );
    assert.equal(
      readFileSync(path.join(value.taskDir, "task.json"), "utf8"),
      before,
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(value.taskDir, "product-manager.json"))).taskId,
      "pm",
    );
    assert.deepEqual(
      collectProductManagerSummary(value.root, value.taskDir, "pm").currentGate,
      null,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("sync-plan creates one implicit milestone for a single-deliverable plan", () => {
  const value = fixture();
  try {
    writeFileSync(
      path.join(value.taskDir, "implement.md"),
      "# Plan\n\nDeliver the approved user-visible result.\n",
    );
    const state = syncProductManagerPlan(value.taskDir);
    assert.deepEqual(
      state.milestones.map(({ id, title, weight }) => ({
        id,
        title,
        weight,
      })),
      [
        {
          id: "M1",
          title: "Final user deliverable",
          weight: 100,
        },
      ],
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("user responses preserve the PM verdict and derive progress", () => {
  const value = fixture();
  try {
    let state = syncProductManagerPlan(value.taskDir);
    state.milestones[0].status = "awaiting_user_acceptance";
    state.milestones[0].pmVerdict = "accepted";
    state.currentGate = {
      kind: "milestone",
      checkpointId: "M1",
      status: "awaiting_user_acceptance",
      acceptanceCard: { goal: "Contract", nextAction: "Implement M2" },
    };
    state = writeProductManagerState(value.taskDir, state, state.stateRevision);
    state = respondToProductManagerGate(value.taskDir, {
      response: "验收通过",
      expectedRevision: state.stateRevision,
    });
    assert.equal(state.milestones[0].status, "completed");
    assert.equal(state.milestones[0].pmVerdict, "accepted");
    assert.equal(state.progress.implementation, 20);
    assert.equal(state.progress.productAcceptance, 20);

    state.milestones[1].status = "awaiting_user_acceptance";
    state.milestones[1].pmVerdict = "rejected";
    state.currentGate = {
      kind: "milestone",
      checkpointId: "M2",
      status: "awaiting_user_acceptance",
      acceptanceCard: { goal: "Bridge", nextAction: "Implement M3" },
    };
    state = writeProductManagerState(value.taskDir, state, state.stateRevision);
    state = respondToProductManagerGate(value.taskDir, {
      response: "忽略风险并继续",
      expectedRevision: state.stateRevision,
    });
    assert.equal(state.milestones[1].status, "user_overridden");
    assert.equal(state.milestones[1].pmVerdict, "rejected");
    assert.equal(state.progress.implementation, 50);
    assert.equal(state.progress.productAcceptance, 20);
    assert.equal(state.progress.health, "yellow");
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("state writes use revision CAS and reject parallel .ccg task roots", () => {
  const value = fixture();
  try {
    const state = syncProductManagerPlan(value.taskDir);
    assert.throws(
      () => writeProductManagerState(value.taskDir, state, 0),
      /revision/i,
    );
    const forbidden = path.join(value.root, ".ccg", "tasks", "pm");
    mkdirSync(forbidden, { recursive: true });
    assert.throws(() => syncProductManagerPlan(forbidden), /parallel|Trellis/i);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("status reports final eligibility without mutating task status", () => {
  const value = fixture();
  try {
    const state = syncProductManagerPlan(value.taskDir);
    for (const milestone of state.milestones) {
      milestone.status = "completed";
      milestone.pmVerdict = "accepted";
      milestone.evidenceRefs = [`test:${milestone.id}`];
    }
    state.finalReview = {
      verdict: "accepted",
      userAccepted: true,
      requiredGatesPassed: true,
      blockers: [],
      evidenceRefs: ["test:final"],
    };
    writeProductManagerState(value.taskDir, state, state.stateRevision);
    const status = buildProductManagerStatus(value.taskDir);
    assert.deepEqual(status.finalEligibility, {
      eligible: true,
      conclusion: "completed",
      reasons: [],
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(value.taskDir, "task.json"))).status,
      "in_progress",
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("review application rejects stale identities and creates a user hard gate", () => {
  const value = fixture();
  try {
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareProductManagerReview(value.root, value.taskDir, {
      triggerType: "MILESTONE_REVIEW",
      checkpointId: "M1",
      evidenceRefs: ["test:focused"],
    });
    assert.throws(
      () =>
        applyProductManagerReview(value.taskDir, prepared, {
          ...prepared.input,
          invocation_key: prepared.invocationKey,
          task_id: "other",
          verdict: "accepted",
        }),
      /stale/i,
    );
    const response = {
      ...prepared.input,
      invocation_key: prepared.invocationKey,
      verdict: "accepted",
      facts: [],
      hypotheses: [],
      findings: [],
      evidence_refs: ["test:focused"],
      progress: {
        implementation: 0,
        product_acceptance: 0,
        health: "green",
        reasons: [],
      },
      risks: [],
      recommended_next_action: "Request user acceptance.",
      process_adjustments: [],
      material_change_proposal: null,
      reopen_request: null,
      user_acceptance_summary: "M1 is ready.",
      provider_identity: {
        provider: "gemini",
        model: "fake",
        cli_version: "test",
      },
      generated_at: "2026-07-27T00:00:00.000Z",
    };
    const state = applyProductManagerReview(value.taskDir, prepared, response);
    assert.equal(state.milestones[0].status, "awaiting_user_acceptance");
    assert.equal(state.currentGate.checkpointId, "M1");
    assert.equal(state.currentGate.status, "awaiting_user_acceptance");
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("review application rechecks current artifact input before projecting state", () => {
  const value = fixture();
  try {
    writeFileSync(path.join(value.taskDir, "design.md"), "# Initial design\n");
    syncProductManagerPlan(value.taskDir);
    const prepared = prepareProductManagerReview(value.root, value.taskDir, {
      triggerType: "MILESTONE_REVIEW",
      checkpointId: "M1",
      evidenceRefs: ["test:artifact-drift"],
    });
    writeFileSync(path.join(value.taskDir, "design.md"), "# Changed design\n");
    assert.throws(
      () =>
        applyProductManagerReview(
          value.taskDir,
          prepared,
          acceptedResponse(prepared),
        ),
      /stale/i,
    );
    assert.equal(
      readProductManagerState(value.taskDir).milestones[0].status,
      "not_started",
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("INTAKE_REVIEW carries an explicit GRILL_HANDOFF without creating another requirement source", () => {
  const value = fixture();
  try {
    syncProductManagerPlan(value.taskDir);
    const handoff = {
      originalRequest: "Build the product-manager role.",
      verifiedFacts: ["Trellis owns the task."],
      confirmedDecisions: ["No parallel plan authority."],
      artifactRef: ".trellis/tasks/pm/prd.md",
    };
    const prepared = prepareProductManagerReview(
      value.root,
      value.taskDir,
      {
        triggerType: "INTAKE_REVIEW",
        checkpointId: "intake",
        grillHandoff: handoff,
      },
    );
    assert.deepEqual(prepared.input.grill_handoff, handoff);
    assert.throws(
      () =>
        prepareProductManagerReview(value.root, value.taskDir, {
          triggerType: "INTAKE_REVIEW",
          checkpointId: "intake",
          grillHandoff: [],
        }),
      /GRILL_HANDOFF/i,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("intake acceptance resumes automatically while material decisions remain a user hard gate", () => {
  const value = fixture();
  try {
    syncProductManagerPlan(value.taskDir);
    const accepted = prepareProductManagerReview(
      value.root,
      value.taskDir,
      {
        triggerType: "INTAKE_REVIEW",
        checkpointId: "intake",
      },
    );
    const baseResponse = {
      ...accepted.input,
      invocation_key: accepted.invocationKey,
      verdict: "accepted",
      facts: [],
      hypotheses: [],
      findings: [],
      evidence_refs: ["prd:intake"],
      progress: {
        implementation: 0,
        product_acceptance: 0,
        health: "green",
        reasons: [],
      },
      risks: [],
      recommended_next_action: "Continue the approved Trellis plan.",
      process_adjustments: [],
      material_change_proposal: null,
      reopen_request: null,
      user_acceptance_summary: "The intake is aligned.",
      provider_identity: {
        provider: "gemini",
        model: "fake",
        cli_version: "test",
      },
      generated_at: "2026-07-27T00:00:00.000Z",
    };
    let state = applyProductManagerReview(
      value.taskDir,
      accepted,
      baseResponse,
    );
    assert.equal(state.currentGate, null);
    assert.equal(
      state.nextAction,
      "Continue the approved Trellis plan.",
    );

    const decision = prepareProductManagerReview(
      value.root,
      value.taskDir,
      {
        triggerType: "DRIFT_REVIEW",
        checkpointId: "scope-change",
      },
    );
    state = applyProductManagerReview(value.taskDir, decision, {
      ...baseResponse,
      ...decision.input,
      invocation_key: decision.invocationKey,
      verdict: "needs_user_decision",
      material_change_proposal: {
        change: "Expand scope",
      },
    });
    assert.equal(state.currentGate.kind, "decision");
    assert.equal(
      state.currentGate.status,
      "awaiting_user_acceptance",
    );
    state = respondToProductManagerGate(value.taskDir, {
      response: "验收不通过：保持原范围",
      expectedRevision: state.stateRevision,
    });
    assert.equal(state.currentGate, null);
    assert.match(state.nextAction, /保持原范围/);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("FINAL_REVIEW merges with the last unchanged milestone into one atomic user gate", () => {
  const value = fixture();
  try {
    let state = syncProductManagerPlan(value.taskDir);
    for (const milestone of state.milestones.slice(0, -1)) {
      milestone.status = "completed";
      milestone.pmVerdict = "accepted";
      milestone.evidenceRefs = [`test:${milestone.id}`];
    }
    state.milestones.at(-1).status = "awaiting_user_acceptance";
    state.milestones.at(-1).pmVerdict = "accepted";
    state.milestones.at(-1).evidenceRefs = ["test:all-gates"];
    state = writeProductManagerState(
      value.taskDir,
      state,
      state.stateRevision,
    );
    const prepared = prepareProductManagerReview(
      value.root,
      value.taskDir,
      {
        triggerType: "FINAL_REVIEW",
        checkpointId: "M3",
        evidenceRefs: ["test:all-gates"],
      },
    );
    state = readProductManagerState(value.taskDir);
    state.milestones.at(-1).pmReview = {
      evidenceDigest: prepared.input.evidence_digest,
    };
    state.currentGate = {
      kind: "milestone",
      checkpointId: "M3",
      status: "awaiting_user_acceptance",
      pmVerdict: "accepted",
    };
    state = writeProductManagerState(
      value.taskDir,
      state,
      state.stateRevision,
    );
    const fresh = prepareProductManagerReview(
      value.root,
      value.taskDir,
      {
        triggerType: "FINAL_REVIEW",
        checkpointId: "M3",
        evidenceRefs: ["test:all-gates"],
      },
    );
    const response = {
      ...fresh.input,
      invocation_key: fresh.invocationKey,
      verdict: "accepted",
      facts: [],
      hypotheses: [],
      findings: [],
      evidence_refs: ["test:all-gates"],
      progress: {
        implementation: 100,
        product_acceptance: 100,
        health: "green",
        reasons: [],
      },
      risks: [],
      recommended_next_action: "Request the merged user acceptance.",
      process_adjustments: [],
      material_change_proposal: null,
      reopen_request: null,
      user_acceptance_summary: "M3 and final delivery are ready.",
      provider_identity: {
        provider: "gemini",
        model: "fake",
        cli_version: "test",
      },
      generated_at: "2026-07-27T00:00:00.000Z",
    };
    state = applyProductManagerReview(
      value.taskDir,
      fresh,
      response,
    );
    assert.equal(state.currentGate.kind, "merged");
    assert.equal(state.finalReview.mergedWithMilestone, "M3");
    state.finalReview.requiredGatesPassed = true;
    state = writeProductManagerState(
      value.taskDir,
      state,
      state.stateRevision,
    );
    state = respondToProductManagerGate(value.taskDir, {
      response: "验收通过",
      expectedRevision: state.stateRevision,
    });
    assert.equal(state.milestones.at(-1).status, "completed");
    assert.equal(state.finalReview.userAccepted, true);
    assert.equal(
      buildProductManagerStatus(value.taskDir).finalEligibility.eligible,
      true,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
