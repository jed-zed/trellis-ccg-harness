---
description: "Create or revise a CCG plan with the applicable role providers"
argument-hint: "<task-or-requirement>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow plan --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Plan - Codex Planner

The user invoked:

```text
/ccg:plan $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:plan`.

This command is Codex-native:

- Codex owns context search, requirement enhancement, final plan synthesis, and writing new plans under `.codex/ccg/plans/*.md`.
- Follow the shared **Companion Role Contract**: frontend or backend makes
  search required and evaluates the product-manager authorization gate.
  Planning is an internal phase of each role.
- If the selected provider is external, do not write or present a final plan
  until Codex has read its non-empty output.
- If Gemini is selected, use the bundled preview helper with
  `gemini-3.1-pro-preview` by default.
- Claude is disabled for ordinary delegation. It may run only when unified CCG
  routing selects Claude for the read-only `product-manager` role and the
  project allows the explicit provider call.
- Do not modify product code. This command may write CCG plan files only under `.codex/ccg/plans/`.
- All user-facing output for this command must be Chinese by default, including usage/help, progress summaries, questions, failure reports, saved-plan summaries, and the next manual command.
- The saved CCG plan content itself must be Chinese by default. Section headings, table headers, checklists, narrative analysis, risks, test strategy, and handoff prose must be Chinese. English is allowed only for literal file paths, commands, code identifiers, generated slugs, URLs, model names, and environment variables.
- After writing the plan, show the saved path and the next manual command: `/ccg:execute <plan-path>`.
