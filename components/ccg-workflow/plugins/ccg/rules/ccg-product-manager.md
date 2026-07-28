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
- Ordinary implementation and evidence collection do not call the product
  manager. Candidate milestone completion may create `MILESTONE_REVIEW`;
  independent analysis or review has at most one implicit final milestone.
- `FINAL_REVIEW` is prepared only after milestone evidence and required quality
  gates are complete. It does not replace the final milestone review.
- Skills, commands, hooks, and helpers report event candidates only. The current
  Codex task explicitly invokes `ccg product-manager review`, validates the
  result, applies it through the Harness adapter, and presents any user hard
  gate.
- Never create `.ccg/tasks`, another task, or a parallel plan. Never let the
  provider write the workspace, use terminal tools, control subagents, mutate
  Trellis status, or call finish/archive.
