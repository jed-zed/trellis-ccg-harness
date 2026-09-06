# Integrate preserved root evidence onto latest main

## Goal

Create a lossless, independently verifiable backup of the divergent dirty root
branch, then build a clean integration branch from `ab9c259` that preserves only
still-valid Trellis evidence and independent documentation. Runtime code and
managed Harness/CCG snapshots must remain exactly as they are on `main`.

## Background

- Root branch: `codex/harness-recommended-project-skills` at
  `d6fa26d6b7e8454d7cb985c06c48bd3e5b277305`.
- Integration base: `ab9c2597054fbafb0353024a1593fea3798a7e8d`.
- Root divergence: 14 local commits, 26 modified files, 98 untracked files,
  and 124 unique dirty paths.
- The root branch contains old GPT Pro UIA / Stop Hook and older managed CCG
  mechanisms that have been replaced on `main` and must be treated as dead
  code, not compatibility work to restore.
- The root worktree is user-owned evidence and must remain untouched.

## Requirements

1. Preserve the 14 commits in a Git bundle and patch series, with a commit
   inventory and a restore check that reaches the original root HEAD.
2. Preserve the exact current contents of all 124 dirty files in an external
   archive, with path manifests, SHA-256 checksums, tracked patches, Git status,
   and an extraction/hash restore check.
3. Create `codex/integrate-root-salvage` in an isolated worktree directly from
   `ab9c259`, without merge, rebase, reset, clean, or checkout in the root
   worktree.
4. Review candidate Trellis task evidence and independent documentation by
   content and current semantics. Include only evidence that is accurate,
   non-duplicated, and not superseded by `main`.
5. Exclude all root product/runtime code, managed snapshots, generated lock
   files, user-owned project skills, duplicate active-task projections, and
   obsolete UIA / Stop Hook specifications or tests.
6. Rebuild task lifecycle state, workspace index, and journal through Trellis
   scripts instead of copying conflicting journal/index files by hand.
7. Keep publication outside this task: do not push, open a PR, or merge the
   integration branch.

## Acceptance Criteria

- [x] `G:\\CodexBackups\\trellis-ccg-harness-root-20260823T195605Z` contains
  the bundle, patch series, dirty-file archive, inventories, and top-level
  `BACKUP-SHA256SUMS.txt`.
- [x] Bundle verification restores root HEAD `d6fa26d` and the same ordered 14
  local commit IDs.
- [x] The dirty-file archive contains 124 entries and all 124 restored file
  hashes match the source manifest.
- [x] Root HEAD and its 124-path dirty set remain unchanged after backup and
  integration work.
- [x] The integration branch starts at exact commit `ab9c259` and contains no
  merge or cherry-pick of root product code.
- [x] Every changed path relative to `ab9c259` is Trellis task/workspace
  evidence or an independently reviewed project document.
- [x] `components/ccg-workflow/**`, `harness.sources.json`, provider runtime,
  Harness adapter code, tests, and other managed/runtime paths are byte-for-byte
  unchanged from `ab9c259`.
- [x] Old GPT Pro UIA / Stop Hook and other superseded mechanisms are retained
  only in the external backup, not reintroduced into the integration branch.
- [x] Trellis task validation, journal/index generation, Harness conflict
  checks, source verification, and the repository's complete offline quality
  gates pass.
- [x] The final integration worktree is clean and committed locally; no remote
  write occurs.

## Out of Scope

- Restoring root branch runtime behavior or reconciling it with current main.
- Publishing the integration branch or changing an existing PR.
- Installing dependencies, invoking paid Providers, or running live browser,
  GPT Pro, Grok, Claude, or Antigravity reviews.
- Deleting the root branch, its dirty files, its worktree, or the backup.
