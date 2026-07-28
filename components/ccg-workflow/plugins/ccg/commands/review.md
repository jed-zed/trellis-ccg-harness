---
description: "Review a CCG implementation with Codex plus optional Gemini evidence"
argument-hint: "[diff-or-plan-path]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For final review append --trigger final_diff_verify and bind the actual --diff plus any --plan, --target, and --dependency files. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Review

The user invoked:

```text
/ccg:review $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:executor`.

Review the current diff or the implementation associated with `$ARGUMENTS`.
Codex performs the primary review. For non-trivial, risky, or explicitly
requested CCG reviews, Gemini may provide bounded second-pass review evidence.
Codex verifies findings before reporting them.

If Gemini is used, invoke the bundled browser preview helper automatically. Do not ask the user to run `/ccg:gemini-preview` first and do not call the raw Gemini CLI directly.

Claude is disabled for ordinary review delegation. It may run only when
unified CCG routing selects Claude for the isolated, read-only
`product-manager` role and the project allows it; do not conflate that evidence
with the primary CCG review or workspace authority.
