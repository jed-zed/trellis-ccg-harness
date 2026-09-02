# 执行计划

## Phase 1 — 前置身份

- [x] 读取已完成 CCG 子任务的 merge SHA/tree、版本和六资产摘要。
- [x] 新建该 merge commit 的 clean detached CCG checkout，验证 clean 和 tree。
- [x] 重新核验 Harness 远端 `main`；若不同于规划基线，更新任务证据后停止。
- [x] 验证专用 Harness worktree clean、RepoRoot ownership 正确且无 pending transaction。

## Phase 2 — Lifecycle 更新

- [x] 从精确 Harness `main` 创建新 `codex/` 分支。
- [x] 以 `2052120` 修复并回归验证 update 只要求当前已安装基线，目标全局 CLI/plugin 留给 G5。
- [x] 运行受支持的 `harness:update`，只传 40 位 CCG merge SHA 和 clean source checkout。
- [x] 若失败，保存日志并使用受支持 recover/rollback；不手改生成物。

## Phase 3 — 验证和审查门

- [x] 复核 lifecycle 全部内建检查结果。
- [x] 独立比对 source checkout tree、snapshot tree 和 `harness.sources.json`。
- [x] 运行 Harness doctor、source verification 和 `harness-adapter conflicts`；G5 前 doctor 只能有目标 CLI/plugin 尚未安装的预期差异。
- [x] 检查 diff，只保留前置 lifecycle 修复、对应测试/规范和 lifecycle 必需生成物；复核两个原脏工作区不变。
- [x] 展示 diff、身份和测试结果，等待 G3。

## Phase 4 — Draft PR 与合并

- [x] G3 后 commit、push 并创建 Draft PR；记录精确 head。
- [x] 等待并核验 CI、PR merge base 和无额外提交，等待 G4。
- [x] G4 后合并；重新读取 Harness 云端 `main` SHA 和 manifest。
- [x] 更新本子任务证据并交付本机安装子任务；Boss 已统一批准最终归档。

## Final Evidence

- PR: `https://github.com/jed-zed/trellis-ccg-harness/pull/44`
- Harness merge SHA: `fa503092372a7f33eaaae5398560b2d1a4f77940`
- CI: run `32305707403`, 10/10 checks passed
