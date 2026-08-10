# 修复 PR #38 七个 GPT Pro 阻断缺陷

## Goal

关闭 PR #38 四 Provider 联合审查中由 Codex 点验确认的七个 Major，使 GPT Pro bridge、RootWait watcher 与 batch 调度在同一安全合同下 fail closed，同时保持严格 `Pro` 发送门槛、exact-once/no-resend、7200 秒总截止、每任务 3/全局 6 容量上限、跨任务隔离和后台不抢焦点行为不变。

## Confirmed Facts

- 缺陷证据绑定 PR head `1117cc26b56f93013e1bd51dd5086c30bffedc9d`；联合报告位于父任务 `research/joint-review-report.md`。
- Harness 自有 watcher/adapter 位于 `.agents/skills/chatgpt-pro-sidebar/**`；CCG bridge 的权威源是 `G:\CodexWorktrees\gptpro-url-first-recovery-source@cf47e799...`，Harness `components/ccg-workflow` 只是 manifest 锁定的快照。
- 当前 CCG 权威源工作树干净；Harness 工作树含父审查任务文档和用户未跟踪 `pnpm-lock.yaml`，后者不属于本任务且不得修改、暂存或包含进 Provider/快照输入。
- 用户授权统一修复七个 Major，也允许 worker；当前项目强制 `codex-inline`，因此产品实现和检查仍由主会话完成，不派发 implement/check worker。

## Requirements

### R1. Complete retry proof

- capacity release、RootWait terminal projection 与 adapter target-claim transfer 必须执行同一完整 proof 语义。
- `retry-not-submitted` 只接受：`phase=send-uncertain`、无 submission acknowledgement、`automaticResendAllowed=false`、合法 prompt SHA、准确的 attempt count、从 1 开始的有序 attempt 编号、准确 outcome、空 exact URL、未观察 user turn/generation、composer SHA 与 prompt SHA 相同。
- 一次 retry preparation failure 必须同时有非空 failure category/message；普通两次尝试必须完整证明第一轮 `proved-not-submitted` 和第二轮 `retry-not-submitted`。
- 任一历史尝试含 URL、user turn、generation、错误 composer hash、重排/重复 attempt 或不一致顶层状态时，RootWait 不得生成安全终态，capacity 不得释放；返回 `ConcurrencySlotRecoveryRequired` 并保持 no-resend。

### R2. Shared batch admission bounds

- bridge 与 watcher 的 batch timeout 都只接受 `30..7200` 秒，默认 `7200`。
- idempotency key 在 bridge、watcher、adapter 三层统一为 `^[A-Za-z0-9._:-]{1,128}$`，并保持唯一。
- bridge 写出的最终 composed prompt 与 watcher 读取的 prompt file 均不得超过 24000 个字符；空白或无效 UTF-8 在 session 创建和 capacity acquisition 前拒绝。
- direct watcher manifest 的 `browserId/profileId/tabId/sessionKey` 必须非空、最多 512 字符且不含 CR/LF；所有边界失败发生在创建 session、申请 capacity 或启动 child 之前。

### R3. Durable batch terminal authority

- child stdout 只作诊断，不得成为 terminal authority。
- terminal item 必须来自同一 evidence directory 的 durable watcher state/event，并验证 exact Codex thread、watcher ID、terminal status、`requiresCodexReview=true` 与 `automaticResendAllowed=false`。
- 缺失、非 terminal、`send-uncertain`、thread/watcher 不匹配或 stdout 与 durable evidence 冲突时，slot 保持隔离并返回 `ConcurrencySlotRecoveryRequired`。
- capacity release 失败后 item 必须为 `recovery-required`；`allSucceeded=true` 只允许全部 item 同时满足 `status=completed`、`terminalStatus=completed` 且无非 completed terminal outcome。

### R4. Immutable batch source binding

- batch 创建时把 manifest SHA-256、batch/round identity、idempotency key SHA-256、prompt SHA-256、原始 target binding 与 `freshConversation` 写入独立 durable mapping/session status。
- import 在任何 response、ack 或 canonical evidence 写入前，复核 mapping、manifest、session status、adapter state 与 result 的上述字段。
- 篡改 key、target、prompt、fresh policy、batch ID、round ID 或 manifest 内容必须 fail closed；partial batch 中真正 completed 的未篡改成员仍可按现有合同导入。

### R5. Completed-only V2 response persistence

- `browser_transport_required=agent-browser-cli-v2` 的 session 禁止无 transport metadata 的 `save_response` 和 `/save-response` 手工写入。
- 公开 `save_response` 不接受调用者自行构造的 transport metadata；只有 completed sidebar importer 的内部持久化路径可提交已验证 metadata。
- 只有明确历史 legacy session（没有 V2 required transport 字段）可保留现有手工保存兼容。
- 被拒绝的 V2 手工保存不得修改 response、status、ack 或 canonical evidence。

### R6. Follow-up identity and serialization

- follow-up 必须通过现有 `resolve_existing_session_dir`、`load_session` 与 `resolve_session_status_binding` 重新验证 session。
- caller 的 mode、workdir、task ID、task dir、evidence file、Codex thread 或 session path 与既有 binding 冲突时，在任何 round 文件写入前拒绝。
- 同一 session 的 current-round 读取、next-round 选择、prompt/response 创建和 status 更新必须处于同一个 session lock；并发合法 follow-up 串行得到不同 round，不得覆盖同一路径或丢失 status 字段。

### R7. Authoritative source and snapshot parity

- CCG bridge 先修改权威源的 template/plugin 两份并保持安全相关函数行为一致；先运行源仓库测试，再创建本地源提交。
- 推送/发布权威源、更新 `harness.sources.json`、运行受支持 `harness:update`、安装全局版本均是独立外部变更门槛，执行前另行取得用户授权。
- Harness snapshot 不手工修改；只通过受支持 lifecycle 从已提交权威源物化，然后运行 doctor/verify:sources/conflicts。

### R8. Preserved invariants

- 不放宽严格 `Pro` pre-send、exact URL/thread/target/hash/ack、一次安全内部 retry、caller no-resend、3/6 capacity、background/no-focus 与 completed import 合同。
- 不触碰用户 `pnpm-lock.yaml`，不改变 PR Draft 状态，不自动合并 PR，不调用外部 Provider 或真实浏览器作为本任务的单元修复步骤。

## Acceptance Criteria

- [x] AC1：统一 retry-proof 反例表在 target transfer、capacity release 与 RootWait projection 三处均 fail closed；完整一次/两次 proof 仍通过。
- [x] AC2：bridge/watcher 在占槽前统一拒绝 7201 秒、129 字符或非法 key、24001 字符 composed prompt、513 字符或含 CR/LF 的 target；合法边界值通过。
- [x] AC3：stdout=completed 但 durable state/event 缺失、非 terminal 或不匹配时不释放 slot；release failure 后 `allSucceeded=false`。
- [x] AC4：batch manifest/key/target/prompt/fresh policy/batch ID/round ID 任一篡改均在 response/ack/canonical evidence 写入前拒绝。
- [x] AC5：新 V2 session 的直接 `save_response`、伪造 metadata 与 HTTP `/save-response` 均被拒绝且文件哈希不变；显式 legacy session 兼容测试通过。
- [x] AC6：跨 task/thread/mode/workdir/evidence/session 的 follow-up 被拒绝；并发合法 follow-up 不共享 round、不覆盖 status。
- [x] AC7：权威源 template/plugin 回归与 parity 通过；获授权后 Harness snapshot/manifest 只通过 lifecycle 更新且 doctor/verify:sources/conflicts 全绿。
- [x] AC8：完整 Pester、CCG lint/typecheck/test/build、Harness test、PowerShell/Node parse、`git diff --check` 与安全检查通过，且用户 `pnpm-lock.yaml` 哈希不变。
- [ ] AC9：父联合报告更新为七个 Major 已闭合前，重新由 Codex 对最终 diff 做 file:line 复审；PR 仍保持 Draft，是否重跑 Provider/转 Ready 由后续用户决定。

## Out of Scope

- 联合报告中的两个 Minor：自动化元数据文案矛盾、batch 大小写唯一性语义。
- 新的重试策略、容量配置、Provider fallback、UI 重构、额外浏览器自动化或依赖。
- 自动发布、安装、Provider 调用、PR Ready/merge；这些需要独立授权或父任务验收。

## Open Questions

无阻断产品问题。外部发布与 Harness lifecycle 执行保留为后续授权门槛。
