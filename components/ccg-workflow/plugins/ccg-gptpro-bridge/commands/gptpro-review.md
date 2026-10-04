---
description: Append GPT Pro advisory review to real original Claude CCG review evidence.
argument-hint: "<authorized diff, review scope, and test results>"
disable-model-invocation: true
---

# GPT Pro review evidence for original CCG

$ARGUMENTS

Use the original `/ccg:review` semantics and the user's configured models first.
Include the real bounded diff, routed findings and executed tests; missing evidence
stays missing. Then follow `${CLAUDE_PLUGIN_ROOT}/skills/gptpro-bridge/SKILL.md` in
`review` mode, with real Claude session `${CLAUDE_SESSION_ID}`. Ask GPT Pro for missed
bugs, regressions and useful additional verification. Claude independently classifies
each finding, verifies it and decides the outcome under the original CCG workflow.
Do not import the personal Codex Harness's gates, hooks, routing or task lifecycle.
