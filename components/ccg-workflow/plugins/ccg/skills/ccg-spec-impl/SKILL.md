---
name: spec-impl
description: Execute a spec-backed CCG plan. Use when the user invokes /ccg:spec-impl.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow spec-impl --phase spec-plan --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Spec Impl

Execute a plan backed by `.codex/ccg/specs/<name>/`.

## Behavior

- Read `.codex/ccg/specs/<name>/constraints.md`.
- Read `.codex/ccg/specs/<name>/plan.md` or `.codex/ccg/plans/<name>.md`.
- Run `../ccg-spec-init/scripts/spec_manager.js validate <name> --json` before execution.
- Refuse to execute when the spec is missing `constraints.md`, missing `plan.md`, or the existing artifacts fail validation.
- Execute through the normal `/ccg:execute` workflow.
- Archive results to `.codex/ccg/specs/<name>/archive.md` through `../ccg-spec-init/scripts/spec_manager.js archive <name> --summary-file <summary.md>`.

Codex remains final owner. Report in Chinese.
