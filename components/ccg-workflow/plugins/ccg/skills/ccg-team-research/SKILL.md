---
name: team-research
description: Run scoped parallel research for a CCG task. Use when the user invokes /ccg:team-research.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow team-research --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs this gate. Teammates reuse the persisted state and never invoke Grok independently. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Team Research

Research a task for possible worker ownership.

## Output

Write or propose `.codex/ccg/team/<task>/research.md` with:

- open questions
- evidence
- risk
- recommended ownership split

Use Codex subagents only with clear scopes. Summarize in Chinese.
