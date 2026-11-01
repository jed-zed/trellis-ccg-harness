# Design — Grok ACP `session/new` compatibility repair

## Boundary

The personal `jed-zed/ccg-gptpro-worflow` source is authoritative. The repair
changes the outbound `session/new` parameter object only; it does not change
authentication, permissions, Provider-native MCP events, prompt execution,
routing, or fallback behavior.

```text
CCG doctor / Grok intelligence
  -> createGrokAcpClient
  -> initialize
  -> authenticate
  -> session/new { cwd, mcpServers: [] }
  -> handshakeOnly: stop here
  -> normal run only: session/prompt
```

## Source changes

Keep the two runtime projections byte-identical:

- `templates/engine/tools/grok-intelligence/lib/acp-client.mjs`
- `plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/lib/acp-client.mjs`

The only runtime change is restoring `mcpServers: []` beside the validated
`cwd`. The existing fake ACP child already returns the received parameters, so
the focused Vitest assertion is the smallest offline contract regression.

Do not reintroduce validation that rejects `_x.ai/mcp/servers_updated` with
non-empty entries or `_x.ai/mcp_initialized` with tools. Those events describe
Provider-native capability state and are separate from the required
client-supplied `mcpServers` field.

## Real-CLI compatibility check

Reuse `ccg doctor --grok`; it already runs the real ACP flow with
`handshakeOnly: true`, returns after `session/new`, and sends no model prompt.
Split that command into a clearly named step in the existing manual
`.github/workflows/grok-live-smoke.yml`, before the paid Web/X step. Extend the
existing workflow-parity test to pin the prompt-free handshake step.

The local equivalent is `pnpm exec tsx src/cli.ts doctor --grok` from the clean
source checkout. Running it is a separate explicit authorization because it
starts the logged-in real Grok CLI and may perform external authentication or
session traffic. It must not be confused with `--grok-live`, which sends a paid
model prompt.

## Documentation

Preserve the dated 2026-07-21 record in
`docs/verification/grok-cli-contract-windows.md`. Correct its stale statement
that current sessions omit `mcpServers`, and append a new dated handshake-only
record only after a successful authorized real-CLI run. Record exact CLI
version, request shape, success/failure boundary, and `paidModelPromptSent=false`;
do not store credentials or raw private session data.

## Provenance and delivery

Implementation starts in a dedicated clean `codex/` branch or worktree based on
the exact current personal `gptpro/main` commit. A later Harness update must run
`pnpm harness:update -- --source-checkout <clean-authoritative-checkout>` so the
component snapshot and `harness.sources.json` move transactionally. Installed
npm files and Codex plugin caches are outputs, never edit targets.

Commit, push, PR, version bump/release, Harness sync, and local installation are
independent approval gates. If release is approved, use the next patch version
for CCG and the matching `+codex.1` plugin version; do not bump the Go wrapper
because this repair changes no Go input.

## Risks and rollback

- Risk: confusing `mcpServers: []` with disabling Provider-native MCP behavior.
  Mitigation: retain the existing non-empty MCP/tool event tests.
- Risk: a fake server accepts an invalid request again. Mitigation: exact offline
  parameter assertion plus an authorized real-CLI handshake-only gate.
- Risk: source/snapshot/cache drift. Mitigation: change source first and use the
  supported transactional Harness/install paths later.
- Rollback before publication: revert the three source/test hunks and workflow
  split. After publication or sync, use the repository's normal revert and
  Harness rollback paths; never patch caches backward by hand.
