---
description: "Verify plan, diff, and dependencies against current Grok evidence"
argument-hint: "<task> --diff <file> --official-domain <domain> [--plan <file>] [--dependency <file>] [--force-refresh] [--export <dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# /ccg:grok-verify

$ARGUMENTS

Use the installed `ccg:grok-verify` skill. Bind the exact plan digest, mandatory non-empty diff
digest, and dependency digests. Before Grok runs, derive at least one authoritative domain from the
explicit external-fact target or trusted metadata and pass repeated `--official-domain`; do not use
this Web/X command for pure local code review. Print requirement/status/search counts plus evidence/manifest paths and hashes. Propagate
exit 2, exit 3, and exit 4 exactly.
Use `--allow-empty-diff` only when the task explicitly verifies that no repository change exists.
