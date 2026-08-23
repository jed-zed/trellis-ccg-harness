# 执行计划

## Phase 1 — 基线

- [x] 重新核验个人 CCG 远端 `main` SHA；若不等于规划基线，更新任务证据后停止。
- [x] 从该 SHA 创建新 clean worktree 和 `codex/` 分支，记录 HEAD、tree 和 clean 状态。
- [x] 完整读取即将修改的命令构造、测试、版本和 workflow 文件。

## Phase 2 — 最小实现

- [x] 在共享 Antigravity argv 构造点加入 trim 后的 `ANTIGRAVITY_MODEL` 参数。
- [x] 增加一个最小测试覆盖空值保持不变和指定值精确注入。
- [x] 更新帮助文本、package/plugin/wrapper 版本及仓库要求的现有版本表面。
- [x] 用精确 Go `1.21.13` 构建六平台 wrapper，写入六个 SHA-256；无法取得工具链则停止。

## Phase 3 — 本地验证和审查门

- [x] 运行聚焦 Go 测试、`go test ./...`、版本/摘要检查、pnpm lint/typecheck/test/build。
- [x] 用假的 `agy` 捕获 argv；不执行真实 Provider 请求。
- [x] 检查 diff，删除无法映射到需求的改动，并复核原脏工作区不变。
- [x] 向 Boss 展示 diff、测试、工具链和六摘要，等待 G1。

## Phase 4 — Draft PR 与发布

- [x] G1 后 commit、push 并创建 Draft PR；记录精确 head。
- [x] 等待 CI 独立重建六平台产物；任何摘要不一致都回到根因修复。
- [x] 展示 CI、PR head、merge 方式和 release 影响，等待 G2。
- [x] G2 后合并；核验个人 `main` merge SHA/tree、`preset` 六资产与摘要。
- [x] 更新本子任务证据并交付 Harness 子任务；Boss 已统一批准最终归档。
