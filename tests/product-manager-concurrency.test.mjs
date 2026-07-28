import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireProductManagerLock,
  applyProductManagerReview,
  heartbeatProductManagerLock,
  prepareProductManagerReview,
  readProductManagerState,
  releaseProductManagerLock,
  syncProductManagerPlan,
  writeProductManagerState,
} from "../scripts/lib/harness-adapter.mjs";

test("a product-manager projection has one cross-process lock owner", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness pm lock-"));
  const taskDir = path.join(root, ".trellis", "tasks", "pm");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, "task.json"), '{"id":"pm","status":"in_progress"}\n');
  try {
    const key = "a".repeat(64);
    const first = acquireProductManagerLock(taskDir, key);
    assert.match(first.lockPath, /product-manager[\\/]projection-locks[\\/]/);
    assert.throws(() => acquireProductManagerLock(taskDir, key), /in progress/i);
    releaseProductManagerLock(first);
    const second = acquireProductManagerLock(taskDir, key);
    releaseProductManagerLock(second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a live owner cannot be stale-stolen and dead crash residue is recoverable", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-pm-recovery-"));
  const taskDir = path.join(root, ".trellis", "tasks", "pm");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, "task.json"), '{"id":"pm","status":"in_progress"}\n');
  try {
    const key = "b".repeat(64);
    const first = acquireProductManagerLock(taskDir, key, {
      staleAfterMs: 1_000,
    });
    const before = statSync(first.lockPath).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    heartbeatProductManagerLock(first);
    assert.ok(statSync(first.lockPath).mtimeMs > before);

    const staleAt = new Date(Date.now() - 10_000);
    utimesSync(first.lockPath, staleAt, staleAt);
    assert.throws(
      () => acquireProductManagerLock(taskDir, key, {
        staleAfterMs: 10,
      }),
      /in progress/i,
    );
    heartbeatProductManagerLock(first);
    releaseProductManagerLock(first);

    writeFileSync(
      first.lockPath,
      `${JSON.stringify({
        invocationKey: key,
        nonce: "dead-owner",
        pid: 2147483647,
        acquiredAt: new Date(0).toISOString(),
      })}\n`,
    );
    utimesSync(first.lockPath, staleAt, staleAt);
    const recovered = acquireProductManagerLock(taskDir, key, {
      staleAfterMs: 10,
    });
    assert.notEqual(recovered.nonce, first.nonce);
    releaseProductManagerLock(recovered);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a late response cannot update state after revision drift", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-pm-late-"));
  const taskDir = path.join(root, ".trellis", "tasks", "pm");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, "task.json"), '{"id":"pm","status":"in_progress"}\n');
  writeFileSync(
    path.join(taskDir, "implement.md"),
    "# Plan\n\n## M1：Contract\n",
  );
  try {
    syncProductManagerPlan(taskDir);
    const prepared = prepareProductManagerReview(root, taskDir, {
      triggerType: "MILESTONE_REVIEW",
      checkpointId: "M1",
      evidenceRefs: ["test:late"],
    });
    const current = readProductManagerState(taskDir);
    current.nextAction = "Newer orchestrator decision.";
    writeProductManagerState(taskDir, current, current.stateRevision);
    const response = {
      contract_version: prepared.input.contract_version,
      task_id: prepared.input.task_id,
      trigger_type: prepared.input.trigger_type,
      checkpoint_id: prepared.input.checkpoint_id,
      plan_revision: prepared.input.plan_revision,
      input_digest: prepared.input.input_digest,
      evidence_digest: prepared.input.evidence_digest,
      invocation_key: prepared.invocationKey,
      verdict: "accepted",
      evidence_refs: prepared.input.evidence_refs,
      findings: [],
      risks: [],
      process_adjustments: [],
      recommended_next_action: "Wait for user acceptance.",
      material_change_proposal: null,
      reopen_request: null,
      user_acceptance_summary: "M1 ready.",
      provider_identity: {
        provider: "codex",
        model: "fake",
        cli_version: "fake",
      },
      generated_at: new Date().toISOString(),
    };
    assert.throws(
      () => applyProductManagerReview(taskDir, prepared, response),
      /stale/i,
    );
    assert.equal(
      readProductManagerState(taskDir).nextAction,
      "Newer orchestrator decision.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
