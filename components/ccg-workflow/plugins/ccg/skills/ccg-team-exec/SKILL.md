---
name: team-exec
description: Execute a scoped CCG team plan with Codex as final owner. Use when the user invokes /ccg:team-exec.
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

`ccg-codex route --workflow team-exec --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg-codex route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.
-->

# CCG Team Exec

Execute scoped work packages as soon as their dependencies are ready.

## Behavior

- Reuse the canonical Trellis plan when present; read `.codex/ccg/team/<task>/plan.md` when provided as its execution view, not a second plan authority.
- Follow `../ccg-team/references/native-workers.md`, including the root loop and actual native-tool calls. For formal team plans run `../ccg-team/scripts/team_plan_checker.js validate <plan.md> --json`; validation must not erase real execution state.
- Repair missing presentation metadata locally. Unknown authority or unsafe writes block the affected branch; independent authorized work continues. A merge paragraph does not authorize concurrent writers. Zero workers is valid for simple/serial work.
- Use `../ccg-team/scripts/worker_dispatch.mjs` when dependency/file coordination is needed. Record actual tool handles, use early fixed deliveries, and dispatch newly ready work without a whole-batch barrier. The helper does not launch agents or add permissions.
- Tell every worker they are not alone in the codebase and must not revert others' edits.
- Maintain root-owned runtime evidence under `.codex/ccg/team/<task>/`; plan validation status is not evidence of a native spawn. Only the coordinator writes canonical lifecycle state.
- Codex applies or reconciles final changes, reviews the diff, runs verification, and reports in Chinese.

Follow the shared **Companion Role Contract** for routed evidence: frontend or
backend evaluates advisory search and the mapped product-manager gate.
Providers remain evidence helpers and cannot own the real workspace.
