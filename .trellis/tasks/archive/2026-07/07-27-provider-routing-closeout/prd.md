# Close persistent CCG provider routing rollout

## Goal

让已合并的 CCG `3.4.0` 三角色路由在本机 Codex 与 Harness 中持久生效：
Provider 可由 `frontend`、`backend`、`search` 路由选择，不再被 Harness
项目策略永久写死为 Claude/Grok 禁用。

## Background

- 远端 Harness `main` 已包含 CCG `3.4.0`，但 Codex marketplace 仍指向
  `I:\ai\trellis-ccg-harness-clean` 的旧快照，实际登记插件仍为 `3.3.0`。
- 全局 CLI 已为 `ccg/3.4.0`，`ccg routing list` 已能解析三个角色。
- `.harness/adapter.json`、根 `AGENTS.md`、适配器冲突检查与规范仍将
  Claude/Grok 的通用可用性写死为禁用。
- Claude CLI 当前未安装；Grok CLI 已安装，但付费 external intelligence
  仍为独立 opt-in 开关。

## Requirements

- `R1`：Codex marketplace 必须指向持久、干净、与远端 Harness `main`
  对齐的本地来源，并通过受支持的 `codex plugin`/Harness 安装流程登记
  `ccg 3.4.0+codex.1`；禁止只复制缓存目录。
- `R2`：Harness 只固定 Codex 为真实工作区写入者和最终验证者；Claude、
  Grok、Gemini 等外部 Provider 均只能提供有界只读证据或草案。
- `R3`：Harness 不得再把 Claude/Grok 的通用角色可用性永久写死为
  `enabled=false`。角色选择由 `ccg routing get <role>` 决定，运行时是否
  可调用由对应 CLI/包装器可用性决定。
- `R4`：Grok 的角色路由与 `ccg route` external intelligence opt-in 必须
  明确区分；本任务不得自动开启付费 intelligence。
- `R5`：本任务不得安装、登录或启动 Claude CLI，也不得执行 Grok 付费
  模型请求。
- `R6`：旧的 Trellis/Harness 规范、冲突文档、适配器契约与测试必须同步，
  避免项目指令继续覆盖新的角色路由。
- `R7`：保留现有脏工作树、历史分支和用户文件，不做清理或重置。

## Acceptance Criteria

- [x] `codex plugin list --marketplace ccg-gptpro-worflow` 显示 CCG 已安装、
  已启用，版本为 `3.4.0` 或精确插件构建 `3.4.0+codex.1`，来源为持久的
  Harness CCG `3.4.0` 快照。
- [x] 新插件缓存包含完整 Grok runtime，`ccg:doctor -Grok` 不再因缺少
  `manage.mjs` 失败；不要求真实 Grok 调用成功。
- [x] 根 `AGENTS.md` 和当前规范不再声明 “Claude is disabled” 或
  “Grok is disabled by default” 作为通用角色策略。
- [x] Harness 冲突检查只阻止外部 Provider 获得工作区写权限，不再因为
  Claude/Grok 被角色路由选中而报 blocking。
- [x] Harness context/契约能表达 Provider 可路由、只读和运行时可用性边界，
  不把本机未安装 CLI 误写成永久策略。
- [x] `ccg routing list` 的三个角色保持独立设置；本任务不改写用户选择。
- [x] 聚焦测试、`pnpm harness:test`、`pnpm doctor`、
  `pnpm harness:conflicts`、`pnpm verify:sources` 和 CCG 完整质量门禁通过。
- [x] 变更通过干净分支提交、推送和 PR 交付。

## Out of Scope

- 安装或登录 Claude Code。
- 启用 Grok external intelligence、执行付费 Web/X/模型请求。
- 新增 Provider 注册框架、守护进程、数据库或第二套路由配置。
- 清理现有脏工作树、旧分支或用户级 Claude/Grok 数据。

## Open Questions

无。用户已批准上述最小收尾范围。
