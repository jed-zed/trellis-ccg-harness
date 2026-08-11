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
- For a pure local code review, do not run Grok external-intelligence or apply an official-domain
  gate. Only when a conclusion depends on a current external fact, predeclare its authoritative
  domain, write the bounded subject, and run
  `ccg route --workflow gptpro-review --phase final-verify --task-file <request-file> --state-file <state-file> --trigger final_diff_verify --plan <plan> --diff <diff> --dependency <lockfile>`.
  Add repeated `--official-domain <domain>` chosen before Grok runs. Bind the external verification to
  the exact plan, diff, dependency locks, and test summary; require its canonical artifact, manifest,
  hashes, and active-task pointer. Exit `2`, `3`, or `4` stops the workflow, and raw Grok output is
  never embedded in the GPT Pro prompt.
- Run ordinary `/ccg:review` semantics first. Preserve Codex as the final
  review authority and use the applicable frontend/backend/search review evidence from that
  workflow.
- Inherit the ordinary **Companion Role Contract**: frontend or backend makes
  search evidence required and evaluates the mapped product-manager gate. The
  Provider call still requires explicit per-call authorization.
- Before GPT Pro, write Base CCG Routing Evidence that records the current orchestrator, actual
  routed model evidence, ordinary review conclusion, `searchStatus`,
  `productManagerStatus`, and skipped/failed model steps.
- Run every required provider from ordinary review; search is mandatory when
  frontend or backend participates.
  Gemini is optional and must not be added merely because GPT Pro is requested.
- When ordinary review actually used Gemini, pass its real non-empty
  `CCG_GEMINI_RESPONSE_FILE` through the optional evidence path. Do not invent findings.
- Include the ordinary review conclusion, Project Access Context, and Base CCG Routing Evidence in
  the GPT Pro prompt. Include a Gemini response path and concise summary only when Gemini actually
  ran.
- Ask GPT Pro to focus on hidden bugs, security risks, compatibility risks, edge cases, test gaps,
  ordinary-model false positives, and missed findings.
- Require output sections: `Critical`, `Major`, `Minor`, `False Positives`, `Required Tests`.
- Build a single-round review prompt by default.
- Expected questions: 1.
- Additional sequential follow-up questions have no fixed bridge limit.
- Follow-up rounds are only after Codex fixes blocker findings.
- Use `scripts/gptpro_bridge.py --mode review --gemini-policy optional --gemini-evidence-role gate --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence [--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file> when Gemini actually ran] [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=verified or status=received_unverified and requirement=required]`; omit those three external-intelligence flags for `status=waived`.
- Delegate, monitor, wake, and import through the installed `chatgpt-pro-sidebar` Skill exactly as defined by the shared bridge Skill.
- After the sidebar response import succeeds, classify Critical/Major/Minor findings, false positives, required tests,
  and Codex actions.
- Report in Chinese and synthesize validated Grok external intelligence when that external-fact path ran, ordinary review evidence,
  optional Gemini evidence when present, and GPT Pro findings.
- The current CCG orchestrator remains final owner.
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
