# Fix Grok ACP session/new request contract

## Goal

Restore compatibility between the personal CCG Grok ACP adapter and the
currently installed Grok CLI by sending the required `session/new` request
shape, while preserving the existing Provider-routing, authentication,
permission, and no-fallback boundaries.

## Confirmed Facts

- The installed CCG is `3.4.12`; the reported Grok CLI is `0.2.112`.
- `grok --version` and `grok agent --help` succeed, and CCG reports its isolated
  Grok account as logged in.
- `ccg doctor --grok` completes ACP `initialize` and `authenticate`, then fails
  at `session/new` with `ACP session/new failed: Invalid params` before any
  model invocation.
- The CCG `3.4.12` adapter sends `request('session/new', { cwd })`. Current xAI
  ACP examples in both the official CLI guide and official `grok-build`
  repository send `{ cwd, mcpServers: [] }`; no official xAI source found during
  planning documents omission as compatible or supplies a default.
- The regression was traced to personal CCG commit `2e16de5`, which removed
  `mcpServers: []` and changed a fake-server unit test to accept `{ cwd }`.
  The fake server does not enforce the real Grok schema.
- The authoritative personal CCG source contains two byte-identical runtime
  projections with the regressed request shape:
  `templates/engine/tools/grok-intelligence/lib/acp-client.mjs` and
  `plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/lib/acp-client.mjs`.
  The global package, active Codex plugin cache, and Harness-synchronized CCG
  snapshot propagate that same source state.
- `ccg doctor --grok` already provides a real, prompt-free handshake path:
  `initialize` → `authenticate` → `session/new`, with `handshakeOnly: true`
  preventing `session/prompt`. The manual official-Grok workflow invokes this
  command before its separately paid Web/X smoke.
- Direct edits to the installed package, active plugin cache, or tracked
  Harness snapshot are not the authoritative repair path.
- The current Harness worktree contains unrelated existing changes that are
  protected from this task.

## Requirements

### R1 — Repair the authoritative CCG source

Restore `{ cwd, mcpServers: [] }` for Grok ACP `session/new` in both
source-owned CCG runtime projections. Do not add a new configuration option,
fallback request, retry, schema-guessing path, or runtime patch of
installed/cache files. Preserve acceptance of Provider-native MCP capability
events; the empty array describes the client-supplied session field and must not
reintroduce the removed empty-MCP preflight gate.

### R2 — Add regression evidence at the real contract boundary

Update the focused fake-server assertion so it fails if `mcpServers` is omitted
and proves the exact empty-array request shape without invoking Grok. Reuse the
existing prompt-free `ccg doctor --grok` path for real-CLI compatibility; make
that handshake a distinct, named step in the manual official-Grok workflow so
its result is not hidden inside the paid Web/X step. Any execution of that live
workflow, local real-CLI handshake, installation, or paid/network Provider
activity remains a separately authorized gate.

### R3 — Preserve unrelated behavior

Do not change Grok authentication, account isolation, local MCP discovery
outside this explicit empty-list request, Provider selection, review target
binding, permissions, no-fallback behavior, or other Providers.

### R4 — Deliver through supported provenance

Implement in a clean authoritative checkout of the personal
`jed-zed/ccg-gptpro-worflow` fork. Publication, Harness synchronization, local
installation, commits, pushes, PRs, releases, and live Provider calls are
separate approval gates. A later Harness sync must use its supported update
workflow rather than hand-editing the vendored snapshot.

### R5 — Correct the contract record

Update the existing Windows Grok contract verification document so it no longer
claims current sessions omit `mcpServers`. Preserve the 2026-07-21 historical
probe, and add a separate dated compatibility record only after an authorized
real handshake succeeds, including the exact tested Grok CLI version and the
fact that no model prompt was sent.

## Acceptance Criteria

- [x] The authoritative CCG ACP adapter sends exactly
      `{ cwd, mcpServers: [] }` for Grok `session/new` in all required source
      projections.
- [x] A focused offline regression fails if `mcpServers` is omitted and proves
      the exact empty-array request shape without invoking Grok.
- [x] The manual official-Grok workflow contains a separately named real ACP
      handshake step that runs `doctor --grok` before any paid Web/X prompt, and
      repository tests prevent that step from disappearing silently.
- [x] Existing affected unit, parity, typecheck, and source-verification gates
      pass in the clean authoritative CCG checkout.
- [x] After separate authorization for any live/network action, a real Grok CLI
      handshake reaches or completes `session/new` without `Invalid params` and
      without sending a model prompt; the exact CLI version and result are
      recorded in the existing verification document.
- [x] No installed package, plugin cache, Harness snapshot, credential, routing
      configuration, unrelated worktree change, or other Provider behavior is
      modified as part of the source fix.
- [ ] Any later publication, Harness sync, installation, and final doctor check
      use exact recorded source provenance and their own explicit approvals.

## Out of Scope

- Diagnosing unrelated Claude, Hooks, legacy wrapper, or missing-MCP doctor
  findings.
- Changing Grok login state, model selection, search routing, or permissions.
- Adding compatibility fallbacks for hypothetical older Grok schemas.
- Reinstating the superseded empty-MCP inventory/tool-count rejection gate.
- Hand-editing global npm files, Codex plugin caches, or Harness snapshots.
- Publishing, synchronizing, installing, committing, pushing, opening a PR, or
  calling a live Provider during planning.
