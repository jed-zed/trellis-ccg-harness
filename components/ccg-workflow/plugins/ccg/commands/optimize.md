---
description: "Optimize performance, maintainability, or workflow bottlenecks with measured changes"
argument-hint: "<optimization-target>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow optimize --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Optimize

The user invoked:

```text
/ccg:optimize $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:optimize`.

Measure or inspect before changing behavior. Use the applicable frontend,
backend, and/or search providers for alternatives or missed risks; Codex
applies and verifies the final optimization.
