# Implementation plan: safely remove legacy GPT Pro Stop Hook

## Phase 1 — Reconfirm evidence and detach the global Hook

- [x] Record current `origin/main`, branch, clean-worktree status, global
  `hooks.json` SHA-256, helper SHA-256, and protected worktree status.
- [x] Recheck zero matching helper processes and zero unexpired v1/v2
  registrations; stop without mutation if either condition fails.
- [x] Back up canonical `G:/CodexData/.codex/hooks.json` to a timestamped local
  rollback directory and verify the copy hash.
- [x] Atomically remove only the exact GPT Pro Stop command; preserve every
  unrelated Hook and validate parsed JSON equality outside that command.
- [x] Reload/restart Codex and observe one normal stop/completion cycle; prove
  no helper process and no new Stop Hook registration.

Rollback point: restore the exact backup atomically before any registry or
repository cleanup.

## Phase 2 — Retire stale machine-local registry

- [x] Repeat the quiescence gate.
- [x] Rename live `stop-hook-v2` to a timestamped quarantine under the same
  `%LOCALAPPDATA%/ChatGptProSidebar` root.
- [x] Verify RootWait and ordinary task stopping do not recreate or read the
  live registry path.
- [x] Delete only the quarantined eight stale files and directory; verify
  `stop-hook-v1` and `stop-hook-v2` are absent.
- [x] Prove the capacity/idempotency/target/evidence subtrees were not touched.

Rollback point: before final deletion, restore the quarantine only together
with the backed-up global Hook registration.

## Phase 3 — Remove repository runtime and tests

- [x] Delete `scripts/chatgpt-pro-sidebar-stop-hook.py` and its dedicated Pester
  suite.
- [x] In `chatgpt-pro-sidebar-watch.ps1`, remove Stop Hook constants, registry
  functions, horizon behavior, implicit transport fallback, legacy
  acknowledgement, legacy command routing, and Stop-Hook-only output fields.
- [x] Preserve RootWait/AgentMonitor shared helpers and make undeclared legacy
  continuation state fail closed.
- [x] Remove Stop-Hook-only watcher tests; update command/transport/status tests
  for the reduced surface without weakening RootWait coverage.
- [x] Update current Skill/spec/docs only where they describe an installable or
  executable Stop Hook. Retain explicit RootWait-only negative guards and
  historical archives.
- [x] Search the non-archive tree for executable/runtime references. Remaining
  `Stop Hook` or `codex-stop-hook` matches must be documented negative guards,
  conflict fixtures, or immutable history.

## Phase 4 — Validation

- [x] Parse `chatgpt-pro-sidebar.ps1` and
  `chatgpt-pro-sidebar-watch.ps1` with the PowerShell parser.
- [x] Run focused Pester:
  `chatgpt-pro-sidebar.Tests.ps1` and
  `chatgpt-pro-sidebar-watch.Tests.ps1`.
  - [x] Watcher suite: 123/123 passed.
  - [x] Sidebar suite: 187/188 passed. The sole failure is the unchanged
    `uses the full profile tree when the tab-list URL is abbreviated with an
    ellipsis` baseline test; neither its test nor sidebar implementation is in
    this task diff. The user accepted this documented baseline exception.
- [x] Run affected Node test:
  `node --test tests/harness-adapter.test.mjs`.
- [x] Run complete offline gates:
  `pnpm harness:test`, `pnpm doctor`,
  `pnpm harness:conflicts -- --ci`, and `pnpm verify:sources`.
- [x] Run `git diff --check`, inspect the full diff, and verify no archive,
  personal CCG snapshot, or protected-worktree path changed.
- [x] Re-run machine-state checks: no global Stop command, no helper process,
  no live registry, and active RootWait state unaffected.

## Phase 5 — Trellis finish path

- [x] Phase 3.3: update the active tooling spec only if implementation reveals
  a contract not already captured; record the explicit no-update judgment
  otherwise.
- [x] Present validation and machine-state evidence for user acceptance.
- [ ] Phase 3.4: create local work commit(s) on
  `codex/remove-legacy-gptpro-stop-hook` only after acceptance.
- [ ] Push/PR/merge/install only with separate explicit authorization.
- [ ] Archive the Trellis task only after repository and machine cleanup are
  complete and rollback instructions are recorded.

## Start gate

- [x] User has reviewed and explicitly approved the latest PRD, design, and
  implementation plan in a fresh message.
- [x] `task.py start` has been run only after that approval.

## Risks

- Global Hook configuration is outside Git; a malformed edit can affect every
  Codex task. Mitigation: exact-match removal, backup, atomic replace, semantic
  comparison, and reload proof.
- The registered script is inside a dirty user worktree. Mitigation: never edit
  or clean that worktree; detach the configuration instead.
- Old registry files contain local identities and paths. Mitigation: aggregate
  inspection only, no raw values in logs or committed artifacts, and no copy
  into the repository.
- Overbroad watcher deletion could remove shared RootWait acknowledgement.
  Mitigation: symbol-level consumer search, preserve shared ack/local-event
  helpers, and run focused plus full Pester.
