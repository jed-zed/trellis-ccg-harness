---
description: "Automated ChatGPT Pro sidebar bridge for CCG planning evidence"
argument-hint: "<task-or-plan> [--task <task-id>] [--followup <session-dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write]
---

# /ccg:gptpro-plan

$ARGUMENTS

Use this command when a CCG task needs an automated ChatGPT Pro adversarial plan review after the
ordinary `/ccg:plan` semantics have already run.

## Contract

Run the Grok intelligence decision by writing the bounded planning subject to the active task directory, then run
`ccg route --workflow gptpro-plan --phase intake --task-file <request-file> --state-file <state-file>`
before ordinary `/ccg:plan`. The main orchestrator adds `--semantic-mode contract|incident` and a
reason when external evidence is materially useful even if the user did not request search. When external intelligence is
required, the shared route must produce canonical source-backed evidence before any routed
planning evidence or GPT Pro session is created. Required exit 2/3/4 stops this workflow unless the
user supplies an explicit route-state waiver with `ccg route waive --state-file <state-file> --reason "<user reason>"`; the waiver does not create evidence or claim verification passed. A waived route continues only through ordinary routing evidence and must omit the bridge's external-intelligence flags. Exit code `2`, `3`, or `4` stops before ordinary work.
Add `--require-external-intelligence` together with `--expected-intelligence-mode <route investigation_mode>` and `--expected-intelligence-depth <route depth>` only when the route state says `status=valid` and `requirement=required`.
Then run ordinary `/ccg:plan`. Preserve the current CCG orchestrator semantics and the normal
model routing for this installation, including any configured role providers that ordinary
planning would use. GPT Pro is additional evidence: it is appended as a sidebar planning second
opinion after ordinary routing evidence exists. In this command GPT Pro is a risk-triggered
external reviewer: it challenges the existing plan, but must not rewrite the whole plan or replace
the current orchestrator's planning authority.

The ordinary planning stage follows the applicable frontend, backend, and
search providers. This named command then adds GPT Pro without changing the
saved roles.

GPT Pro is not a `codeagent-wrapper` backend and must not be routed through `model-router.md` as an
automated model. Do not replace routed models, skip ordinary planning, or use GPT Pro to invent
missing routed-provider evidence.

Plan-only boundary:

- Do not execute implementation.
- Do not apply product code changes.
- Only create or update CCG plan artifacts and GPT Pro bridge artifacts.
- After the sidebar watcher reaches a terminal state and the bridge successfully imports a non-empty
  GPT Pro response, synthesize ordinary planning evidence plus GPT Pro planning findings, write or
  revise the plan through the current orchestrator, report the plan path, and stop.
- Execution requires a separate `/ccg:execute <plan>` or `/ccg:codex-exec <plan>` request.

Hard boundaries:

- Do not automate ChatGPT login, DOM reading, cookies, or tokens. Only the installed
  `chatgpt-pro-sidebar` Skill may submit prompts and capture bounded UIA output.
- Do not paste the full generated prompt into the chat unless the user explicitly asks.
- Do not continue planning synthesis until the sidebar watcher reaches a terminal state and the bridge
  successfully imports a non-empty GPT Pro response.
- Do not store full GPT Pro evidence in `task.json`; use task-local `evidence.json`.

## Required Inputs

Resolve `<task-dir>` and `<evidence-root>` before continuing:

- Native CCG: `<task-dir> = .ccg/tasks/<task-id>` and `<evidence-root> = <task-dir>`.
- Trellis authority: `<task-dir> = .trellis/tasks/<task-id>` and
  `<evidence-root> = <task-dir>/.ccg-evidence`.

For Trellis authority, never create a parallel `.ccg/tasks/<task-id>` and never write CCG gate
fields into Trellis `task.json`.

1. Locate or create the native CCG task, or locate the existing Trellis task, at
   `<task-dir>/task.json`.
2. Resolve the planning subject from `$ARGUMENTS`, an existing plan file, or task context.
3. Run `/ccg:grok-intel <planning-subject> --mode contract` when required. Validate the canonical
   `grok/external-intelligence/required` item, artifact hash, manifest hash, and task pointer. Never
   pass raw JSONL to GPT Pro.
4. Run or verify the ordinary `/ccg:plan` route first and write a concise routing evidence file,
   for example `<evidence-root>/evidence/routing.md`, plus a routing summary file.
   The routing evidence must identify the current orchestrator, the routed model evidence that
   actually exists, the ordinary planner conclusion, and any skipped/failed model steps.
5. If ordinary planning used Gemini, validate its optional gate evidence from
   `<evidence-root>/evidence.json`. Legacy `task.json.gemini_evidence` or
   `task.json.gemini_gate` may be normalized for read compatibility, but do not
   expand large evidence arrays into `task.json`. Absence of Gemini evidence
   must not block GPT Pro when Base CCG Routing Evidence is valid.

## Bridge Creation

Create a concise prompt file with:

- task title, phase, gate, and next action;
- requirements, constraints, known code context, and draft plan if present;
- Project Access Context is injected by the bridge with repository URL, branch, commit, and local
  status; if repository URL is unavailable, the prompt must say so and GPT Pro must not guess repo facts;
- Base CCG Routing Evidence summary and artifact path;
- optional Gemini evidence summary and artifact path when Gemini actually ran;
- validated Grok summary, claims, evidence/manifest paths and hashes; never raw events or page bodies;
- explicit request to challenge the existing plan for requirement ambiguity, wrong assumptions,
  architecture risk, missing constraints, test gaps, and whether the plan is worth continuing;
- required output sections: `Blockers`, `Risks`, `Missing Evidence`, `Plan Adjustments`, and `Go-NoGo`.

Then invoke the task-local bridge:

```bash
python "<installed-ccg-plugin>/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py" \
  --mode plan \
  --workdir "$WORKDIR" \
  --task-dir "<task-dir>" \
  --source-command "/ccg:gptpro-plan" \
  --prompt-file "<prompt-file>" \
  --slug "<task-id>-plan" \
  --gemini-policy optional \
  --gemini-evidence-role gate \
  --routing-evidence-file "<routing-evidence-file>" \
  --routing-summary-file "<routing-summary-file>" \
  --require-routing-evidence \
  [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=valid and requirement=required]
```

When ordinary planning produced genuine Gemini evidence, also pass
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

Default one GPT Pro question. A second round is only for blocker re-check or revised plan
comparison. If more is needed, split the task or return to native CCG planning.
