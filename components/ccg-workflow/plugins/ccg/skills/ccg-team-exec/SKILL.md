---
name: team-exec
description: Execute a scoped CCG team plan with Codex as final owner. Use when the user invokes /ccg:team-exec.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow team-exec --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Team Exec

Execute scoped worker plans conservatively.

## Behavior

- Read `.codex/ccg/team/<task>/plan.md` when provided.
- Run `../ccg-team/scripts/team_plan_checker.js validate .codex/ccg/team/<task>/plan.md --json` before dispatch so `status.json` is refreshed.
- Refuse to dispatch when `can_execute=false`, including when multiple workers own the same file without an explicit merge strategy.
- Tell every worker they are not alone in the codebase and must not revert others' edits.
- Maintain `.codex/ccg/team/<task>/status.json` as the execution evidence artifact.
- Codex applies or reconciles final changes, reviews the diff, runs verification, and reports in Chinese.

Follow the shared **Companion Role Contract** for routed evidence: frontend or
backend makes search required and evaluates the mapped product-manager gate.
Providers remain evidence helpers and cannot own the real workspace.
