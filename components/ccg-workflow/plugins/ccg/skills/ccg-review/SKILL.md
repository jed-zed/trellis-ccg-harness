---
name: review
description: Review a CCG implementation with Codex-led judgment and optional Gemini evidence. Use when the user invokes /ccg:review or asks for CCG review of a diff/plan.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For final review append --trigger final_diff_verify and bind the actual --diff plus any --plan, --target, and --dependency files. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Review

Load and follow `skills/ccg-executor/SKILL.md`.

Review the current diff or the implementation associated with the supplied
plan/task. Codex performs the primary review. Gemini may provide bounded
second-pass review evidence for non-trivial, risky, or explicitly requested
CCG reviews; Codex must verify findings before reporting them.

Every Gemini call in the CCG workflow must use the bundled preview helper. Do not call the raw `gemini`, `gemini.cmd`, or `gemini.exe` CLI directly. `/ccg:gemini-preview` is only a manual smoke-test/debug entry; `/ccg:review` must open the same browser preview automatically whenever it asks Gemini for a second-pass review.

When using Gemini, call the bundled preview helper with `--prompt-template review`. The template already carries the original CCG-style read-only and prioritized review protocol; put only the concrete diff, plan, and review focus in the task prompt.

Claude is not a generic second-pass reviewer. It may participate only through
an explicitly selected product-manager contract. If required external evidence
is missing, say so explicitly and do not claim that review occurred.
