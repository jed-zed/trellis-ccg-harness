---
name: team-plan
description: Create a worker ownership plan for CCG team execution. Use when the user invokes /ccg:team-plan.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow team-plan --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Team Plan

Create `.codex/ccg/team/<task>/plan.md`.

## Required Structure

```markdown
## Workers
| Worker | Scope | Files | Constraints |
|--------|-------|-------|-------------|

## Merge Strategy
## Verification Strategy
## Conflict Risks
```

Detect same-file ownership conflicts before recommending execution. Write the plan in Chinese by default.

## Required Helper Flow

- Validate the plan structure with `../ccg-team/scripts/team_plan_checker.js summarize <plan.md> --json`.
- Run `../ccg-team/scripts/team_plan_checker.js validate <plan.md> --json` before recommending `/ccg:team-exec`.
- Keep the plan executable by ensuring every same-file conflict is paired with an explicit merge strategy, not a generic promise to reconcile later.
