# Implementation Plan

1. After Boss approves the final planning summary, bind and start this task through `task.py start`, then load phase 2 context and `trellis-before-dev`.
2. Run the CCG execute intake route with external intelligence disabled; stop if the route returns exit 2, 3, or 4.
3. Recheck the source checkout identity, clean state, `ddfc70c` commit, Git tree, package version, and direct ancestry from `a57cddd`.
4. Re-run default-Python bootstrap checks and a temporary context-validation smoke that asserts the warning text and zero exit status.
5. Create a temporary sparse worktree from current `HEAD`, excluding only the two documented protected security-reference paths.
6. In that clean worktree run:
   `pnpm harness:update -- --ccg-commit ddfc70c09e2e06b158d0a972a677d2b02aedec21 --source-checkout C:\Users\29933\.codex\worktrees\fix-windows-grok-cmd`
7. Require the transaction receipt to report commit `ddfc70c` and tree `4d914cdd03fd8e66a58a4d7555698b9045d3f903`. Reject a generated diff outside `components/ccg-workflow/**` and `harness.sources.json`.
8. Apply the exact lifecycle-generated patch in this worktree. Confirm that the component diff is limited to the seven source-commit paths and the coupled manifest.
9. Stage only those eight snapshot/provenance paths and run `pwsh -NoProfile -File .\scripts\verify-sources.ps1 -Index`.
10. Run the focused Grok distribution test, affected CCG lint/typecheck/test/build gates, `pnpm harness:test`, `pnpm doctor`, and `node scripts/harness-adapter.mjs conflicts`; record exact exits and any unrelated blocker.
11. Run `trellis-check`, inspect full task-owned diffs, verify protected dirty paths remain excluded, and perform the required spec-update judgment.
12. Present one commit plan covering only task-owned files. Commit only after Boss confirms; do not push.

## Execution evidence

- Trellis compatibility: default Python compiled `task_context.py`, `task.py`, and `get_context.py`; task list/context and the warning smoke passed.
- Lifecycle: canonical clean sparse-worktree update completed with `status: updated`, commit `ddfc70c09e2e06b158d0a972a677d2b02aedec21`, tree `4d914cdd03fd8e66a58a4d7555698b9045d3f903`, and root Harness results `448 passed / 3 skipped / 0 failed`.
- Snapshot scope: generated and applied diff is exactly seven CCG paths plus `harness.sources.json`; the two protected security-reference paths remained sparse-excluded.
- Current worktree: `verify-sources.ps1 -Index -AuthoritativeCheckout <clean-local-checkout>` passed, focused Grok distribution tests passed `18/18`, and `harness-adapter.mjs conflicts --index` reported `0 blocking / 0 warning`.
- Review gates: change analysis passed; both Grok distribution copies passed security scanning with zero findings; quality scanning passed with only pre-existing directory-level complexity warnings.
- Spec judgment: no `.trellis/spec/` update is needed because this task introduces no new Harness contract; provenance rules already exist, and the Trellis 0.6.9 compatibility workaround plus overwrite risk are task-local and documented in this PRD/design.

## Expected task-owned paths

- `.trellis/scripts/common/task_context.py`
- `.trellis/tasks/08-04-grok-windows-distribution-closeout/**`
- `harness.sources.json`
- The seven `components/ccg-workflow/**` paths changed by `ddfc70c`

## Validation checkpoints

- Bootstrap: Python compile, task list/context, warning smoke.
- Source: clean personal checkout; exact commit/tree/version/remote.
- Transaction: canonical lifecycle receipt and built-in gates.
- Snapshot: exact staged tree through `verify-sources.ps1 -Index`.
- Integration: focused CCG test, full affected gates, Harness tests, doctor, and conflicts.
- Scope: no protected dirty path staged or task-modified.
