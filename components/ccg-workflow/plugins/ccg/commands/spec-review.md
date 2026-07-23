---
description: "Review a CCG spec, plan, and implementation diff"
argument-hint: "<spec-name-or-path>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow spec-review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Spec Review

The user invoked:

```text
/ccg:spec-review $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:spec-review`.

Validate the spec artifacts first, then check implementation against constraints, acceptance criteria, tests, scope, and security-sensitive deltas.
