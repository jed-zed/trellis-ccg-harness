# Design: versioned pre-send capacity handoff

## Problem statement

当前 `submissionAttempted=true` 同时表示“准备启动 round”和“可能已进入 adapter send”。该字段在真正 adapter 调用之前写入，导致控制进程若在两者之间退出，exact-once 恢复逻辑无法区分“从未调用”与“可能已调用”。修复必须改正状态语义，而不是放宽对缺文件或空页面的判断。

## Architecture boundary

只修改以下三处项目权威文件：

1. `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1`
2. `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-watch.Tests.ps1`
3. `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md`

不修改 adapter 的点击/no-resend 状态机，不修改 CCG snapshot，不触碰全局 `%LOCALAPPDATA%/ChatGptProSidebar/concurrency-v1` 数据。

## Claim protocol

新增 capacity claim 自身的 schema/protocol 版本，避免把新语义反向套用到旧 claim。只把 `Acquire-CapacitySlot` 写入的 claim `schemaVersion` 从 `1` 升为 `2`（或使用独立 claim schema 常量）；不得修改 `$Script:WatcherSchemaVersion`，也不得修改仍被硬校验为 `1` 的 batch manifest schema。读取方继续接受旧 claim，但只有新 claim 可使用 `run-starting/false` 证明。

| phase | submissionAttempted | 含义 | owner 死亡后的释放 |
|---|---:|---|---|
| `slot-acquired-pre-send` | `false` | 已占槽，尚未启动 round | 现有 `never-launched`，安全 |
| `run-starting` | `false` | 进程/child handoff 已开始，但尚未进入 adapter send | 仅新 schema 可作为 `never-invoked` 安全释放 |
| `run-starting` | `true` | 已跨过 adapter send 调用边界，发送结果可能不确定 | 必须依赖 durable pre-click/terminal 证明；否则隔离 |
| `pre-click-unsent` | `false` | 已持久证明点击前失败 | 安全 |
| `terminal` | 任意 | 已持久终态 | 现有规则安全 |

`submissionAttempted=true` 转换同时写 `submissionAttemptedAtUtc`。该时间是审计字段，不单独构成释放证明。

## Direct round flow

1. `Invoke-CapacityBoundRootWaitRound` 完成所有 admission 校验。
2. `Acquire-CapacitySlot` 创建新 schema claim。
3. wrapper 将 claim 置为 `run-starting/false`，把 `SlotId/ClaimId` 传入 `Invoke-RootWaitRound`。
4. wrapper 把 `CapacitySlotId/CapacityClaimId` 传入 `Invoke-RootWaitRound`；后者在 `Invoke-WatchAdapterSend` 前调用 mutex-held compare-and-swap helper，要求 claimId、schema 2、`run-starting` 与精确 `submissionAttempted=false` 全部匹配，再原子写 `submissionAttempted=true` 与时间戳。
5. 只有第 4 步成功后才允许调用 adapter。
6. 终态、pre-click、retry-not-submitted 与 recovery-required 仍使用现有释放规则。

## Batch flow

1. parent 获取唯一 claim，启动 child 前写 `run-starting/false`。
2. child 以 `SlotId/ClaimId` 验证新 schema、thread、evidence directory、phase 和 `submissionAttempted=false`，不二次占槽。
3. child 进入相同 `Invoke-RootWaitRound` 边界，并原子完成 `false -> true`。
4. 如果 parent 在 child 转换前死亡，其他 acquire/release 可回收 `run-starting/false`；如果 parent 仍活但已观察 child 完成，则沿用 `OwnerCompletionObserved` 证明。child 随后的原子转换因 claim 不存在而失败，adapter 不会被调用。
5. 如果 child 已转换为 `true`，parent 死亡后继续遵守现有模糊状态隔离。

## Release proof

`Get-CapacityReleaseProof` 仅新增一个窄分支，而且必须排在现有 durable retry、pre-click、adapter completed 与 watcher terminal 证明之后：

- claim 为新 schema；
- phase 精确为 `run-starting`；
- `submissionAttempted` 精确为 `false`；
- schema 必须是 JSON 解析后的规范整数，不接受字符串、decimal、数组、对象或其他可强制转换表示；
- 不得存在 `submissionAttemptedAtUtc`、`watcherId` 或 `terminalStatus` 等与“从未进入提交边界”矛盾的 claim 标记；
- owner 已死亡，或 batch parent 使用现有 `OwnerCompletionObserved` 明确观察到 child 完成；
- claim identity 已由 `Release-CapacitySlot` 校验。

满足时返回 `never-invoked`。该分支复用 `Get-CapacityReleaseProof` 开头现有的 owner-alive/`OwnerCompletionObserved` 前置门，不得再叠加 `Test-CapacityOwnerAlive`；因此直接 run-root 的存活 owner 自释放和 batch parent 已观察 child 完成都可成立。如果存在 `recovery-required`、不完整 retry、`send-uncertain` 或其他与 `false` 冲突的 durable 证据，先按现有规则隔离，不得落入 `never-invoked`。不读取页面，不把 `state.json` 缺失当证明，不兼容性猜测旧 claim。

## Failure semantics

- claim 转换失败：在 adapter 前以 `ConcurrencySlotRecoveryRequired` 或 ownership-changed 失败，无发送。
- adapter 调用前的常规失败：写现有 `pre-click-unsent`/durable pre-invoke proof 后释放。
- 转换后进程异常且无 durable proof：保留槽并返回 `ConcurrencySlotRecoveryRequired`。
- recovery-required 不会删除 idempotency/target claim，也不会自动建立新 evidence directory。

## Compatibility

- schema 1 claim 继续按旧规则读取和释放；缺失 `schemaVersion` 或缺失 `submissionAttempted` 也不得被解释为 schema 2 的安全 `false`。
- 命令行签名不新增用户参数；`SlotId/CapacityClaimId` 仍是内部 batch handoff。
- `slots` 输出增加字段，不删除现有字段。

## Risks and rollback

- 风险：转换被放得太晚会使 adapter 在 claim 仍为 `false` 时开始。防护：把转换代码放在 `Invoke-RootWaitRound` 内、紧邻且先于唯一 `Invoke-WatchAdapterSend` 调用，并用 Pester 观察调用顺序。
- 风险：batch parent 与 child 竞态。防护：所有 claim 读取/转换继续使用 capacity mutex 与 claimId compare-and-swap；claim 被回收后 child 必须在 adapter 前失败。部署或回滚前等待 in-flight batch 静默结束，避免 parent/child 版本 skew。
- 风险：测试 mock 掉 `Invoke-RootWaitRound` 后未模拟提交边界，可能让错误结果经 `never-invoked` 假通过。防护：边界测试改为 mock `Invoke-WatchAdapterSend`，或由 mock 显式调用同一 compare-and-swap helper。
- 风险：读取原子替换中的 JSON 时命中瞬时共享冲突会误报 malformed。防护：同一路径最多本地重读 5 次、每次 25ms；持续 malformed 仍 fail closed，不触发浏览器或 Provider。
- 回滚：恢复三个文件的任务提交即可；不迁移或改写已有全局 claim，因此没有数据回滚步骤。

## Deferred live validation

本任务可用隔离的 `$Script:CapacityRootOverride` 完整证明故障窗口。真实 Chrome/GPT Pro canary 会产生外部发送，只有在实现阶段得到单独授权后才执行；缺少 canary 不得被表述为已完成 live E2E。
