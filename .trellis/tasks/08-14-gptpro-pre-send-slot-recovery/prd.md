# Recover GPT Pro pre-send run-starting capacity slots

## Goal

让 `run-root` 或批量子进程在真正进入 GPT Pro adapter send 之前退出时，其容量槽能够依据版本化、持久化的“尚未尝试提交”证明安全回收，避免空证据槽永久占用容量；同时完整保留 exact-once、禁止自动重发和 `ConcurrencySlotRecoveryRequired` 的保守隔离边界。

## Background and confirmed facts

- 当前新 claim 以 `phase=slot-acquired-pre-send`、`submissionAttempted=false` 创建，见 `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1:2161`。
- 批处理父进程在 `Start-BatchRoundProcess` 之前就写入 `phase=run-starting`、`submissionAttempted=true`，见同文件 `:2622` 与 `:2627`。
- 直接 `run-root` 同样在调用 `Invoke-RootWaitRound` 之前写入上述状态，见同文件 `:3027` 与 `:3031`。
- 实际 adapter 调用直到 `Invoke-RootWaitRound` 内的 `Invoke-WatchAdapterSend` 才发生，见同文件 `:2761`。
- 对于 owner 已死亡、claim 为 `run-starting/true` 且没有 adapter/watcher 持久证据的槽，`Get-CapacityReleaseProof` 只能返回 `terminal-state-not-proven`，`Release-CapacitySlot` 必须返回 `ConcurrencySlotRecoveryRequired` 并保留 claim，见同文件 `:2004` 与 `:2090`。
- 已报告的真实故障符合上述窗口：页面仍为空白新会话、没有生成、证据目录没有 `state.json`、`watch-state.json`、`watch-event.json`、`evidence.json` 或响应，但 claim 已被过早标成 `run-starting/true`。

## Requirements

### R1 — versioned submission boundary

- 新容量 claim 必须仅在 capacity claim 记录自身使用新的 claim schema/protocol 版本，明确区分“进程/交接已开始”和“adapter send 已进入”；watcher/evidence 的 `$Script:WatcherSchemaVersion` 与 batch manifest schema 保持 `1`。
- `submissionAttempted` 只能在共同的 `Invoke-RootWaitRound` adapter 调用边界、紧邻 `Invoke-WatchAdapterSend` 之前由 `false` 原子变为 `true`，并记录 `submissionAttemptedAtUtc`。
- 进程创建、参数验证、batch handoff 验证等不涉及 adapter/browser 的工作不得把 `submissionAttempted` 提前标为 `true`。

### R2 — direct and batch use one transition

- 直接 `run-root` 获取一个 claim 后，以 `run-starting/submissionAttempted=false` 进入 `Invoke-RootWaitRound`，由后者执行唯一的提交边界转换。
- 批处理父进程仍只获取一个 claim；启动 child 前将其置为 `run-starting/false`，child 必须校验 schema、claim/thread/evidence 绑定和 `submissionAttempted=false`，随后复用同一 claim。
- child 不得再次获取容量；父进程继续负责 batch claim 的最终释放。
- 如果 claim 在 child 转换前被安全回收，child 的转换必须因 claim 缺失或身份变化而在 adapter 调用前失败。

### R3 — bounded safe recovery

- 对新 schema，owner 已死亡或调用方已明确观察到 owner 完成时，`run-starting/submissionAttempted=false` 是可审计的 `never-invoked` 证明，可安全释放。
- `run-starting/submissionAttempted=true`、旧 schema 的含糊 `run-starting` claim，以及任何身份/版本不匹配都继续返回 `ConcurrencySlotRecoveryRequired`。
- 缺少证据文件、页面为空或没有生成不能单独成为释放证明。
- 恢复路径不得调用 adapter、发现/打开浏览器、写 composer、点击 Send、删除 idempotency/target claim，或授权重发。

### R4 — compatibility and observability

- 现有 schema 的 `slot-acquired-pre-send`、`pre-click-unsent`、durable retry-not-submitted 和 terminal 证明保持兼容。
- `slots` 只读诊断必须显示 claim schema/protocol 版本、`submissionAttempted` 和时间字段，便于审计新旧 claim。
- 每任务 `3`、本机用户全局 `6`、批次 `7200` 秒默认值及现有 target/thread/idempotency 绑定不得改变。

## Acceptance Criteria

- [x] AC1：新 claim 以新 schema 创建；直接与 batch 在 adapter 调用前均保持 `run-starting/submissionAttempted=false`；watcher/evidence 与 batch manifest schema 仍为 `1`。
- [x] AC2：直接 `run-root` 和 batch child 都只在共同的 `Invoke-RootWaitRound -> Invoke-WatchAdapterSend` 边界原子写入 `submissionAttempted=true` 与时间戳，且每个逻辑 round 只转换一次、只拥有一个 claim。
- [x] AC3：模拟 owner 在上述转换前死亡且证据目录为空时，`release-slot` 返回成功的 `never-invoked` 证明，容量恢复；测试同时证明 adapter/browser/child 启动次数为 `0`。
- [x] AC4：模拟 owner 在转换后死亡但没有 terminal/pre-click 证据时，仍返回 `ConcurrencySlotRecoveryRequired`、槽保留且不得重发。
- [x] AC5：batch handoff 对新 schema 的 `run-starting/false` 成功，对旧 schema、`true`、错误 claim/thread/evidence 绑定均在 adapter 调用前拒绝。
- [x] AC6：历史安全释放证明、3/6 容量限制、queued-timeout、retry-not-submitted、recovery-required 和 terminal 释放回归保持通过。
- [x] AC7：`.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md` 同步新 claim 状态机、兼容边界和 Required checks。
- [x] AC8：PowerShell 解析、聚焦 Pester、完整 sidebar Pester、Harness conflicts/doctor/verify 与相关离线门禁全部通过；diff 不含无关改动。

## Out of scope

- 自动释放当前或历史的旧 schema `run-starting/true` 模糊 claim。
- 根据空白页面、缺文件、人工观察或 ChatGPT 页面文本推断“未发送”。
- 修改 idempotency、target claim、发送重试、两小时总等待、3 分钟页面观察、3/6 容量或 RootWait 唤醒语义。
- 在规划阶段清理全局 slot、操控浏览器、发送 GPT Pro 请求、发布、安装或推送。
