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

- [ ] `harness.sources.json` pins the CCG main commit and tree; the snapshot matches that tree.
- [ ] The snapshot has no `repair-wrapper-r2` files or R2 sync steps, and `codex-mode install` accepts `--agent-preservation-plan-sha256`.
- [ ] `harness:update` gates pass (CCG install/lint/typecheck/build/tests, Go, Harness tests); `verify-sources` and `conflicts` results recorded.
- [ ] Harness CI passes on the PR.

## Plan

1. Merge CCG #55 after CI passes; record the resulting main commit.
2. Clean CCG checkout (remote `gptpro`) at that commit; run `pnpm harness:update --source-checkout <path>` in this worktree.
3. Run `verify-sources` and `conflicts`, commit snapshot + task record, open the Harness PR, watch CI.
