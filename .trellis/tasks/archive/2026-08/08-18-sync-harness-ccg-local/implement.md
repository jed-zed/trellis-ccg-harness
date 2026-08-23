# 总体执行计划

## Phase 0 — 规划与保护

- [x] 核验 Harness/CCG 云端 `main`、本机安装内容和现有定制来源。
- [x] 记录 Boss 选择 A：原脏工作区保持不动。
- [x] 记录 Boss 选择保留 `ANTIGRAVITY_MODEL` 定制。
- [x] 获得 G0，启动子任务 1；父任务保持进行中，后续子任务仍为 planning。

## Phase 1 — CCG 定制发布

- [x] 执行 `08-18-integrate-antigravity-model-ccg`。
- [x] G1：本地 diff/测试批准后创建 Draft PR。
- [x] G2：精确 head/CI 批准后合并，并核验六个 `preset` wrapper 产物。

## Phase 2 — Harness provenance 发布

- [x] 执行 `08-18-sync-harness-from-ccg`。
- [x] G3：lifecycle diff/测试批准后创建 Draft PR。
- [x] G4：精确 head/CI 批准后合并并重新读取云端 `main`。

## Phase 3 — 本机安装

- [x] 执行 `08-18-install-synced-ccg-local`。
- [x] G5：最终预览、备份和回滚证据批准后更新全局安装。
- [x] 完成内容、ownership、doctor、离线模型 argv 和原脏工作区不变性核验。

## Phase 4 — 收尾

- [x] 运行 `node scripts/harness-adapter.mjs conflicts`。
- [x] 汇总 CCG/Harness merge SHA、tree、版本、wrapper SHA-256、安装证据和回滚位置。
- [x] Boss 已统一批准执行到最后；完成并归档三个子任务和父任务。
