---
description: "Add, repair, or design tests for a target change"
argument-hint: "<test-task-or-target>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow test --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Test

The user invoked:

```text
/ccg:test $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:test`.

Codex owns test implementation and execution. Gemini may supply edge cases, fixture ideas, or review gaps through the bundled browser preview helper.
