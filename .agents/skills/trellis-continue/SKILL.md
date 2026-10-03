---
name: trellis-continue
description: "Resume the current Trellis task from its accepted requirements, plan and verification evidence without repeating completed work."
---

# Continue Current Task

Read current task state if it is not already known:

```bash
python ./.trellis/scripts/get_context.py
python ./.trellis/scripts/get_context.py --mode phase
```

Follow Request Triage in `.trellis/workflow.md` when there is no matching task. An unrelated simple question can use the fast lane without mutating the active task.

- `planning`: read requirements and planning artifacts. Complex tasks must have `prd.md`, `design.md`, and `implement.md`; missing design or implementation plans block complex-task implementation. Lightweight structured tasks may be PRD-only.
- Present completed planning artifacts and wait for explicit implementation approval before `task.py start`; task-creation consent or a generic request to continue cannot replace that review. Inline seed-only context uses the supported `--allow-empty-context` option.
- `in_progress`: resume the first unfinished implementation or verification step. Follow the project lint/typecheck/tests and coverage checklist; the final pass covers all affected task scope.
- Acceptance met: record results and use `trellis-finish-work`. A commit, journal or extra review is not an automatic completion prerequisite.

A pending product-manager hard gate still requires presentation and a fresh explicit user response. Do not infer acceptance from a generic request to continue.

Load only the missing step detail with `get_context.py --mode phase --step <X.Y> --platform codex`. Every extra step needs a trigger fact -> required output -> stop condition; `.trellis/workflow.md` is the authority.
