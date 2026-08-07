---
name: spec-review
description: Review CCG spec, plan, implementation, and tests for consistency. Use when the user invokes /ccg:spec-review.
---

## Evidence Mode Selection

For a pure local code review, do not run or invoke Grok external-intelligence and do not apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain and run the shared route from the controller:

`ccg route --workflow spec-review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For that external-fact path, add repeated `--official-domain <domain>` chosen before Grok runs, and bind the proposal, target, plan, and diff. Stop ordinary work on exit code `2`, `3`, or `4`.

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

Follow the shared **Companion Role Contract** for the bounded second-pass
review: frontend or backend makes search required and evaluates the mapped
product-manager gate. Codex makes the final judgment.
