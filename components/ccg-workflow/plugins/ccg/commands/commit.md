---
description: "Prepare a safe CCG commit with optional scoped gate collection"
argument-hint: "[--check-gates] [--scope staged|all] [--execute|--confirm]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

> External intelligence default: this Git-only workflow does not invoke Grok automatically. Use `/ccg:grok-intel` or `/ccg:grok-verify` explicitly when external evidence is actually required.

# CCG Commit

The user invoked:

```text
/ccg:commit $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:commit`.

Default behavior is dry-run: inspect status, optionally collect gate results, and show a commit message. Commit only when the user explicitly asks for direct execution.
