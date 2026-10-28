---
name: trellis-before-dev
description: "Read the requirements and project guidelines applicable to the actual changed boundary before writing code."
---

# Before Development

Follow Request Triage in `.trellis/workflow.md`. Fast-lane edits need the request, target/callers and applicable guidelines; they do not need a task, PRD, design or plan file.

For structured work, read the owning requirements, design and execution plan. Complex tasks must have `prd.md`, `design.md`, and `implement.md`, with planning review and implementation approval completed before edits. Lightweight structured tasks may be PRD-only. Read linked research only when applicable.

Read the changed package/layer's spec index and only its relevant guidelines. Use `get_context.py --mode packages` if locations are unknown. Shared guides are needed only for a question they address; reuse context already read and refresh only changed facts.

Trace the real flow and callers before editing. Prefer existing code, standard/native capabilities and installed dependencies; implement the smallest sufficient change. Add defensive code only for a real boundary, supported input range, concrete failure model or business invariant. Avoid mechanically repeating guarantees established internally; retain independent security controls. Do not add speculative configuration, abstraction, persistence or gates.

Fix the common root cause. Propagate clear errors without swallowing exceptions or claiming success. Keep retries bounded in one responsible layer; account for idempotency when retries or repeated calls can duplicate side effects and inspect the original operation before retrying an uncertain result. Preserve trust-boundary validation, security, data protection and accessibility.
