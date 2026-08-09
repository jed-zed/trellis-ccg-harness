# Grill 决策与代码证据

> 这些已确认决策随任务迁移到目标工作树，产品含义不变。

## 已确认事故机制

- 基线：`codex/gptpro-url-first-recovery-migrated@80ed5d257f70d4b81911096473789d2bf042504e`。
- `chatgpt-pro-sidebar.ps1::Assert-AgentBrowserUserTurnAcknowledgement` 把最后一个渲染用户消息的 SHA 与原始 prompt SHA 做严格相等比较；页面对空行等格式进行渲染转换时会误报 `UserTurnAcknowledgementMismatch`。
- `Invoke-AgentBrowserSend` 的点击后观察先调用上述校验，再把 fresh chat 的精确 URL 落为稳定绑定；因此页面已出现 `/c/<id>` 时仍可能先进入 `send-uncertain`，留下空的 `conversationUrlBound`。
- 当前 bridge 已有点击前 composer SHA、全局 idempotency reservation、target claim、response baseline、RootWait 本地轮询和 3/6 capacity slot；设计应复用这些机制，不新增另一套身份或队列。

## 用户确认的最小状态机

1. 点击前保存 composer 原文 SHA、baseline、idempotency 和 target/profile 证据。
2. 点击后同 tab 首次出现精确 `/c/<id>` 就原子绑定，不等待渲染用户消息哈希。
3. 每次点击最多观察 180 秒；请求总截止时间固定为第一次点击后 7200 秒。
4. 精确 URL 已绑定时只继续观察，绝不重试。
5. 只有 fresh/unbound homepage 且 180 秒后 prompt 仍完整留在 composer、原文 SHA 一致、无用户消息、无生成时，才在同 profile 的新后台 tab 上做一次重试。
6. 重试与第一次共享 request/idempotency/capacity slot；旧 tab 保留诊断且不再操作。
7. 第二次 180 秒无进展即终止：composer 完整则 `retry-not-submitted` 并安全释放；否则 `recovery-required`。
8. 终态只由 RootWait 返回原 Codex 任务；最多两次点击，无第三次发送。

## 必须保留的边界

- profile、精确 URL、CodexThreadId、watcher、target claim、response baseline、response/evidence/import hash 校验。
- background-only 与 `focusRequested=false`。
- 本地无模型轮询、每任务 3 / 全局 6、不同任务隔离。
- 登录/挑战/不同 profile/不同 URL 继续 fail closed。

## 规划关注点

- 在共享发送/等待状态机根因处修改，避免在 CCG importer 或单个调用方加补丁。
- 将“允许第二次点击”建模为同一逻辑请求的受限 attempt transition，而不是把 `automaticResendAllowed` 改为 true。
- Duplicate same-URL tab 的稳定选择只用于只读观察；发送仍依赖精确完整 target binding。
- watcher 的终态、slot release proof 和 batch result 必须认识 `retry-not-submitted` / `recovery-required`，且不把非 terminal durable state 当成功。
