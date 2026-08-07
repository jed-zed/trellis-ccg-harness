---
name: optimize
description: Optimize performance, maintainability, or workflow bottlenecks with measured Codex-owned changes. Use when the user invokes /ccg:optimize.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow optimize --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Optimize

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:optimize` command.

## Behavior

- Identify the optimization target and current bottleneck before editing.
- Prefer measurements, profiler output, tests, or static evidence over speculation.
- Preserve public behavior unless the user explicitly requests behavior changes.
- Follow the shared **Companion Role Contract** when resolving roles for
  alternatives and regression-risk review. If a selected provider is Gemini,
  use the bundled preview helper with `--prompt-template optimizer`.
- Codex owns final edits, benchmarks/tests, diff review, and Chinese delivery.

## Verification

- Run the smallest meaningful performance, build, test, or static check that proves the optimization did not break behavior.
- Report any missing benchmark or measurement limitation.
