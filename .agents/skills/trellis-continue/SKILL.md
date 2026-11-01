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
- Apply `.trellis/workflow.md#shared-plan-approval` before `task.py start`; reuse actual same-scope approval and ask only for a required unapproved plan or a material decision. Inline seed-only context uses the supported `--allow-empty-context` option.
- `in_progress`: resume the first unfinished implementation or verification step. Use `trellis-check` for risk-proportionate checks and required project/CI gates across all affected behavior. Reuse passing checks for unchanged work; rerun only for a new change, failure, concrete unresolved concern or required gate. Never label an unrun check as passed.
- Acceptance met: record results and use `trellis-finish-work`. A commit, journal or extra review is not an automatic completion prerequisite.

A pending product-manager hard gate still requires presentation and a fresh explicit user response. Do not infer acceptance from a generic request to continue.

Load only missing step detail with `get_context.py --mode phase --step <X.Y> --platform codex`. Add work only for a concrete question or risk, using existing task, Git, PR and CI records; `.trellis/workflow.md` is the authority. Preserve requested independent reviews and report real blockers instead of repeating completed work or forcing completion.
