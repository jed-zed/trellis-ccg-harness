---
description: "Create a scoped worker ownership plan for CCG team execution"
argument-hint: "<task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow team-plan --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Team Plan

The user invoked:

```text
/ccg:team-plan $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:team-plan`.

Produce `.codex/ccg/team/<task>/plan.md` with workers, file ownership, merge strategy, verification, and conflict risks, then verify it with `team_plan_checker.js`.
