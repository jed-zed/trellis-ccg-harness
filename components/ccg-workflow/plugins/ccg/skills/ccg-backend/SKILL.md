---
name: backend
description: Implement backend-heavy work with the configured backend provider and Codex as final workspace owner. Use when the user invokes /ccg:backend or asks CCG to handle APIs, services, data flows, jobs, storage, or backend architecture.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow backend --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Backend

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:backend` command.

## Behavior

- Treat the user argument as backend-heavy work: APIs, services, data flow, storage, jobs, migrations, auth, validation, or backend architecture.
- Read `../../rules/ccg-role-routing.md`, follow its **Companion Role Contract**,
  then resolve `backend` and its required `search` companion before assigning
  backend drafting or analysis; evaluate the mapped product-manager gate at the
  next eligible checkpoint.
- Use the configured backend provider for implementation drafts, design
  alternatives, risky edge cases, concurrency, data integrity, or tests. If it
  is Gemini, run the bundled
  `../ccg-executor/scripts/invoke_gemini_preview.py` foreground command in a
  tool-managed background job and prefer `--prompt-template architect` or
  `--prompt-template tester`; monitor it until completion and do not pass
  `--detach`. Otherwise run
  `ccg wrapper --backend <provider> --progress - "<workdir>"`, pass
  the prompt through stdin, and do not add `--lite`.
- Codex owns final edits, migration safety, tests, diff review, and Chinese delivery.

## Verification

- Run focused backend tests, type checks, schema checks, or smoke scripts.
- For security-sensitive backend changes, run or equivalently perform `/ccg:verify-security <changed-path>`.
