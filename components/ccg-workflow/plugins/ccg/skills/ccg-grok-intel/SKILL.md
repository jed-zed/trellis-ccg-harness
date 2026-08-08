---
name: grok-intel
description: Collect current source-backed Web/X evidence through the isolated official Grok CLI ACP profile. Use for /ccg:grok-intel.
---

# CCG Grok External Intelligence

Use `scripts/grok-intelligence/command.mjs intel`. The default is a single-agent, normal-depth run.

- Put the task in a bounded task file and pass `--task-file`; never interpolate user text into shell.
- Support `--mode discover|contract|incident|landscape`, `--depth normal|deep`, `--force-refresh`,
  repeated `--file`, repeated `--official-domain`, and `--export`. Supply official domains only
  from an explicit target or trusted package/repository metadata; otherwise preserve
  `official_unknown` provenance for `intel`. The `verify` action must predeclare at least one
  official domain before Grok runs.
- Use only official Grok ACP built-in WebSearch evidence. Do not call a Grok Search MCP.
- Print requirement/status, Web/X search counts, evidence and manifest paths/hashes.
- Preserve exit 2 (required unavailable), exit 3 (unsafe), and exit 4 (configuration/login) exactly.
- Raw events and credentials stay private. Codex remains final authority.
