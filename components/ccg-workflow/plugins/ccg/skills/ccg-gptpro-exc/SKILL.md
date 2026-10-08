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
## Research

Use existing independent research agents with grok-search MCP. Search actively and
verify key conclusions against original sources; check versions/licenses when
reusing code and experiment conditions when adopting papers. Mark unverified findings.
Archived instructions below are inactive: ordinary work does not run Grok CLI/ACP,
wait for its gates, or require its manifests and hash packages.

<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
- Before ordinary execution or any Gemini or GPT Pro handoff, write the bounded subject and run
  `ccg-codex route --workflow gptpro-exc --phase intake --task-file <request-file> --state-file <state-file>`.

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg-codex route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.
  Let the current orchestrator add a semantic mode/reason whenever current external facts materially
  affect the route, even if search was not requested. When required, the shared route runs Grok for the
  exact plan and dependency baseline, require its canonical artifact, manifest, hashes, and active-task
  pointer, and stop on exit `2`, `3`, or `4`. After implementation, run `/ccg:grok-verify` again when
  the plan, diff, dependencies, or external-evidence digest changed. Pass only validated summary,
  claims, and provenance to GPT Pro, never raw Grok output.
-->

<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
- Preserve the current CCG orchestrator as the ordinary execution owner after that route gate.
-->
- Preserve the current CCG orchestrator as the ordinary execution owner.
- Preserve Codex as the CCG orchestrator and ordinary execution owner. Ordinary
  execution evidence follows the configured role providers.
- Inherit the ordinary **Companion Role Contract**: frontend or backend may use
  advisory search evidence when current external facts would materially help,
  and evaluates the mapped product-manager gate. The Provider call still
  requires explicit per-call authorization.
- Before GPT Pro, write Base CCG Routing Evidence that records the current orchestrator, actual
  routed model evidence, ordinary execute conclusion so far, `searchStatus`,
  `productManagerStatus`, and skipped/failed model steps.
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
- Additional sequential follow-up questions have no fixed bridge limit.
- Follow-up rounds should be converted into `/ccg:gptpro-review` whenever possible; use Gemini `--prompt-template review` and `--gemini-evidence-role frontend-review` for frontend review evidence over the applied diff.
<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
- Use `scripts/gptpro_bridge.py --mode exc --gemini-policy optional --gemini-evidence-role frontend-prototype --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=verified or status=received_unverified and requirement=required]`; omit those three external-intelligence flags for `status=waived`.
-->
- Use `scripts/gptpro_bridge.py --mode exc --gemini-policy optional --gemini-evidence-role frontend-prototype --routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence`.
- When frontend/full-stack Gemini output is available, add `--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file>`.
- Delegate, monitor, wake, and import through the installed `chatgpt-pro-sidebar` Skill exactly as defined by the shared bridge Skill.
- GPT Pro output must use sections: `Proceed`, `Revise Plan`, `Stop`, `Implementation Notes`,
  `Required Tests`, `Verification`.
- Require `Implementation Readiness Scorecard` as a mandatory part of `Verification` in the same response, even for weak-evidence input: plan fit, implementation completeness, verification readiness, risk handling, and adoption recommendation, each out of 20 with evidence and `TOTAL SCORE` out of 100.
- Missing evidence lowers scores; disagreements use the more conservative score and blocker judgment. The scorecard remains read-only advisory second-opinion evidence and does not authorize execution or Provider calls or decide final implementation.
<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
- Report in Chinese and synthesize validated Grok external intelligence, ordinary execute evidence,
  Gemini frontend evidence when present, and GPT Pro sidebar second opinion. If Gemini frontend
  evidence was not used, say so from routing evidence rather than inventing a Gemini result.
-->
- Synthesize available MCP research, ordinary role evidence, and GPT Pro findings in Chinese; the current orchestrator decides the outcome.
- The current CCG orchestrator remains final owner.
- Do not automate ChatGPT web login.
- Do not read arbitrary ChatGPT DOM.
- Only the installed bridge Skill may use its fixed bounded DOM extractor through `agent-browser-cli-v2`.

## Sidebar Handoff

- Create the bridge artifacts without launching the legacy preview.
- Use the installed sidebar Skill to validate the target and prepare the ChatGPT conversation.
- Invoke watcher `run-root` once so send, watcher start, and local RootWait stay in the current root turn.
- If the accepted execution route has independent parallel slices, use the shared bridge's batch create ->
  `run-batch-root` -> batch import contract instead; keep the `3` per-task / `6` global cap.
- Continue only after `run-root` returns completed evidence for the exact Codex task.
- Import completed sidebar evidence with the exact Codex task binding; never ask the user to copy or
  save the response.
