---
name: team-plan
description: Create a worker ownership plan for CCG team execution. Use when the user invokes /ccg:team-plan.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow team-plan --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

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
