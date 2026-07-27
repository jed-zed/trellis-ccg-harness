---
name: team
description: CCG team command index and router for Codex-native worker workflows. Use when the user invokes /ccg:team.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow team --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Team

Route team workflow requests. Codex remains final owner.

## Commands

- `/ccg:team-research <task>`
- `/ccg:team-plan <task>`
- `/ccg:team-exec <team-plan-path-or-task>`
- `/ccg:team-review <team-task-or-diff>`

## Rules

- Workers are scoped helpers with explicit ownership.
- Routed external providers remain bounded helpers.
- Same-file conflicts must be detected before dispatch.
- No worker can bypass final Codex verification.

Report in Chinese.
