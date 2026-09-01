# 从已发布 CCG 同步并发布 Harness

## Goal

在 CCG 定制 merge commit 和六平台 `preset` 资产确认后，复用专用 clean Harness worktree，通过受支持 lifecycle 更新 snapshot/manifest，并形成可审查的 Harness 发布候选。

## Requirements

- **R1 — 前置条件**：仅在子任务 `08-18-integrate-antigravity-model-ccg` 已有已合并的个人 CCG `main` commit、Git tree、`3.4.15` / `3.4.15+codex.1` / wrapper `5.12.13` 和六资产摘要证据后开始。
- **R2 — Harness 基线**：开始前重新读取 Harness 远端 `main`；规划基线为 `e4d3319cac90d29d6faf2c9ef1fb1ff5d7b0a96c`。远端若前进，停止并更新证据。
- **R3 — 隔离 worktree**：复用 `I:\ai\trellis-ccg-harness-ccg-3.4.14-sync` 以保留其 lifecycle ownership，只从核验后的 Harness `main` 创建新 `codex/` 分支。原工作区 `I:\ai\trellis-ccg-harness` 不得改动。
- **R4 — 权威 CCG checkout**：为 CCG merge commit 建立新的 clean detached checkout；记录 40 位 SHA、Git tree 和 clean 状态，不以旧的 `G:\CodexWorktrees\ccg-merged-3d6c4d65` 代替新版本来源。
- **R5 — 支持的 lifecycle**：只运行 `pnpm harness:update -- --ccg-commit <40-sha> --source-checkout <clean-checkout>` 生成 CCG snapshot 和 `harness.sources.json`。不得手工编辑 snapshot、manifest、ownership 或 managed block；Trellis 保持 `0.6.9`。
- **R6 — 验证**：接受 lifecycle 自带的 frozen install、lint、typecheck、test、build、Go gate、source-tree validation 和 snapshot 本地 CLI smoke；随后运行 source verification、`node scripts/harness-adapter.mjs conflicts` 并独立比对 snapshot Git tree。普通 Harness doctor 在 G5 前只允许精确报告尚未安装的目标 CLI/plugin，不得有其他 blocking/warning；G5 后必须完整通过。
- **R7 — 事务与失败**：更新前确认没有 pending transaction。失败时只使用 `pnpm harness:recover` 或 `pnpm harness:rollback`，不得手工拼回 manifest/snapshot。
- **R8 — 发布门禁**：本地更新和验证完成后停在 G3；G3 后才可 commit、push 和创建 Draft PR；G4 后才可合并。不得 force-push 或清理原 worktree。

## Acceptance Criteria

- [x] **AC1 / R1-R4**：Harness branch 基于重新核验的最新 `main`；CCG source checkout 精确等于已发布 merge SHA/tree；两个原脏工作区不变。
- [x] **AC2 / R5**：只有 lifecycle 生成的必要 snapshot、manifest、lockfile/受管版本表面发生变化，Trellis 仍为 `0.6.9`。
- [x] **AC3 / R5-R6**：`harness.sources.json` 精确记录 CCG `3.4.15`、plugin `3.4.15+codex.1`、merge commit 和 tree；snapshot tree 独立比对一致。
- [x] **AC4 / R6**：update 自带检查、source verification 和 conflict audit 全部通过；G5 前 doctor 只有目标 CLI/plugin 尚未安装这一组预期差异，G5 后完整通过且无 blocking/warning。
- [x] **AC5 / R7**：无 pending transaction；失败时可由受支持 rollback/recover 恢复。
- [x] **AC6 / R8**：commit/push/PR/merge 均有对应门禁批准；最终记录 Harness merge SHA、PR 和云端 `main` manifest 证据。

## Out of Scope

- 同步 Trellis、升级第三方 Skill 或修改项目业务代码。
- 手工维护 CCG snapshot、manifest、ownership 或 release asset。
- 合并、rebase、stash、clean 或 reset 原 Harness 脏分支。
