---
description: "Verify a plan, diff, or dependency change against current external evidence"
argument-hint: "<task> --diff <file> [--plan <file>] [--dependency <file>] [--force-refresh] [--export <dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# /ccg:grok-verify

$ARGUMENTS

Run post-implementation external-fact verification through the same isolated official Grok ACP
runner used by `/ccg:grok-intel`. Never use the legacy Grok Search MCP as evidence.

## Procedure

1. Resolve the task and the exact plan, applied diff, and dependency/lock files in scope. `--diff`
   is mandatory and must normally be non-empty; generate it from the bounded Git worktree when the
   user did not provide a trusted diff artifact. Use `--allow-empty-diff` only when the explicit
   verification subject is that no repository change exists.
2. Write task text to a bounded UTF-8 file under `.ccg/tasks/<task-id>/`; never interpolate it into
   a shell command.
3. Run:

```text
node ~/.claude/.ccg/engine/tools/grok-intelligence/command.mjs verify --task-file <task-file> --diff <file> [--plan <file>] [--dependency <file>] [--force-refresh] [--export <dir>]
```

The runner computes and records a plan digest, diff digest, and every dependency digest. Missing or
changed inputs invalidate the verification scope; do not reuse evidence bound to different bytes.

Print `requirement`, `status`, search counts, bound digests, evidence/manifest paths, and both hashes.
Propagate exit 2 (required evidence unavailable), exit 3 (unsafe context/policy violation), and exit 4
(login/consent/configuration missing) without downgrade. Codex remains the final adjudicator.
