---
description: "Collect current Grok evidence for a plan, diff, and dependencies"
argument-hint: "<task> --diff <file> [--official-domain <domain>] [--plan <file>] [--dependency <file>] [--force-refresh] [--export <dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# /ccg:grok-verify

$ARGUMENTS

Use the installed `ccg:grok-verify` skill. Bind the exact plan digest, mandatory non-empty diff
digest, and dependency digests. Pass a trusted `--official-domain` when one is known; otherwise
preserve `official_unknown` instead of blocking or guessing. Do not use this Web/X command for pure
local code review. Print requirement/status/search counts plus evidence/manifest paths and hashes. Propagate
exit 2, exit 3, and exit 4 exactly.
Treat `received_unverified` as a usable response, not an invocation failure.
Use `--allow-empty-diff` only when the task explicitly verifies that no repository change exists.
