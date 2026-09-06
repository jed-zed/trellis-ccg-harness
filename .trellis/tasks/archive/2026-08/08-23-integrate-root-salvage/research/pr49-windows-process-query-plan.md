# PR #49 follow-up plan: Windows process identity lookup

> Historical proposal, superseded: Boss authorized and started Trellis task
> `fix-windows-process-identity`. The PowerShell 7 candidate failed its real
> regression and was reverted. Boss subsequently approved the native Win32 /
> existing-Python revision recorded in that task. The statements below describe
> the original proposal, not the current task or implementation state.

## Approval and lifecycle boundary

Boss answered "同意" to separately repairing the Windows process identity
query failure, then continuing checks and conditional merge. The original
salvage task is archived and remains historical evidence. Current adapter
context reports no active task. No production implementation has started;
creation and activation of a dedicated repair task require confirmation.

## Confirmed observations

- The last supported snapshot update failed 3 of 458 Harness tests. Repeating
  only those failures left one approval-receipt-lock failure.
- The failing tests do not mutate the real process PATH or PowerShell
  environment. They exercise the real process identity lookup.
- Both an identity query and a constant-output command timed out under
  Windows PowerShell. Closing stdin did not change either result.
- A startup probe measured Node at 76 ms, Python at 107 ms, Windows
  PowerShell at 14727 ms, and PowerShell 7 at 444 ms. These are individual
  observations, not general performance guarantees.
- Alternating the identical query produced legacy-host timeouts at 13702 ms
  and 5030 ms, followed by a 567 ms success. PowerShell 7 also timed out once
  at 5038 ms, then succeeded at 2424 ms and 629 ms. Successful calls returned
  exactly the same process-creation identity for the same Node process.
- Thus delay can occur before the query executes; neither stdin handling nor
  query-specific work explains it. Switching hosts alone is a candidate fix,
  not yet a proven fix. The project already requires PowerShell 7+ in README.
- Sources remain unchanged. Local diagnostic logs: `j-xxgziz`, `j-1qiyz7`,
  `j-hulo4y`, and `j-xubajf`. Throwaway probes are isolated under ignored `.ccg/`.

## Minimal proposed change

1. Add a Windows-only regression that invokes the existing real Global Init
   and project initializer tests in an isolated child process. Block legacy
   `powershell.exe` in that child only, allow the real PowerShell 7 executable,
   and assert that no legacy process-identity query was attempted. Do not add
   production test hooks or weaken assertions.
2. Verify that regression fails against the current code. Change the two
   Windows query call sites to the already-required PowerShell 7 executable:
   `readProcessInstance` in `third-party-approval.mjs` and
   `readPlatformProcessIdentity` in `harness-init-core.mjs`.
3. Preserve PID validation, exact `win32:<pid>:<UTC ticks>` identity,
   null/unknown handling, conservative live-owner behavior, hidden windows,
   no-shell execution, output bounds, existing timeout and retry policy.
   Do not add a new dependency, fallback, native bridge or global setting.
4. Update only the validator's canonical SHA-256 pin in
   `scripts/verify-sources.ps1`, after reviewing its exact diff, and document
   the required query host in the initializer specification. Do not change
   `selected-archive-files.sha256` or recompute unrelated archival hashes.
5. Re-run the guarded regression, original failing CLI case, initializer,
   third-party approval, live-owner and PID-reuse tests. If PowerShell 7 still
   blocks, stop this candidate and diagnose further; do not increase timeouts
   or treat retries as proof of correctness.
6. On success, commit the independent Harness repair, then use the supported
   lifecycle update with source commit
   `6252515c5359a7e704296ad1ac39d7624d244543`. Require the complete source,
   snapshot and Harness gates, source verification, conflicts and security
   review. Preserve automatic rollback on failure.
7. Push the fully verified integration head to Harness PR #49. Merge only
   after all fresh CI checks pass for that exact unchanged head.

## Intended implementation paths

- `.agents/skills/harness-init/scripts/third-party-approval.mjs`
- `.agents/skills/harness-init/scripts/harness-init-core.mjs`
- `tests/windows-process-identity.test.mjs`
- `scripts/verify-sources.ps1`
- `.trellis/spec/tooling/harness-initializer.md`
- Canonical repair task artifacts and tool-generated Trellis journal/index

The later supported CCG snapshot update may change only the known Go test
fixture and its generated `harness.sources.json` provenance relative to current
main. Root worktrees, backups, installed plugins, global configuration and
other PRs remain outside the repair scope.

## Risks and rollback

PowerShell 7 had one diagnostic timeout, so the host change must earn its
acceptance through real focused and full-suite results. Process identity is a
data-protection boundary: no lock may be reclaimed merely because lookup is
slow or unavailable. If the candidate fails, retain evidence in the isolated
worktree and leave Harness PR #49 unmerged. No force push, root reset or global
installation is part of this plan.
