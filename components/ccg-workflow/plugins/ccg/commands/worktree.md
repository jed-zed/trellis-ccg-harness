---
description: "Manage Git worktrees safely"
argument-hint: "list|add <branch>|remove <path> [--dry-run|--confirm]"
allowed-tools: [Read, Glob, Grep, Bash, Edit, Write, WebFetch]
---

> External intelligence default: this Git-only workflow does not invoke Grok automatically. Use `/ccg:grok-intel` or `/ccg:grok-verify` explicitly when external evidence is actually required.

# CCG Worktree

The user invoked:

```text
/ccg:worktree $ARGUMENTS
```

Use the installed CCG plugin skill `ccg:worktree`.

Never remove the current directory or a dirty worktree. Default removal behavior is dry-run.
