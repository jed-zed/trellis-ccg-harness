---
description: "Manual ChatGPT Pro bridge for CCG review evidence"
argument-hint: "[plan-or-diff] [--task <task-id>] [--followup <session-dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write]
---

# /ccg:gptpro-review

$ARGUMENTS

Use this command when a CCG task needs a manual ChatGPT Pro review after the ordinary `/ccg:review`
semantics have already run. Review is GPT Pro's highest-value default use case because concrete
diffs, findings, and tests let it focus on missed risks instead of inventing implementation context.

## Contract

Run `/ccg:grok-verify` through the shared automatic route: write the bounded review subject to the active task directory, then run
`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs --workflow gptpro-review --phase final-verify --task-file <request-file> --state-file <state-file> --trigger final_diff_verify --plan <plan> --diff <diff> --dependency <lockfile>`
over the exact plan, applied diff, dependency locks, and relevant tests before
ordinary `/ccg:review`. Required exit 2/3/4 stops GPT Pro bridge creation unless the user runs
`node ~/.claude/.ccg/engine/tools/grok-intelligence/route.mjs waive --state-file <state-file> --reason "<user reason>"`; this records a route-state waiver without creating evidence or claiming verification passed. A waived route continues only through ordinary routing evidence and must omit the bridge's external-intelligence flags. Exit code `2`, `3`, or `4` stops before ordinary work. Add
`--require-external-intelligence` together with `--expected-intelligence-mode <route investigation_mode>` and `--expected-intelligence-depth <route depth>` only when the inherited/re-evaluated route has `status=valid` and `requirement=required`.
Then run ordinary `/ccg:review`. Preserve the current CCG orchestrator semantics and the normal
cross-review/model routing for this installation, including Codex, Claude, Gemini, or any configured
helper that ordinary review would use. GPT Pro is fourth evidence: it is appended as a manual review
second opinion after ordinary routing evidence exists. In this command GPT Pro is a high-value
external reviewer for hidden bugs, security risks, compatibility risks, edge cases, test gaps, and
ordinary model false positives or missed findings.

Ordinary review must include Claude evidence unless the user explicitly says Claude must not be
used. First try `~/.claude/bin/codeagent-wrapper[.exe] --backend claude`. If the automatic Claude
route fails or returns empty output, stop before creating the GPT Pro bridge, tell the user Claude
evidence is missing, and offer a manual Claude Code handoff: write the Claude prompt to a file, ask
the user to paste it into Claude Code, then paste/save Claude's response back before continuing.

GPT Pro is not a `codeagent-wrapper` backend and must not be routed through `model-router.md` as an
automated model. Do not replace routed models, skip ordinary review, or use GPT Pro to decide that
missing Codex, Claude, or Gemini evidence exists.

Hard boundaries:

- Do not automate ChatGPT login, prompt submission, DOM reading, output extraction, cookies, or tokens.
- Do not paste the full generated prompt into the chat unless the user explicitly asks.
- Do not continue analysis after creating the bridge until the user saves a non-empty response.
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
3. Run `/ccg:grok-verify` with the exact plan, diff, and every changed dependency/lock input.
   Validate the canonical Grok artifact and manifest hashes plus the task pointer. Never pass raw JSONL.
4. Run or verify the ordinary `/ccg:review` route first and write a concise routing evidence file,
   for example `<evidence-root>/evidence/routing.md`, plus a routing summary file.
   The routing evidence must identify the current orchestrator, the routed model evidence that
   actually exists, `claudeEvidenceStatus: automatic|manual_handoff|skipped_by_user|blocked`, the
   ordinary reviewer conclusion, and any skipped/failed model steps.
5. Validate required Gemini review/gate evidence from `<evidence-root>/evidence.json`.
   Legacy `task.json.gemini_evidence` or `task.json.gemini_gate` may be normalized for read
   compatibility, but do not expand large evidence arrays into `task.json`.

Required Gemini evidence:

```text
provider=gemini
role=gate
policy=required
available=true
artifactFile exists and is non-empty
artifactSha256 matches when present
```

If required Gemini evidence is missing or invalid, stop and explain the exact missing evidence.
Do not create a GPT Pro bridge session with invented Gemini findings.

## Bridge Creation

Create a concise prompt file with:

- task title, phase, gate, and next action;
- review scope and relevant diff/file excerpts;
- Project Access Context is injected by the bridge with repository URL, branch, commit, and local
  status; pasted diffs and local evidence override repository contents when they differ;
- Base CCG Routing Evidence summary and artifact path;
- Gemini evidence summary and artifact path;
- validated Grok diff-bound summary, claims, evidence/manifest paths and hashes; never raw events;
- explicit request for hidden bugs, security risks, compatibility risks, edge cases, test gaps,
  likely false positives, and missed findings in ordinary model evidence;
- required output sections: `Critical`, `Major`, `Minor`, `False Positives`, and `Required Tests`.

Then invoke the task-local bridge:

```bash
python ~/.claude/.ccg/engine/tools/gptpro/gptpro_bridge.py \
  --mode review \
  --workdir "$WORKDIR" \
  --task-dir "<task-dir>" \
  --source-command "/ccg:gptpro-review" \
  --prompt-file "<prompt-file>" \
  --slug "<task-id>-review" \
  --gemini-policy required \
  --gemini-evidence-role gate \
  --gemini-response-file "<gemini-response-file>" \
  --gemini-summary-file "<gemini-summary-file>" \
  --routing-evidence-file "<routing-evidence-file>" \
  --routing-summary-file "<routing-summary-file>" \
  --require-routing-evidence \
  --require-claude-evidence \
  [--require-external-intelligence --expected-intelligence-mode <route investigation_mode> --expected-intelligence-depth <route depth> when route status=valid and requirement=required] \
  --detach-preview \
  --open-preview
```

If the user explicitly disabled Claude and routing evidence records
`claudeEvidenceStatus: skipped_by_user`, omit `--require-claude-evidence`; do not omit it for
automatic failure or blocked Claude evidence.

Expected artifacts:

```text
<evidence-root>/gptpro/<session-id>/status.json
<evidence-root>/gptpro/<session-id>/round-1/prompt.md
<evidence-root>/gptpro/<session-id>/round-1/response.md
<evidence-root>/evidence.json
```

## Manual Wait State

After bridge creation, update the active task only when native CCG owns lifecycle:

```json
{
  "status": "in_progress",
  "gate": "manual_gptpro_waiting",
  "nextAction": "Open the GPT Pro preview, manually submit the prompt, save the response, then continue."
}
```

For a Trellis task, do not write those CCG gate fields into `task.json`; preserve Trellis lifecycle
state and use bridge `status.json` for the manual wait state.

Report only the preview URL and artifact paths, then stop the current turn.

Continue only after:

- `status.json` shows the current round response saved;
- `response.md` is non-empty;
- `response_sha256` is present for the saved round;
- `<evidence-root>/evidence.json` contains the GPT Pro item.

## Round Budget

Default one manual GPT Pro question. A second round is only for blocker re-check after fixes,
revised plan comparison, applied diff review, or another high-risk follow-up. If more is needed,
split the task or return to native CCG planning/review.
