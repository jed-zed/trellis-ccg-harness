---
name: gptpro-review
description: Create a manual ChatGPT Pro review second-opinion bridge. Use when the user invokes /ccg:gptpro-review.
---

# CCG GPT Pro Review

This is ordinary CCG review plus GPT Pro manual evidence. Review is GPT Pro's highest-value default
use case because concrete diffs, findings, and tests let it focus on missed risks.

Load and follow `skills/ccg-gptpro-bridge/SKILL.md`.

## Behavior

- Gather review input: plan, diff, touched files, test summary, or user-provided target.
- Before ordinary review or any Gemini or GPT Pro handoff, write the bounded subject and run
  `ccg route --workflow gptpro-review --phase final-verify --task-file <request-file> --state-file <state-file> --trigger final_diff_verify --plan <plan> --diff <diff> --dependency <lockfile>`.
  Let the current orchestrator inherit or re-evaluate whether external verification is required. When required, bind it to
  the exact plan, diff, dependency locks, and test summary; require its canonical artifact, manifest,
  hashes, and active-task pointer. Exit `2`, `3`, or `4` stops the workflow, and raw Grok output is
  never embedded in the GPT Pro prompt.
- Run ordinary `/ccg:review` semantics first. Preserve Codex as the final
  review authority and use the applicable frontend/backend/search review evidence from that
  workflow.
- Before GPT Pro, write Base CCG Routing Evidence that records the current orchestrator, actual
  routed model evidence, ordinary review conclusion, and skipped/failed
  model steps.
- Run whichever frontend/backend/search providers ordinary review classifies as applicable.
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
- Expected manual questions: 1.
- Maximum manual questions: 2.
- Round 2 only after Codex fixes blocker findings.
- Use `scripts/gptpro_bridge.py --mode review --detach-preview --open-preview --gemini-policy optional --gemini-evidence-role gate --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence [--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file> when Gemini actually ran] [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=valid and requirement=required]`; omit those three external-intelligence flags for `status=waived`.
- After response is saved, classify Critical/Major/Minor findings, false positives, required tests,
  and Codex actions.
- Report in Chinese and synthesize validated Grok external intelligence, ordinary review evidence,
  optional Gemini evidence when present, and GPT Pro findings.
- The current CCG orchestrator remains final owner.
- Do not automate ChatGPT web login.
- Do not read ChatGPT web DOM.
- Do not extract ChatGPT Output programmatically.

## Manual Handoff Barrier

- After creating the bridge artifacts, show only handoff metadata.
- Do not paste the full generated prompt into chat.
- Show the preview URL, session directory, prompt file path, response file path, and status file path.
- Tell the user to open the preview page and use the preview page Copy Prompt button, then manually submit the prompt to ChatGPT Pro and manually save the response.
- End the current assistant turn after the handoff. Do not continue the review analysis in the same turn.
- Continue only after `status.json` shows `response_saved=true` and `response.md is non-empty`.
