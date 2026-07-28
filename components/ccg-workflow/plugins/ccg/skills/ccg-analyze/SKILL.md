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
- Read `../../rules/ccg-role-routing.md`, classify the request as frontend,
  backend, search, or a combination, then resolve only those top-level roles.
- Ask each applicable role provider for its read-only analysis. If it is
  Gemini, use the bundled preview helper with `--prompt-template analyzer`;
  otherwise use the existing provider adapter described by the routing rule.
  When it is Codex, analyze directly without external delegation.
- Report in Chinese with findings, evidence, tradeoffs, and recommended next steps.
