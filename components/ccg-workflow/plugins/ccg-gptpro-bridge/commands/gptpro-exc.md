---
description: Optional GPT Pro execution advice after original Claude CCG preflight and before local implementation.
argument-hint: "<authorized plan and current implementation context>"
disable-model-invocation: true
---

# GPT Pro execution advice for original CCG

$ARGUMENTS

Run the original `/ccg:execute` preflight and configured model routing up to the point
where advice can still change the implementation safely. Preserve the user's existing
execution authorization; this bridge creates none. Then follow
`${CLAUDE_PLUGIN_ROOT}/skills/gptpro-bridge/SKILL.md` in `exc` mode, with real Claude
session `${CLAUDE_SESSION_ID}`. GPT Pro supplies read-only implementation advice.
Claude applies any useful proposal, verifies it and owns the original CCG delivery.
Do not import the personal Codex Harness's gates, hooks, routing or task lifecycle.
