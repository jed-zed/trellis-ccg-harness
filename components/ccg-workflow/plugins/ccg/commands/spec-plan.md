---
description: "Create a Codex-native plan from a CCG spec"
argument-hint: "<spec-name>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow spec-plan --phase spec-plan --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Spec Plan

The user invoked:

```text
/ccg:spec-plan $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:spec-plan`.

Create Chinese spec-backed plans under `.codex/ccg/specs/<name>/plan.md` and, when needed, `.codex/ccg/plans/<name>.md`. Refuse to continue when `constraints.md` is missing or invalid.
