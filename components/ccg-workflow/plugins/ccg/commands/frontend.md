---
description: "Build or review frontend/UI work with the configured frontend provider"
argument-hint: "<frontend-task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow frontend --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Frontend

The user invoked:

```text
/ccg:frontend $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:frontend`.

Resolve `ccg routing get frontend --json`, use that provider for the bounded UI
draft or review, and keep Codex responsible for final edits and verification.
