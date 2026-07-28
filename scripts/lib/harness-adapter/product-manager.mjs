import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { assertInside, readJson, sha256 } from "./process.mjs";
import { commandError, defaultRunner, runCommand } from "./process.mjs";
import { redactString, redactValue } from "./redaction.mjs";
import {
  discoverTrustedCommandRoots,
  resolveTrustedCommand,
} from "../../../.agents/skills/harness-init/scripts/trusted-command-resolver.mjs";

const STATE_FILE = "product-manager.json";
const MILESTONE_STATUSES = new Set([
  "not_started",
  "in_progress",
  "blocked",
  "awaiting_user_acceptance",
  "completed",
  "user_overridden",
]);
const PM_VERDICTS = new Set([
  "accepted",
  "rejected",
  "needs_user_decision",
  "reopen_request",
  "unavailable",
]);
const IMPLEMENTATION_STATUSES = new Set([
  "awaiting_user_acceptance",
  "completed",
  "user_overridden",
]);
const REVIEW_TRIGGERS = new Set([
  "INTAKE_REVIEW",
  "PLAN_REVIEW",
  "DRIFT_REVIEW",
  "MILESTONE_REVIEW",
  "FINAL_REVIEW",
]);
const ADVICE_KEYS = [
  "invocationKey",
  "triggerType",
  "checkpointId",
  "planRevision",
  "verdict",
  "providerIdentity",
  "generatedAt",
  "productManagerStatement",
  "findings",
  "risks",
  "processAdjustments",
  "recommendedNextAction",
  "evidenceRefs",
  "presentedAt",
];

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Canonical state contains an unsupported number.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .map((key) => ({ key, normalized: key.normalize("NFC") }))
      .sort((left, right) =>
        left.normalized < right.normalized
          ? -1
          : left.normalized > right.normalized
            ? 1
            : 0,
      );
    if (
      new Set(entries.map((entry) => entry.normalized)).size !==
      entries.length
    ) {
      throw new TypeError(
        "Canonical state contains duplicate keys after NFC normalization.",
      );
    }
    return `{${entries
      .map(({ key, normalized }) => `${JSON.stringify(normalized)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`Canonical state contains unsupported ${typeof value}.`);
}

function assertCanonicalTaskDirectory(taskDirectory) {
  const resolved = path.resolve(taskDirectory);
  const portable = resolved.replaceAll("\\", "/").toLowerCase();
  if (
    portable.includes("/.ccg/tasks/") ||
    !portable.includes("/.trellis/tasks/")
  ) {
    throw new Error(
      "Product-manager state requires the canonical Trellis task directory; parallel .ccg/tasks authority is forbidden.",
    );
  }
  const taskPath = path.join(resolved, "task.json");
  if (!existsSync(taskPath)) {
    throw new Error("Canonical Trellis task is missing task.json.");
  }
  return { taskDirectory: resolved, taskPath };
}

function atomicWriteJson(filePath, value) {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${canonicalJson(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function atomicWriteText(filePath, value) {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, value, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function productManagerCallPaths(taskDirectory, invocationKey) {
  const canonical = assertCanonicalTaskDirectory(taskDirectory);
  const callRoot = path.join(
    canonical.taskDirectory,
    ".ccg-evidence",
    "product-manager",
    "calls",
    invocationKey,
  );
  assertInside(canonical.taskDirectory, callRoot, "Product-manager call root");
  return {
    callRoot,
    inputPath: path.join(callRoot, "input.json"),
    providerRequestPath: path.join(callRoot, "provider-request.json"),
    rawResponsePath: path.join(callRoot, "response.raw"),
    resultPath: path.join(callRoot, "result.json"),
    statusPath: path.join(callRoot, "status.json"),
  };
}

function updateProductManagerCallStatus(paths, patch) {
  const current = existsSync(paths.statusPath)
    ? readJson(paths.statusPath)
    : {};
  atomicWriteJson(
    paths.statusPath,
    redactValue({
      ...current,
      ...patch,
    }),
  );
}

function parseMilestones(implement) {
  const weights = new Map();
  for (const line of implement.split(/\r?\n/)) {
    const row = line.match(
      /^\|\s*(M\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|/,
    );
    if (row) {
      weights.set(row[1], {
        title: row[2].trim(),
        weight: Number(row[3]),
      });
    }
  }
  const milestones = [];
  for (const line of implement.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(M\d+)\s*[:：]\s*(.+?)\s*$/);
    if (!heading || milestones.some((item) => item.id === heading[1])) {
      continue;
    }
    const fromTable = weights.get(heading[1]);
    const title = (fromTable?.title || heading[2])
      .replace(/[（(]\s*\d+(?:\.\d+)?\s*[）)]\s*$/, "")
      .trim();
    milestones.push({
      id: heading[1],
      title,
      weight: fromTable?.weight ?? null,
    });
  }
  if (milestones.length === 0) {
    return [
      {
        id: "M1",
        title: "Final user deliverable",
        weight: 100,
      },
    ];
  }
  if (milestones.some((milestone) => milestone.weight === null)) {
    const equal = 100 / milestones.length;
    for (const milestone of milestones) milestone.weight = equal;
  }
  const total = milestones.reduce(
    (sum, milestone) => sum + milestone.weight,
    0,
  );
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(`Milestone weights must total 100; received ${total}.`);
  }
  return milestones;
}

function calculateProgress(milestones) {
  const implementation = milestones
    .filter((milestone) => IMPLEMENTATION_STATUSES.has(milestone.status))
    .reduce((sum, milestone) => sum + milestone.weight, 0);
  const productAcceptance = milestones
    .filter(
      (milestone) =>
        milestone.pmVerdict === "accepted" &&
        milestone.status !== "user_overridden",
    )
    .reduce((sum, milestone) => sum + milestone.weight, 0);
  const reasons = [];
  if (milestones.some((milestone) => milestone.status === "blocked")) {
    reasons.push("blocker");
  }
  if (milestones.some((milestone) => milestone.reviewStale)) {
    reasons.push("drift");
  }
  if (milestones.some((milestone) => milestone.status === "user_overridden")) {
    reasons.push("user_override");
  }
  if (milestones.some((milestone) => milestone.evidenceGap)) {
    reasons.push("evidence_gap");
  }
  if (milestones.some((milestone) => milestone.majorRisk)) {
    reasons.push("major_risk");
  }
  return {
    implementation: Math.round(implementation * 100) / 100,
    productAcceptance: Math.round(productAcceptance * 100) / 100,
    health:
      reasons.includes("blocker") || reasons.includes("major_risk")
        ? "red"
        : reasons.length > 0
          ? "yellow"
          : "green",
    reasons,
  };
}

function invocationIdentity(input) {
  return {
    contract_version: input.contract_version,
    task_id: input.task_id,
    trigger_type: input.trigger_type,
    checkpoint_id: input.checkpoint_id,
    plan_revision: input.plan_revision,
    input_digest: input.input_digest,
    evidence_digest: input.evidence_digest,
  };
}

function createInvocationKey(input) {
  return sha256(canonicalJson(invocationIdentity(input)));
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((entry, index) => entry !== required[index])
  ) {
    throw new Error(`${label} has missing or unknown fields.`);
  }
}

function createAdviceProjection(response, { presentedAt = null } = {}) {
  return {
    invocationKey: response.invocation_key,
    triggerType: response.trigger_type,
    checkpointId: response.checkpoint_id,
    planRevision: response.plan_revision,
    verdict: response.verdict,
    providerIdentity: structuredClone(response.provider_identity),
    generatedAt: response.generated_at,
    productManagerStatement: response.user_acceptance_summary,
    findings: structuredClone(response.findings),
    risks: structuredClone(response.risks),
    processAdjustments: structuredClone(response.process_adjustments),
    recommendedNextAction: response.recommended_next_action,
    evidenceRefs: structuredClone(response.evidence_refs),
    presentedAt,
  };
}

function isNonemptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isValidTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isValidProviderIdentity(identity) {
  return Boolean(
    identity &&
    typeof identity === "object" &&
    !Array.isArray(identity) &&
    ["codex", "gemini", "claude"].includes(identity.provider) &&
    typeof identity.model === "string" &&
    typeof identity.cli_version === "string",
  );
}

function hasValidAdviceIdentity(advice) {
  return (
    /^[a-f0-9]{64}$/.test(advice.invocationKey) &&
    REVIEW_TRIGGERS.has(advice.triggerType) &&
    isNonemptyString(advice.checkpointId) &&
    Number.isSafeInteger(advice.planRevision) &&
    advice.planRevision >= 1 &&
    PM_VERDICTS.has(advice.verdict) &&
    isValidProviderIdentity(advice.providerIdentity) &&
    isValidTimestamp(advice.generatedAt)
  );
}

function hasValidAdviceContent(advice) {
  return (
    isNonemptyString(advice.productManagerStatement) &&
    Array.isArray(advice.findings) &&
    Array.isArray(advice.risks) &&
    Array.isArray(advice.processAdjustments) &&
    isNonemptyString(advice.recommendedNextAction) &&
    Array.isArray(advice.evidenceRefs) &&
    advice.evidenceRefs.every((entry) => typeof entry === "string")
  );
}

function hasValidPresentationTimestamp(advice) {
  return advice.presentedAt === null || isValidTimestamp(advice.presentedAt);
}

function validateAdvice(advice, label = "Product-manager advice") {
  if (advice === null) return null;
  if (!advice || typeof advice !== "object" || Array.isArray(advice)) {
    throw new Error(`${label} is malformed.`);
  }
  assertExactKeys(advice, ADVICE_KEYS, label);
  if (
    !hasValidAdviceIdentity(advice) ||
    !hasValidAdviceContent(advice) ||
    !hasValidPresentationTimestamp(advice)
  ) {
    throw new Error(`${label} is malformed.`);
  }
  return advice;
}

function recoverLegacyAdvice(taskDirectory, state) {
  const historyEntry = [...state.history]
    .reverse()
    .find(
      (entry) =>
        entry?.type === "product_manager_review" &&
        /^[a-f0-9]{64}$/.test(entry.invocationKey),
    );
  if (!historyEntry) return null;
  const resultPath = path.join(
    taskDirectory,
    ".ccg-evidence",
    "product-manager",
    "calls",
    historyEntry.invocationKey,
    "result.json",
  );
  assertInside(taskDirectory, resultPath, "Legacy product-manager result");
  if (!existsSync(resultPath)) return null;
  try {
    const response = readJson(resultPath);
    if (
      response.invocation_key !== historyEntry.invocationKey ||
      response.trigger_type !== historyEntry.triggerType ||
      response.checkpoint_id !== historyEntry.checkpointId
    ) {
      return null;
    }
    return validateAdvice(
      createAdviceProjection(response),
      "Recovered product-manager advice",
    );
  } catch {
    return null;
  }
}

function normalizeLegacyState(taskDirectory, state) {
  let normalized = state;
  if (!Object.hasOwn(normalized, "latestAdvice")) {
    normalized = structuredClone(normalized);
    normalized.latestAdvice = recoverLegacyAdvice(taskDirectory, normalized);
  }
  const advice = normalized.latestAdvice;
  if (!advice) return normalized;
  const milestone = normalized.milestones.find(
    (item) => item.pmReview?.invocationKey === advice.invocationKey,
  );
  if (
    milestone &&
    typeof milestone.pmReview.productManagerStatement !== "string"
  ) {
    if (normalized === state) normalized = structuredClone(normalized);
    const normalizedMilestone = normalized.milestones.find(
      (item) => item.id === milestone.id,
    );
    normalizedMilestone.pmReview = {
      ...advice,
      ...normalizedMilestone.pmReview,
      presentedAt: advice.presentedAt,
    };
  }
  return normalized;
}

function validateState(state, taskId, taskDirectory) {
  state = normalizeLegacyState(taskDirectory, state);
  if (
    !state ||
    state.schemaVersion !== 1 ||
    state.taskId !== taskId ||
    !Number.isSafeInteger(state.stateRevision) ||
    state.stateRevision < 0 ||
    !Number.isSafeInteger(state.planRevision) ||
    state.planRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(state.planDigest) ||
    !Array.isArray(state.milestones) ||
    !Array.isArray(state.history)
  ) {
    throw new Error("product-manager.json is malformed or belongs to another task.");
  }
  assertExactKeys(
    state,
    [
      "schemaVersion",
      "taskId",
      "stateRevision",
      "planRevision",
      "planDigest",
      "milestones",
      "currentGate",
      "finalReview",
      "progress",
      "nextAction",
      "latestAdvice",
      "history",
      "updatedAt",
    ],
    "product-manager.json",
  );
  const milestoneIds = new Set();
  for (const milestone of state.milestones) {
    assertExactKeys(
      milestone,
      [
        "id",
        "title",
        "weight",
        "status",
        "pmVerdict",
        "pmReview",
        "userAcceptance",
        "evidenceRefs",
        "reviewStale",
        "evidenceGap",
        "majorRisk",
      ],
      `Product-manager milestone ${milestone?.id ?? "?"}`,
    );
    if (
      typeof milestone.id !== "string" ||
      typeof milestone.title !== "string" ||
      !Number.isFinite(milestone.weight) ||
      milestone.weight <= 0 ||
      !MILESTONE_STATUSES.has(milestone.status) ||
      (milestone.pmVerdict !== null && !PM_VERDICTS.has(milestone.pmVerdict)) ||
      !Array.isArray(milestone.evidenceRefs) ||
      milestone.evidenceRefs.some((entry) => typeof entry !== "string") ||
      typeof milestone.reviewStale !== "boolean" ||
      typeof milestone.evidenceGap !== "boolean" ||
      typeof milestone.majorRisk !== "boolean" ||
      milestoneIds.has(milestone.id)
    ) {
      throw new Error(`Product-manager milestone ${milestone?.id ?? "?"} is malformed.`);
    }
    milestoneIds.add(milestone.id);
  }
  const totalWeight = state.milestones.reduce(
    (sum, milestone) => sum + milestone.weight,
    0,
  );
  if (Math.abs(totalWeight - 100) > 0.001) {
    throw new Error(
      `Product-manager milestone weights must total 100; received ${totalWeight}.`,
    );
  }
  if (
    typeof state.nextAction !== "string" ||
    !state.nextAction.trim() ||
    typeof state.updatedAt !== "string" ||
    Number.isNaN(Date.parse(state.updatedAt))
  ) {
    throw new Error("Product-manager next action or timestamp is malformed.");
  }
  validateAdvice(state.latestAdvice);
  if (
    canonicalJson(state.progress) !==
    canonicalJson(calculateProgress(state.milestones))
  ) {
    throw new Error(
      "Product-manager progress does not match canonical milestone state.",
    );
  }
  return state;
}

export function readProductManagerState(taskDirectory, { required = true } = {}) {
  const canonical = assertCanonicalTaskDirectory(taskDirectory);
  const task = readJson(canonical.taskPath);
  const statePath = path.join(canonical.taskDirectory, STATE_FILE);
  if (!existsSync(statePath)) {
    if (!required) return null;
    throw new Error("Canonical product-manager.json is missing; run pm sync-plan.");
  }
  return validateState(readJson(statePath), task.id, canonical.taskDirectory);
}

export function writeProductManagerState(
  taskDirectory,
  candidate,
  expectedRevision,
) {
  const canonical = assertCanonicalTaskDirectory(taskDirectory);
  const task = readJson(canonical.taskPath);
  const statePath = path.join(canonical.taskDirectory, STATE_FILE);
  const current = existsSync(statePath)
    ? validateState(readJson(statePath), task.id, canonical.taskDirectory)
    : null;
  const actualRevision = current?.stateRevision ?? 0;
  if (expectedRevision !== actualRevision) {
    throw new Error(
      `Product-manager state revision conflict: expected ${expectedRevision}, actual ${actualRevision}.`,
    );
  }
  const next = structuredClone(candidate);
  next.schemaVersion = 1;
  next.taskId = task.id;
  next.stateRevision = actualRevision + 1;
  next.progress = calculateProgress(next.milestones);
  next.updatedAt = new Date().toISOString();
  validateState(next, task.id, canonical.taskDirectory);
  atomicWriteJson(statePath, next);
  return next;
}

export function syncProductManagerPlan(taskDirectory) {
  const canonical = assertCanonicalTaskDirectory(taskDirectory);
  const task = readJson(canonical.taskPath);
  const implementPath = path.join(canonical.taskDirectory, "implement.md");
  if (!existsSync(implementPath)) {
    throw new Error("Canonical Trellis implement.md is required for pm sync-plan.");
  }
  const implement = readFileSync(implementPath, "utf8");
  const planDigest = sha256(implement);
  const parsed = parseMilestones(implement);
  const current = readProductManagerState(canonical.taskDirectory, {
    required: false,
  });
  if (current?.planDigest === planDigest) return current;
  const previous = new Map(
    (current?.milestones ?? []).map((milestone) => [milestone.id, milestone]),
  );
  const milestones = parsed.map((milestone) => {
    const existing = previous.get(milestone.id);
    return {
      id: milestone.id,
      title: milestone.title,
      weight: milestone.weight,
      status: existing?.status ?? "not_started",
      pmVerdict: existing?.pmVerdict ?? null,
      pmReview: existing?.pmReview ?? null,
      userAcceptance: existing?.userAcceptance ?? null,
      evidenceRefs: existing?.evidenceRefs ?? [],
      reviewStale: Boolean(current && existing?.pmReview),
      evidenceGap: existing?.evidenceGap ?? false,
      majorRisk: existing?.majorRisk ?? false,
    };
  });
  const nextMilestone = milestones.find(
    (milestone) =>
      !["completed", "user_overridden"].includes(milestone.status),
  );
  const next = {
    schemaVersion: 1,
    taskId: task.id,
    stateRevision: current?.stateRevision ?? 0,
    planRevision: (current?.planRevision ?? 0) + 1,
    planDigest,
    milestones,
    currentGate: null,
    finalReview: null,
    progress: calculateProgress(milestones),
    nextAction: nextMilestone
      ? `Implement ${nextMilestone.id}: ${nextMilestone.title}`
      : "No milestone available.",
    latestAdvice: current?.latestAdvice ?? null,
    history: [
      ...(current?.history ?? []),
      {
        type: "plan_synced",
        planRevision: (current?.planRevision ?? 0) + 1,
        planDigest,
        recordedAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  return writeProductManagerState(
    canonical.taskDirectory,
    next,
    current?.stateRevision ?? 0,
  );
}

export function prepareProductManagerReview(
  repoRoot,
  taskDirectory,
  {
    triggerType,
    checkpointId,
    evidenceRefs = [],
    grillHandoff = null,
  },
) {
  if (!REVIEW_TRIGGERS.has(triggerType)) {
    throw new Error(`Unsupported product-manager trigger ${triggerType}.`);
  }
  if (
    typeof checkpointId !== "string" ||
    !checkpointId.trim() ||
    !Array.isArray(evidenceRefs) ||
    evidenceRefs.some((value) => typeof value !== "string")
  ) {
    throw new Error("Product-manager checkpoint and evidence refs are invalid.");
  }
  if (
    grillHandoff !== null &&
    (
      typeof grillHandoff !== "object" ||
      Array.isArray(grillHandoff)
    )
  ) {
    throw new Error("GRILL_HANDOFF must be a task-artifact object.");
  }
  const canonical = assertCanonicalTaskDirectory(taskDirectory);
  const task = readJson(canonical.taskPath);
  const state = readProductManagerState(canonical.taskDirectory);
  const prdPath = path.join(canonical.taskDirectory, "prd.md");
  const designPath = path.join(canonical.taskDirectory, "design.md");
  const implementPath = path.join(canonical.taskDirectory, "implement.md");
  const artifacts = Object.fromEntries(
    [
      ["prd.md", prdPath],
      ["design.md", designPath],
      ["implement.md", implementPath],
    ]
      .filter(([, file]) => existsSync(file))
      .map(([name, file]) => [
        name,
        {
          path: path.relative(repoRoot, file).replaceAll("\\", "/"),
          sha256: sha256(readFileSync(file, "utf8")),
        },
      ]),
  );
  const milestone =
    state.milestones.find((item) => item.id === checkpointId) ?? null;
  const evidenceDigest = sha256(canonicalJson([...evidenceRefs].sort()));
  const completionMatrix =
    triggerType === "FINAL_REVIEW"
      ? state.milestones.map((item) => ({
          requirement: item.id,
          deliverable: item.title,
          status: item.status,
          pmVerdict: item.pmVerdict,
          userDecision: item.userAcceptance?.decision ?? null,
          evidenceRefs: item.evidenceRefs,
        }))
      : null;
  const base = {
    contract_version: "1",
    task_id: task.id,
    trigger_type: triggerType,
    checkpoint_id: checkpointId,
    plan_revision: state.planRevision,
    evidence_digest: evidenceDigest,
    user_request: String(task.description || task.title || task.id),
    product_brief: artifacts["prd.md"]
      ? { artifact: artifacts["prd.md"] }
      : null,
    grill_handoff: grillHandoff,
    approved_plan: {
      artifact: artifacts["implement.md"],
      milestones: state.milestones.map(({ id, title, weight, status }) => ({
        id,
        title,
        weight,
        status,
      })),
      completion_matrix: completionMatrix,
    },
    current_milestone: milestone
      ? {
          id: milestone.id,
          title: milestone.title,
          weight: milestone.weight,
          status: milestone.status,
        }
      : null,
    repository_facts: [
      { lifecycle_authority: "trellis" },
      { workspace_writer: "codex" },
      { artifacts },
    ],
    evidence_refs: [...evidenceRefs],
    risks: state.milestones
      .filter((item) => item.majorRisk)
      .map((item) => ({ milestone: item.id, kind: "major_risk" })),
    drift: state.milestones
      .filter((item) => item.reviewStale)
      .map((item) => ({ milestone: item.id, kind: "stale_review" })),
    user_feedback: state.history.filter(
      (entry) => entry.type === "user_response",
    ),
    historical_overrides: state.milestones
      .filter((item) => item.status === "user_overridden")
      .map((item) => ({ milestone: item.id, decision: item.userAcceptance })),
    previous_review: milestone?.pmReview ?? null,
  };
  const inputDigest = sha256(canonicalJson(base));
  const input = {
    ...base,
    input_digest: inputDigest,
  };
  const invocationKey = createInvocationKey(input);
  return {
    input,
    invocationKey,
    repoRoot: path.resolve(repoRoot),
    stateRevision: state.stateRevision,
    planDigest: state.planDigest,
  };
}

function assertReviewIdentity(prepared, response) {
  if (!response || typeof response !== "object") {
    throw new Error("Product-manager response must be an object.");
  }
  for (const [field, expected] of Object.entries(
    invocationIdentity(prepared.input),
  )) {
    if (response[field] !== expected) {
      throw new Error(`Stale product-manager response: ${field} mismatch.`);
    }
  }
  if (response.invocation_key !== prepared.invocationKey) {
    throw new Error(
      "Stale product-manager response: invocation_key mismatch.",
    );
  }
  if (!PM_VERDICTS.has(response.verdict)) {
    throw new Error("Product-manager response verdict is invalid.");
  }
  if (
    !response.provider_identity ||
    !["codex", "gemini", "claude"].includes(
      response.provider_identity.provider,
    )
  ) {
    throw new Error("Product-manager response provider identity is invalid.");
  }
  if (
    typeof response.recommended_next_action !== "string" ||
    !response.recommended_next_action.trim()
  ) {
    throw new Error(
      "Product-manager response requires one recommended next action.",
    );
  }
  if (
    typeof response.user_acceptance_summary !== "string" ||
    !response.user_acceptance_summary.trim() ||
    !Array.isArray(response.findings) ||
    !Array.isArray(response.risks) ||
    !Array.isArray(response.process_adjustments) ||
    !Array.isArray(response.evidence_refs) ||
    response.evidence_refs.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      "Product-manager response requires a statement, findings, risks, process adjustments, and evidence refs.",
    );
  }
}

function assertPreparedReviewIsCurrent(taskDirectory, prepared) {
  const current = prepareProductManagerReview(
    prepared.repoRoot,
    taskDirectory,
    {
      triggerType: prepared.input.trigger_type,
      checkpointId: prepared.input.checkpoint_id,
      evidenceRefs: prepared.input.evidence_refs,
      grillHandoff: prepared.input.grill_handoff,
    },
  );
  if (
    current.invocationKey !== prepared.invocationKey ||
    current.input.input_digest !== prepared.input.input_digest ||
    current.input.evidence_digest !== prepared.input.evidence_digest ||
    current.stateRevision !== prepared.stateRevision ||
    current.planDigest !== prepared.planDigest
  ) {
    throw new Error(
      "Stale product-manager response: current input or evidence identity changed.",
    );
  }
}

function acceptanceCard(milestone, response, state) {
  return {
    goal: milestone?.title ?? "Final product acceptance",
    productManagerStatement: response.user_acceptance_summary,
    delivered: response.user_acceptance_summary,
    userVisibleChange: response.user_acceptance_summary,
    shortestValidation: response.user_acceptance_summary,
    expectedResult: response.verdict === "accepted"
      ? "The milestone matches the approved product outcome."
      : "Choose remediation or explicitly override the recorded risk.",
    engineeringEvidence: response.evidence_refs,
    findings: response.findings,
    remainingRisks: response.risks,
    processAdjustments: response.process_adjustments,
    pmVerdict: response.verdict,
    progress: calculateProgress(state.milestones),
    recommendedNextAction: response.recommended_next_action,
    nextAction: response.recommended_next_action,
    responses: [
      "验收通过",
      "验收不通过：原因",
      "忽略风险并继续",
    ],
  };
}

function canMergeFinalAcceptance(state, milestone, prepared, response) {
  const lastMilestone = state.milestones.at(-1);
  return (
    milestone !== undefined &&
    lastMilestone?.id === milestone.id &&
    milestone.status === "awaiting_user_acceptance" &&
    milestone.pmVerdict === "accepted" &&
    milestone.pmReview?.evidenceDigest === response.evidence_digest &&
    state.planRevision === prepared.input.plan_revision &&
    response.verdict === "accepted" &&
    Array.isArray(response.risks) &&
    response.risks.length === 0 &&
    response.material_change_proposal === null &&
    response.reopen_request === null
  );
}

export function applyProductManagerReview(taskDirectory, prepared, response) {
  assertReviewIdentity(prepared, response);
  assertPreparedReviewIsCurrent(taskDirectory, prepared);
  const state = readProductManagerState(taskDirectory);
  if (
    state.stateRevision !== prepared.stateRevision ||
    state.planRevision !== prepared.input.plan_revision ||
    state.planDigest !== prepared.planDigest
  ) {
    throw new Error(
      "Stale product-manager response: canonical state or plan changed.",
    );
  }
  const milestone = state.milestones.find(
    (item) => item.id === prepared.input.checkpoint_id,
  );
  if (
    prepared.input.trigger_type === "MILESTONE_REVIEW" &&
    !milestone
  ) {
    throw new Error("Stale product-manager response: milestone is missing.");
  }
  const review = {
    ...createAdviceProjection(response),
    invocationKey: prepared.invocationKey,
    inputDigest: response.input_digest,
    evidenceDigest: response.evidence_digest,
  };
  state.latestAdvice = createAdviceProjection(response);
  if (prepared.input.trigger_type === "FINAL_REVIEW") {
    const merged = canMergeFinalAcceptance(
      state,
      milestone,
      prepared,
      response,
    );
    if (
      state.currentGate?.status === "awaiting_user_acceptance" &&
      !merged
    ) {
      throw new Error(
        "FINAL_REVIEW cannot replace a pending milestone acceptance gate.",
      );
    }
    state.finalReview = {
      ...state.finalReview,
      ...review,
      verdict: response.verdict,
      requiredGatesPassed:
        state.finalReview?.requiredGatesPassed === true,
      blockers: state.finalReview?.blockers ?? [],
      userAccepted: false,
      userOverridden: false,
      mergedWithMilestone: merged ? milestone.id : null,
      completionMatrix:
        prepared.input.approved_plan.completion_matrix,
    };
  } else if (
    prepared.input.trigger_type === "MILESTONE_REVIEW" &&
    milestone
  ) {
    milestone.pmVerdict = response.verdict;
    milestone.pmReview = review;
    milestone.reviewStale = false;
    milestone.evidenceRefs = response.evidence_refs;
    milestone.status =
      response.verdict === "accepted"
        ? "awaiting_user_acceptance"
        : "blocked";
  }
  const decisionTrigger = [
    "INTAKE_REVIEW",
    "PLAN_REVIEW",
    "DRIFT_REVIEW",
  ].includes(prepared.input.trigger_type);
  const needsDecisionGate =
    decisionTrigger &&
    (
      ["needs_user_decision", "reopen_request", "unavailable"].includes(
        response.verdict,
      ) ||
      response.material_change_proposal !== null
    );
  if (decisionTrigger && !needsDecisionGate) {
    state.currentGate = null;
    state.nextAction = response.recommended_next_action;
    state.history.push({
      type: "product_manager_review",
      checkpointId: prepared.input.checkpoint_id,
      triggerType: prepared.input.trigger_type,
      invocationKey: prepared.invocationKey,
      verdict: response.verdict,
      recordedAt: new Date().toISOString(),
    });
    return writeProductManagerState(
      taskDirectory,
      state,
      prepared.stateRevision,
    );
  }
  const gateKind =
    prepared.input.trigger_type === "FINAL_REVIEW"
      ? state.finalReview?.mergedWithMilestone
        ? "merged"
        : "final"
      : needsDecisionGate
        ? "decision"
        : "milestone";
  state.currentGate = {
    kind: gateKind,
    checkpointId: prepared.input.checkpoint_id,
    status: "awaiting_user_acceptance",
    invocationKey: prepared.invocationKey,
    pmVerdict: response.verdict,
    acceptanceCard: acceptanceCard(milestone, response, state),
    presentationRequired: true,
    presentedAt: null,
    presentedStateRevision: null,
    presentationDigest: null,
  };
  state.nextAction =
    response.verdict === "accepted"
      ? `Wait indefinitely for user acceptance of ${prepared.input.checkpoint_id}.`
      : `Remediate or explicitly override ${prepared.input.checkpoint_id}.`;
  state.history.push({
    type: "product_manager_review",
    checkpointId: prepared.input.checkpoint_id,
    triggerType: prepared.input.trigger_type,
    invocationKey: prepared.invocationKey,
    verdict: response.verdict,
    recordedAt: new Date().toISOString(),
  });
  return writeProductManagerState(
    taskDirectory,
    state,
    prepared.stateRevision,
  );
}

function parseRuntimeVersion(value) {
  const match = String(value || "").match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

function allowedProvidersFromContract(contract) {
  const configured = contract.productManager?.allowedProviders;
  if (!Array.isArray(configured)) {
    throw new Error(
      "Harness adapter contract is missing productManager.allowedProviders.",
    );
  }
  const allowed = configured.filter((provider) => {
    if (!["codex", "gemini", "claude"].includes(provider)) return false;
    const capability = contract.productManager?.providerCapabilities?.[provider];
    return (
      capability?.readOnly === true &&
      capability?.workspaceWrite === false &&
      capability?.terminal === false &&
      capability?.subagents === false &&
      capability?.network === "explicit-per-call" &&
      capability?.paid === "explicit-per-call"
    );
  });
  return allowed;
}

export async function runInstalledProductManagerReview(
  repoRoot,
  taskDirectory,
  {
    triggerType,
    checkpointId,
    evidenceRefs = [],
    grillHandoff = null,
    responseFile,
    allowProviderCall = false,
    runner = defaultRunner,
    resolveCommand = resolveTrustedCommand,
    discoverRoots = discoverTrustedCommandRoots,
    env = process.env,
  },
) {
  const contract = readJson(path.join(repoRoot, ".harness", "adapter.json"));
  const sources = readJson(path.join(repoRoot, "harness.sources.json"));
  const allowedProviders = allowedProvidersFromContract(contract);
  if (allowedProviders.length === 0) {
    throw new Error(
      "Harness policy allows no independently read-only product-manager provider.",
    );
  }
  const roots = await discoverRoots(["ccg"], { env });
  const binding = await resolveCommand("ccg", {
    env,
    approvedPackageRoots: roots.approvedPackageRoots,
    approvedCommandRoots: roots.approvedCommandRoots,
  });
  if (
    !binding ||
    !path.isAbsolute(binding.command) ||
    !Array.isArray(binding.argsPrefix)
  ) {
    throw new Error(
      "Installed CCG runtime does not have a trusted absolute command binding.",
    );
  }
  const runtimeArgs = [...binding.argsPrefix, "--version"];
  const runtime = runCommand(binding.command, runtimeArgs, {
    repoRoot,
    runner,
    env,
  });
  if (runtime.status !== 0) {
    throw new Error(
      commandError(binding.command, runtimeArgs, runtime),
    );
  }
  const actualVersion = parseRuntimeVersion(runtime.stdout);
  if (actualVersion !== sources.ccg.version) {
    throw new Error(
      `Installed CCG runtime drift: expected ${sources.ccg.version}, actual ${actualVersion ?? "unknown"}.`,
    );
  }
  const prepared = prepareProductManagerReview(
    repoRoot,
    taskDirectory,
    { triggerType, checkpointId, evidenceRefs, grillHandoff },
  );
  const token = acquireProductManagerLock(
    taskDirectory,
    prepared.invocationKey,
  );
  const paths = productManagerCallPaths(
    taskDirectory,
    prepared.invocationKey,
  );
  const createdAt = new Date().toISOString();
  let response = null;
  try {
    atomicWriteJson(paths.inputPath, redactValue(prepared.input));
    atomicWriteJson(paths.providerRequestPath, {
      invocation_key: prepared.invocationKey,
      allowed_providers: allowedProviders,
      mode: responseFile
        ? "recorded-response"
        : allowProviderCall
          ? "live-provider-call"
          : "authorization-required",
      provider_call_authorized: Boolean(allowProviderCall),
      requested_at: createdAt,
    });
    updateProductManagerCallStatus(paths, {
      status: "pending",
      task_id: prepared.input.task_id,
      checkpoint_id: prepared.input.checkpoint_id,
      plan_revision: prepared.input.plan_revision,
      invocation_key: prepared.invocationKey,
      input_digest: prepared.input.input_digest,
      evidence_digest: prepared.input.evidence_digest,
      provider: null,
      model: null,
      cli_version: actualVersion,
      contract_version: prepared.input.contract_version,
      created_at: createdAt,
      heartbeat_at: createdAt,
      completed_at: null,
      result_summary: null,
      canonical_projection_revision: null,
    });
    const args = [
      "product-manager",
      "review",
      "--input",
      paths.inputPath,
      "--task-dir",
      path.resolve(taskDirectory),
      "--allowed-providers",
      allowedProviders.join(","),
      "--json",
    ];
    if (responseFile) {
      args.push("--response", path.resolve(responseFile));
    } else if (allowProviderCall) {
      args.push("--allow-provider-call");
    }
    const boundArgs = [...binding.argsPrefix, ...args];
    const result = runCommand(binding.command, boundArgs, {
      repoRoot,
      runner,
      env,
    });
    if (result.status !== 0) {
      throw new Error(
        commandError(binding.command, boundArgs, result),
      );
    }
    atomicWriteText(
      paths.rawResponsePath,
      `${redactString(result.stdout)}\n`,
    );
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw new Error("Installed CCG product-manager returned malformed JSON.");
    }
    atomicWriteJson(paths.resultPath, redactValue(response));
    const projected = applyProductManagerReview(
      taskDirectory,
      prepared,
      response,
    );
    updateProductManagerCallStatus(paths, {
      status: response.verdict === "unavailable" ? "failed" : "completed",
      provider: response.provider_identity?.provider ?? null,
      model: response.provider_identity?.model ?? null,
      cli_version: response.provider_identity?.cli_version ?? actualVersion,
      heartbeat_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result_summary: {
        verdict: response.verdict,
        recommended_next_action: response.recommended_next_action,
      },
      canonical_projection_revision: projected.stateRevision,
    });
    return projected;
  } catch (error) {
    const stale = /stale/i.test(String(error));
    updateProductManagerCallStatus(paths, {
      status: stale ? "stale" : "failed",
      heartbeat_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result_summary: {
        error: redactString(error instanceof Error ? error.message : String(error)),
      },
      canonical_projection_revision: null,
    });
    throw error;
  } finally {
    releaseProductManagerLock(token);
  }
}

function normalizeUserResponse(response) {
  const value = String(response || "").trim();
  if (value === "验收通过") return { kind: "accepted", reason: null };
  if (value.startsWith("验收不通过：") || value.startsWith("验收不通过:")) {
    const reason = value.replace(/^验收不通过[：:]\s*/, "").trim();
    if (!reason) throw new Error("验收不通过 requires a reason.");
    return { kind: "rejected", reason };
  }
  if (value === "忽略风险并继续") {
    return { kind: "overridden", reason: "User explicitly accepted the risk." };
  }
  throw new Error(
    "Response must be 验收通过, 验收不通过：原因, or 忽略风险并继续.",
  );
}

function markReviewPresented(state, invocationKey, presentedAt) {
  for (const milestone of state.milestones) {
    if (milestone.pmReview?.invocationKey === invocationKey) {
      milestone.pmReview.presentedAt = presentedAt;
    }
  }
  if (state.finalReview?.invocationKey === invocationKey) {
    state.finalReview.presentedAt = presentedAt;
  }
}

function assertPresentableAdvice(state) {
  if (!state.latestAdvice) {
    throw new Error("No product-manager advice is available to present.");
  }
  const gate = state.currentGate;
  if (
    gate &&
    (
      gate.status !== "awaiting_user_acceptance" ||
      gate.invocationKey !== state.latestAdvice.invocationKey
    )
  ) {
    throw new Error(
      "Pending product-manager gate does not match the latest advice.",
    );
  }
  return gate;
}

function wasAdvicePresentedAtCurrentRevision(state, gate) {
  return Boolean(
    state.latestAdvice.presentedAt &&
    (
      !gate ||
      gate.presentedStateRevision === state.stateRevision
    ),
  );
}

function recordAdvicePresentation(state, gate, expectedRevision) {
  const presentedAt = new Date().toISOString();
  state.latestAdvice.presentedAt = presentedAt;
  markReviewPresented(
    state,
    state.latestAdvice.invocationKey,
    presentedAt,
  );
  if (gate) {
    gate.presentationRequired = true;
    gate.presentedAt = presentedAt;
    gate.presentedStateRevision = expectedRevision + 1;
    gate.presentationDigest = sha256(
      canonicalJson({
        advice: state.latestAdvice,
        acceptanceCard: gate.acceptanceCard,
      }),
    );
  }
  state.history.push({
    type: "product_manager_advice_presented",
    checkpointId: state.latestAdvice.checkpointId,
    invocationKey: state.latestAdvice.invocationKey,
    presentationDigest: gate?.presentationDigest ?? sha256(
      canonicalJson(state.latestAdvice),
    ),
    recordedAt: presentedAt,
  });
}

export function presentProductManagerGate(
  taskDirectory,
  { expectedRevision },
) {
  const state = readProductManagerState(taskDirectory);
  if (expectedRevision !== state.stateRevision) {
    throw new Error(
      `Product-manager state revision conflict: expected ${expectedRevision}, actual ${state.stateRevision}.`,
    );
  }
  const gate = assertPresentableAdvice(state);
  if (wasAdvicePresentedAtCurrentRevision(state, gate)) return state;
  recordAdvicePresentation(state, gate, expectedRevision);
  return writeProductManagerState(
    taskDirectory,
    state,
    expectedRevision,
  );
}

export function respondToProductManagerGate(
  taskDirectory,
  { response, expectedRevision },
) {
  const state = readProductManagerState(taskDirectory);
  if (expectedRevision !== state.stateRevision) {
    throw new Error(
      `Product-manager state revision conflict: expected ${expectedRevision}, actual ${state.stateRevision}.`,
    );
  }
  const gate = state.currentGate;
  if (!gate || gate.status !== "awaiting_user_acceptance") {
    throw new Error("No product-manager user-acceptance gate is pending.");
  }
  if (
    gate.presentationRequired !== true ||
    typeof gate.presentedAt !== "string" ||
    Number.isNaN(Date.parse(gate.presentedAt)) ||
    gate.presentedStateRevision !== state.stateRevision ||
    !/^[a-f0-9]{64}$/.test(gate.presentationDigest)
  ) {
    throw new Error(
      "Product-manager advice must be presented with pm present before accepting a fresh user response.",
    );
  }
  const decision = normalizeUserResponse(response);
  const milestone = state.milestones.find(
    (item) => item.id === gate.checkpointId,
  );
  if (
    !milestone &&
    !["final", "decision"].includes(gate.kind)
  ) {
    throw new Error(`Pending checkpoint ${gate.checkpointId} is missing.`);
  }
  if (
    decision.kind === "accepted" &&
    gate.kind !== "decision" &&
    (gate.pmVerdict ?? milestone?.pmVerdict) !== "accepted"
  ) {
    throw new Error(
      "A rejected or unavailable product-manager verdict requires remediation or 忽略风险并继续.",
    );
  }
  if (
    decision.kind === "accepted" &&
    gate.kind === "decision" &&
    gate.pmVerdict === "unavailable"
  ) {
    throw new Error(
      "An unavailable product-manager verdict requires retry or 忽略风险并继续.",
    );
  }
  if (milestone) {
    milestone.status =
      decision.kind === "accepted"
        ? "completed"
        : decision.kind === "rejected"
          ? "in_progress"
          : "user_overridden";
    milestone.userAcceptance = {
      decision: decision.kind,
      reason: decision.reason,
      recordedAt: new Date().toISOString(),
    };
  }
  if (gate.kind === "final" || gate.kind === "merged") {
    state.finalReview ??= {};
    state.finalReview.userAccepted = decision.kind === "accepted";
    state.finalReview.userOverridden = decision.kind === "overridden";
    state.finalReview.userDecision = {
      decision: decision.kind,
      reason: decision.reason,
      recordedAt: new Date().toISOString(),
    };
  }
  state.currentGate = null;
  const next = state.milestones.find(
    (item) => !["completed", "user_overridden"].includes(item.status),
  );
  state.nextAction =
    decision.kind === "rejected"
      ? `Remediate ${gate.checkpointId}: ${decision.reason}`
      : next
        ? `Resume ${next.id}: ${next.title}`
        : "Prepare FINAL_REVIEW.";
  state.history.push({
    type: "user_response",
    checkpointId: gate.checkpointId,
    decision: decision.kind,
    reason: decision.reason,
    recordedAt: new Date().toISOString(),
  });
  return writeProductManagerState(
    taskDirectory,
    state,
    expectedRevision,
  );
}

export function determineProductManagerFinalEligibility(state) {
  const reasons = [];
  for (const milestone of state.milestones) {
    if (!["completed", "user_overridden"].includes(milestone.status)) {
      reasons.push(`${milestone.id}:${milestone.status}`);
    }
    if (
      ["completed", "user_overridden"].includes(milestone.status) &&
      (!Array.isArray(milestone.evidenceRefs) ||
        milestone.evidenceRefs.length === 0)
    ) {
      reasons.push(`${milestone.id}:evidence_missing`);
    }
  }
  const final = state.finalReview ?? {};
  if (final.verdict !== "accepted") reasons.push("final_verdict:missing");
  if (final.userAccepted !== true && final.userOverridden !== true) {
    reasons.push("final_user_acceptance:missing");
  }
  if (final.requiredGatesPassed !== true) reasons.push("required_gates:failed");
  if (!Array.isArray(final.evidenceRefs) || final.evidenceRefs.length === 0) {
    reasons.push("final_evidence:missing");
  }
  reasons.push(...(Array.isArray(final.blockers) ? final.blockers : []));
  if (reasons.length > 0) {
    return { eligible: false, conclusion: "blocked", reasons };
  }
  const overrides = new Set(
    state.milestones
      .filter((milestone) => milestone.status === "user_overridden")
      .map((milestone) => `${milestone.id}:user_overridden`),
  );
  for (const entry of state.history) {
    if (
      entry.type === "user_response" &&
      entry.decision === "overridden" &&
      typeof entry.checkpointId === "string"
    ) {
      overrides.add(`${entry.checkpointId}:user_overridden`);
    }
  }
  if (final.userOverridden) overrides.add("FINAL:user_overridden");
  return {
    eligible: true,
    conclusion:
      overrides.size > 0 ? "completed_with_overrides" : "completed",
    reasons: [...overrides],
  };
}

export function buildProductManagerStatus(taskDirectory) {
  const state = readProductManagerState(taskDirectory);
  return {
    schemaVersion: 1,
    taskId: state.taskId,
    stateRevision: state.stateRevision,
    planRevision: state.planRevision,
    planDigest: state.planDigest,
    milestones: state.milestones,
    currentGate: state.currentGate,
    progress: calculateProgress(state.milestones),
    nextAction: state.nextAction,
    latestAdvice: state.latestAdvice
      ? {
          ...state.latestAdvice,
          stale: state.latestAdvice.planRevision !== state.planRevision,
        }
      : null,
    finalEligibility: determineProductManagerFinalEligibility(state),
  };
}

export function acquireProductManagerLock(
  taskDirectory,
  invocationKey,
  { staleAfterMs = 5 * 60_000 } = {},
) {
  const canonical = assertCanonicalTaskDirectory(taskDirectory);
  if (!/^[a-f0-9]{64}$/.test(invocationKey)) {
    throw new Error("Product-manager invocation key must be a SHA-256 digest.");
  }
  const root = path.join(
    canonical.taskDirectory,
    ".ccg-evidence",
    "product-manager",
    "projection-locks",
  );
  assertInside(canonical.taskDirectory, root, "Product-manager lock root");
  mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, `${invocationKey}.lock`);
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = openSync(lockPath, "wx", 0o600);
      writeFileSync(
        handle,
        `${canonicalJson({
          invocationKey,
          nonce,
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        })}\n`,
      );
      closeSync(handle);
      return { lockPath, invocationKey, nonce };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - statSync(lockPath).mtimeMs <= staleAfterMs) {
        throw new Error(
          `Product-manager invocation ${invocationKey} is already in progress.`,
        );
      }
      let owner = null;
      try {
        owner = readJson(lockPath);
      } catch {
        // A malformed, expired crash residue has no trusted live owner.
      }
      if (isLiveProcess(owner?.pid)) {
        throw new Error(
          `Product-manager invocation ${invocationKey} is already in progress.`,
        );
      }
      const stalePath = `${lockPath}.stale-${Date.now()}-${randomUUID()}`;
      try {
        renameSync(lockPath, stalePath);
        rmSync(stalePath, { force: true });
      } catch (renameError) {
        if (renameError?.code === "ENOENT") continue;
        throw renameError;
      }
    }
  }
  throw new Error(`Could not acquire product-manager lock ${invocationKey}.`);
}

function isLiveProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function heartbeatProductManagerLock(token) {
  const current = readJson(token.lockPath);
  if (current.nonce !== token.nonce) {
    throw new Error("Product-manager lock ownership changed.");
  }
  const now = new Date();
  utimesSync(token.lockPath, now, now);
}

export function releaseProductManagerLock(token) {
  if (!existsSync(token.lockPath)) return;
  const current = readJson(token.lockPath);
  if (current.nonce !== token.nonce) {
    throw new Error("Product-manager lock ownership changed.");
  }
  unlinkSync(token.lockPath);
}
