# 简化 GPT Pro URL 优先绑定与一次安全重试

## Goal

在保留 GPT Pro bridge 的目标隔离、幂等、防重发、并发配额和后台无抢焦点能力的前提下，消除“网页已成功创建会话，但渲染后的用户消息与原始提示词哈希不同而被判定为 `send-uncertain`”的误失败，并只在能持久证明第一次没有提交时允许一次后台重试。

用户价值：长提示词和页面渲染格式发生变化时仍能稳定完成桥接；异常首页不会无限等待或重复发送；通知只回到发起请求的原 Codex 任务。

## Background and Confirmed Facts

- 实现与任务基线为当前工作树分支 `codex/gptpro-url-first-recovery-migrated` 的提交 `80ed5d257f70d4b81911096473789d2bf042504e`；实现前必须重新确认该基线及工作树 clean，不能按旧控制工作树脚本修改。
- 当前发送链在 `Assert-AgentBrowserUserTurnAcknowledgement` 中要求渲染后的新用户消息 SHA-256 与原始提示词 SHA-256 完全相等；ChatGPT 对空行等格式的渲染变换会造成误判。
- 当前新会话的精确 `/c/<id>` URL 只有在用户消息确认链通过后才稳定落盘；若哈希先失败，`conversationUrlBound` 可能保持为空。
- 用户已确认以 `profileId + conversationUrl + idempotencyKey` 作为持久恢复身份；`browserId`、`tabId`、`sessionKey` 仅作为当前运行句柄。
- 用户已确认保留点击前 composer 原文哈希、响应文件哈希、幂等预留和响应 baseline；取消点击后“渲染后的用户消息必须等于原始提示词哈希”的成功门槛。

## Requirements

### R1. URL-first persistent binding

- 新会话点击成功后，只要同一已绑定 tab 首次暴露精确 canonical `https://chatgpt.com/c/<id>`，立即原子写入 `conversationUrlBound` 和绑定时间，不等待 DOM 用户消息出现。
- 已有会话点击后 URL 保持原精确 canonical URL 时，即使 DOM 新用户消息暂未出现，也进入已发送/观察状态，不得因为提示词文本哈希差异中断。
- 精确 URL 绑定后，原 tab 关闭时只允许在同一 `profileId` 中后台重开该精确 URL。

### R2. Post-click observation and total deadline

- 每次点击后的“新用户消息、生成状态或精确 URL 进展”观察窗口为 180 秒。
- 整个请求的总等待时间仍为 7200 秒，并从第一次点击开始使用同一个绝对截止时间；重试不得重置或延长该截止时间。
- 若已绑定精确 URL，即使 180 秒内没有看到新用户消息，也继续只读观察直到完成或总截止时间到达；不得重试。

### R3. One safe retry for a proved unsubmitted fresh homepage

- 仅当第一次是 fresh/unbound homepage，180 秒后仍同时满足以下持久证据时，才允许一次重试：
  - 仍是 homepage，未出现精确 `/c/<id>`；
  - 没有新用户消息且没有生成状态；
  - composer 中仍完整保留原始提示词；
  - composer 原文 SHA-256 与点击前保存值完全一致。
- 重试在同一已登录 Chrome profile 中打开一个新的后台 tab；不得抢占焦点。
- 原失败 tab 保留作诊断，不再操作，也不自动关闭。
- 两次尝试属于同一个逻辑请求：复用相同请求身份、idempotency identity 和同一个并发 slot；不得额外占用每任务 3 / 全局 6 的配额。
- 每个逻辑请求最多两次点击；绝不允许第三次发送。

### R4. Second observation timeout and terminal behavior

- 第二次点击也使用 180 秒观察窗口。
- 第二次窗口结束后仍无精确 URL、新用户消息或生成状态时，立即结束 RootWait 并通知用户，不继续等到 7200 秒，也不得第三次发送。
- 若第二个 composer 仍完整且原文哈希一致，记录 `retry-not-submitted`，以持久的 pre-click-unsent 等价证明安全释放原 slot。
- 若第二个 composer 已清空、内容变化或无法读取，记录 `recovery-required`；不得自动释放或重发。
- 原 Codex 任务必须显示不同的用户提示与建议动作：
  - `retry-not-submitted`：明确说明两次尝试均已持久证明未提交、slot 已安全释放；只有用户再次发起新请求时才能使用新的 idempotency identity 重试。
  - `recovery-required`：明确说明提交状态无法确认、禁止重发且 slot 仍隔离；建议保留页面与 evidence，先做人工诊断和显式恢复处理。

### R5. Duplicate URL handling and notification isolation

- 同一 profile 内出现多个相同精确 conversation URL 的 tab 时：原 tab/session 仍存活则优先使用；否则按稳定、可复现的顺序选择一个匹配 tab 做只读观察，不因重复 URL 直接失败。
- 不同 profile、不同 URL、登录页或挑战页仍必须停止并报告，不得宽松匹配。
- 终态通知只能通过原 `CodexThreadId` 对应的 Codex 任务返回；不使用 Stop Hook、子代理、系统托盘或跨任务通知。
- RootWait 等待继续由本地脚本轮询，不调用模型，不因轮询消耗模型 token。

### R6. Evidence and safety invariants

- 保留 `automaticResendAllowed=false` 的默认和 exact-once 审核语义；一次安全重试必须由专门的两尝试状态机授权，不能把通用自动重发开关改为 true。
- state/evidence 必须记录 request identity、attempt 1/2、各自 target binding、点击时间、180 秒观察结果、URL 绑定、composer 证明、最终分类和共享 slot 身份。
- URL、profile、Codex task、watcher、response baseline、response/evidence 文件哈希和 acknowledgement/import 防重校验继续保留。

## Acceptance Criteria

- [ ] AC1：fresh homepage 点击后先出现精确 `/c/<id>`、DOM 用户消息稍后出现时，URL 立即持久绑定且请求继续完成。
- [ ] AC2：已有精确会话中 DOM 用户消息渲染延迟或文本格式变化时，不被原始提示词 SHA 不一致中断，也不触发重试。
- [ ] AC3：只有 composer 原文完整且 SHA 一致的 fresh/unbound homepage 才能触发第二次后台点击。
- [ ] AC4：一个逻辑请求最多两次点击；任何分支都没有第三次发送。
- [ ] AC5：两次尝试复用相同 request/idempotency identity 和同一 capacity slot，不额外占用 3/6 配额。
- [ ] AC6：第二次 180 秒超时后，composer 完整分支安全释放 slot 并提示“已证明未提交，可由用户新建请求”；不完整/不可读分支进入 `recovery-required` 并提示“状态不明、禁止重发、需人工诊断”；二者都立即通过原 Codex 任务通知用户。
- [ ] AC7：同一 profile 的重复精确 URL tab 不导致失败；优先原句柄，否则稳定选择只读观察目标。
- [ ] AC8：7200 秒绝对截止时间从第一次点击开始，重试不重置。
- [ ] AC9：新后台 tab、观察、恢复均不请求焦点，不干扰用户输入。
- [ ] AC10：现有多窗口每任务 3 / 全局 6、跨任务隔离、幂等、防重发、RootWait 无模型轮询、response/evidence/import 哈希校验均无回归。
- [ ] AC11：真实 Chrome E2E 覆盖 URL-first 成功、一次安全重试和第二次超时通知；用户确认焦点未被打断。

## Out of Scope

- 不使用提示词/页面文本的统一格式化哈希作为新的主成功门槛。
- 不放宽 profile、conversation URL、CodexThreadId、watcher、response/evidence 或 import 身份校验。
- 不自动登录、处理 CAPTCHA/MFA、调用 ChatGPT 内部 API，或切回 Codex 侧边浏览器/UIA。
- 不增加第三次发送、无限重试、跨 profile 恢复、自动关闭诊断 tab 或新的模型/子代理监控。
- 不改变 ChatGPT 服务端配额，也不把 3/6 本地并发限制解释为服务端官方上限。
