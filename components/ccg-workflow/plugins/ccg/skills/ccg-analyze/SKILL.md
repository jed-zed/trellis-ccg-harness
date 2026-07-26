---
name: analyze
description: Analyze code, architecture, risks, or implementation options without applying changes. Use when the user invokes /ccg:analyze or asks CCG for read-only analysis.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow analyze --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Analyze

Load and follow `skills/ccg-executor/SKILL.md` for context search and reporting standards, but keep this command read-only unless the user explicitly asks to implement.

## Behavior

- Treat the user argument as an analysis request.
- Inspect relevant files, docs, git status, and project rules.
- Do not edit files, commit, install dependencies, or run destructive commands.
- Use Gemini through the bundled browser preview helper with `--prompt-template analyzer` when a second architectural perspective, risk review, or broad cross-module analysis would help.
- Report in Chinese with findings, evidence, tradeoffs, and recommended next steps.
