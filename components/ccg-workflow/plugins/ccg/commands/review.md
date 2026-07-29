---
description: "Review a CCG implementation with the applicable role providers"
argument-hint: "[diff-or-plan-path]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For final review append --trigger final_diff_verify and bind the actual --diff plus any --plan, --target, and --dependency files. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Review

The user invoked:

```text
/ccg:review $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:review`.

Review the current diff or the implementation associated with `$ARGUMENTS`.
Classify changed areas as frontend, backend, and/or search, then use those
top-level providers for bounded review evidence. Review is an internal phase of
each role. Codex verifies findings before reporting them. When a selected role
uses Gemini, invoke the bundled browser preview helper automatically and do not
call the raw Gemini CLI.

Claude is disabled for ordinary review delegation. It may run only when
unified CCG routing selects Claude for the isolated, read-only
`product-manager` role and the project allows the explicit provider call.
