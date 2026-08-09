# CCG Provider 规划证据

## 路由

- `backend=grok`
- `search=grok`
- `product-manager=claude`（已选择但尚未获得本次调用授权）

## Search / intelligence gate

- 状态：`invoked`，exit code `0`，`received_unverified`。
- 模型：`grok-4.5`。
- 最新状态文件：`.ccg/tasks/simplify-gptpro-url-first-recovery/intelligence-route.json`。
- 最新原始证据：`.codex/ccg/intelligence/20260809081931-fe36367ca33f/evidence.json`。
- 最新证据 SHA-256：`a5316f046ebf3483baf22463967cde9e94cc34e8a546de1845e674cfb65ead4f`。
- 最新语义判定：`contract`，原因是规划 durable bridge state-machine contract，并非诊断当前线上事故。
- 可用结论：保留 exact canonical conversation URL 与 `/share/` 区分；同一逻辑重试复用 idempotency identity；后台打开的无抢焦点行为需要真实 E2E。
- 限制：route 误判为 current incident，且没有预声明官方产品域；外部结论不作为本地状态机事实，仅作风险提示。

## Backend planning analysis

- 状态：成功，非空响应。
- Provider session：`019fe301-d7c3-7682-a3b6-0d1897d961d5`。
- 工作树：`G:/CodexWorktrees/gptpro-url-first-recovery-harness`。
- 原始报告：`G:/CodexWorktrees/gptpro-url-first-recovery-harness\.codex\ccg\intelligence\20260808141514-urlfirst\report.md`。
- 原始证据：`G:/CodexWorktrees/gptpro-url-first-recovery-harness\.codex\ccg\intelligence\20260808141514-urlfirst\evidence.json`。
- Provider 确认：
  - `Invoke-AgentBrowserSend` 在用户消息哈希校验之后才捕获 fresh chat 精确 URL，导致已出现 `/c/<id>` 仍可能留下空 `conversationUrlBound`。
  - `targetBinding.url` 与 `conversationUrlBound` 可能分裂；watcher 因后者为空而拒绝恢复。
  - 现有同 profile 精确 URL 后台 reopen ladder 可复用，不需要重写。
  - 建议把 exact URL 落盘提前，并由 adapter/watcher 使用一致的 recovery URL 语义。

## 分歧与 Codex 决策

| 主题 | Grok 建议 | 用户固定要求 | Codex 决策 |
|---|---|---|---|
| 自动重试 | 最小 M2 修复保持点击后绝不重试 | 有 durable 未提交证明时允许一次后台重试 | 实现专用两尝试状态机；`automaticResendAllowed` 仍保持 false，通用调用方不得重发 |
| 同 URL 重复 tab | 报 ambiguous、fail closed | 同 profile 同 exact URL 可继续只读观察 | 发送仍需完整 binding；观察优先原句柄，否则稳定排序选择一个 |
| 字段收缩 | 可选后续把多个 URL 字段合并 | 本任务目标是修复体验 | 不做 schema 大迁移；只增加最少 attempt/deadline/proof 字段并统一 resolver 语义 |
| 外部搜索 | route 给出通用 Web 资料 | 本地事故已由代码与 live evidence 证明 | 本地代码/测试为事实权威；外部资料仅支持 URL 分类、幂等与焦点风险 |

## Product Manager 迁移记录

- 2026-08-09：旧控制工作树在 Provider 请求前因 `harness.sources.json` 锁定 CCG `3.4.5`、安装运行时为 `3.4.6` 而 fail closed；没有产生 Claude 网络调用、费用或审查结果。
- 本任务随后迁移到锁定 CCG `3.4.6` 的目标工作树，保留同一需求与 Provider 证据身份，并重新发起一次获授权的只读 `PLAN_REVIEW`。
