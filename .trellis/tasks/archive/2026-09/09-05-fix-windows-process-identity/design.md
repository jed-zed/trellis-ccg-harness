# Design: native Windows process creation time through existing Python

## Evidence and decision

The accepted research plan records timeouts before even a constant command
executed. Closing stdin did not help. Windows PowerShell took 14.7 seconds in
one startup probe; PowerShell 7 took 0.4 seconds. Both hosts returned the same
UTC process creation ticks on successful queries. PowerShell 7 also timed out
once, so the candidate must pass real tests rather than rely on that sample.

The PowerShell 7 candidate reproduced the approval-receipt lock failure on the
first run of the planned repeat batch. Its production edits were reverted.
Boss then approved native Win32 queries using the existing Python runtime.

Both callers share a small `windows-process-identity.mjs` module. An isolated
Python standard-library program uses `OpenProcess(0x1000)`, `GetProcessTimes`
and `CloseHandle`, converting FILETIME's epoch to the existing .NET UTC ticks.
The existing Python resolver moves into the portable Skill; its old root module
re-exports the same API. This avoids duplicate runtime selection logic and
keeps the standalone Skill complete. Windows path resolution asks the selected
Python for `sys.executable`: `where.exe` was independently reproduced timing out
after the version check succeeded in 70 ms. This removes that blocking launch;
the selected Python is used directly without launcher-only arguments.
Resolution and query share each existing
five-second attempt budget, with bounded output; successful runtime selection
is reused. No new dependency, configuration, PowerShell fallback, timeout
extension or retry mechanism is introduced.

## Security boundary

These queries protect authenticated locks against PID reuse. Preserve safe
positive PID validation, `win32:<pid>:<UTC ticks>`, existing null/unknown
handling, conservative live-owner checks, hidden noninteractive no-shell
execution, and current bounds. Slow or unavailable lookup must never make an
unknown owner reclaimable. Existing signature and compare-and-swap logic is
unchanged.

The Python query uses isolated/no-site mode, fixed code and a separate validated
PID argument. A failed query, missing runtime, malformed response or denied
handle remains unknown, never proof that an owner is dead. Existing PID liveness
checks remain authoritative for death; approval keeps its three attempts.

The regression intercepts both PowerShell identity hosts only in a disposable
child test process. Real native queries and existing fixture assertions remain
in use; successful numeric responses must be observed for both callers.
No test hook enters production APIs.

## Change scope and provenance

- The two query implementation files under `.agents/skills/harness-init/scripts/`.
- Shared native query and relocated Python resolver in the same Skill scripts
  directory; the existing root resolver becomes a re-export.
- `tests/windows-process-identity.test.mjs`, resolver/export coverage and the
  source-verifier fixtures/tests needed for the new dependency boundary.
- The validator and its new dependency pins/materialization in
  `scripts/verify-sources.ps1`, including staged-tree verification.
- `.trellis/spec/tooling/harness-initializer.md` and task/journal evidence.
- Subsequently, the supported update may change only the published Go test
  fixture and generated `harness.sources.json` relative to current main.

Do not modify `selected-archive-files.sha256`, unrelated hashes, root branches,
backups, installed plugins, credentials or global state.

## Rollback

Stop this candidate if focused or full tests still reproduce the blocker.
Retain diagnostic evidence, preserve the supported updater's automatic
rollback, and leave the PR unmerged. No force push or destructive cleanup.
