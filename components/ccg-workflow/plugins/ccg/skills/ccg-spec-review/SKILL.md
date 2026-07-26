---
name: spec-review
description: Review CCG spec, plan, implementation, and tests for consistency. Use when the user invokes /ccg:spec-review.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow spec-review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Spec Review

Review spec-driven work for consistency and scope control.

## Checks

- Run `../ccg-spec-init/scripts/spec_manager.js validate <name> --json` before review.
- Require both constraints and plan artifacts before treating the spec as reviewable.
- Implemented behavior matches constraints.
- Tests map to acceptance criteria.
- No out-of-scope behavior was added.
- Security-sensitive deltas were reviewed.
- Review output is written or summarized in Chinese and may update `.codex/ccg/specs/<name>/review.md` when requested.

Gemini may provide a bounded second-pass review through the preview helper; Codex makes the final judgment.
