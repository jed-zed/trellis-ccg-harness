---
name: trellis-start
description: "Start or resume a Trellis session by classifying the request, loading only relevant context, and routing to the fast lane or structured task workflow."
---

# Start Session

First use Request Triage in `.trellis/workflow.md`. Simple conversation, read-only local inspection, and known local low-risk edits default to the fast lane: needed context -> answer/minimal edit -> applicable quality checks -> report. Do not ask a task-creation question, create task artifacts or load the full lifecycle for these requests. Preserve an existing task and its pending gates.

Unknown impact, ambiguous requests, or a risk boundary enter the structured lane. Load current state and the compact phase index once, unless already known:

```bash
python ./.trellis/scripts/get_context.py
python ./.trellis/scripts/get_context.py --mode phase
```

If context includes `Trellis update available:`, preserve that full operational hint when reporting it; an available update does not authorize an installation.

Reuse the matching task. Obtain creation consent only if a new task is needed and consent is missing. Route `planning` to requirements, design and execution planning. Complex tasks must have `prd.md`, `design.md`, and `implement.md`; lightweight structured tasks may be PRD-only. Present the completed plan for explicit user approval before `task.py start`. Route `in_progress` to the next unfinished implementation/check step.

Read relevant spec indexes before coding; discover packages only when their location is unknown. Load step detail only when needed with `get_context.py --mode phase --step <X.Y> --platform codex`.

Use `trellis-brainstorm` for unresolved decisions, `trellis-before-dev` before edits, `trellis-check` for verification, and `trellis-finish-work` for a structured task's completion. Extra steps follow the trigger fact -> required output -> stop condition contract in workflow.md.
