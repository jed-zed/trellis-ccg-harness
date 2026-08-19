# Safely remove legacy GPT Pro Stop Hook

## Goal

Remove the retired GPT Pro Stop Hook from the supported local runtime and the
Harness repository without interrupting any in-flight work, losing unrelated
global Hooks, weakening RootWait exact-once behavior, or touching protected
dirty worktrees.

The supported result is one continuation path only:
`run-root -> RootWait -> wait-root -> acknowledge-root`.

## Confirmed facts

- `origin/main` documents and enforces RootWait-only startup. The current Skill
  says it never registers a Stop Hook, and the V2 watcher rejects Stop Hook
  mode before launch.
- The canonical repository `.codex/hooks.json` has no Stop Hook registration.
- The machine-global `C:/Users/29933/.codex/hooks.json` resolves to
  `G:/CodexData/.codex/hooks.json`; it still registers one `Stop` command that
  executes the legacy helper from
  `I:/ai/trellis-ccg-harness/.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-stop-hook.py`
  with a 7500-second timeout.
- The global Hook target exists inside a protected dirty worktree. This task
  must not modify, clean, stash, reset, or delete that worktree.
- Read-only preflight found zero running Stop Hook Python processes.
- `%LOCALAPPDATA%/ChatGptProSidebar/stop-hook-v1` is absent.
- `%LOCALAPPDATA%/ChatGptProSidebar/stop-hook-v2` contains eight stale files:
  seven expired registrations and one log. Four registrations are
  `registered`, three are `continuation-requested`, and all deadlines have
  expired.
- In `origin/main`, the helper script is referenced only by its dedicated test
  and archived research. `Register-WatchStopHook` has no production caller.

## Requirements

### R1. Detach the machine-global Hook before repository deletion

- Recheck that no legacy Stop Hook process or unexpired registration exists.
- Back up the canonical global `hooks.json` with timestamp and SHA-256.
- Remove only the exact GPT Pro Stop command. If the `Stop` collection contains
  any other command at execution time, preserve it and remove only the matching
  command object.
- Write the updated JSON atomically, parse it, and prove all unrelated Hook
  entries are unchanged.
- Do not edit the registered `I:/ai/trellis-ccg-harness` target worktree.

### R2. Retire stale local Stop Hook state safely

- After the global registration is detached and Codex reload/restart confirms
  it is no longer invoked, recheck process and deadline state.
- Move `stop-hook-v2` out of its live registry path as a recoverable quarantine,
  verify that no process recreates or reads it, then remove the quarantined
  eight stale files during the same accepted cleanup.
- Do not delete capacity, idempotency, target-claim, RootWait, prompt, response,
  or current evidence state.

### R3. Remove executable Stop Hook support from the repository

- Delete the legacy Python helper and its dedicated Pester suite.
- Remove watcher constants, registry/path writers, registration code,
  Stop-Hook-only timeout horizon, legacy claim/callback acknowledgement, the
  legacy `acknowledge` command, and Stop-Hook-only result/status fields.
- Make continuation transport decoding fail closed when state declares neither
  RootWait nor another explicitly retained transport; it must not silently
  default to `codex-stop-hook`.
- Preserve the RootWait acknowledgement file and RootWait validation used by
  the active importer.

### R4. Preserve supported behavior and negative guards

- Do not change adapter send, retry, exact-once, capacity, target binding,
  response deadlines, RootWait polling, or `acknowledge-root` semantics.
- Do not remove AgentMonitor compatibility merely because it is also disabled
  in V2; it is outside this task unless a direct Stop Hook dependency makes a
  minimal edit unavoidable.
- Keep current RootWait-only documentation and tests that explicitly reject
  `codex-stop-hook` drift. Remove only text that presents the registry/helper as
  an available implementation.
- Keep all archived Trellis tasks, changelog entries, and historical evidence
  unchanged.

### R5. Isolate user-owned work and publication

- Implement only in `G:/CodexWorktrees/remove-legacy-gptpro-stop-hook-harness`
  on `codex/remove-legacy-gptpro-stop-hook`, based on the recorded latest
  `origin/main`.
- Do not modify the dirty worktrees at
  `G:/CodexData/.codex/worktrees/e2de/trellis-ccg-harness` or
  `I:/ai/trellis-ccg-harness`.
- Local commit preparation is part of Trellis Phase 3.4. Push, PR creation,
  merge, installation, or publication require separate authorization.

## Acceptance Criteria

- [x] **AC1 — No in-flight legacy work:** immediately before detachment and
  registry retirement, there are zero matching Python processes and zero
  unexpired Stop Hook registrations.
- [x] **AC2 — Global config is precise and recoverable:** a timestamped backup
  and SHA-256 exist; the live JSON parses; the exact GPT Pro Stop command is
  absent; every unrelated Hook entry matches the backup semantically.
- [x] **AC3 — Reload proves detachment:** after Codex reload/restart and one
  ordinary stop/completion observation, no process invokes the retired helper
  and no new Stop Hook registration appears.
- [x] **AC4 — Live legacy registry is gone:** `stop-hook-v1` and `stop-hook-v2`
  are absent after the recoverable quarantine check, with no current RootWait,
  capacity, idempotency, target, prompt, response, or evidence data removed.
- [x] **AC5 — Repository runtime is gone:** the Python helper, dedicated test,
  `Register-WatchStopHook`, Stop Hook registry/claim/callback/horizon code, and
  legacy `acknowledge` command no longer exist in the active source tree.
- [x] **AC6 — RootWait remains intact:** PowerShell parses, focused watcher and
  sidebar Pester suites pass, and tests continue to prove RootWait-only launch,
  no resend, capacity bounds, deadline preservation, and `acknowledge-root`.
  User acceptance explicitly includes the unchanged main-branch sidebar
  baseline failure documented in `research/validation.md`; watcher coverage is
  123/123 green and no sidebar source belongs to this task diff.
- [x] **AC7 — Harness gates pass:** affected Node tests, `pnpm harness:test`,
  `pnpm doctor`, `pnpm harness:conflicts -- --ci`, `pnpm verify:sources`, and
  `git diff --check` pass.
- [x] **AC8 — Scope is clean:** current non-archive docs describe RootWait as
  the only active continuation; negative drift guards may still mention
  `codex-stop-hook`; historical archives and protected dirty worktrees are
  unchanged.
- [x] **AC9 — Rollback is proven:** restoring the backed-up `hooks.json` is
  documented and hash-checked; repository rollback is one normal Git revert;
  no rollback step resends a GPT Pro request.

## Out of scope

- Redesigning RootWait, capacity recovery, browser control, or GPT Pro import.
- Removing AgentMonitor or historical Windows UIA evidence.
- Editing or completing unrelated Trellis tasks and untracked specifications.
- Rewriting archived tasks, journals, or changelog history to erase Stop Hook
  references.
- Updating or publishing the personal CCG source snapshot.
- Automatically pushing, opening, readying, or merging a PR.

## Blocking questions

None. The user explicitly requested full Stop Hook retirement after a read-only
machine-state check. Implementation still requires fresh approval of this
planning package.
