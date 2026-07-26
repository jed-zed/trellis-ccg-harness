---
description: "Execute a scoped CCG team plan with Codex as final owner"
argument-hint: "<team-plan-path-or-task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow team-exec --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Team Exec

The user invoked:

```text
/ccg:team-exec $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:team-exec`.

Run `team_plan_checker.js` before dispatch, stop when `can_execute=false`, and let Codex review and verify all final changes.
