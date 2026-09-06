# Fix Windows process identity queries before PR49 merge

## Goal

Repair Windows process identity queries that block Harness PR #49 validation,
without weakening transaction ownership or recovery safety. Continue the
previously approved PID-fixture synchronization and merge only after fresh CI.

## Requirements

- Use the existing Python runtime to read Windows creation time through native
  Win32 APIs; the PowerShell 7-only candidate was rejected by real regressions.
- Preserve PID validation, exact identity values, unknown/dead distinctions,
  conservative live-owner handling, timeouts, retries and output limits.
- Exercise the real initializer and Global Init paths with both PowerShell
  identity-query hosts unavailable; do not add production test hooks or a fallback.
- Preserve root worktrees, backups, global installations and configuration.
- Keep the personal CCG source authoritative; synchronize its published PID
  test fix only through the supported Harness lifecycle update.

## Acceptance Criteria

- [x] The new Windows regression fails on the original query mechanism and passes
  after the scoped repair, with both real initializer paths exercised.
- [x] Original failing cases, initializer, third-party approval, live-owner and
  PID-reuse checks pass without relaxing their assertions.
- [x] Source pin, specification, security review, source verification and
  conflict checks match the actual repair.
- [x] Complete required Harness/CCG/Go checks and the supported snapshot update
  succeed; a failed update rolls back and does not authorize merge.
- [ ] The exact pushed PR head passes all fresh CI checks before merge.

## Notes

- Boss approved: "批准按这份方案新建 Trellis 修复任务，并执行 `task.py start` 开始处理".
- Accepted plan (repository-relative): `.trellis/tasks/archive/2026-08/08-23-integrate-root-salvage/research/pr49-windows-process-query-plan.md`.
- Boss approved the revised native Win32/Python approach with "批准" after the
  PowerShell 7 candidate failed. The current design supersedes that candidate,
  not its recorded failure evidence.
- This task owns only the follow-up repair. The archived salvage task remains
  historical evidence and is not reopened.
