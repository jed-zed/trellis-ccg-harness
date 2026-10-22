---
name: review
description: Review a CCG implementation with the applicable frontend, backend, or search providers and Codex as final verification owner. Use when the user invokes /ccg:review or asks for CCG review of a diff/plan.
---

## Research

Use existing independent research agents with grok-search MCP. Search actively and
verify key conclusions against original sources; check versions/licenses when
reusing code and experiment conditions when adopting papers. Mark unverified findings.
Ordinary work does not run Grok CLI/ACP,
wait for its gates, or require its manifests and hash packages.

For a pure local code review, use the bound diff, source, tests and CI;
do not run external-intelligence. Research current external facts only when
the review conclusion depends on them.

# CCG Review

Load and follow `skills/ccg-executor/SKILL.md`.

Review the supplied target or task diff; bind its files and revision before
reviewing. Read `../../rules/ccg-role-routing.md`, follow its **Companion Role
Contract**, classify changed areas as frontend, backend, and any materially
useful search slice, then resolve the required top-level providers. Review is a phase
inside each role. Have Codex verify every finding's location, trigger,
actual consequence and supporting contract/evidence before reporting it.
Zero findings is valid. Keep optional suggestions separate from defects;
do not require hypothetical compatibility or unsupported-platform tests.
Preserve real security and data-loss concerns.

Review does not authorize repairing every dirty file. Apply a verified fix
only when both the current task and explicit write ownership cover it;
otherwise report it. Use `../../rules/ccg-quality-gates.md` for proportional
verification, mandatory repository/CI checks and stopping conditions.

When a selected provider is Gemini, run the bundled
`../ccg-executor/scripts/invoke_gemini_preview.py` foreground command in a
tool-managed background job with `--prompt-template review`; monitor it until
completion and do not pass `--detach` or call the raw Gemini CLI. For another
provider, pass the prompt through stdin and do not add `--lite`. If advisory
search evidence is missing, say so and continue without claiming it occurred.

When a selected provider is Grok, treat ordinary code review as local-only;
do not run the external-intelligence route. Build the prompt from the bundled
Grok reviewer template and an exact `CCG_REVIEW_TARGETS` list of the regular
workspace-relative files being reviewed. Invoke `ccg-codex wrapper --backend grok
--progress --grok-review-target <file> - "<workdir>"` with one target flag per
listed file and the prompt through stdin; do not add `--lite`. The wrapper
snapshots only those files, runs a fresh Grok session, and appends the exact
scope envelope. A zero exit and
the validated final `CCG_GROK_REVIEW_JSON` envelope are required before claiming
Grok reviewed the files. If no concrete target file can be bound, report missing
Grok review evidence. Codex must independently verify every finding.

When a selected provider is Antigravity or Claude, bind the same concrete
review files and invoke `../ccg-executor/scripts/invoke_provider_review.py`
with `--backend <provider> --workdir "<workdir>"` plus one `--target <file>` per
bound file, passing the prompt through stdin. The helper copies only those
files into a disposable snapshot and runs the provider there with its native
permission mode. For unattended Antigravity snapshot review only, the helper
passes `--skip-permissions`; ordinary Antigravity frontend/backend/resume calls
remain conditional. The snapshot bounds the default input and working directory;
it is not an OS sandbox and does not override native absolute-path or network
capabilities. Require a completed model report before claiming review evidence;
otherwise report it as missing.

Claude may be explicitly selected for `frontend`, `backend`, or
`product-manager`. It is not eligible for `search`; defaults and no-fallback
behavior remain unchanged.

## Review result

Report the conclusion, verified findings (or zero), verification scope/limits
and next action in natural Chinese, usually within one screen. Link precise
locations and evidence where useful. Missing evidence is an explicit limit,
not a guessed score. Unresolved blockers remain incomplete; optional advice
does not become a requirement. No numerical scorecard is required.
