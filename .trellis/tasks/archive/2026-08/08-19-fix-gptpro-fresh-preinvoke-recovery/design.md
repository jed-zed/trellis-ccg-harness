# 设计：GPT Pro fresh 调用与 pre-invoke 槽位恢复

## 根因

失败的 PR #46 审查在 ChatGPT 根首页调用 `run-root`，但命令没有传
`-FreshConversation`。adapter 因 `ExistingConversationUnproved` 在全局幂等
reservation 和 click 之前退出；watcher 已在调用 adapter 前把槽位标成
`submissionAttempted=true`，而 adapter 尚未写 `state.json`，所以释放逻辑无法证明
未发送并保守地留下隔离槽位。

## 最小方案

1. 保持 fresh/已有会话两种模式显式分离，只修正权威“新独立任务”入口示例。
2. 在现有 `Invoke-AgentBrowserSend` 的单一 pre-click 边界捕获异常；如果尚未尝试
   click，则复用现有原子 evidence 写入，落盘 `pre-invoke-failed`。不在各调用方分别
   打补丁。
3. 复用现有 watcher 的 `pre-invoke-failed` 释放证明，只补足状态字段校验和组合测试；
   post-click/不确定路径保持 `send-uncertain`。

不新增恢复服务、数据库、重试或首页自动推断。

## 状态合同

`pre-invoke-failed` 至少绑定：

- `schemaVersion`、`tool`、`transport`；
- `codexThreadId`、`idempotencyKeySha256`、`promptSha256`；
- 完整 target binding（如在失败点已经解析）及 evidence directory；
- `invokeAttempted=false`、`submissionAcknowledged=false`、失败类别和时间；
- `automaticResendAllowed=false`。

只有 adapter 内部仍能证明 click 未尝试、且 request identity 已完成校验时才允许写该
状态。状态写入本身失败时，暴露写入失败并让槽位继续隔离，不能用不完整记录换取释放。

## 安全边界

- 威胁：点击结果不确定时误判未发送会触发重复提交；伪造或残缺的释放证明会错误释放
  隔离槽位。
- 决策：在调用 click 前立即跨越不可逆边界；边界后的所有异常继续走 no-resend。
  watcher 对 thread、幂等键、prompt 文件/hash、evidence directory、时间、目标绑定和
  严格布尔字段逐项失败关闭。
- 信任边界：adapter 是“是否尝试 click”的唯一事实来源；watcher 只验证落盘证据，
  不从错误文本或页面外观推断未发送。
- 已知风险：本地同权限进程仍可篡改 runtime evidence；既有 slot 1/2 没有本任务所需
  证明，因此继续隔离且不在本任务中处理。

## 旧轮次恢复

旧失败发生在修复前，无法凭空生成状态。Codex 用保留的 FastCtx job 命令、当前
target/status、空 evidence 目录和缺失全局幂等 reservation 交叉核验后，以修复后的
adapter 原样重放旧命令；它在同一确定性 `ExistingConversationUnproved` 点击前边界失败，
并由 adapter 写出同合同记录。随后调用现有 `release-slot`，只释放 slot 3。这是一轮有界
审计恢复，不改变普通运行时的自动释放规则，也不处理 slot 1/2。

## 验证

- adapter Pester：根首页 fresh 成功进入发送准备；已有会话模式仍拒绝首页；早期失败
  写出完整 `pre-invoke-failed`，且 click mock 为零。
- watcher Pester：direct 和 batch 对该状态释放槽位；损坏状态和 post-click 状态不释放。
- 文档/Skill 合同测试：新独立 `run-root` 示例包含 `-FreshConversation`。
- Harness conflicts；必要时运行相关 source/doctor 检查。

## 回退

代码和文档可按本任务 diff 回退；运行 evidence、reservation、target claim 和 GPT Pro
审查结果不删除。回退绝不能把已点击或不确定轮次改判为可重发。
