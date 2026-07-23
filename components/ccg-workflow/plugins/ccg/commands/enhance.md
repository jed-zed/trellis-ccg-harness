---
description: "Enhance an existing feature while preserving current behavior and repository patterns"
argument-hint: "<enhancement-request>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow enhance --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Enhance

The user invoked:

```text
/ccg:enhance $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:enhance`.

Codex should identify current behavior first, keep the change scoped, and verify regressions. Gemini may assist with UX, edge cases, or review through the bundled browser preview helper.
