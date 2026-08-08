---
description: "Collect source-backed external intelligence with Grok"
argument-hint: "<task> [--mode discover|contract|incident|landscape] [--depth normal|deep] [--official-domain <domain>] [--force-refresh] [--export <dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# /ccg:grok-intel

$ARGUMENTS

Use the installed `ccg:grok-intel` skill. Default to a single-agent normal-depth run. Support
`--mode`, `--depth`, repeated trusted `--official-domain`, `--force-refresh`, and `--export`; print requirement/status/search counts and
evidence/manifest paths/hashes. Propagate exit 2, exit 3, and exit 4 exactly.
