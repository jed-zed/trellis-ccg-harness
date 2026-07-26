---
name: spec-research
description: Convert a requirement into CCG research and constraints. Use when the user invokes /ccg:spec-research.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow spec-research --phase spec-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Spec Research

Turn fuzzy requirements into research and constraints under `.codex/ccg/specs/<name>/`.

## Outputs

- `.codex/ccg/specs/<name>/research.md`
- `.codex/ccg/specs/<name>/constraints.md`
- `.codex/ccg/specs/<name>/status.json`

## Required Helper Flow

- Use `../ccg-spec-init/scripts/spec_manager.js write-research <name> --file <research.md>`.
- Use `../ccg-spec-init/scripts/spec_manager.js write-constraints <name> --file <constraints.md>`.
- Run `../ccg-spec-init/scripts/spec_manager.js validate <name> --json` after writing both artifacts.
- If validation fails, report the blocking sections in Chinese instead of pretending the spec is ready.

Gemini may provide a read-only analyzer second view through the preview helper, but Codex writes the final Chinese constraints.
