---
description: "Automated ChatGPT Pro sidebar bridge for CCG review evidence"
argument-hint: "[plan-or-diff] [--task <task-id>] [--followup <session-dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write]
---

# /ccg:gptpro-review

$ARGUMENTS

Use this command when a CCG task needs an automated ChatGPT Pro review after the ordinary `/ccg:review`
semantics have already run. Review is GPT Pro's highest-value default use case because concrete
diffs, findings, and tests let it focus on missed risks instead of inventing implementation context.

## Contract

For a pure local code review, do not run Grok external-intelligence or apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain, write the bounded review subject to the active task directory, then run
`ccg route --workflow gptpro-review --phase final-verify --task-file <request-file> --state-file <state-file> --trigger final_diff_verify --plan <plan> --diff <diff> --dependency <lockfile>`
with repeated `--official-domain <domain>` chosen before Grok runs, over the exact plan, applied diff, dependency locks, and relevant tests before
ordinary `/ccg:review`. Required exit 2/3/4 stops GPT Pro bridge creation unless the user runs
`ccg route waive --state-file <state-file> --reason "<user reason>"`; this records a route-state waiver without creating evidence or claiming verification passed. A waived route continues only through ordinary routing evidence and must omit the bridge's external-intelligence flags. Exit code `2`, `3`, or `4` stops before ordinary work. Add
`--require-external-intelligence` together with `--expected-intelligence-mode <route investigation_mode>` and `--expected-intelligence-depth <route depth>` only when the inherited/re-evaluated route has `status=verified or status=received_unverified` and `requirement=required`.
Then run ordinary `/ccg:review`. Preserve the current CCG orchestrator semantics and the normal
cross-review/model routing for this installation, including any configured role providers that
ordinary review would use. GPT Pro is additional evidence: it is appended as a sidebar review
second opinion after ordinary routing evidence exists. In this command GPT Pro is a high-value
external reviewer for hidden bugs, security risks, compatibility risks, edge cases, test gaps, and
ordinary model false positives or missed findings.

The ordinary review stage follows the **Companion Role Contract**: frontend or
backend makes search required and evaluates the product-manager authorization
gate. This named command then adds GPT Pro without changing saved roles.

GPT Pro is not a `codeagent-wrapper` backend and must not be routed through `model-router.md` as an
automated model. Do not replace routed models, skip ordinary review, or use GPT Pro to invent
missing routed-provider evidence.

Hard boundaries:

- Do not automate ChatGPT login, cookies, tokens, or arbitrary DOM. Only the installed
  `chatgpt-pro-sidebar` Skill may use the fixed bounded DOM contract and `agent-browser-cli-v2`.
- Do not paste the full generated prompt into the chat unless the user explicitly asks.
- Do not continue analysis until the sidebar watcher reaches a terminal state and the bridge
  successfully imports a non-empty GPT Pro response.
- Do not store full GPT Pro evidence in `task.json`; use task-local `evidence.json`.

## Required Inputs

Resolve `<task-dir>` and `<evidence-root>` before continuing:

- Native CCG: `<task-dir> = .ccg/tasks/<task-id>` and `<evidence-root> = <task-dir>`.
- Trellis authority: `<task-dir> = .trellis/tasks/<task-id>` and
  `<evidence-root> = <task-dir>/.ccg-evidence`.

For Trellis authority, never create a parallel `.ccg/tasks/<task-id>` and never write CCG gate
fields into Trellis `task.json`.

1. Locate the active task at `<task-dir>/task.json`.
2. Resolve review scope from `$ARGUMENTS`, `git diff HEAD`, the active plan, or changed files.
3. Only for a current external-fact dependency, run `/ccg:grok-verify` with predeclared `--official-domain` values, the exact plan, diff, and every changed dependency/lock input.
   Validate the canonical Grok artifact and manifest hashes plus the task pointer. Never pass raw JSONL.
4. Run or verify the ordinary `/ccg:review` route first and write a concise routing evidence file,
   for example `<evidence-root>/evidence/routing.md`, plus a routing summary file.
   The routing evidence must identify the current orchestrator, the routed model evidence that
   actually exists, the ordinary reviewer conclusion, `searchStatus`,
   `productManagerStatus`, and any skipped/failed model steps. Product-manager
   invocation still needs explicit per-call authorization.
5. If ordinary review used Gemini, validate its optional gate evidence from
   `<evidence-root>/evidence.json`. Legacy `task.json.gemini_evidence` or
   `task.json.gemini_gate` may be normalized for read compatibility, but do not
   expand large evidence arrays into `task.json`. Absence of Gemini evidence
   must not block GPT Pro when Base CCG Routing Evidence is valid.

## Bridge Creation

Create a concise prompt file with:

- task title, phase, gate, and next action;
- review scope and relevant diff/file excerpts;
- Project Access Context is injected by the bridge with repository URL, branch, commit, and local
  status; pasted diffs and local evidence override repository contents when they differ;
- Base CCG Routing Evidence summary and artifact path;
- optional Gemini evidence summary and artifact path when Gemini actually ran;
- validated Grok diff-bound summary, claims, evidence/manifest paths and hashes only when the external-fact path ran; never raw events;
- explicit request for hidden bugs, security risks, compatibility risks, edge cases, test gaps,
  likely false positives, and missed findings in ordinary model evidence;
- required output sections: `Critical`, `Major`, `Minor`, `False Positives`, and `Required Tests`.

Then invoke the task-local bridge:

```bash
python "<installed-ccg-plugin>/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py" \
  --mode review \
  --workdir "$WORKDIR" \
  --task-dir "<task-dir>" \
  --source-command "/ccg:gptpro-review" \
  --prompt-file "<prompt-file>" \
  --slug "<task-id>-review" \
  --gemini-policy optional \
  --gemini-evidence-role gate \
  --routing-evidence-file "<routing-evidence-file>" \
  --routing-summary-file "<routing-summary-file>" \
  --require-routing-evidence \
  [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=verified or status=received_unverified and requirement=required]
```

When ordinary review produced genuine Gemini evidence, also pass
`--gemini-response-file` and `--gemini-summary-file`. Never invent them.

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
  "nextAction": "The atomic RootWait round is active; continue after run-root returns completed evidence."
}
```

For a Trellis task, do not write those CCG gate fields into `task.json`; preserve Trellis lifecycle
state and use bridge `status.json` plus the sidebar watcher evidence for the wait state.

Use the installed `chatgpt-pro-sidebar` Skill to create a fresh conversation, then invoke watcher
`run-root` once so prompt submission, watcher start, and local wait stay in the current root turn.
For explicitly independent parallel review slices, use the shared bridge batch create -> `run-batch-root`
-> batch import contract with the fixed `3` per-task / `6` global cap.
Never ask the user to copy the prompt or response.

Continue only after:

- `CCG_GPTPRO_SIDEBAR_IMPORTED=1`;
- `status.json` shows the current round response saved with transport `chatgpt-pro-sidebar`;
- `response.md` is non-empty;
- `response_sha256` is present for the saved round;
- `<evidence-root>/evidence.json` contains the GPT Pro item.

## Round Budget

Default one GPT Pro question. A second round is only for blocker re-check after fixes,
revised plan comparison, applied diff review, or another high-risk follow-up. If more is needed,
split the task or return to native CCG planning/review.
