---
name: test
description: Add, repair, or design tests with Codex as the implementer. Use when the user invokes /ccg:test or asks CCG to improve test coverage.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow test --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Test

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:test` command.

## Behavior

- Treat the user argument as a testing task: add coverage, repair failing tests, design fixtures, or improve validation.
- Inspect existing test style before adding new test infrastructure.
- Follow the shared **Companion Role Contract** when resolving roles for test
  design and test-gap review. If a selected provider is Gemini, use the bundled
  preview helper with `--prompt-template tester`.
- Codex owns final test code, test execution, failures, and Chinese delivery.

## Verification

- Run the focused tests you changed or added.
- If a full suite is too slow or blocked, run the smallest meaningful subset and report the blocker.
