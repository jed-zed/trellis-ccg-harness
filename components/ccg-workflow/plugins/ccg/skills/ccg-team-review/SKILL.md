---
name: team-review
description: Review CCG team outputs, diffs, and tests. Use when the user invokes /ccg:team-review.
---

## Evidence Mode Selection

For a pure local code review, do not run or invoke Grok external-intelligence and do not apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain and run the shared route from the controller:

`ccg route --workflow team-review --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs that external-fact path, with repeated `--official-domain <domain>` chosen before Grok runs. Teammates never invoke Grok independently. Stop ordinary work on exit code `2`, `3`, or `4`.

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

Follow the shared **Companion Role Contract** for the second-pass review:
frontend or backend makes search required and evaluates the mapped
product-manager gate. Codex delivers final judgment in Chinese.
