---
name: frontend
description: Build or review frontend/UI work with the configured frontend provider and Codex as final workspace owner. Use when the user invokes /ccg:frontend or asks CCG for UI, UX, component, styling, accessibility, or responsive work.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow frontend --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Frontend

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:frontend` command.

## Behavior

- Treat the user argument as a frontend, UI, UX, component, styling, accessibility, or responsive-design task.
- Read `../../rules/ccg-role-routing.md`, follow its **Companion Role Contract**,
  then resolve `frontend` and its required `search` companion before assigning
  the frontend draft or review; evaluate the mapped product-manager gate at the
  next eligible checkpoint.
- Ask the configured frontend provider for UI structure, interaction states,
  accessibility, responsive behavior, and visual risks. If it is Gemini, run
  the bundled `../ccg-executor/scripts/invoke_gemini_preview.py` foreground
  command in a tool-managed background job with `--prompt-template frontend`;
  monitor it until completion and do not pass `--detach`. Otherwise run
  `ccg wrapper --backend <provider> --progress - "<workdir>"`, pass
  the prompt through stdin, and do not add `--lite`.
- Codex must adapt provider output to the local framework, design system, and existing component patterns. External output is not authoritative.
- Codex owns final edits, screenshot/playwright verification where applicable, tests, diff review, and Chinese delivery.
- Do not create marketing-style landing pages unless the user asked for one; build the actual usable experience first.

## Verification

- Run the relevant frontend typecheck, lint, component tests, or build.
- When a dev server is needed, start it and inspect the UI with a browser/screenshot workflow when available.
- Check text fit, layout overlap, responsive behavior, and accessibility-sensitive states.
