# 设计：GPT Pro URL-first 与一次安全重试

## 1. 边界与基线

- 实现目标是 `codex/gptpro-url-first-recovery-migrated@80ed5d257f70d4b81911096473789d2bf042504e` 及其现有 PR 工作树 `G:/CodexWorktrees/gptpro-url-first-recovery-harness`。
- Trellis 任务与 CCG 计划已迁移到上述目标工作树并作为唯一任务权威；执行前仍需确认分支、基线和工作树没有未分类改动。
- 不引入新依赖、新通知通道、新浏览器 transport 或第二套队列。复用已有 atomic JSON、idempotency reservation、target claim、target-scoped UI mutex、background open、RootWait 和 capacity slot。

## 2. 根因与最小修复位置

原始发送失败的根因位于共享发送状态机：`Invoke-AgentBrowserSend` 点击后先执行渲染用户消息的原始 prompt SHA 相等校验，再绑定 fresh chat 的 exact URL。页面已经产生会话时，格式渲染差异会先抛错，使 durable recovery key 没有落盘。M2 仍把 importer 作为独立安全边界验证，并已补上未知或非 `completed` `terminalOutcome` 的拒绝回归；这不是原始发送根因，但属于同一交付批次必须闭合的成功导入门槛。

修改应集中在：

1. `chatgpt-pro-sidebar.ps1` 的 post-click observation、URL binding、attempt state 和 exact-URL target recovery。
2. `chatgpt-pro-sidebar-watch.ps1` 的绝对 deadline、terminal evidence、capacity release proof 与 batch result 映射。
3. 两个既有 Pester 测试文件以及 Skill/spec 文档。

CCG bridge/import 继续只导入 `completed` 且 acknowledgement/hash/target/thread 全部通过的证据；失败终态只回报原 Codex task，不进入成功 import。

## 3. Durable state contract

保留现有顶层字段，并增加以下最小字段：

```text
requestStartedAtUtc
firstClickAtUtc
responseDeadlineAtUtc        # firstClickAtUtc + 7200s
attemptCount                 # 1..2
attempts[]                   # 最多两项
  attempt
  targetBinding
  clickedAtUtc
  observationDeadlineAtUtc   # clickedAtUtc + 180s
  exactConversationUrl
  userTurnObserved
  generatingObserved
  composerSha256Observed
  outcome
retryOutcome                 # empty | retry-not-submitted | recovery-required
```

不把 `automaticResendAllowed` 改为 true。它仍表示调用方和通用 recovery 不能重发；第二次点击只能由同一次 adapter send 内部状态机在 durable proof 全部成立时执行。

`promptSha256` 继续是点击前 composer 完整性证明和 evidence 绑定，不再作为页面渲染用户消息的成功门槛。`baselineUserTurnSha256` 仍用于检测 baseline 后是否恰好增加了一个用户 turn，但不比较新增 turn 的内容 SHA 与原始 prompt SHA。

## 4. 两尝试状态机

### 4.1 第一次点击

1. 保持现有 pre-click 校验、prompt fill、composer raw SHA、idempotency 和 target claim。
2. 点击返回后立刻写 `invokeAttempted/invokeReturned`、`firstClickAtUtc`、绝对 `responseDeadlineAtUtc` 和 attempt 记录。
3. 在最长 180 秒观察中，每次 snapshot 按顺序处理：
   - 先验证同 profile 与绑定目标；
   - 若同 tab 首次出现 exact canonical `/c/<id>`，立即原子写 `conversationUrlBound`、时间和当前 target binding；
   - 再记录新用户 turn / generating / composer 状态；不得用渲染文本 SHA 阻止 URL 落盘。

### 4.2 第一次窗口结束

- 已有 exact URL：进入 `sent`，启动/继续 RootWait 到绝对 7200 秒截止；DOM user turn 延迟不触发重试。
- fresh/unbound 但已出现 user turn 或 generating：进入 `sent` 且 binding pending，继续只读观察；不得重试。
- fresh/unbound 且没有 URL/user turn/generating，并且 composer 原文仍完整且 SHA 与点击前相等：记录 attempt 1 `proved-not-submitted`，允许第二次点击。
- 其余情况：记录 `recovery-required`，立即产生 no-resend 终态并回报原任务；不继续猜测或重试。

### 4.3 第二次点击

1. 复用同 evidence dir、CodexThreadId、idempotency key/reservation、request identity 和 capacity slot。
2. 使用同 profile 既有 `open --background` primitive 创建新 homepage tab，证明 fresh/empty 后预留新的 tab target claim；旧 tab/claim 保留作诊断，不再操作、不关闭。
3. 对 attempt 2 再执行一次相同 pre-click 校验与点击；总点击数上限由 `attemptCount < 2` 的单一 guard 强制。
4. 第二次观察同样 180 秒，但绝对 7200 秒 deadline 不重置。

### 4.4 第二次窗口结束

- 取得 exact URL 或 user turn/generating：进入 `sent` 并继续观察剩余总时限。
- 仍无 URL/user turn/generating，composer 完整且 raw SHA 相等：记录 `retryOutcome=retry-not-submitted`，立即终止并允许 capacity slot 安全释放。
- composer 清空、变化或不可读：记录 `retryOutcome=recovery-required`，立即终止；capacity slot 保持隔离，等待诊断释放合同，不授权第三次发送。

## 5. RootWait、deadline 与终态

- `run-root` 在调用 adapter send 之前记录一个请求级 deadline；adapter send 消耗的 180/360 秒计入该 deadline。
- adapter 返回 waitable `sent` 时，watcher 只获得“绝对 deadline 的剩余秒数”，不得重新得到 7200 秒。
- adapter 产生 `retry-not-submitted` 或 `recovery-required` durable outcome 时，`run-root` 不启动观察 worker；它在当前 RootWait 命令内使用既有 atomic state/event helper 写一个 requires-Codex-review、no-resend 的 terminal event，并返回原 Codex task。
- 为减少状态枚举扩散，watch event 继续使用既有 terminal `stopped-unverified`，新增 `terminalOutcome=retry-not-submitted|recovery-required` 和明确 `errorCategory`；batch `allSucceeded` 仍只接受 `terminalStatus=completed`。
- capacity release proof 新增一条：只有 durable `terminalOutcome=retry-not-submitted` 且 attempt 2 composer raw hash/无 URL/无 turn/无 generating 证据完整时才安全释放。`recovery-required` 不能自动释放。

用户提示不能只显示底层 `stopped-unverified`，必须按 `terminalOutcome` 投影：

| terminalOutcome | 用户可见说明 | 建议动作 |
|---|---|---|
| `retry-not-submitted` | 两次尝试均已证明未提交，slot 已安全释放 | 仅在用户主动发起时创建新的逻辑请求和 idempotency identity |
| `recovery-required` | 提交状态无法确认，系统已禁止重发并保留 slot 隔离 | 保留页面/evidence，先诊断并按显式恢复合同处理 |

## 6. Duplicate exact-URL observation

- 发送前仍必须完整匹配 `browserId/profileId/tabId/sessionKey`，重复 tab 不放宽发送目标。
- wait/recovery 已有完整 binding 可用时优先原 binding。
- 原 binding 不存在且有 exact bound URL 时，只在同 `profileId` 的 normal tabs 中筛 exact URL；按 ordinal `(browserId, tabId, sessionKey)` 稳定排序，选择第一项做只读 snapshot。
- 选中项必须再次通过 fixed DOM probe 的 exact URL、origin、login/challenge 和 profile 校验；任一失败即停止，不遍历猜测另一个账号或 URL。
- target claim 的 conversation scope 已按 `profileId + exact URL` 派生，因此 duplicate tab 观察不改变持久 claim 身份。

## 7. 兼容、回滚与安全

- 旧 completed evidence 保持可读；缺少 attempt/deadline 字段的历史不完整 evidence 不自动获得重试资格。
- `send-uncertain`、旧 UIA evidence、跨 profile、不同 URL、login/challenge 和无法证明的 composer 状态继续 fail closed。
- 回滚只需恢复 adapter/watcher/测试/Skill/spec 同一提交；idempotency 和 target claim 文件不删除、不迁移。
- 不接受 homepage、`/share/`、截断 tabs URL 或 query 变体作为 conversation recovery key。

## 8. 关键取舍

| 主题 | 决策 | 原因 |
|---|---|---|
| 页面 prompt 格式化 | 不加入统一格式化哈希门槛 | URL 与请求进展已足够；格式化再次制造升级脆弱性 |
| 自动重发开关 | 保持 false | 一次 retry 是 adapter 内部、durable 未提交证明驱动的受限 transition，不是通用重发许可 |
| 状态 schema | 增加 attempt/deadline/proof，不做 URL 字段大迁移 | 直接满足需求，降低 importer/watch 兼容风险 |
| 终态枚举 | 复用 `stopped-unverified` + `terminalOutcome` | 避免所有 terminal consumers 扩散新 status，同时保留用户可见分类 |
| 重复 URL tab | 只放宽观察，不放宽发送 | 改善恢复体验而不破坏 exact send identity |
