# 设计：修复 PR #38 七个 GPT Pro 阻断缺陷

## 1. Boundaries

本任务只改两个权威面：

1. Harness 自有 `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1` 及其 Pester 测试/规范。
2. CCG 权威源 `G:\CodexWorktrees\gptpro-url-first-recovery-source` 的 template/plugin bridge 与共享 Vitest；Harness 中 `components/ccg-workflow` 只在源提交和授权后的 lifecycle update 中物化。

不建立新框架、不增加依赖。现有锁、atomic JSON、SHA-256、session status、watch-state/event 与校验 helper 都继续复用。

## 2. Watcher safety design

### 2.1 One retry-proof predicate

在 watcher 增加一个只读 proof predicate，语义与 adapter `Test-AgentBrowserTargetClaimTransferSafeState` 对齐，并补上现有 adapter 未验证的 attempt 序号。capacity release 和 RootWait terminal projection 都调用该 predicate，不再各自抽取“最后一次尝试”或只信顶层字段。

adapter 的既有 predicate 同步验证 attempt 序号，使三条路径对同一 fixture 得出相同结论。`recovery-required` 不借此释放 capacity；proof 不完整统一走现有隔离错误。

### 2.2 Durable terminal only

`Read-BatchRoundProcessResult` 保留 stdout 解析用于错误文字和 telemetry，但 terminal status 只由现有 durable continuation validator 接受。active round 记录 exact thread ID，validator 复核 watch-state/event 的 transport、thread、watcher、terminal/no-resend/review gate。

只有 durable terminal proof 成立才把 capacity claim 标为 terminal。release 抛错后 item status 变为 `recovery-required`；最终 success 同时检查 item status、terminal status 和 terminal outcome。

### 2.3 Admission before capacity

扩展现有 `Read-RootWaitBatchManifest`：在返回 normalized rounds 前检查 key grammar、prompt UTF-8/24000 字符和 target 字段边界。现有 timeout 上限保持 7200。所有检查发生在 `Acquire-CapacitySlot` 之前。

## 3. Bridge source design

### 3.1 Shared bounds

在 template/plugin 两份 bridge 使用相同常量：batch timeout 7200、idempotency regex 1..128、最终 composed prompt 24000 字符。`read_batch_request` 先拒绝明显非法输入；`create_session` 在写 prompt/session artifact 前验证最终 composed prompt，覆盖 routing/gate 文本造成的超限。

### 3.2 Batch intent binding

创建 batch 时生成 watcher manifest，再计算其 SHA-256。每个 mapping item 与 session `batch` status 记录：batch ID、round ID、manifest SHA、key SHA、prompt SHA、normalized initial target（可空）和 fresh policy。

import 先验证 manifest hash 与每个 session 的 batch identity，再验证：

```text
mapping intent
== manifest round
== session batch binding
== adapter state/result（适用字段）
```

任何不一致在调用 `import_sidebar_evidence` 前终止，因此不会产生 response、ack 或 canonical evidence 的部分写入。

### 3.3 V2 manual-save gate

公开 `save_response` 拒绝调用者提供 transport metadata，并在 V2 session 无 metadata 时 fail closed；只有 `import_sidebar_evidence` 完成全部校验后才调用模块内部持久化 helper 并传入已验证 metadata。这样 HTTP preview、普通 Python 直调和伪造 metadata 都无法绕过 completed import；历史 status 缺少 V2 required transport 字段时维持原兼容。

### 3.4 Follow-up transaction

follow-up 先 canonical resolve session directory，再取得现有 session lock；锁内重新 load/validate status、比较 caller binding、计算 next round、写 prompt/response 并 atomic 更新 status。使用 stdlib/context manager 覆盖完整 read-modify-write，不新增锁协议。

并发合法调用按锁串行：第二个 caller 在获得锁后重新读取 current round，因此得到下一不同 round。任何 caller binding 冲突都在创建 round directory 前失败。

## 4. Compatibility

- 新 V2 session 只能走 sidebar completed import；历史 legacy 手工 session 继续可读/保存。
- 已完成 batch 的 schema 仍为 version 1；新 binding 字段是同版本内必需的安全字段。旧的未导入 V2 batch 因缺字段 fail closed，不做猜测迁移。
- partial batch 的 completed member 导入语义保持不变，只增加来源绑定。
- 两个 Minor 不在本次修改范围。

## 5. Source synchronization

1. 在干净权威源改 template/plugin/tests，运行源 gates 并创建本地 source commit。
2. 等待用户授权推送/发布。
3. 使用 `pnpm harness:update --source-checkout <clean-source-checkout>` 物化 snapshot 与 manifest；禁止手工复制。
4. 在 Harness 集成 watcher 变更，运行 full gates，提交 PR 分支。

## 6. Rollback

- watcher 改动可按 retry predicate、durable terminal、batch admission 三组独立回滚；回滚时保留对应失败测试，防止把不安全行为误当恢复。
- bridge 改动作为一个 source commit 回滚；Harness lifecycle 可恢复到 manifest 的 `cf47e799...` tree。
- 任何 gate 失败都保持 PR Draft，不推送、不发布、不安装、不重发 GPT Pro。
