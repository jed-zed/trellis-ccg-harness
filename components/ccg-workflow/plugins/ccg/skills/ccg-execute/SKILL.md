---
name: execute
description: Execute a CCG plan with Codex as orchestrator and Gemini as an optional bounded evidence helper. Use when the user invokes /ccg:execute or asks Codex to execute a .codex/ccg/plans/*.md file.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow execute --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Execute

Load and follow `skills/ccg-executor/SKILL.md`.

Treat the user argument as a CCG plan path or task description. Plans from `/ccg:plan` live under `.codex/ccg/plans/*.md`. Codex owns context gathering, final code edits, verification, review, and Chinese delivery. Backend-only simple low-risk work may remain Codex-only; other work may use Gemini when the active policy requires it. Frontend/UI execution remains Gemini-first: Gemini produces the Unified Diff Patch prototype or bounded review, and Codex rewrites, applies, verifies, and reports the final workspace changes.

Every Gemini call in the CCG workflow must use the bundled preview helper. Do not call the raw `gemini`, `gemini.cmd`, or `gemini.exe` CLI directly. `/ccg:gemini-preview` is only a manual smoke-test/debug entry; `/ccg:execute` must open the same browser preview automatically whenever it delegates to Gemini.

Claude is disabled for ordinary Codex-mode delegation. The only exception is
an explicitly selected product-manager Provider invoked through `ccg
product-manager review` with per-call authorization and the no-tool, no-write,
non-persistent contract. Codex remains the only final workspace owner.

For frontend, UI, styling, layout, component, accessibility, or responsive work, `/ccg:execute` must call Gemini with `--prompt-template frontend` or `--prompt-template prototype` before Codex edits the real workspace. Treat Gemini diffs as dirty prototypes, not final code. After Codex applies any frontend/UI change, run Gemini bounded review with `--prompt-template review` or `--prompt-template frontend`; retry Gemini failures twice, then stop and report missing Gemini evidence instead of pretending the review happened.
