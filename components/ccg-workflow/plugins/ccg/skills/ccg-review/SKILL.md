---
name: review
description: Review a CCG implementation with the applicable frontend, backend, or search providers and Codex as final verification owner. Use when the user invokes /ccg:review or asks for CCG review of a diff/plan.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For final review append --trigger final_diff_verify and bind the actual --diff plus any --plan, --target, and --dependency files. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Review

Load and follow `skills/ccg-executor/SKILL.md`.

Review the current diff or the implementation associated with the supplied
plan/task. Read `../../rules/ccg-role-routing.md`, classify changed areas as
frontend, backend, search, or a combination, then resolve those top-level
providers. Review is a phase inside each role. Have Codex verify every finding
before reporting it.

When a selected provider is Gemini, call the bundled preview helper with
`--prompt-template review`; do not call the raw Gemini CLI. For another
provider, use the existing adapter described by the routing rule. If required
external review evidence is missing, say so and do not claim it occurred.
