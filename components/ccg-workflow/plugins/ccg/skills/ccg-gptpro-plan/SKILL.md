---
name: gptpro-plan
description: Create an automated ChatGPT Pro sidebar planning second-opinion bridge. Use when the user invokes /ccg:gptpro-plan.
---

# CCG GPT Pro Plan

This is ordinary CCG planning plus GPT Pro sidebar evidence. GPT Pro acts as an adversarial plan
reviewer: it challenges an existing plan, but does not rewrite the whole plan or replace the current
orchestrator's planning authority.

Load and follow `skills/ccg-gptpro-bridge/SKILL.md`.

## Behavior

- Treat the argument as a planning task or plan-review input.
- Before ordinary planning or any Gemini or GPT Pro handoff, write the bounded subject and run
  `ccg route --workflow gptpro-plan --phase intake --task-file <request-file> --state-file <state-file>`.
  Let the current orchestrator add a semantic mode/reason whenever external evidence is materially
  useful even if the user did not request search. When required, the shared route runs Grok contract evidence
  and require its canonical artifact, manifest, hashes, and active-task pointer. Exit `2`, `3`, or `4`
  stops the workflow; pass only the validated summary, claims, and provenance, never raw Grok output.
- Run ordinary `/ccg:plan` semantics first. Preserve Codex as the planning
  authority and use the applicable frontend/backend/search planning evidence from that
  workflow.
- Inherit the ordinary **Companion Role Contract**: frontend or backend makes
  search evidence required and evaluates the mapped product-manager gate. The
  Provider call still requires explicit per-call authorization.
- Before GPT Pro, write Base CCG Routing Evidence that records the current orchestrator, actual
  routed model evidence, ordinary planning conclusion, `searchStatus`,
  `productManagerStatus`, and skipped/failed model steps.
- Run every required provider from ordinary planning; search is mandatory when
  frontend or backend participates.
  Gemini is optional and must not be added merely because GPT Pro is requested.
- When ordinary planning actually used Gemini, pass its real non-empty
  `CCG_GEMINI_RESPONSE_FILE` through the optional evidence path. Do not invent findings.
- Include the ordinary planning context, Project Access Context, and Base CCG Routing Evidence in
  the GPT Pro prompt. Include a Gemini response path and concise summary only when Gemini actually
  ran.
- Ask GPT Pro to focus on requirement ambiguity, wrong assumptions, architecture risk, missing
  constraints, test gaps, and whether the plan is worth continuing.
- Require output sections: `Blockers`, `Risks`, `Missing Evidence`, `Plan Adjustments`, `Go-NoGo`.
- Build a single-round planning prompt by default.
- Expected questions: 1.
- Maximum questions: 2.
- Round 2 only for blocker re-check or revised plan comparison.
- Use `scripts/gptpro_bridge.py --mode plan --gemini-policy optional --gemini-evidence-role gate --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence [--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file> when Gemini actually ran] [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=valid and requirement=required]`; omit those three external-intelligence flags for `status=waived`.
- Delegate, monitor, wake, and import through the installed `chatgpt-pro-sidebar` Skill exactly as defined by the shared bridge Skill.
- Read the response only after `CCG_GPTPRO_SIDEBAR_IMPORTED=1`.
- Summarize and synthesize validated Grok external intelligence, ordinary planning evidence,
  optional Gemini evidence when present, and GPT Pro findings in Chinese; the current orchestrator
  decides final plan edits.
- The current CCG orchestrator remains final owner.
- Do not automate ChatGPT web login.
- Do not read arbitrary ChatGPT DOM.
- Only the installed bridge Skill may use its fixed bounded DOM extractor through `agent-browser-cli-v2`.

## Plan-only Boundary

- `/ccg:gptpro-plan` is planning-only.
- Do not execute implementation.
- Do not apply code changes except writing or updating CCG plan artifacts and GPT Pro bridge artifacts.
- Do not run implementation tasks, mutate product code, commit, push, create a pull request, or continue into `/ccg:execute` behavior.
- After the sidebar response import succeeds, synthesize Codex, Gemini, and GPT Pro planning findings only.
- Produce or revise the plan, report the plan location and key decisions in Chinese, then stop.
- Stop after producing or updating the plan.
- If the user wants execution, require a separate `/ccg:execute <plan>` or `/ccg:codex-exec <plan>` request.

## Sidebar Handoff

- Create the bridge artifacts without launching the legacy preview.
- Use the installed sidebar Skill to validate the target and prepare the ChatGPT conversation.
- Invoke watcher `run-root` once so send, watcher start, and local RootWait stay in the current root turn.
- Continue only after `run-root` returns completed evidence for the exact Codex task.
- Import the completed sidebar evidence through `--import-session`, `--import-sidebar-evidence`, and
  `--expected-codex-thread-id`; never ask the user to copy or save the response.
