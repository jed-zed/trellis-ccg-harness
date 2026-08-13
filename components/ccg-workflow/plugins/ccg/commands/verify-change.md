---
description: "Analyze change impact and documentation sync"
argument-hint: "[--mode working|staged|committed]"
allowed-tools: [Read, Glob, Grep, Bash]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow verify-change --phase quality-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

The route itself decides whether an external trigger exists; local-only quality work records a skip and performs no Grok model call. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Verify Change

Use the `verify-change` skill bundled with this plugin.

Analyze the current change set or requested mode, then report only meaningful findings in Chinese.
