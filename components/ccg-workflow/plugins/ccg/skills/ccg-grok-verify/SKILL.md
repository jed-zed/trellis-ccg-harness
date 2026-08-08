---
name: grok-verify
description: Verify plan, diff, dependency, and test assumptions against current source-backed Grok evidence. Use for /ccg:grok-verify.
---

# CCG Grok Verify

Load `skills/ccg-grok-intel/SKILL.md`, then run its shared
`scripts/grok-intelligence/command.mjs verify` entry.

- Put task text in a file and pass `--task-file`.
- Use this command only for current external facts, not pure local code review. Pass an authoritative
  domain from the explicit target or trusted metadata with `--official-domain` when known; otherwise preserve
  `official_unknown`. Never derive the whitelist from Grok's returned URLs.
- Bind the exact plan with `--plan`, a mandatory non-empty applied diff with `--diff`, and every
  dependency/lock input with repeated `--dependency`. Generate a bounded Git diff when no trusted
  diff artifact was supplied. The runtime records their SHA-256 digests.
- `--allow-empty-diff` is permitted only for an explicit no-change verification subject.
- Support `--force-refresh` and `--export`.
- Print requirement/status, search counts, bindings, evidence/manifest paths and hashes. A
  `received_unverified` response is usable and must not be reported as an invocation failure.
- Preserve exit 2, exit 3, and exit 4. Never replace official ACP evidence with a Grok Search MCP.
