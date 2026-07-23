---
description: "Alias for /ccg:execute, preserving the common misspelling"
argument-hint: "<plan-path-or-task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow excute --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Excute - Alias

The user invoked:

```text
/ccg:excute $ARGUMENTS
```

This is a typo-compatible alias of `/ccg:execute`. Use the installed CCG plugin skill `ccg:executor` and follow it exactly. Treat `$ARGUMENTS` as the plan path or task description. The architecture is Codex-led: Gemini and Claude provide evidence when the Codex-native parity rules require it; Codex owns final implementation and verification.
