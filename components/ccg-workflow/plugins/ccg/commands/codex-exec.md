---
description: "Execute a CCG plan in Codex-led CCG mode"
argument-hint: "<plan-path>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow codex-exec --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Codex Exec

The user invoked:

```text
/ccg:codex-exec $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:executor` and follow it exactly. This command is equivalent to `/ccg:execute` in this Codex plugin: Codex reads `.codex/ccg/plans/*.md` plans, gathers context, collects explicitly allowed non-Claude evidence when required, applies final edits, verifies, reviews, and reports in Chinese.
