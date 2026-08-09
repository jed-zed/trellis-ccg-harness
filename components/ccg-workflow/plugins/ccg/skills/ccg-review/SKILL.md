---
name: review
description: Review a CCG implementation with the applicable frontend, backend, or search providers and Codex as final verification owner. Use when the user invokes /ccg:review or asks for CCG review of a diff/plan.
---

## Evidence Mode Selection

Classify the review before any external route:

- For a pure local code review, use the bound diff, source, tests, CI, and local read-only Provider evidence. Do not run or invoke Grok external-intelligence, and do not apply an official-domain gate.
- Only when a review conclusion depends on a current external API, version, advisory, incident, or other external fact, predeclare the authoritative domain from the explicit target or trusted package/repository metadata and run the shared route from the controller:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For that external-fact path, append `--trigger final_diff_verify`, repeated `--official-domain <domain>`, and the actual `--diff` plus any `--plan`, `--target`, and `--dependency` files. The domain must be chosen before Grok runs; never promote a domain merely because Grok returned it. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Review

Load and follow `skills/ccg-executor/SKILL.md`.

Review the current diff or the implementation associated with the supplied
plan/task. Read `../../rules/ccg-role-routing.md`, follow its **Companion Role
Contract**, classify changed areas as frontend, backend, search, or a
combination, then resolve the required top-level providers. Review is a phase
inside each role. Have Codex verify every finding before reporting it.

When a selected provider is Gemini, run the bundled
`../ccg-executor/scripts/invoke_gemini_preview.py` foreground command in a
tool-managed background job with `--prompt-template review`; monitor it until
completion and do not pass `--detach` or call the raw Gemini CLI. For another
provider, run `ccg wrapper --backend <provider> --read-only --progress - "<workdir>"`;
pass the prompt through stdin and do not add `--lite`. If required external
review evidence is missing, say so and do not claim it occurred.

When a selected provider is Grok, treat ordinary code review as local-only;
do not run the external-intelligence route. Build the prompt from the bundled
Grok reviewer template and an exact `CCG_REVIEW_TARGETS` list of the regular
workspace-relative files being reviewed. Invoke `ccg wrapper --backend grok --read-only --progress --grok-review-target <file> - "<workdir>"` with one target flag per listed file and the prompt through stdin; do not add `--lite`. The wrapper snapshots only those files,
runs Grok without tools, and appends the exact scope envelope. A zero exit and
the validated final `CCG_GROK_REVIEW_JSON` envelope are required before claiming
Grok reviewed the files. If no concrete target file can be bound, report missing
Grok review evidence. Codex must independently verify every finding.

When a selected provider is Antigravity, bind the same concrete review files
in the prompt and invoke `ccg wrapper --backend antigravity --read-only --progress --antigravity-review - "<workdir>"` with the prompt through stdin; do not add `--lite`. Require a completed model report before claiming
Antigravity review evidence; otherwise report it as missing. This review mode
is restricted to sandboxed plan execution with slash commands disabled.

When frontend/backend routing selects Claude, use the generic managed read-only
wrapper contract above. This role evidence is separate from any explicitly
selected and authorized read-only `product-manager` contract.
