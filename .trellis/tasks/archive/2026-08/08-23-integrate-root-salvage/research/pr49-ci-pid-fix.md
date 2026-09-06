# PR #49 follow-up: cleanup test PID collision

> Historical source-fix and failed-sync record. The subsequent Windows repair
> is authorized and tracked in Trellis task `fix-windows-process-identity`;
> consult its results for the current repair and synchronization status.

## Approved scope

After the original evidence-only task was archived, Boss authorized this
separate repair: "单独修复它并重新运行检查，等测试通过后再合并代码".
This follow-up does not change the historical salvage acceptance criteria.
It fixes only the failing CCG test fixture, publishes the personal-source
commit and matching Harness snapshot, and merges only after fresh CI passes.
Root worktrees, runtime cleanup behavior, global installations and user
configuration remain unchanged.

## Evidence and design

- Harness PR #49 head: `d9b51ca2feba4547a84650b452d48fcba41ae3e7`.
- Failing CI run/job: `34004348514` / `101408732107`.
- `TestRunCleanupFlagEndToEnd_Success` used fixed orphan PIDs `2100` and
  `2200`, while its process-check stub preserves `os.Getpid()`.
- The failing process PID was `2200`; the second orphan was consequently
  retained. Expected deletions: 2; actual deletions: 1.
- Reuse the adjacent startup-cleanup test's `os.Getpid() + 1000` fixture
  pattern. Derive output assertions from those fixture filenames, retaining
  all existing count, deletion, keeper and no-new-log assertions.
- Modify the personal CCG source, not its managed Harness snapshot. Sync
  through `scripts/harness-lifecycle.mjs update` and preserve source identity.

## Execution and acceptance

1. Fix only `codeagent-wrapper/main_integration_test.go` on an isolated CCG
   branch based on personal `main` at `433081945d40ccd79720309e0ed7a101ac20fc0b`.
2. Run the focused cleanup test repeatedly, the complete short Go suite and
   Go build; keep all assertions and required checks enabled.
3. Commit/publish the source repair, sync the exact clean source through the
   existing Harness update flow, and check the complete resulting diff.
4. Run the update's source/Harness gates and fresh CI. Merge only if the
   reviewed heads still match and all required checks pass.

## Verified execution results

- Personal CCG source commit: `6252515c5359a7e704296ad1ac39d7624d244543`.
  Only `codeagent-wrapper/main_integration_test.go` changed (9 insertions,
  7 deletions); runtime cleanup code and all existing assertions are retained.
- Focused cleanup test: 100 repetitions passed. The complete short Go suite,
  Go build and `git diff --check` also passed.
- Personal CCG [PR #49](https://github.com/jed-zed/ccg-gptpro-worflow/pull/49)
  passed all 7 CI checks and merged as
  `9d29419d589ae65fb073a5d913773b00e56adcb0`.
- The supported Harness update used that exact clean source commit. Both the
  source and exported snapshot passed lint, typecheck, 643 tests (3 existing
  skips), package build, the full Go suite and Go build. Their full Go runs
  reported 97.592 seconds and 46.791 seconds respectively.
- The final Harness suite reported 452 passed, 3 failed and 3 skipped (458
  total). All three failures were Windows process-instance lookup failures in
  unchanged third-party transaction/approval receipt lock code, not the PID
  fixture. The update exited nonzero and automatically restored the prior
  snapshot/manifest (`1572b7ae8111fb15272c5b3f60a59bb5ce1bf510`); the worktree
  was verified clean before writing this result.
- A focused rerun of those three failures passed two and reproduced the
  approval receipt lock failure in
  `tests/harness-third-party-cli.test.mjs:742`. The affected implementation and
  tests are identical to current Harness `main` at `a68519f6233bef3022c333a75b0f56ee8e6353df`.
- A read-only probe of the exact Windows process lookup reproduced three
  5-second timeouts (5036, 5027 and 5030 ms, terminated by the existing bound).
  A separate diagnostic with a 30-second bound also timed out (41504 ms
  including termination); simply increasing the production bound is not a
  verified repair.
  No timeout, lock semantics, retry policy or test gate was changed.
- Local evidence: FastCtx logs `j-ntteio` (full update), `j-mga9l0` (focused
  rerun), `j-0ms9d5` (5-second process lookup diagnostic), and `j-uic3tw`
  (30-second diagnostic).

Status: the isolated PID fixture repair is published and verified in the
personal source. Harness synchronization and merge remain blocked by the
separate Windows process-instance lookup failure. Harness PR #49 remains open
at `d9b51ca2feba4547a84650b452d48fcba41ae3e7`; no failed snapshot was pushed.
The new lock-related failure requires a separately scoped repair decision.
