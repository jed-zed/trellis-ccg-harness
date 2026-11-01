---
name: gptpro-review
description: Create an automated ChatGPT Pro sidebar review second-opinion bridge. Use when the user invokes /ccg:gptpro-review.
---

# CCG GPT Pro Review

This is ordinary CCG review plus GPT Pro sidebar evidence. Review is GPT Pro's highest-value default
use case because concrete diffs, findings, and tests let it focus on missed risks.

Load and follow `skills/ccg-gptpro-bridge/SKILL.md`.

## Behavior

- Gather review input: plan, diff, touched files, test summary, or user-provided target.

## Research

Use existing independent research agents with grok-search MCP. Search actively and
verify key conclusions against original sources; check versions/licenses when
reusing code and experiment conditions when adopting papers. Mark unverified findings.
Ordinary work does not run Grok CLI/ACP,
wait for its gates, or require its manifests and hash packages.

For a pure local code review, do not run external-intelligence. Use the bound
diff, source, tests and CI; research a current external fact only when a
conclusion depends on it.

- Run ordinary `/ccg:review` semantics first. Preserve Codex as the final
  review authority and use the applicable frontend/backend/search review evidence from that
  workflow.
- Inherit the ordinary **Companion Role Contract**: frontend or backend may use
  advisory search evidence when current external facts would materially help,
  and evaluates the mapped product-manager gate. The Provider call still
  requires explicit per-call authorization.
- Before GPT Pro, write Base CCG Routing Evidence that records the current orchestrator, actual
  routed model evidence, ordinary review conclusion, `searchStatus`,
  `productManagerStatus`, and skipped/failed model steps.
- Run every required provider from ordinary review; advisory search failure or
  `not_applicable` must not block an otherwise valid local review.
  Gemini is optional and must not be added merely because GPT Pro is requested.
- When ordinary review actually used Gemini, pass its real non-empty
  `CCG_GEMINI_RESPONSE_FILE` through the optional evidence path. Do not invent findings.
- Include the ordinary review conclusion, Project Access Context, and Base CCG Routing Evidence in
  the GPT Pro prompt. Include a Gemini response path and concise summary only when Gemini actually
  ran.
- Bind the review to the actual submitted files/revision and supported behavior.
  Ask for concrete bugs, real security/data risks, relevant test gaps and
  false positives in the existing findings. Verify location, trigger, actual
  consequence and supporting contract/evidence before adopting a finding.
- Zero findings is valid. Keep optional suggestions separate; they do not
  become requirements or justify hypothetical compatibility tests. Missing
  evidence is a stated limit, not a guessed score. Resolve conflicting findings
  from the evidence rather than automatically adopting a more severe opinion.
- Preserve Boss's requested independent GPT Pro PR review. Default to one
  complete review plus one focused re-review after fixes as a soft budget,
  using only the changed diff, remaining findings and relevant test results.
  Skip the follow-up when there is nothing concrete to re-check. Additional
  rounds need a specific unresolved blocker or changed risk and a bounded
  question; do not loop full reviews without new evidence. Reaching the budget
  never makes a blocker pass: report incomplete and narrow the remaining fix.
- Use `scripts/gptpro_bridge.py --mode review --gemini-policy optional --gemini-evidence-role gate --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence [--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file> when Gemini actually ran]`.
- Delegate, monitor, wake, and import through the installed `chatgpt-pro-sidebar` Skill exactly as defined by the shared bridge Skill.
- After import, verify findings and distinguish confirmed defects, false
  positives, optional suggestions, necessary checks and Codex actions. Fix only
  within the existing task and write authorization; keep unresolved real
  security/data risks visible. No numerical scorecard is required.
- Synthesize available MCP research, ordinary role evidence, and GPT Pro findings in Chinese; the current orchestrator decides the outcome.
- The current CCG orchestrator remains final owner.
- Report the result, verification limits, next action and any user decision
  in natural Chinese, usually within one screen; link precise evidence as needed.
- Do not automate ChatGPT web login.
- Do not read arbitrary ChatGPT DOM.
- Only the installed bridge Skill may use its fixed bounded DOM extractor through `agent-browser-cli-v2`.

## Sidebar Handoff

- Create the bridge artifacts without launching the legacy preview.
- Use the installed sidebar Skill to validate the target and prepare the ChatGPT conversation.
- Invoke watcher `run-root` once so send, watcher start, and local RootWait stay in the current root turn.
- If the accepted review scope has independent parallel slices, use the shared bridge's batch create ->
  `run-batch-root` -> batch import contract instead; keep the `3` per-task / `6` global cap.
- Continue only after `run-root` returns completed evidence for the exact Codex task.
- Import completed sidebar evidence with the exact Codex task binding; never ask the user to copy or
  save the response.

Webpage strength: preserve an explicit user choice through shared bridge --thinking-mode and Skill
-ThinkingMode on status/new-chat/run-root. Default Pro only when unspecified; 极高 is Extra High.
This does not change --mode review workflow semantics or Codex reasoning effort.
