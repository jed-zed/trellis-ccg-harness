---
description: Append GPT Pro advisory plan evidence to the original Claude CCG planning route.
argument-hint: "<authorized task or plan context>"
disable-model-invocation: true
---

# GPT Pro plan evidence for original CCG

$ARGUMENTS

Use the original `/ccg:plan` semantics and the user's configured models first. Preserve
actual model evidence and any failures. Planning remains planning; this command does
not authorize implementation. Then follow
`${CLAUDE_PLUGIN_ROOT}/skills/gptpro-bridge/SKILL.md` in `plan` mode, with real Claude
session `${CLAUDE_SESSION_ID}`. Ask GPT Pro for gaps, assumptions, acceptance criteria,
risks and a bounded advisory plan. Only Claude synthesizes and verifies the result.
Do not import the personal Codex Harness's gates, hooks, routing or task lifecycle.
