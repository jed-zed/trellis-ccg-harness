# Stop Hook retirement validation

Captured: 2026-08-19 (America/Denver)

## Repository result

- Deleted the legacy Python Stop Hook helper and its dedicated Pester suite.
- Removed Stop Hook registry, registration, callback/claim acknowledgement,
  horizon, fallback transport, command routing, and output fields from the
  watcher.
- Preserved RootWait, AgentMonitor, local continuation acknowledgement,
  capacity, deadline, exact-once, and browser-send paths.
- Undeclared continuation transports now fail closed.
- Active-tree reference scan found no executable Stop Hook entry point. The
  remaining non-archive matches are a negative watcher guard/test and the
  adapter's deliberate `codex-stop-hook` drift fixture.
- Phase 3.3 judgment: no tooling spec update is required. The current Skill and
  tooling spec already describe RootWait as the only supported continuation
  and retain the required negative Stop Hook guard.

## Validation results

- PowerShell parser: both sidebar scripts parsed with zero errors.
- Watcher Pester: 123 passed, 0 failed.
- Combined watcher/sidebar Pester: 310 passed, 1 failed. The sole failure is
  the unchanged baseline case `uses the full profile tree when the tab-list URL
  is abbreviated with an ellipsis`; neither that test nor the sidebar
  implementation is changed by this task.
- `node --test tests/harness-adapter.test.mjs`: 31 passed, 0 failed.
- `pnpm harness:test`: 456 total, 453 passed, 0 failed, 3 skipped.
- `pnpm doctor`: passed.
- `pnpm harness:conflicts -- --ci`: 0 blocking, 0 warnings.
- `pnpm verify:sources`: passed for Trellis 0.6.9 and CCG 3.4.14.
- `git diff --check`: passed; only Git's informational LF-to-CRLF warnings were
  emitted.

## Final machine state

- Global `hooks.json` parses, has no `Stop` entry, and retains SHA-256
  `3b93f45e773d3c65808eedab077d02dd0b574c9f61839f10255478564dabe683`.
- No external Stop Hook/watcher process is running.
- `stop-hook-v1`, `stop-hook-v2`, and quarantine directories are absent.
- No live capacity claim exists. Two pre-existing owner-dead `run-starting`
  claims remain untouched.

## Rollback

Global configuration rollback is an exact atomic restore from:

`G:/CodexData/.codex/backups/stop-hook-retirement/20260818T-current/hooks.json.before-stop-hook-removal`

The backup SHA-256 is
`3231150f51fc1fb1f807553078059b41bf42fc99c85d5aa3ad6672a59b5c45ee`.
Verify that hash before replacing `G:/CodexData/.codex/hooks.json`, then restart
Codex. Repository rollback is one ordinary Git revert after a future local
commit. Neither rollback path sends or resends a GPT Pro request.
