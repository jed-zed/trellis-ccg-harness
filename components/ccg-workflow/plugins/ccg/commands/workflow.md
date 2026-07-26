---
description: "Show the Codex-native CCG workflow"
argument-hint: "[plan-path-or-task]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow workflow --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Workflow

The user invoked:

```text
/ccg:workflow $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:executor`.

Explain or execute the Codex-native CCG workflow:

- Codex creates or revises plans with Gemini + Claude read-only analysis evidence for real planning work.
- Codex orchestrates the work and owns final code edits.
- Gemini assists with bounded code drafts, UI prototypes, edge cases, tests, or review.
- Claude assists with read-only architecture, security, backend correctness, edge cases, and review evidence when Codex-native parity rules require it.
- Codex verifies and reports in Chinese.

If `$ARGUMENTS` contains a plan path or task, route to the same behavior as `/ccg:execute`.
