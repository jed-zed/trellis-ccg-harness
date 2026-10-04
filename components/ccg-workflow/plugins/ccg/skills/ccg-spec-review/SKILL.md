---
name: spec-review
description: Review CCG spec, plan, implementation, and tests for consistency. Use when the user invokes /ccg:spec-review.
---

## Research

Use existing independent research agents with grok-search MCP. Search actively and
verify key conclusions against original sources; check versions/licenses when
reusing code and experiment conditions when adopting papers. Mark unverified findings.
Archived instructions below are inactive: ordinary work does not run Grok CLI/ACP,
wait for its gates, or require its manifests and hash packages.

<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
## Evidence Mode Selection

For a pure local code review, do not run or invoke Grok external-intelligence and do not apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain and run the shared route from the controller:

`ccg-codex route --workflow spec-review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg-codex route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

For that external-fact path, add repeated `--official-domain <domain>` chosen before Grok runs, and bind the proposal, target, plan, and diff. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.
-->

# CCG Spec Review

Review spec-driven work for consistency and scope control.

## Checks

- Run `../ccg-spec-init/scripts/spec_manager.js validate <name> --json` before review.
- Require both constraints and plan artifacts before treating the spec as reviewable.
- Implemented behavior matches constraints.
- Tests map to acceptance criteria.
- No out-of-scope behavior was added.
- Security-sensitive deltas were reviewed.
- Review output is written or summarized in Chinese and may update `.codex/ccg/specs/<name>/review.md` when requested.

Follow the shared **Companion Role Contract** for the bounded second-pass
review: frontend or backend evaluates advisory search and the mapped
product-manager gate. Codex makes the final judgment.

## Output Contract

Every review must include:

```markdown
### Summary Scorecard
| Dimension | Status |
| --- | --- |
| Completeness | X/Y tasks |
| Correctness | M/N acceptance criteria covered |
| Coherence | Followed / Issues |
```

Then group findings as `CRITICAL`, `WARNING`, and `SUGGESTION`, and finish with `Final Assessment`. Critical findings must make the final assessment blocked until fixed.
