---
name: spec-init
description: Initialize Codex-native CCG spec storage. Use when the user invokes /ccg:spec-init.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow spec-init --phase spec-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Spec Init

Initialize `.codex/ccg/specs/**` for spec-driven work.

## Behavior

- Use `scripts/spec_manager.js init`.
- Create `.codex/ccg/specs/`.
- Create `.codex/ccg/specs/README.md` when missing.
- Do not overwrite existing specs.
- Use `scripts/spec_manager.js create <name> --requirement "<text>"` when the user wants to start a named spec lifecycle.
- Persist the original requirement as `.codex/ccg/specs/<name>/requirement.md` and expose it in `status.json`.
- Explain that legacy `openspec/**` can be read as migration input but new CCG specs belong under `.codex/ccg/specs/**`.

Report in Chinese.
