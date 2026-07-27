---
name: debug
description: Debug a failure with Codex-led reproduction, root-cause analysis, and focused verification. Use when the user invokes /ccg:debug or provides an error, failing test, crash, or regression.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow debug --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Debug

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:debug` command.

## Behavior

- Reproduce or localize the failure before changing code when feasible.
- Gather exact error messages, failing commands, recent diffs, and relevant files.
- Prefer small fixes that address the root cause, not broad rewrites.
- Resolve the applicable frontend, backend, and/or search role for root-cause
  analysis and second-pass review. If a selected provider is Gemini, use the
  bundled preview helper with `--prompt-template debugger` or `review`.
- Codex owns final diagnosis, edits, verification, and Chinese delivery.

## Verification

- Re-run the failing command or the smallest meaningful reproduction.
- Add or update a regression test when the failure has a stable behavior boundary.
