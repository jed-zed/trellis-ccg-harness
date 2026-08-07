---
description: "Review a CCG implementation with the applicable role providers"
argument-hint: "[diff-or-plan-path]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Evidence Mode Selection

Classify the review before any external route:

- Codex remains the final review owner in both modes.
- For a pure local code review, use the bound diff, source, tests, CI, and local read-only Provider evidence. Do not run or invoke Grok external-intelligence, and do not apply an official-domain gate.
- Only when a review conclusion depends on a current external API, version, advisory, incident, or other external fact, predeclare the authoritative domain from the explicit target or trusted package/repository metadata and run the shared route from the controller:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For that external-fact path, append `--trigger final_diff_verify`, repeated `--official-domain <domain>`, and the actual `--diff` plus any `--plan`, `--target`, and `--dependency` files. The domain must be chosen before Grok runs; never promote a domain merely because Grok returned it. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Review

The user invoked:

```text
/ccg:review $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:review`.

Review the current diff or the implementation associated with `$ARGUMENTS`.
Follow the shared **Companion Role Contract**, then use the required providers
for bounded review evidence. Review is an internal phase of each role.
Codex verifies findings before reporting them. When a selected role
uses Gemini, invoke the bundled browser preview helper automatically and do not
call the raw Gemini CLI.

For local Grok review, bind an exact `CCG_REVIEW_TARGETS` list and pass each
regular workspace-relative file through `--grok-review-target`. The wrapper
must embed only those files in a fresh, tool-less Provider session. Require a
zero exit and wrapper-generated, validated `CCG_GROK_REVIEW_JSON` envelope. For local Antigravity
review, bind the concrete files in the prompt and invoke `ccg wrapper --backend
antigravity --antigravity-review`; require a completed model report. Neither
local path uses the external-intelligence route or an official-domain gate.

Claude is disabled for ordinary review delegation. It may run only when
unified CCG routing selects Claude for the isolated, read-only
`product-manager` role and the project allows the explicit provider call.
