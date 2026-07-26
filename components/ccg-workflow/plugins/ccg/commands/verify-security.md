---
description: "Scan code for security risks and dangerous patterns"
argument-hint: "<scan-path>"
allowed-tools: [Read, Glob, Grep, Bash]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow verify-security --phase quality-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

The route itself decides whether an external trigger exists; local-only quality work records a skip and performs no Grok model call. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Verify Security

Use the `verify-security` skill bundled with this plugin.

Scan the requested path for security risks. Critical and High findings must be fixed or explicitly reported.
