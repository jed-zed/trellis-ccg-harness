# Update CCG snapshot: remove R2 mirror and restore plan SHA binding

## Goal

Update components/ccg-workflow to CCG main after #59 and #55: drop the unused Cloudflare R2 mirror and restore the --agent-preservation-plan-sha256 option that scripts/install.ps1 passes.

## Background

- Harness #58 pinned CCG `6462540`, a branch commit without a CCG PR. CCG #59 (merged as `4b22a68`) now carries it, plus the R2 removal: the installer has used only the personal GitHub Release since `b0f2c41`, no Cloudflare credentials exist, and nothing reads the mirror.
- The pinned snapshot lost CCG #55's preservation-plan SHA binding. `scripts/install.ps1:1108` still passes `--agent-preservation-plan-sha256`, which the snapshot's `codex-mode` command rejects as an unknown option. CCG #55 restores it on main.

## Requirements

- Update the snapshot with the supported `pnpm harness:update --source-checkout <clean checkout>` flow to the CCG main commit that contains #59 and #55; no hand edits under `components/ccg-workflow/`.
- Run it in a separate worktree from `origin/main`, leaving the main checkout's uncommitted work untouched; do not change the global CCG install or link.
- Deliver as a separate Harness PR; no auto-merge.

## Acceptance Criteria

- [x] `harness.sources.json` pins the CCG main commit and tree; the snapshot matches that tree.
- [x] The snapshot has no `repair-wrapper-r2` files or R2 sync steps, and `codex-mode install` accepts `--agent-preservation-plan-sha256`.
- [x] `harness:update` gates pass (CCG install/lint/typecheck/build/tests, Go, Harness tests); `verify-sources` and `conflicts` results recorded.
- [ ] Harness CI passes on the PR.
- [ ] `doctor.ps1` run from Codex before merge (installed-CLI check pending; see Verification).

## Plan

1. Merge CCG #55 after CI passes; record the resulting main commit.
2. Clean CCG checkout (remote `gptpro`) at that commit; run `pnpm harness:update --source-checkout <path>` in this worktree.
3. Run `verify-sources` and `conflicts`, commit snapshot + task record, open the Harness PR, watch CI.

## Verification

- CCG #55 merged as `af2f421` (tree `466b449`). `pnpm harness:update --source-checkout <clean gptpro checkout>` → `status: updated`, transaction `2026-10-28T23-29-48-804Z-6a68b89b`. Gates: CCG vitest 829 passed / 3 skipped (source and final path), Go `codeagent-wrapper` ok, Harness tests 590 (589 passed, 1 skipped).
- Snapshot change list equals the CCG diff `6462540..af2f421` (18 files); committed component tree is `466b449`.
- `verify-sources`: passed. `conflicts --ci`: 0 blocking, 0 warning, 14 passed.
- Not valid: the doctor step inside `harness:update` ran under Claude Code with `CLAUDECODE`/`CCG_HOST` stripped so the global `ccg-codex --version` check would run. The global CLI is Codex-only, so that check must be rerun with `pwsh -NoProfile -File .\scripts\doctor.ps1` from Codex. No other step used the global CLI; the managed global smoke was skipped (no ownership record in the worktree).
- Environment note: a resident process under `I:\ai\` holds directory handles, so the component rename failed with `EPERM` in an `I:\ai\...` worktree (transaction rolled back, no changes). The update ran in `G:\CodexWorktrees\ccg-snapshot-r2-plan-sha-harness`.
