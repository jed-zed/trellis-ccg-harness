# Product Manager Module

## Purpose

This module implements the bounded, read-only product-manager contract used by
Codex-led CCG workflows. It exists to turn product requirements, plan state,
evidence, and user feedback into a strictly validated recommendation without
becoming a task or workspace authority.

## Responsibilities

- Define the versioned input/output contract and canonical invocation identity.
- Validate facts, hypotheses, progress, verdicts, evidence references, and a
  vendor-neutral provider identity.
- Run only an explicitly selected, implemented Codex, Gemini, or Claude adapter through
  a no-tool, read-only boundary.
- Redact provider payloads and task-local runtime evidence.
- Keep machine-readable stdout to exactly one JSON document by suppressing
  support notices in both CCG and provider children, and record bounded,
  redacted diagnostics for every failed same-provider attempt.
- Enforce same-key single-flight, live-owner-safe stale-lock recovery, result
  reuse, complete `calls/<invocation-key>/` evidence, and append-only NDJSON
  audit.

## Non-responsibilities

- It does not create or update Trellis tasks, PRDs, plans, milestones, or user
  acceptance state.
- It does not install, authenticate, select, or silently fall back to another
  provider.
- In the Trellis Harness integration it does not accept `.ccg/tasks` as a
  parallel lifecycle path.

## Dependencies

The module uses Node.js filesystem/process primitives and the existing
`fs-extra` dependency. `src/commands/product-manager.ts` is the CLI boundary;
the Harness adapter consumes its validated JSON result and remains responsible
for Trellis state projection and user gates.

## Quick use

```text
ccg routing get product-manager --json
ccg routing set product-manager claude
ccg product-manager status --json
ccg product-manager review --input <input.json> --task-dir <trellis-task>
```

Provider execution additionally requires explicit `--allow-provider-call`.
Supplying a pre-recorded `--response` keeps validation fully offline.
`[product_manager]` contains behavior parameters only; Provider selection is
resolved exclusively from unified routing.

Claude execution reuses an already installed and authenticated native Claude
CLI. CCG does not install Claude, log it in, create project `.claude` state, or
enable it for ordinary delegation. The adapter always passes `--model`; its
default is the native `opus` alias, while
`CCG_PRODUCT_MANAGER_CLAUDE_MODEL` can explicitly override that value.
