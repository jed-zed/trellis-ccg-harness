# Execution results: PowerShell host candidate rejected

## Task activation

- Boss explicitly approved creating this task and executing `task.py start`.
- Task status is `in_progress`. FastCtx does not expose a native session ID,
  so the supported `TRELLIS_CONTEXT_ID=codex-pr49-windows-process-identity`
  override binds the active pointer for this task's commands.
- Harness context verified the task path and all three planning artifacts.
  Product-manager state is absent; no provider was invoked.

## Regression and candidate results

1. The first test harness launch inherited `NODE_TEST_CONTEXT` and Node refused
   recursive test discovery. This is not regression evidence. Only the child
   environment was corrected to create an independent test runner.
2. `j-wzad0j`: the corrected regression failed against unchanged production
   code, observed legacy host calls in both real paths, and reproduced
   `Cannot establish the current process instance for the approval receipt lock.`
3. Exactly two executable literals were changed to `pwsh.exe`. Query text,
   PID checks, parsing, timeout, retry and lock semantics were unchanged.
4. `j-6oqwfv`: the first candidate run failed; the assertion did not expose
   the nested runner's stdout sufficiently to diagnose its internal failure.
   The regression's failure message was improved, without weakening checks.
5. `j-eheg2c`: one candidate run passed (18922 ms), including actual numeric
   PowerShell 7 identity responses for both initializer and approval paths.
6. A fixed three-run validation was scheduled with immediate stop on failure.
   `j-pniq7m` failed on its first iteration (35643 ms): project initialization
   observed a successful PowerShell 7 identity, but Global Init again reported
   the original approval-receipt-lock identity error. The remaining two runs
   were not executed. The single preceding green result is not acceptance.
7. Per the approved stop condition, both production literals were restored.
   No validator pin, timeout, retry, production fallback, or lock protection
   was changed. No repair commit, push, snapshot update or merge followed.
   The uncommitted regression remains as experimental task work, not a passing
   test or an accepted PowerShell-only contract.

## Discriminating read-only probe

The existing Go wrapper already uses `OpenProcess` with
`PROCESS_QUERY_LIMITED_INFORMATION` and `GetProcessTimes`. An ignored local
Python/ctypes diagnostic exercised those same native APIs against its known
parent Node process. It closed each handle and made no target-process writes.

`j-1kei5t`: three native reads took 266, 123 and 124 ms. PowerShell 7 took
626 ms in the same probe. All four returned exactly the same UTC creation
ticks. These samples establish format compatibility and local feasibility,
not full acceptance or reliability under every load. No native bridge was
added to production.

## Analysis and next decision

- Category: implicit assumption that a general-purpose PowerShell host will
  reliably start inside the existing process-query budget. Slow startup has
  been observed; its host/OS-level cause is not yet established.
- Rejected fix: choosing PowerShell 7 alone does not remove that dependency or
  reliably resolve the failure on this machine.
- Prevention: retain real integration assertions for both successful identity
  queries and locked-owner safety, and preserve failed-run evidence rather
  than accepting a later green rerun as sufficient proof.
- Proposed next approach: query the native Windows creation-time API using the
  project's existing Python prerequisite, preserving identity format and
  conservative errors. This expands the approved implementation mechanism and
  requires a revised plan approval within this same task, not another task.
- Root worktrees, backups, global installations and the remote PR are untouched.

## Approved native revision and red/green evidence

Boss subsequently approved the native Win32/Python revision with "批准".
The same active task's PRD/design/implementation plan now records that approach.
The earlier approval request and rejected candidate above are historical.

- `j-i03xki`: revised regression red on original production code (8.7 s). Both
  PowerShell query paths were blocked and Global Init reproduced the exact
  approval-receipt lock error. Initializer completion alone still masked an
  unknown identity, as expected from its existing safety behavior.
- `j-nasvx9`: first native candidate failed the mandatory initializer-success
  assertion. Global Init succeeded; this was not accepted as a passing repair.
- `j-emfaer`: instrumentation isolated the new blocker: `py -3 --version`
  succeeded in 70/75 ms, but `where.exe py` timed out after 4943/4936 ms. Native
  API execution was not the failing first step. Windows interpreter location
  now uses the same selected Python's `sys.executable`; no timeout was raised.
- `j-gvgndc`: resolver regressions passed and both real operations completed.
  The test's caller label was incorrect because its `data:` preload URL included
  both source filenames. Filtering those URL frames corrected only the test
  evidence classification, without modifying production behavior.
- `j-76c89m`: all three new tests passed (17.9 s): transport precision and
  conservative errors, actual native creation ticks, and successful native
  identity observations for both real initialization paths.
- `j-c3sy8i`: source verification passed at the unchanged CCG pin `1572b7a`;
  conflicts reported 19 pass / 0 blocking / 0 warning / 2 info. Local security
  scanner inspected 10 Skill scripts with no findings. `git diff --check` passed.

## Security and distribution review

The native program uses only Python's standard library and a query-limited,
non-inheritable process handle, closed in `finally`. PID is validated in JS and
Python and passed as a separate argument; there is no shell or interpolated user
code. `-I -S` isolates Python imports/site startup. FILETIME arithmetic remains
integer-only and emits the same .NET UTC ticks. Lookup resolution and execution
share five seconds and 4096-byte output bounds. Missing runtime, denied access,
malformed output and execution errors stay unknown; they never prove owner death.
The existing liveness, signature and compare-and-swap controls are unchanged.

The shared resolver lives inside the exported Skill; the root path re-exports it
instead of maintaining a duplicate. The verifier pins both transitive imports
and materializes the exact staged blobs before Node imports the validator.
No external model/provider was called; automated scanning is supplemented by
this focused review of the JS-to-native boundary.

Primary API references used for the implementation:
[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes),
[OpenProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess),
[Python ctypes](https://docs.python.org/3.10/library/ctypes.html).

## Focused gate completion before supported synchronization

- `j-1qucw8`: the fixed three-run native batch passed 3/3 tests each time.
  The following seven-file suite completed with 204 pass / 7 fail / 1 existing
  skip (212 total). All seven failures were in `harness-adapter.test.mjs`:
  its generic fake Python runner returned a task path for the newly required
  executable-path query. The fixture now responds to that query explicitly;
  no assertion was relaxed. All other files passed, including all 15 source
  verifier cases and both new dependencies' worktree/staged tamper/missing tests.
- `j-yuljrg`: after that fixture correction, the entire adapter file passed
  31/31. Combined focused evidence therefore covers the final code; the first
  mixed suite remains recorded as failed, not relabeled green. The supported
  updater must still rerun the complete final Harness suite before publication.
- `j-2yhxkm`: actual staged-tree source verification passed. CCG commit gates
  reported no failures, 136 quality warnings (primarily existing large files
  and functions, including a long new integration-test callback), plus the
  task-metadata documentation reminder. With the supported warning allowance,
  `canCommit=true`; `gates_passed=false` is retained rather than misreported.
  The new runtime modules had zero quality warnings. Local security scanning
  and the focused manual boundary review above had no blocking finding.
- Trellis tools bound this existing task to the isolated repair branch, added
  initializer/lifecycle/research context, and validated both three-entry JSONL
  context files. No second task or external provider was created.
- Remote main was rechecked as `a68519f6233bef3022c333a75b0f56ee8e6353df`.
  Personal CCG PR #49 remains merged; Harness PR #49 remains open at `d9b51ca`.

## Successful supported update

- Independent Harness repair commit:
  `094ee383fbc3a5f5c0bf6c23f43e0d328b5b1403`. The worktree was clean before update.
- `j-vb5ekj` ran the approved lifecycle update and exited 0 with
  `status=updated`, source commit `6252515c5359a7e704296ad1ac39d7624d244543`,
  tree `bdebcc0f2812922b7fd1d488673f8c45e95f6d01`, and transaction
  `2026-09-06T04-40-56-218Z-0a2f3ca1-23e6-42b9-8361-d01248bca656`.
- Preflight doctor, source verification and conflict checks passed.
- Source and exported snapshot each passed lint, typecheck, 643 tests with
  3 existing skips, package build, full Go tests and Go build. The source Go
  test result was cached; the snapshot reported 36.884 s of test execution.
  A slow Go preparation interval was inspected read-only: no extra module
  subdirectories, links or ancestor `go.work` files explained an expanded scan.
  The command completed without a timeout/configuration/cache change.
- The final Harness suite passed **460 / 463**, with **3 existing skips and
  zero failures** (750.763 s). The original Windows lock failures, new native
  regressions, full adapter file, and staged dependency tampering tests all
  passed in this single final run.
- The component/manifest diff is exactly the approved PID-fixture repair plus
  generated provenance: 2 files, 12 insertions / 10 deletions. No unrelated
  managed source was transplanted.
- A separate bounded packaging check found no production path that copies the
  root Python entrypoints without the Skill tree; standalone export imports
  also passed in the complete Harness run.

Next: commit the synchronized snapshot and results, run the post-update doctor,
then publish to the existing Harness PR. Keep this task active until the pushed
repair head passes fresh CI. After recording acceptance with Trellis tools,
any resulting metadata-only commits must also pass fresh CI before merge.

## First pushed CI: Linux error-format assertion (2026-09-06 UTC)

- Snapshot/results commit `2e6cf4640c5b2edd967e0b875b0fd4689aca6cc3`
  was pushed normally to Harness PR #49. Post-update doctor passed, the
  worktree was clean, and the latest main was fully incorporated.
- [Harness CI run 34013488634](https://github.com/jed-zed/trellis-ccg-harness/actions/runs/34013488634)
  did not authorize merge. Both Ubuntu Node 20/22 jobs reported exactly one
  failure in the new native dependency tampering test (454 pass / 1 fail /
  8 platform skips each).
- The verifier correctly rejected the altered staged dependency with a
  nonzero exit and `Staged validator dependency windows-process-identity.mjs
  SHA-256 mismatch`. PowerShell's Ubuntu error renderer wrapped between
  `SHA-256` and `mismatch`, including ANSI formatting and a continuation gutter.
  The test incorrectly required those words to be contiguous.
- Bounded log replay `j-0ymgch` reproduced the old assertion failure against
  the actual CI error text. The corrected expression in `j-0is6qr` accepted
  that same text. The change only allows formatting between `SHA-256` and
  `mismatch` in the two new dependency assertions, matching the existing
  multiline diagnostic assertion convention. Nonzero status, dependency
  identity and mismatch semantics remain required. No verifier, runtime,
  integrity pin, timeout or CI configuration was changed.
- `j-0is6qr` completed the entire source-verification file: **15/15 passed,
  zero failures or skips** (469.116 s), including both native dependency
  worktree/staged tampering cases. `git diff --check` also passed. The task
  remains active; fresh replacement CI is mandatory before acceptance or merge.
- The first run completed with 8 successful jobs and the two Ubuntu failures
  above. Both Windows Node jobs, all Go platforms, and all bootstrap/doctor
  platforms passed. Commit gates `j-me9q94` reported no failures and two test
  complexity warnings (`canCommit=true` with the supported warning allowance;
  `gates_passed=false` is retained rather than reported as warning-free).
