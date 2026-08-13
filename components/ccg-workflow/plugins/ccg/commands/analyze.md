---
description: "Analyze code, architecture, risks, or implementation options without applying changes"
argument-hint: "<analysis-request>"
allowed-tools: [Read, Glob, Grep, Bash, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow analyze --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Analyze

The user invoked:

```text
/ccg:analyze $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:analyze`.

This command is read-only unless the user later asks for implementation.
Follow the shared **Companion Role Contract**, classify the requested analysis
as frontend, backend, search, or a combination, then resolve the required
top-level roles. Analysis is an internal phase, not a provider setting.
