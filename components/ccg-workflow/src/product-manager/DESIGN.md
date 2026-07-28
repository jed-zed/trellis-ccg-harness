# Product Manager Design

## Goals

- Produce evidence-bound product judgments without workspace mutation.
- Keep Trellis as the sole lifecycle authority in Harness projects.
- Make retries, concurrency, recovery, and stale-result handling deterministic.
- Preserve provider choice as an installation-level CCG setting.

## Chosen design

The module separates pure contracts and canonical JSON from provider execution
and task-local evidence storage. Every review is bound to a SHA-256 invocation
key derived from the versioned task, trigger, checkpoint, plan, input, and
evidence identity. Outputs are rejected unless every identity field and the
strict schema match.

Codex runs in a disposable read-only sandbox with tool features disabled.
Gemini runs in plan mode with a deny-all tool/MCP policy; the bounded prompt is
sent on stdin to avoid command-line length limits. Both run with `shell:false`,
minimal environment, timeouts, and output caps. The same selected provider is
retried; invalid or unavailable responses become an explicit `unavailable`
verdict and never trigger fallback.

The versioned role contract accepts a bounded vendor-neutral provider ID.
Concrete adapters remain an installation-level registry currently limited to
Codex and Gemini, so extending execution support does not require changing the
role protocol.

## Security and trust boundaries

- The Trellis task directory is the only accepted task boundary for this
  integration; runtime evidence stays under ignored
  `.ccg-evidence/product-manager/`.
- Provider payloads and persisted evidence pass through the same secret
  redaction boundary.
- Absolute executable/entrypoint validation, no shell, no tools, no subagents,
  and no workspace writes constrain provider capability.
- Atomic `input.json`, `provider-request.json`, `response.raw`, `result.json`,
  and `status.json` evidence files, append-only NDJSON audit, nonce ownership,
  heartbeat leases, live-process checks before stale takeover, bounded waits,
  and strict identity validation prevent duplicate or late results from
  changing state.

## Alternatives rejected

- A second `.ccg/tasks` lifecycle was rejected because it would conflict with
  the accepted Trellis authority.
- Provider fallback was rejected because it changes cost, trust, and product
  semantics without user approval.
- Passing the full Gemini prompt in argv was rejected because real inputs can
  exceed operating-system argument limits.

## Known limitations

- This module returns a judgment only; the Harness adapter owns progress,
  acceptance cards, hard user gates, and final eligibility.
- Provider calls remain opt-in and require an already installed/authenticated
  provider.
- The contract is version 1 and rejects unknown protocol fields; extensions
  require a contract version change.

## Change history

### 2026-07-27 - Initial Trellis Harness integration

Added the strict contract, provider adapters, canonical identity, evidence
store, single-flight recovery, configuration migration, and offline tests for
the Codex-led product-manager role.
