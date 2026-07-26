---
name: go
description: Smart CCG entrypoint and router. Use when the user invokes /ccg:go or asks CCG to choose the right workflow automatically.
---

# CCG Go

Use `commands/go.md` as the authoritative routing contract for `/ccg:go`.

## Behavior

Bootstrap contract: before invoking the route, create or reuse a safe `<task-id>`, create
`.ccg/tasks/<task-id>/`, and write the original user request to
`.ccg/tasks/<task-id>/intelligence-request.md` with a file-writing tool rather than shell interpolation.
Reuse this same task id throughout `/ccg:go`, including S and git-action routes.

- Before inspecting or routing ordinary work, write the bounded request to the active task directory
  and run `ccg route --workflow go --phase intake --task-file <request-file> --state-file <state-file>`.
  The controller must add `--semantic-mode contract|incident --semantic-reason <reason>` when its own
  judgment finds a material current-fact dependency even if the user did not ask to search. Supply
  plan/diff/dependency paths when present, re-run final external verification when their digests change,
  persist every skip reason, and stop on exit code `2`, `3`, or `4`.
- Inspect the user's natural-language request, current project context, and git status before choosing a workflow.
- Route explicit GPT Pro intents to `/ccg:gptpro-plan`, `/ccg:gptpro-review`, or `/ccg:gptpro-exc`.
- If the user says `gptpro` without a precise subcommand, choose:
  - planning/design intent -> `/ccg:gptpro-plan`;
  - review/audit/diff intent -> `/ccg:gptpro-review`;
  - implement/fix/build intent -> `/ccg:gptpro-exc`;
  - unclear intent -> `/ccg:gptpro-plan`, because it is planning-only and does not edit product code.
- For normal development, follow the complexity/risk/domain strategy matrix in `commands/go.md`.
- Codex remains the controller and final executor.

Do not bypass the GPT Pro manual handoff barrier. GPT Pro is manual evidence, not an automated model backend.
GPT Pro routes inherit the matching ordinary command first: plan -> ordinary `/ccg:plan`, review ->
ordinary `/ccg:review`, exc -> ordinary `/ccg:execute` preflight/routing evidence before manual GPT
Pro second opinion. Do not replace routed Codex, Gemini, or helper evidence.
