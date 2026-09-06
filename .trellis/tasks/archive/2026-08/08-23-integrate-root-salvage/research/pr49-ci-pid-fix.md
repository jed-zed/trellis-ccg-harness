# PR #49 follow-up: cleanup test PID collision

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

Status: implementation and validation pending.
