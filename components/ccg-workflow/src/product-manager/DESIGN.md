# Product Manager Design

## Goals

- Produce evidence-bound product judgments without workspace mutation.
- Keep Trellis as the sole lifecycle authority in Harness projects.
- Make retries, concurrency, recovery, and stale-result handling deterministic.
- Preserve provider choice only in CCG unified role routing.

## Chosen design

The module separates pure contracts and canonical JSON from provider execution
and task-local evidence storage. Every review is bound to a SHA-256 invocation
key derived from the versioned task, trigger, checkpoint, plan, input, and
evidence identity. Outputs are rejected unless every identity field and the
strict schema match.

Codex runs in a disposable read-only sandbox with tool features disabled.
Gemini runs in plan mode with a deny-all tool/MCP policy; the bounded prompt is
sent on stdin to avoid command-line length limits. Claude runs from its trusted
native executable in safe mode with tools, MCP, slash commands, settings
sources, browser integration, and session persistence disabled. All providers
run with `shell:false`, a provider-scoped minimal environment, timeouts, and
output caps. Claude always receives an explicit `--model`; the default is the
native `opus` alias and `CCG_PRODUCT_MANAGER_CLAUDE_MODEL` remains an explicit
override. The same selected provider is retried; invalid or unavailable
responses become an explicit `unavailable` verdict and never trigger fallback.

The versioned role contract accepts a bounded vendor-neutral provider ID.
`product-manager` is the fourth formal role in the same unified routing
registry as frontend, backend, and search. Concrete product-manager adapters
are currently limited to Codex, Gemini, and Claude, so an unimplemented or
disallowed unified selection fails closed without changing the role protocol.
`[product_manager]` stores behavior only.

## Security and trust boundaries

- The Trellis task directory is the only accepted task boundary for this
  integration; runtime evidence stays under ignored
  `.ccg-evidence/product-manager/`.
- Provider payloads and persisted evidence pass through the same secret
  redaction boundary.
- Machine-readable commands emit exactly one JSON document on stdout; CCG
  initialization and the minimal provider child environment both disable
  support notices, and other diagnostics are kept off stdout.
- Each failed same-provider attempt appends a bounded, redacted diagnostic to
  the invocation audit before the final `unavailable` verdict.
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

### 2026-07-28 - Claude Provider and linked snapshot delivery

Added the isolated Claude Provider and documented that downstream Harness
delivery couples the packaged source update with the current commit, tree, and
content fingerprint. That fingerprint identifies the installed snapshot; it
does not permanently lock future compatible updates.

### 2026-07-28 - Unified fourth role routing

Moved product-manager Provider selection into the existing CCG routing
registry as the fourth formal role. Legacy `[product_manager].provider` is
migrated once and removed; route switches do not change Trellis or Harness
snapshot state.

### 2026-07-28 - Machine stdout and retry diagnostics

Suppressed i18next support notices in both the CCG process and Provider child
environment so machine commands emit one JSON document. Added bounded,
redacted per-attempt audit diagnostics without changing same-provider retry,
single-flight, or no-fallback semantics.

### 2026-07-28 - Explicit Claude Opus default

Changed the Claude product-manager adapter default from the native `sonnet`
alias to `opus`. The adapter still passes `--model` explicitly and retains the
environment override for an intentionally selected exact model name.
