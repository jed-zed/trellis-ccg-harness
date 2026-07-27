---
name: feat
description: Implement a feature with Codex as the executor and Gemini as a bounded helper. Use when the user invokes /ccg:feat or asks CCG to add a feature without a separate plan file.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow feat --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Feature

Load and follow `skills/ccg-executor/SKILL.md`.

Use this as the Codex-native equivalent of the original CCG `/ccg:feat` command.

## Behavior

- Treat the user argument as a feature request.
- If the request is broad or ambiguous, create a short in-chat implementation outline before editing. For high-impact ambiguity, ask a concise Chinese question.
- Gather context according to the current project's `AGENTS.md`. Use `rg` for
  known identifiers and targeted reads otherwise. Third-party search tools are
  optional, require explicit user approval, and must never be installed,
  configured, or enabled by this workflow. Do not invoke ace-tool or create a
  CodeGraph index automatically.
- Codex owns all file edits, verification, diff review, and Chinese delivery.
- Gemini is optional for simple backend-heavy features, but useful for complex design alternatives, edge cases, prototype patches, UI implications, or second-pass review.
- Whenever Gemini is used, invoke `../ccg-executor/scripts/invoke_gemini_preview.py` directly with the bundled browser preview helper. Do not ask the user to run `/ccg:gemini-preview` manually and do not call the raw Gemini CLI.
- Prefer `--prompt-template prototype` for implementation sketches and `--prompt-template review` for second-pass review.

## Verification

- Run the narrowest relevant project tests or type checks.
- For changes over roughly 30 lines, also run or equivalently perform `/ccg:verify-change` and `/ccg:verify-quality <changed-path>`.
- For auth, permissions, validation, secrets, file uploads, command execution, or network boundaries, run or equivalently perform `/ccg:verify-security <changed-path>`.
