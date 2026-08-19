# Design: safely remove legacy GPT Pro Stop Hook

## Boundary model

The cleanup crosses three independent state domains and must retire them in
order:

1. **Machine-global configuration** — `G:/CodexData/.codex/hooks.json` is live,
   user-owned machine state and is not committed to this repository.
2. **Machine-local retired registry** — `%LOCALAPPDATA%/ChatGptProSidebar/stop-hook-v2`
   contains stale callback registrations. It is runtime evidence, never Git
   state.
3. **Repository implementation** — the helper, watcher compatibility code, and
   tests live in the clean task worktree and are the only PR-scoped changes.

Historical Trellis archives form a fourth, read-only evidence domain. They are
not migrated or rewritten.

## Retirement sequence

### 1. Quiescence gate

Read process command lines only to count matching Python helpers. Parse registry
JSON only for phase and deadline; do not print UUIDs, URLs, prompts, responses,
or evidence paths. Proceed only when the helper process count is zero and every
registration deadline is expired.

This gate is repeated immediately before every destructive machine-state step.

### 2. Global Hook detachment

Resolve `C:/Users/29933/.codex/hooks.json` to its canonical target. Copy the
file to a timestamped rollback directory and record SHA-256. Parse the live
JSON, identify the one command whose normalized executable argument contains
the exact retired helper path, and remove only that command.

If this removal empties the enclosing `Stop` Hook list, remove the empty `Stop`
property. If any other Stop Hook exists, keep it unchanged. Publish the updated
JSON through a same-directory temporary file and atomic replace, then parse and
compare all non-target Hook entries against the backup.

The configuration change must not edit the dirty `I:/ai/trellis-ccg-harness`
target. That script remains the immediate rollback target until reload
verification succeeds.

### 3. Reload and registry retirement

Codex must reload or restart so the removed registration is effective. Observe
one normal stop/completion cycle and verify no helper process and no new
registration.

Rename the live `stop-hook-v2` directory to a timestamped quarantine under the
same `ChatGptProSidebar` root. Same-volume rename makes rollback simple and
prevents new consumers from seeing the active path. Re-run the observation;
only then delete the quarantine. `stop-hook-v1` is already absent.

No other `ChatGptProSidebar` subtree is part of this operation. In particular,
the capacity registry, idempotency reservations, target claims, and GPT Pro
evidence remain untouched.

## Repository cleanup

### Files removed

- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-stop-hook.py`
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-stop-hook.Tests.ps1`

### Watcher changes

In `chatgpt-pro-sidebar-watch.ps1` remove only Stop-Hook-owned behavior:

- claim/callback and v1/v2 registry constants;
- registry root/path and registration writers;
- Stop Hook horizon and its bypass switch;
- silent `codex-stop-hook` default transport;
- legacy claim/callback acknowledgement and the `acknowledge` command;
- result/status properties whose only producer or consumer is Stop Hook.

Shared RootWait state, `watch-continuation-ack.json`, local terminal validation,
`acknowledge-root`, AgentMonitor compatibility, and all capacity code remain.
Transport decoding becomes explicit: known retained state maps to its declared
transport; missing/legacy Stop Hook state is rejected rather than inferred.

### Tests and documentation

Delete the dedicated helper suite and Stop-Hook-only watcher tests. Update
watcher assertions to the smaller command surface and explicit RootWait state.
Do not reduce coverage for RootWait startup, worker crash, terminal evidence,
acknowledgement, exact-once, deadlines, or capacity.

Keep negative contracts stating that V2 never registers or accepts a Stop Hook,
including the Harness conflict mutation that rejects
`continuation=codex-stop-hook`. Remove only current documentation that instructs
users to install or operate the retired helper. Archives and changelog history
remain immutable.

## Failure and rollback

- **Before global replace:** no machine state changed; stop.
- **After global replace, before reload proof:** restore the timestamped backup
  atomically and verify its SHA-256.
- **After registry quarantine, before deletion:** rename the quarantine back to
  `stop-hook-v2` only if the global Hook is also restored.
- **After repository edits:** use a normal Git revert. Never reset or clean
  either protected dirty worktree.
- No rollback path sends, retries, imports, or acknowledges a GPT Pro request.

## Trade-offs

The cleanup intentionally rejects old Stop Hook state instead of retaining a
reader-only compatibility shim. Keeping such a shim would preserve the dead
surface the task exists to remove. Historical evidence remains inspectable in
archives, so runtime compatibility is unnecessary.

The global config backup is retained through task acceptance because it is the
smallest useful rollback artifact. The stale registry is deleted only after a
recoverable rename and reload proof; it is not committed or copied into task
artifacts because it contains machine-local identities and paths.
