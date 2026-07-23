---
name: team-review
description: Review CCG team outputs, diffs, and tests. Use when the user invokes /ccg:team-review.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow team-review --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Team Review

Review team results before delivery.

## Checks

- Require `.codex/ccg/team/<task>/status.json` or `plan.md` evidence before concluding the review.
- Use `../ccg-team/scripts/team_plan_checker.js validate <plan.md> --json` when the assignment or conflict picture is unclear.
- Worker outputs match assigned scopes.
- Diff respects file ownership and merge strategy.
- Tests and verification match the plan.
- Same-file conflict risks are resolved.
- Security-sensitive changes are reviewed.

Gemini may provide a second-pass review through the preview helper; Codex delivers final judgment in Chinese.
