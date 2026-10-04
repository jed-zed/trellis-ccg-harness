---
name: execute
description: Execute a canonical Trellis task plan or standalone CCG plan with Codex as orchestrator and independently configured role providers. Use when the user invokes /ccg:execute or asks Codex to execute a task directory, its implement.md, or a .codex/ccg/plans/*.md file.
---

## Research

Use existing independent research agents with grok-search MCP. Search actively and
verify key conclusions against original sources; check versions/licenses when
reusing code and experiment conditions when adopting papers. Mark unverified findings.
Archived instructions below are inactive: ordinary work does not run Grok CLI/ACP,
wait for its gates, or require its manifests and hash packages.

<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg-codex route --workflow execute --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg-codex route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.
-->

# CCG Execute

Load and follow `skills/ccg-executor/SKILL.md`.

Apply the executor's **Input Handling** and **Trellis approval handoff** to a
task directory, its `implement.md`, a CCG plan path, or task description. With
Trellis, reuse the selected canonical task plan and its covered approval;
standalone plans live under `.codex/ccg/plans/*.md`. Resolve each needed role through
`ccg-codex routing get <role> --json`; Codex owns context gathering, final code edits,
verification, review synthesis, and Chinese delivery.

When a role selects Gemini, run the bundled
`../ccg-executor/scripts/invoke_gemini_preview.py` foreground command in a
tool-managed background job and monitor it until completion. Do not pass
`--detach` or call the raw Gemini CLI. For Claude, Antigravity, Grok, or Pi, run
`ccg-codex wrapper --backend <provider> --progress - "<workdir>"`; pass
the prompt through stdin and do not add `--lite`. Treat all external diffs as
dirty prototypes, not final code.
