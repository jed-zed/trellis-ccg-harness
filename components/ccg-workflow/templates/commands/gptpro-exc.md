---
description: "Automated ChatGPT Pro sidebar execution route review bridge"
argument-hint: "<task-or-plan> [--task <task-id>] [--followup <session-dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write]
---

# /ccg:gptpro-exc

$ARGUMENTS

Use this command when a CCG task needs one automated GPT Pro execution route review after the
ordinary `/ccg:execute` semantics have completed preflight and routing evidence, but before real
code landing begins.

## Contract

Run the Grok intelligence decision by writing the bounded execution subject to the active task directory, then run
`ccg route --workflow gptpro-exc --phase intake --task-file <request-file> --state-file <state-file>`
before ordinary `/ccg:execute` preflight. The main orchestrator adds a semantic mode/reason whenever
current external evidence is material even if search was not requested. External API,
dependency, deployment, security, and other current-contract routes require canonical Grok evidence;
required exit 2/3/4 stops GPT Pro bridge creation unless the user runs `ccg route waive --state-file <state-file> --reason "<user reason>"`; this records a route-state waiver without creating evidence or claiming verification passed. A waived route continues only through ordinary routing evidence and must omit the bridge's external-intelligence flags. Exit code `2`, `3`, or `4`
stops before ordinary work. Add `--require-external-intelligence` together with `--expected-intelligence-mode <route investigation_mode>` and `--expected-intelligence-depth <route depth>` only for a route with `status=valid` and `requirement=required`. Then run ordinary
`/ccg:execute` through the preflight, plan load, model routing, prototype, or
analysis-evidence phase. Preserve the current CCG orchestrator semantics and the normal execution
routing for this installation, including Codex, Claude, Gemini, or any configured helper that
ordinary execute would use. GPT Pro is fourth evidence: it is appended as a sidebar second opinion
after ordinary routing evidence exists and before the ordinary execute owner applies final code.
In this command GPT Pro decides whether the route is worth local implementation by Codex or Claude;
it is not a fourth implementation owner.

Ordinary execution evidence must include Claude unless the user explicitly says Claude must not be
used. First try `~/.claude/bin/codeagent-wrapper[.exe] --backend claude`. If the automatic Claude
route fails or returns empty output, stop before creating the GPT Pro bridge, tell the user Claude
evidence is missing, and offer a manual Claude Code handoff: write the Claude prompt to a file, ask
the user to paste it into Claude Code, then paste/save Claude's response back before continuing.

GPT Pro provides automated read-only helper evidence only. It must not write files, own delivery, replace routed
models, or decide that missing Codex, Claude, or Gemini evidence exists.
Any code sketch, localized pseudo patch, key function draft, test sample, or verification command
from GPT Pro is advisory / illustrative only and must be reimplemented and verified locally by the
ordinary execute owner.

Gemini behavior still follows ordinary `/ccg:execute` routing:

- Backend-only execution route review sessions should not run Gemini by default.
- Frontend/full-stack sessions may run Gemini first for frontend prototype or frontend-review evidence.
- If Gemini evidence is included, it must come from a real, non-empty response file with a concise
  summary. Do not invent Gemini findings.

Hard boundaries:

- Do not automate ChatGPT login, DOM reading, cookies, or tokens. Only the installed
  `chatgpt-pro-sidebar` Skill may submit prompts and capture bounded UIA output.
- Do not paste the full generated prompt into the chat unless the user explicitly asks.
- Do not continue implementation based on GPT Pro until the sidebar watcher reaches a terminal state
  and the bridge successfully imports a non-empty GPT Pro response.
- Do not store full GPT Pro evidence in `task.json`; use task-local `evidence.json`.

## Required Inputs

Resolve `<task-dir>` and `<evidence-root>` before continuing:

- Native CCG: `<task-dir> = .ccg/tasks/<task-id>` and `<evidence-root> = <task-dir>`.
- Trellis authority: `<task-dir> = .trellis/tasks/<task-id>` and
  `<evidence-root> = <task-dir>/.ccg-evidence`.

For Trellis authority, never create a parallel `.ccg/tasks/<task-id>` and never write CCG gate
fields into Trellis `task.json`.

1. Locate the active task at `<task-dir>/task.json`.
2. Resolve execution scope from `$ARGUMENTS`, the active plan, changed files, or task context.
3. Run `/ccg:grok-intel <execution-contract> --mode contract` when required and validate canonical
   artifact/manifest hashes plus the task pointer. After implementation, run `/ccg:grok-verify` if
   plan, diff, dependency, or external-contract digests changed.
4. Run ordinary `/ccg:execute` preflight and model routing up to the point where implementation
   advice can still change the path safely. Write a concise routing evidence file, for example
   `<evidence-root>/evidence/routing.md`, plus a routing summary file. The routing evidence
   must identify the current orchestrator, the routed model evidence that actually exists, the
   `claudeEvidenceStatus: automatic|manual_handoff|skipped_by_user|blocked`,
   `searchStatus: invoked|failed|not_applicable`, `productManagerStatus:
   authorization_required|authorized|declined|disabled|unavailable|completed|not_applicable`, ordinary
   execute conclusion so far, and any skipped/failed model steps. The ordinary
   Companion Role Contract makes search required for frontend/backend, where
   `not_applicable` is forbidden; a
   product-manager call still needs explicit per-call authorization.
5. Decide whether ordinary routing produced Gemini frontend/full-stack evidence:
   - backend/tooling-only: use `--gemini-policy optional --gemini-evidence-role frontend-prototype`
     without forcing a Gemini run;
   - frontend/full-stack: pass the real Gemini response and summary files when ordinary execute
     produced them.
6. Classify GPT Pro implementation evidence quality:
   - weak evidence: routing summary, snippets, or high-level context only; ask GPT Pro for route
     risk, wrong assumptions, missing tests, and `Proceed` / `Revise Plan` / `Stop`;
   - strong evidence: repository URL, branch, commit, current diff or key file excerpts, and Base
     CCG Routing Evidence are present; GPT Pro may add implementation sketches, localized pseudo
     patches, key function drafts, test samples, and verification commands.

## Bridge Creation

Create a concise prompt file with:

- task title, phase, gate, and next action;
- implementation objective and relevant plan/diff/file excerpts;
- Project Access Context is injected by the bridge with repository URL, branch, commit, and local
  status; repository content is supplemental, and local diff/excerpts remain authoritative;
- Base CCG Routing Evidence summary and artifact path;
- Gemini frontend/full-stack evidence when available;
- validated Grok contract summary, claims, artifact/manifest paths and hashes; never raw events;
- explicit request for execution route judgment first, using `Proceed`, `Revise Plan`, or `Stop`;
- required output sections: `Proceed`, `Revise Plan`, `Stop`, `Implementation Notes`,
  `Required Tests`, and `Verification`;
- only request implementation sketch, localized pseudo patch, key function draft, test sample, or
  verification commands when evidence is strong, and require all code-like output to be marked
  `advisory / illustrative`.

For backend/tooling-only execution route review:

```bash
python ~/.claude/.ccg/engine/tools/gptpro/gptpro_bridge.py \
  --mode exc \
  --workdir "$WORKDIR" \
  --task-dir "<task-dir>" \
  --source-command "/ccg:gptpro-exc" \
  --prompt-file "<prompt-file>" \
  --slug "<task-id>-exc" \
  --gemini-policy optional \
  --gemini-evidence-role frontend-prototype \
  --routing-evidence-file "<routing-evidence-file>" \
  --routing-summary-file "<routing-summary-file>" \
  --require-routing-evidence \
  --require-claude-evidence \
  [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=valid and requirement=required]
```

If the user explicitly disabled Claude and routing evidence records
`claudeEvidenceStatus: skipped_by_user`, omit `--require-claude-evidence`; do not omit it for
automatic failure or blocked Claude evidence.

For frontend/full-stack execution route review with Gemini evidence, also pass:

```bash
  --gemini-response-file "<gemini-response-file>" \
  --gemini-summary-file "<gemini-summary-file>"
```

Expected artifacts:

```text
<evidence-root>/gptpro/<session-id>/status.json
<evidence-root>/gptpro/<session-id>/round-1/prompt.md
<evidence-root>/gptpro/<session-id>/round-1/response.md
<evidence-root>/evidence.json
```

## Sidebar Watch State

After bridge creation, update the active task only when native CCG owns lifecycle:

```json
{
  "status": "in_progress",
  "gate": "gptpro_sidebar_running",
  "nextAction": "The sidebar watcher is registered; continue in this task when the Stop Hook fires."
}
```

For a Trellis task, do not write those CCG gate fields into `task.json`; preserve Trellis lifecycle
state and use bridge `status.json` plus the sidebar watcher evidence for the wait state.

Use the installed `chatgpt-pro-sidebar` Skill to create a fresh conversation, submit `prompt.md`,
start the detached watcher, and then stop the current turn. Never ask the user to copy the prompt or
response.

Continue only after:

- `CCG_GPTPRO_SIDEBAR_IMPORTED=1`;
- `status.json` shows the current round response saved with transport `chatgpt-pro-sidebar`;
- `response.md` is non-empty;
- `response_sha256` is present for the saved round;
- `<evidence-root>/evidence.json` contains the GPT Pro item.

## Round Budget

Default one GPT Pro question. A second round should normally become `/ccg:gptpro-review`
after Codex applies changes. Use round 2 only for blocker re-check, applied diff review, or another
high-risk follow-up.
