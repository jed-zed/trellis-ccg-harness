---
name: gptpro-exc
description: Create an automated ChatGPT Pro sidebar execution route review bridge. Use when the user invokes /ccg:gptpro-exc.
---

# CCG GPT Pro Execution Route Review

Load and follow `skills/ccg-gptpro-bridge/SKILL.md`.

This is ordinary CCG execute semantics plus GPT Pro sidebar evidence. The current CCG orchestrator
controls implementation and final decision after ordinary execute routing; GPT Pro reviews whether
the execution route is worth local implementation before real code landing.

## Behavior

- Treat input as an implementation request whose ordinary `/ccg:execute` preflight and routing must
  happen before the GPT Pro handoff.
- Before ordinary execution or any Gemini or GPT Pro handoff, write the bounded subject and run
  `ccg route --workflow gptpro-exc --phase intake --task-file <request-file> --state-file <state-file>`.
  Let the current orchestrator add a semantic mode/reason whenever current external facts materially
  affect the route, even if search was not requested. When required, the shared route runs Grok for the
  exact plan and dependency baseline, require its canonical artifact, manifest, hashes, and active-task
  pointer, and stop on exit `2`, `3`, or `4`. After implementation, run `/ccg:grok-verify` again when
  the plan, diff, dependencies, or external-evidence digest changed. Pass only validated summary,
  claims, and provenance to GPT Pro, never raw Grok output.
- Preserve the current CCG orchestrator as the ordinary execution owner after that route gate.
- Preserve Codex as the CCG orchestrator and ordinary execution owner. Ordinary
  execution evidence follows the configured role providers.
- Before GPT Pro, write Base CCG Routing Evidence that records the current orchestrator, actual
  routed model evidence, ordinary execute conclusion so far, and
  skipped/failed model steps.
- For backend-only tasks, follow ordinary execute routing and do not run Gemini by default.
- For frontend or full-stack tasks, pass real Gemini frontend evidence when ordinary execute
  produced it through the bundled Gemini preview helper.
- Include the ordinary implementation context, Project Access Context, Base CCG Routing Evidence,
  target files, constraints, existing patterns, and any available `Gemini Frontend Prototype Evidence`
  in the GPT Pro prompt.
- Classify evidence quality before writing the GPT Pro prompt:
  - weak evidence: routing summary, snippets, or high-level context only; ask for route risk, wrong
    assumptions, missing tests, and `Proceed` / `Revise Plan` / `Stop`;
  - strong evidence: repository URL, branch, commit, current diff or key file excerpts, and Base CCG
    Routing Evidence are present; allow implementation sketches, localized pseudo patches, key
    function drafts, test samples, and verification commands.
- If Gemini frontend evidence is provided, it must come from a real, non-empty response file with a concise summary; do not invent Gemini findings.
- Gemini is not a gate for `/ccg:gptpro-exc`, is not a general execution participant beyond ordinary
  execute routing, and must not apply workspace changes.
- GPT Pro is an automated read-only second opinion; it does not write workspace files.
- GPT Pro is not an implementation owner. Code-like output must be labeled advisory / illustrative
  and reimplemented locally by Codex.
- Expected questions: 1.
- Maximum questions: 2.
- Round 2 should be converted into `/ccg:gptpro-review` whenever possible; use Gemini `--prompt-template review` and `--gemini-evidence-role frontend-review` for frontend review evidence over the applied diff.
- Use `scripts/gptpro_bridge.py --mode exc --gemini-policy optional --gemini-evidence-role frontend-prototype --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=valid and requirement=required]`; omit those three external-intelligence flags for `status=waived`.
- When frontend/full-stack Gemini output is available, add `--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file>`.
- Delegate, monitor, wake, and import through the installed `chatgpt-pro-sidebar` Skill exactly as defined by the shared bridge Skill.
- GPT Pro output must use sections: `Proceed`, `Revise Plan`, `Stop`, `Implementation Notes`,
  `Required Tests`, `Verification`.
- Report in Chinese and synthesize validated Grok external intelligence, ordinary execute evidence,
  Gemini frontend evidence when present, and GPT Pro sidebar second opinion. If Gemini frontend
  evidence was not used, say so from routing evidence rather than inventing a Gemini result.
- The current CCG orchestrator remains final owner.
- Do not automate ChatGPT web login.
- Do not read ChatGPT web DOM.
- Do not use DOM extraction; only the installed sidebar Skill may capture bounded UIA output.

## Sidebar Handoff

- Create the bridge artifacts without launching the legacy preview.
- Use the installed sidebar Skill to create the ChatGPT conversation and submit `prompt.md`.
- Start the detached watcher and end the turn only after the watcher registration is durable.
- Continue automatically in the same Codex Desktop task when the Stop Hook fires.
- Import completed sidebar evidence with the exact Codex task binding; never ask the user to copy or
  save the response.
