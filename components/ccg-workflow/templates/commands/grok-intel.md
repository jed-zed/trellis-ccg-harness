---
description: "Collect source-backed current Web/X evidence with the isolated Grok CLI profile"
argument-hint: "<task> [--mode discover|contract|incident|landscape] [--depth normal|deep] [--official-domain <domain>] [--force-refresh] [--export <dir>]"
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# /ccg:grok-intel

$ARGUMENTS

Run the manual Grok external-intelligence collector. This is a single-agent, normal-depth run by
default. It uses the official Grok CLI ACP transport and built-in WebSearch; never use the legacy
Grok Search MCP as a substitute.

## Procedure

1. Parse `--mode discover|contract|incident|landscape`, `--depth normal|deep`, repeated
   `--official-domain <domain>`, `--force-refresh`, and `--export <dir>` from the arguments. Treat
   the remaining text as the task. Derive official domains only from an explicit task target or
   trusted package/repository metadata; if unknown, omit the flag so evidence remains
   `official_unknown` instead of guessing.
2. Write the task text to a bounded UTF-8 task file under the active `.ccg/tasks/<task-id>/` directory.
   Do not interpolate task text into a shell command.
3. Select only the minimum relevant repository files. Add each with `--file <relative-path>`.
4. Run:

```text
node ~/.claude/.ccg/engine/tools/grok-intelligence/command.mjs intel --task-file <task-file> --mode <mode> --depth <depth> [--official-domain <domain>] [--file <path>] [--force-refresh] [--export <dir>]
```

5. Print `requirement`, `status`, `webSearches`, `xSearches`, `evidencePath`,
   `evidenceSha256`, `manifestPath`, and `manifestSha256`. Do not print raw events or credentials.
6. Propagate the process outcome exactly: exit 2 means required evidence unavailable, exit 3 means
   unsafe CLI context/policy violation, and exit 4 means login, consent, or configuration is missing.
   Never silently downgrade those exits.

Deep evidence is leader-only and advisory. If deep research is disabled, stop with exit 4 rather
than pretending a normal run was deep. The orchestrator remains final authority.
