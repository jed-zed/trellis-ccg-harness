---
description: "Implement backend-heavy work with the configured backend provider"
argument-hint: "<backend-task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow backend --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Backend

The user invoked:

```text
/ccg:backend $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:backend`.

Follow the shared **Companion Role Contract**: resolve backend plus required
search evidence and evaluate the product-manager gate. Codex applies the final
workspace changes and verifies them.
