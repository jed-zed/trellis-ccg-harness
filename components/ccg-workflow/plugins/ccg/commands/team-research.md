---
description: "Run scoped team research for a CCG task"
argument-hint: "<task>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
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

`ccg-codex route --workflow team-research --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg-codex route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.
-->

# CCG Team Research

The user invoked:

```text
/ccg:team-research $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:team-research`.

Produce `.codex/ccg/team/<task>/research.md` with evidence, risks, open questions, and ownership recommendations.
