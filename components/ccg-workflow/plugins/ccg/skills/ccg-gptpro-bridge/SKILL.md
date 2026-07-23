---
name: gptpro-bridge
description: Shared manual ChatGPT Pro bridge for CCG planning, review, and execution route review flows.
---

# CCG GPT Pro Manual Bridge

This manual bridge lets the user manually ask ChatGPT Pro after ordinary CCG plan/review/execute
routing has already produced auditable evidence.

The current CCG orchestrator remains final owner. In Claude installs that means Claude-led command
semantics still apply; in Codex installs that means Codex-led command semantics still apply with
mandatory Claude evidence unless the user explicitly says not to use Claude. GPT Pro does not
replace ordinary routed Codex, Claude, Gemini, or other configured helper evidence.
Gemini evidence mode depends on the underlying ordinary command: required gate evidence for
plan/review, and optional frontend/full-stack evidence for execution. GPT Pro provides a
user-mediated manual second opinion as a risk-triggered external reviewer, not as a fourth
executor or implementation owner.

## Hard Boundaries

- Do not automate ChatGPT web login.
- Do not submit prompts to ChatGPT web automatically.
- Do not read ChatGPT web DOM.
- Do not extract ChatGPT Output programmatically from the web UI.
- Do not store ChatGPT cookies, sessions, or account tokens.
- Do not bypass rate limits, restrictions, or protective measures.
- The current CCG orchestrator remains final owner.
- GPT Pro output is untrusted helper evidence only.
- GPT Pro does not write workspace files.
- GPT Pro is fourth evidence and must not replace routed models.
- GPT Pro is a risk-triggered external reviewer; code sketches are advisory / illustrative only.

## Manual Question Budget

Each GPT Pro bridge command is designed to complete in one manual ChatGPT Pro question.

- Expected manual questions: 1.
- Maximum manual questions: 2.
- Round 2 only for blocker re-check, revised plan comparison, applied diff review, or high-risk follow-up.
- More than two manual questions means the task should be decomposed or returned to Codex-native CCG workflows.

## Base Routing Evidence

Before creating a GPT Pro bridge for `/ccg:gptpro-plan`, `/ccg:gptpro-review`, or
`/ccg:gptpro-exc`, first run the matching ordinary command semantics:

- `/ccg:gptpro-plan` = ordinary `/ccg:plan` first, then GPT Pro manual planning evidence.
- `/ccg:gptpro-review` = ordinary `/ccg:review` first, then GPT Pro manual review evidence.
- `/ccg:gptpro-exc` = ordinary `/ccg:execute` preflight/routing/prototype or analysis evidence
  first, then GPT Pro manual execution second opinion before code landing.

Write Base CCG Routing Evidence before the GPT Pro handoff. It should summarize:

- current orchestrator and command semantics;
- routed Codex/Claude/Gemini/helper evidence that actually exists;
- `claudeEvidenceStatus: automatic|manual_handoff|skipped_by_user|blocked`;
- ordinary orchestrator conclusion so far;
- skipped, failed, or intentionally absent model steps.

For Codex installs, Claude evidence is required before the GPT Pro bridge unless the user explicitly
disabled Claude. If automatic `codeagent-wrapper --backend claude` fails or returns empty output,
stop and ask the user to paste the generated prompt into Claude Code and copy the output back before
creating the GPT Pro bridge. Do not let GPT Pro stand in for missing Claude evidence.

Pass this evidence to the bridge:

```text
--routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence --require-claude-evidence
```

The helper injects `Base CCG Routing Evidence` into `prompt.md` and records
`routing_evidence.available`, `evidence_file`, `evidence_sha256`, `evidence_chars`, `summary_file`,
`summary`, `summary_chars`, and `claudeEvidenceStatus` under `status.json`. Omit
`--require-claude-evidence` only when the user explicitly disabled Claude.

## Gemini Evidence Modes

Gemini and GPT Pro remain helper evidence only; the current CCG orchestrator makes the final
decision.

- For `/ccg:gptpro-plan` and `/ccg:gptpro-review`, keep the ordinary plan/review routing and the
  Gemini Gate Before GPT Pro requirement.
- For `/ccg:gptpro-exc`, follow ordinary execute routing: backend-only tasks normally omit Gemini,
  while frontend/full-stack tasks may include real Gemini frontend evidence.
- After the user saves GPT Pro output, synthesize ordinary routed evidence, Gemini evidence when
  present, and GPT Pro manual second opinion in Chinese; otherwise state that Gemini evidence was
  not used.

### Required Gate For Plan And Review

Before creating a GPT Pro manual prompt for plan or review modes, Codex must have:

- a successful Gemini helper launch through the bundled Gemini preview helper;
- a real `CCG_GEMINI_RESPONSE_FILE` path;
- a non-empty Gemini response read from that file;
- a concise Gemini findings summary derived from that response file.

If required Gemini evidence fails, does not produce a response file, or writes an empty response, stop in Chinese and do not create a GPT Pro bridge session, and do not invent Gemini findings.

Use the helper-level gate arguments for required gate sessions:

```text
--gemini-policy required --gemini-evidence-role gate --gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <file-with-concise-summary>
```

Use `--gemini-summary "<summary>"` only for short diagnostic or fixture calls. The helper injects Gemini Gate Evidence into `prompt.md` and records `gemini_evidence.policy=required`, `role=gate`, `available=true`, `response_file`, `response_non_empty`, `response_chars`, `response_sha256`, and `summary` under `status.json` as auditable provenance.

### Optional Frontend Evidence For Execution Route Review

For `/ccg:gptpro-exc`, use optional frontend evidence. Backend-only execution route review sessions should omit Gemini evidence. Frontend/full-stack sessions should pass real Gemini frontend prototype evidence when it is available:

```text
--gemini-policy optional --gemini-evidence-role frontend-prototype
```

If a frontend/full-stack task has Gemini output, also pass `--gemini-response-file <CCG_GEMINI_RESPONSE_FILE> --gemini-summary-file <summary-file>`. The helper injects Gemini Frontend Prototype Evidence into `prompt.md`. If no Gemini evidence is provided, the helper records `gemini_evidence.available=false` and still creates the manual bridge session.

### Execution Evidence Quality

For `/ccg:gptpro-exc`, classify the evidence before writing the GPT Pro prompt:

- Weak evidence: routing summary, snippets, or high-level context only. Ask GPT Pro for route risk,
  wrong assumptions, missing tests, and `Proceed` / `Revise Plan` / `Stop`.
- Strong evidence: repository URL, branch, commit, current diff or key file excerpts, and Base CCG
  Routing Evidence are present. GPT Pro may add implementation sketches, localized pseudo patches,
  key function drafts, test samples, and verification commands.

All code-like GPT Pro output is advisory / illustrative. Codex or Claude must reimplement it
locally, run verification, and review the resulting diff.

## Project Access Context

The helper must include project metadata in every GPT Pro prompt:

- local project name;
- sanitized repository URL, when detected from Git or provided with `--repo-url`;
- current branch and commit;
- whether local git status is clean or dirty.

GitHub links are useful but not sufficient by themselves. The repository URL is optional context, not the source of truth.

- If GPT Pro can use ChatGPT GitHub connector, Deep Research, or browsing, it may inspect the repository URL and cite exact file paths or commits.
- If GPT Pro cannot access the repository URL, it must not guess repository facts.
- Pasted CCG input, Base CCG Routing Evidence, Gemini evidence when provided, diffs, and file
  excerpts have priority over repository content because local uncommitted changes may not exist on
  GitHub.
- If the repository URL is missing, the prompt must explicitly show `Repository URL: not provided`.
- The helper must sanitize repository URLs before including them in prompts or `status.json`; never include credentials, access tokens, cookies, or local filesystem paths as repository URLs.

## Workflow

1. Build a prompt using the selected mode template.
2. Write `status.json`, `round-1/prompt.md`, and `round-1/response.md`.
3. Launch the local bridge page when the user needs an interactive page.
4. The preview page may copy the prompt through browser clipboard APIs only.
5. The user manually pastes prompt into ChatGPT Pro.
6. The user manually sends the prompt.
7. The user manually copies ChatGPT Pro response.
8. The user manually pastes it into the bridge page or `response.md`.
9. Codex reads `response.md`.
10. Codex summarizes and decides next steps in Chinese.

## Manual Handoff Barrier

After creating a GPT Pro bridge session, Codex must stop at a manual handoff barrier.

- Run `scripts/gptpro_bridge.py` with `--detach-preview --open-preview`, the required routing
  evidence arguments, and the mode-appropriate Gemini evidence arguments for round 1 sessions.
- Add `--repo-url <repository-url>` only when Codex needs to override the detected Git remote URL.
- Follow-up sessions may pass fresh Gemini/routing evidence with the same arguments, or inherit the
  existing `gemini_evidence` and `routing_evidence` provenance from round 1.
- Do not paste the full generated prompt into chat during normal handoffs.
- Show the preview URL, session directory, prompt file path, response file path, and status file path.
- Tell the user to open the preview page and use the preview page Copy Prompt button, or open `prompt.md` if the browser copy button fails.
- Tell the user to manually paste the prompt into ChatGPT Pro, manually send it, manually copy the output, and manually save it in the local bridge page or `response.md`.
- End the current assistant turn immediately after the manual handoff instructions. Do not continue planning, reviewing, executing, summarizing GPT Pro findings, or claiming the GPT Pro bridge is complete in the same turn.
- On a later turn, continue only after `status.json` shows `response_saved=true` and `response.md is non-empty`.
- If `response_saved=true` but `response.md is non-empty` is false, treat the bridge as incomplete and ask the user to save a non-empty manual response.

## Script

Use `scripts/gptpro_bridge.py`. The script creates local artifacts and exposes only localhost endpoints:

- `GET /`
- `GET /state`
- `POST /save-response`
- `POST /mark-copied`

It may open `https://chatgpt.com/` in a browser as a convenience. It must not automate ChatGPT web login, prompt submission, DOM extraction, or output extraction.

Use `--detach-preview` for normal skill-driven handoffs so the helper prints the local URL and returns while the localhost page remains available for the user's manual response.

Use `--print-prompt` only for diagnostics, fixtures, or explicit debugging requests, not for normal user-facing handoffs.
