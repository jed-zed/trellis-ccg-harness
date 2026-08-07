---
description: "Review CCG team outputs, diffs, and tests"
argument-hint: "<team-task-or-diff>"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Evidence Mode Selection

For a pure local code review, do not run or invoke Grok external-intelligence and do not apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain and run the shared route from the controller:

`ccg route --workflow team-review --phase team-intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Only the controller or team leader runs that external-fact path, with repeated `--official-domain <domain>` chosen before Grok runs. Teammates never invoke Grok independently. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Team Review

The user invoked:

```text
/ccg:team-review $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:team-review`.

Summarize worker outputs, inspect diffs and tests, require team plan or status
evidence, and follow the shared **Companion Role Contract** for the second pass.
Codex delivers final judgment in Chinese.
