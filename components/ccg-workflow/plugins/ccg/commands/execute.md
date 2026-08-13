---
description: "Execute a CCG plan with Codex and configured role providers"
argument-hint: "<plan-path-or-task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow execute --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Execute - Codex Orchestrator

The user invoked:

```text
/ccg:execute $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:executor` and follow it exactly. Treat `$ARGUMENTS` as the plan path or task description.

This command is Codex-native:

- Planning may come from `/ccg:plan` or an existing CCG plan file.
- CCG plan artifacts live under `.codex/ccg/plans/*.md`.
- Codex is the orchestrator and final code owner.
- Follow the shared **Companion Role Contract** and resolve each required role
  with `ccg routing get <frontend|backend|search|product-manager> --json`.
- Use the selected provider for bounded drafting, analysis, prototypes, or
  review; Codex applies and verifies all changes.
- Claude may be explicitly selected for `frontend`, `backend`, or
  `product-manager`. It is not eligible for `search`; defaults and no-fallback
  behavior remain unchanged.
- Any Gemini delegation must use the bundled browser preview helper automatically; do not ask the user to run `/ccg:gemini-preview` first and do not call the raw Gemini CLI directly.
- For M+ or risky work, apply the active project quality gates and ask the
  applicable top-level provider to perform its analysis or review phase when
  policy requires external evidence.
