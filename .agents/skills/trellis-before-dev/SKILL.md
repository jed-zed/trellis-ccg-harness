---
name: trellis-before-dev
description: "Read the requirements and project guidelines applicable to the actual changed boundary before writing code."
---

# Before Development

Follow Request Triage in `.trellis/workflow.md`. Fast-lane edits need the request, target/callers and applicable guidelines; they do not need a task, PRD, design or plan file.

For structured work, read the owning requirements, design and execution plan. Complex tasks must have `prd.md`, `design.md`, and `implement.md`, with planning review and implementation approval completed before edits. Lightweight structured tasks may be PRD-only. Read linked research only when applicable.

Read the changed package/layer's spec index and only its relevant guidelines. Use `get_context.py --mode packages` if locations are unknown. Shared guides are needed only for a question they address; reuse context already read and refresh only changed facts.

Trace the real flow and callers before editing. Reuse existing code or standard/native capabilities. Each added guard, fallback, retry, compatibility layer, configuration or abstraction needs an accepted requirement, reproduced fault, or real trust/data boundary. Preserve input validation, security, data protection and accessibility.
