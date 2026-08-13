---
description: "Review a CCG spec, plan, and implementation diff"
argument-hint: "<spec-name-or-path>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Evidence Mode Selection

For a pure local code review, do not run or invoke Grok external-intelligence and do not apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain and run the shared route from the controller:

`ccg route --workflow spec-review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For that external-fact path, add repeated `--official-domain <domain>` chosen before Grok runs, and bind the proposal, target, plan, and diff. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Spec Review

The user invoked:

```text
/ccg:spec-review $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:spec-review`.

Validate the spec artifacts first, then check implementation against constraints, acceptance criteria, tests, scope, and security-sensitive deltas.
