---
name: trellis-brainstorm
description: "Plan a structured Trellis task, record its requirements/design/execution artifacts, and obtain implementation approval after review."
---

# Trellis Brainstorm

Follow Request Triage and Planning Artifacts in `.trellis/workflow.md`. Structured tasks use planning before implementation. Fast-lane work does not need task artifacts or a planning approval exchange.

For structured work, reuse the matching task. Create one only with task-creation consent already given or obtained. Creating a task and approving implementation are separate decisions. Present the completed planning artifacts and wait for explicit approval before `task.py start`.

1. Record the user's accepted outcome, scope, constraints and observable acceptance in `prd.md`.
2. Inspect code, tests, configs, specs and task history to answer repository questions. Distinguish observed facts from unresolved product intent; existing code is evidence, not permission to change scope.
3. Ask only for a remaining material product, UX, compatibility, data or risk decision. Give a concise recommendation and tradeoff. Continue independent work while waiting; do not implement behavior dependent on the missing answer.
4. Complex tasks must have `prd.md`, `design.md`, and `implement.md`: requirements and acceptance, technical contracts/tradeoffs, then ordered execution/verification/rollback. Lightweight tasks may be PRD-only. Additional research or Provider work must name its trigger fact, required output and stop condition.
5. Check that acceptance is testable, the plan is implementable and blocking decisions are resolved. Remove duplicate or obsolete planning text only when present; do not mandate a full rewrite on every task.
6. Present the completed artifacts for review and wait for explicit implementation approval. Only after that response and resolution of pending hard gates may the task start; task-creation approval or a generic request to continue is insufficient.

Preserve product-manager hard gates: present the exact pending review and await a fresh explicit response. Existing blanket authorization does not answer such a gate.

Use first-principles analysis when choices are unclear: state the observed problem, required behavior and constraints; remove proposed mechanisms with no supporting fact. Stop when the smallest plan meets those constraints. Do not create research files, child tasks, Provider calls or sub-agents without a concrete need and their required authorization.
