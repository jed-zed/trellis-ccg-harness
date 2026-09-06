---
name: execute
description: Execute a CCG plan with Codex as orchestrator and independently configured role providers. Use when the user invokes /ccg:execute or asks Codex to execute a .codex/ccg/plans/*.md file.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow execute --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Execute

Load and follow `skills/ccg-executor/SKILL.md`.

Treat the user argument as a CCG plan path or task description. Plans from
`/ccg:plan` live under `.codex/ccg/plans/*.md`. Resolve each needed role through
`ccg routing get <role> --json`; Codex owns context gathering, final code edits,
verification, review synthesis, and Chinese delivery.

When a role selects Gemini, run the bundled
`../ccg-executor/scripts/invoke_gemini_preview.py` foreground command in a
tool-managed background job and monitor it until completion. Do not pass
`--detach` or call the raw Gemini CLI. For Claude, Antigravity, Grok, or Pi, run
`ccg wrapper --backend <provider> --progress - "<workdir>"`; pass
the prompt through stdin and do not add `--lite`. Treat all external diffs as
dirty prototypes, not final code.
