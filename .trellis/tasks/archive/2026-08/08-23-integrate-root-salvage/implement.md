# Implementation Plan

1. Reconfirm root branch, target revision, 14 unique commits, and 124 unique
   dirty paths.
2. Create and verify the external Git and working-tree backup, including an
   actual bundle clone and dirty-archive extraction/hash check.
3. Create the isolated integration worktree and branch at exact `ab9c259`.
4. Start this Trellis task after validating these planning artifacts.
5. Run parallel read-only comparisons for committed Trellis evidence,
   untracked task evidence, and independent documentation.
6. Record the classification and copy only current, non-duplicated evidence.
   Do not copy runtime code, managed snapshots, tests, old UIA / Stop Hook
   specs, `pnpm-lock.yaml`, or user-owned local skills.
7. Validate the changed-path allowlist and prove runtime/managed content is
   unchanged from `ab9c259`.
8. Run `git diff --check`, Trellis task validation, Harness adapter context and
   conflicts checks, `pnpm run doctor`, and all offline quality gates required
   by `.trellis/spec/tooling/index.md`.
9. Commit the reviewed integration content locally, archive the Trellis task,
   and use `add_session.py` to rebuild workspace journal/index records.
10. Verify the integration worktree is clean and the root branch still has the
    original HEAD and 124-path dirty set. Do not push.

## Rollback Points

- Stop immediately if backup restore checks fail or the root baseline changes.
- Stop and recreate the isolated branch from `ab9c259` if any runtime or
  managed path differs from the base.
- Keep rejected candidates in the external backup only; never delete them from
  the root worktree.
