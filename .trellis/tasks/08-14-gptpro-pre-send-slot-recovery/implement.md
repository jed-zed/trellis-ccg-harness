# Implementation plan

## Phase 0 — revalidate scope before start

- [x] 运行 `py -3.14 ./.trellis/scripts/get_context.py --mode phase --step 1.4`，确认用户在本规划摘要之后明确批准实施。
- [x] 运行 `node scripts/harness-adapter.mjs context` 与 `git status --short`，保护所有非本任务改动。
- [x] 读取本任务 `prd.md`、`design.md`、`implement.md` 及 `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md`。

## Phase 1 — add failing state-machine regressions

- [x] 在 `chatgpt-pro-sidebar-watch.Tests.ps1` 增加新 schema claim 创建与 `slots` 可观察字段测试。
- [x] 增加 direct `run-root` 测试：adapter 调用前观察 claim 为 `run-starting/false`，进入 `Invoke-WatchAdapterSend` 前精确转换为 `true` 且仅一次。
- [x] 增加 batch handoff 测试：parent/child 复用同一 claim，child 接受新 schema `run-starting/false`，不二次 acquire，并在共同边界转换。
- [x] 增加 crash/recovery 测试：新 schema dead `run-starting/false` 返回 `never-invoked` 并释放；adapter/browser/child 调用为 `0`。
- [x] 增加 batch parent 仍存活但已 `OwnerCompletionObserved` 的 pre-send child 退出测试，必须返回 `never-invoked`；另锁定既有 `never-launched` reason 不被新分支吞并。
- [x] 增加直接 run-root 的存活 owner 自释放 `run-starting/false` 测试；证明新分支不得额外要求 `Test-CapacityOwnerAlive=false`。
- [x] 增加反向测试：新 schema `run-starting/true`、旧 schema `run-starting/false`、错误 claim/thread/evidence 继续 `ConcurrencySlotRecoveryRequired` 并保留槽。
- [x] 增加证据优先级反向测试：schema 2 `run-starting/false` 同时出现 recovery-required、不完整 retry 或 send-uncertain durable evidence时，不得返回 `never-invoked`。
- [x] 审计现有 Pester 中所有 `run-starting/true` 夹具：真正表示 pre-send 启动的改为 schema 2 `false`，有意表示已跨提交边界的保留 `true` 并写清意图；AC6 按语义等价而非字节不变验收。
- [x] 增加断言：只升级 claim schema；`$Script:WatcherSchemaVersion` 与 batch manifest `schemaVersion` 保持 `1`。
- [x] 增加非规范 schema 变异：字符串、decimal、double、null、数组、对象均在 CAS 与释放路径 fail closed；矛盾的提交时间、watcher 或 terminal 标记不得释放。

## Phase 2 — implement the minimum claim protocol

- [x] 只在 `Acquire-CapacitySlot` 创建 schema 2 capacity claim，并保持初始 `submissionAttempted=false`；不得提升 watcher/evidence 或 batch manifest schema。
- [x] 扩展 `Get-CapacitySlots`，只读输出 schema、`submissionAttempted`、`submissionAttemptedAtUtc`。
- [x] 扩展 `Get-CapacityReleaseProof`，只对新 schema 的 `run-starting/false` 返回 `never-invoked`；不改变旧 schema 与 `true` 分支。
- [x] 调整 `Get-ValidatedCapacityHandoff`，要求新 schema、`run-starting/false` 及原有 claim/thread/evidence 精确绑定。
- [x] 调整 direct 与 batch parent，使非发送启动阶段写 `run-starting/false`。
- [x] 为 `Invoke-RootWaitRound` 传入内部 `CapacitySlotId/CapacityClaimId`，增加 mutex-held compare-and-swap helper，精确校验 claimId、schema 2、`run-starting/false` 后写入 `true` 与时间戳；紧邻并先于唯一 `Invoke-WatchAdapterSend`，缺少身份或转换失败时不得调用 adapter。
- [x] 把 `never-invoked` 释放分支放在现有 durable retry/pre-click/adapter/watcher 证明之后；只复用现有 owner-alive/`OwnerCompletionObserved` 前置门，不额外要求 owner 已死亡；冲突 durable 证据继续 fail closed。
- [x] 保持 parent-only batch release、现有 retry-not-submitted/terminal/recovery-required 逻辑及 3/6 限制不变。
- [x] 对原子 JSON 替换的瞬时共享冲突增加 5 次、25ms 的本地有界重读；持续 malformed 继续 fail closed。

## Phase 3 — contract and focused validation

- [x] 更新 `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md` 的 concurrency、atomic RootWait、batch recovery 与 Required checks。
- [x] PowerShell parser 对 watcher 脚本和测试返回零错误。
- [x] 运行聚焦 Pester：`Invoke-Pester .agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-watch.Tests.ps1`（最终 134/134）。
- [x] 运行完整 sidebar Pester：watcher 与 adapter 两个测试文件同次运行并全部通过。
- [x] 检查所有恢复测试使用 `$Script:CapacityRootOverride`，未读取或修改真实全局 slot。

最终完整 sidebar 结果：322/322；其中 watcher 134/134、adapter 188/188。
严格 schema 谓词同时接受 PowerShell JSON 解析产生的规范 `Int32`/`Int64` 整数 2，
并继续拒绝字符串、decimal、double、null、数组和对象。

## Phase 4 — repository gates and review

- [x] 运行 `git diff --check` 并确认 diff 仅含任务权威文件与任务文档。
- [x] 运行 `pnpm harness:test`、`pnpm doctor`、`pnpm harness:conflicts`、`pnpm verify:sources`。
- [x] 按 `.trellis/spec/tooling/index.md` 运行 `pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build`。
- [x] 运行 CCG 变更影响、质量与安全门禁；Critical/High 必须先关闭。
- [x] 独立复核 exact-once：没有基于缺文件/空页面的释放，没有自动重发，没有删除 idempotency/target claim。
- [x] 用户已授权真实 GPT Pro canary/review；同一会话按 durable pre-invoke/no-resend 规则执行并记录所有轮次。

CCG lint/typecheck/build 已通过；`ccg:test` 为 629 通过、3 跳过、1 个未改动用例的
20 秒超时。该用例独立单 worker 复验 3/3 通过；完整单 worker 再跑仍只复现同一超时。

## Phase 5 — finish

- [x] 执行 Trellis Phase 3.3 spec-update judgment：规格补充 PowerShell JSON 规范整数的 `Int32`/`Int64` 宿主表示与禁止强制转换约束。
- [ ] 按 Phase 3.4 提交本任务改动；不推送、不发布、不安装，除非另有授权。
- [ ] 只有全部验收与用户最终确认后才运行 `trellis-finish-work`/archive。
- [ ] 部署或回滚前确认没有 in-flight batch，避免新旧 parent/child handoff 版本交错。

## Rollback points

- 回滚点 A：测试提交（仅回归，无产品语义）。
- 回滚点 B：watcher 状态机提交（恢复旧脚本即可；无全局 claim 迁移）。
- 回滚点 C：spec/任务文档提交。

## Execution status

- 当前 Trellis 状态：`in_progress`。
- 已获用户明确实施及 Grok、Antigravity、Claude、GPT Pro 调用授权。
- GPT Pro round 1 已规范导入但因缺少实现正文无法验证；round 2 的页面回答发现 coercive schema blocker，适配器成功提取但旧 RootWait worker-crashed 事件使其不能规范导入；round 3/4 均有 durable `pre-invoke-failed`、零 click/零 attempt 证明；清空残留 composer 后，压缩提示的 round 5 在同一会话单次发送、由 RootWait 完成并规范导入。最终结论为 Critical/Major 均为 0、建议 `ACCEPT`。首次 FINAL_REVIEW 的用户验收因 AC8 记录过时和 handoff 强制转换而拒绝；两项现已修复，最终完整 sidebar 为 322/322。当前进入 Phase 3.3/3.4，之后需刷新 FINAL_REVIEW 再请求最终验收。
