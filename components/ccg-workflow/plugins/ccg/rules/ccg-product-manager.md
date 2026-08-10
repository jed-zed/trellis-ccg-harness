# CCG Product Manager Event Boundary

When the current project enables the product-manager contract, Codex remains the
sole orchestrator and Trellis remains the task, requirement, plan, milestone,
and completion authority.

- Classify the command's actual effect with the 44-command mapping implemented
  by `src/product-manager/event-mapping.ts`; a command name alone never starts a
  provider call.
- New product work may create an `INTAKE_REVIEW` candidate after repository
  facts are collected. A plan draft may create a `PLAN_REVIEW` candidate before
  user approval. A material evidence, scope, risk, or plan change may create a
  `DRIFT_REVIEW` candidate.
- When a workflow uses `frontend` or `backend`, automatically evaluate its
  mapped product-manager candidate at the next eligible checkpoint. Candidate
  milestone completion may create `MILESTONE_REVIEW`; independent analysis or
  review has at most one implicit final milestone.
- `FINAL_REVIEW` is prepared only after milestone evidence and required quality
  gates are complete. It does not replace the final milestone review.
- Skills, commands, hooks, and helpers report event candidates only. The current
  Codex task explicitly invokes `ccg product-manager review`, validates the
  result, applies it through the Harness adapter, and presents any user hard
  gate.
- Candidate detection automatically opens the explicit per-call authorization
  gate. It must not silently invoke, authenticate, install, or fall back to a
  Provider. Record `authorization_required`, `declined`, `disabled`, or
  `unavailable` when no valid call completes; never fabricate review evidence.
- `product-manager` is the fourth formal CCG unified routing role. Read or
  change its selected Provider only through `ccg routing get/set
  product-manager`; `[product_manager]` stores behavior parameters only.
- Harness and project `allowedProviders` may reject the unified selection but
  must never select or fall back to another Provider.
- The Provider receives only the validated task-local workspace snapshot and
  inherits its upstream permission mode. Project transport defaults to native
  `local`; explicit `ssh` uses environment-only bridge v2 settings and never
  falls back to local.
- Never create `.ccg/tasks`, another task, or a parallel plan. Never let the
  Provider mutate the canonical workspace, Trellis status, or call
  finish/archive. Tool use inside the disposable snapshot grants no workspace
  or lifecycle authority.
