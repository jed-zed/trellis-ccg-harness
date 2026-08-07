---
name: enhance
description: Enhance an existing feature while preserving current behavior and repository patterns. Use when the user invokes /ccg:enhance or asks CCG to improve an existing capability.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow enhance --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Enhance

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:enhance` command.

## Behavior

- Identify current behavior, user-visible contract, tests, and constraints before editing.
- Keep the enhancement scoped; avoid unrelated refactors.
- Follow the shared **Companion Role Contract** when resolving roles. Use each
  provider for its analysis and review phases. If a selected provider is
  Gemini, use the corresponding bundled prompt template.
- Codex owns final edits, tests, review, and Chinese delivery.

## Verification

- Run tests/typechecks for the touched area.
- If the enhancement changes user-facing behavior, include at least one manual or automated acceptance check.
