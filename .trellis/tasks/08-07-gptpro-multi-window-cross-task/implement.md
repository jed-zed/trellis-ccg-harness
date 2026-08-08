# 实施计划：GPT Pro 多窗口与跨 Codex 任务隔离

> Boss 已确认每个 Codex 任务并发 `3`、每用户全局硬上限 `6`；`PLAN_REVIEW plan-v4-pre-execute` 已由 Claude Code/Opus 接受，Boss 已发起 `/ccg:execute`。M1、M2 已分别通过独立 `MILESTONE_REVIEW` 与 Boss 硬验收，当前执行 M3。

| Milestone | Title | Weight |
|---|---|---:|
| M1 | 任务身份、目标声明与 per-target mutex | 35 |
| M2 | batch RootWait 与 CCG 原子持久化 | 40 |
| M3 | 跨任务 live E2E 与交付门禁 | 25 |

## M1: 任务身份、目标声明与 per-target mutex

### 1.1 冻结合同与回归基线

- [x] 把 Boss 确认的每任务并发 `3`、全局硬上限 `6` 写入活动 tooling spec；不得在运行时静默放宽。
- [x] 冻结默认 batch timeout=`7200`、`queued-timeout`、`ConcurrencySlotRecoveryRequired`，以及只读槽位列表和唯一显式诊断释放合同。
- [x] 保留现有单窗口 V2/RootWait 测试与 live evidence 作为兼容基线。
- [x] 先增加失败用例：不同 target mutex 可并行、同 target 冲突、不完整 binding 不获得并行锁、跨 thread evidence/target 拒绝。

### 1.2 扩展 adapter 的精确身份与目标声明

**主要文件**

- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1`
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar.Tests.ps1`

**动作**

- [x] 给发送入口增加必需的 `CodexThreadId` 与可选完整 `TargetBinding`；多目标路径必须提供完整 binding。
- [x] 把 `codexThreadId` 写入 `state.json`，在 status、response、恢复和 finalize 路径逐次精确校验。
- [x] 复用 `CreateNew` 文件模式实现 target claim；同线程同 round 可恢复，不同线程在点击前失败。claim 不以 TTL 过期授权重发。
- [x] 把固定全局 UI mutex 收窄为按完整 target identity 派生的 mutex；未知或不完整目标失败关闭，不获得并行资格。
- [x] 页面不足时仅在已连接且唯一的 profile 后台新开首页标签；发送后绑定同 tab canonical URL，重启后仍只按 exact URL 恢复。

### M1 验收门

- [x] 同一 thread 的三个完整不同 binding 可独立获得 claim/mutex；相同 binding 或跨 thread claim 最多一个成功，失败发生在 composer 写入前。
- [x] 单窗口现有 exact-once、no-resend、exact URL 恢复与焦点合同全部回归通过。
- [x] 重算 task-local handoff 的三个 source SHA-256；预期任务变更更新 handoff 后复核，任何非预期漂移阻断 M1 review。

M1 工程证据见 `research/m1-verification-evidence.json`；adapter Pester
`159/159`、watcher Pester `67/67`、三 binding mutex 验收与 Harness conflicts
均通过。Grok 完成前置外部事实核验，但本地 diff 复审因其 tool-less
profile 初始化错误缺失；Antigravity 最终 M1 复审为 `no blocking findings`。

## M2: batch RootWait 与 CCG 原子持久化

- [x] M2 开始时与 Boss 约定 M3 在独立验收后使用已连接 Chrome、最多六个页面；若现场未自然出现站点限流，使用有记录的模拟 pre-send throttle 验收，禁止提高并发制造真实限流。

### 2.1 增加纯本地批次 RootWait

**主要文件**

- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1`
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-watch.Tests.ps1`
- `.agents/skills/chatgpt-pro-sidebar/SKILL.md`

**动作**

- [x] 新增 `run-batch-root -ManifestPath`，校验 manifest schema、UUID、路径包含关系、幂等键唯一性和批次大小。
- [x] 每项使用独立 evidence directory/target/watcher，并调用现有 `run-root`；父命令只用本地进程等待，不调用模型。
- [x] 同一任务最多同时运行 3 项，每用户全局最多 6 项；额外项只在本地等待槽位，batch timeout 后返回 `ConcurrencySlotTimeout`。
- [x] 以 LocalAppData `CreateNew` slot claim + 短时 capacity mutex 实现全局 6 槽位；死亡进程只有在 durable state 证明 pre-click 未发送或已经 terminal 时才释放，已发送/不确定项必须先只观察恢复，无法证明则返回 `ConcurrencySlotRecoveryRequired`，且任何回收都不授权重发。
- [x] 默认 batch timeout 为 7200 秒；从未取得槽位的项目写 `queued-timeout`、`ConcurrencySlotTimeout` 和 `submissionAcknowledged=false`，与已发送失败及 `send-uncertain` 分开。
- [x] 写原子 `batch-result.json`；部分失败保留成功证据，`send-uncertain` 永不重发。
- [x] pre-send 站点限流明确失败；post-click 或动作边界不确定保持 `send-uncertain`，不得新开标签绕过限流。
- [x] 只记录每项 slot wait 与 run duration；不实现跨任务公平调度，除非验收证据实际观察到饥饿。

### 2.2 修复 CCG bridge 并发持久化

**权威源**

- 外部个人 CCG 源 worktree 中的 `plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py`
- 对应 template 与 `gptpro-plan`、`gptpro-review`、`gptpro-exc` 合同

**Harness 快照**

- `components/ccg-workflow/plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py`
- 对应 templates、commands、tests、Skill 文档与 `harness.sources.json`

**动作**

- [x] 增加 batch manifest/session 创建与结果导入，单轮入口保持兼容。
- [x] 用原子目录创建替换 session 名称的 check-then-create。
- [x] 对 session 状态和 task-level evidence 使用锁 + 临时文件 + 原子替换；去重身份包含 task/thread/session/round。
- [x] importer 对每项继续执行 thread、target、URL、hash、watcher、terminal 与 acknowledgement 的完整校验。
- [x] 先修改权威 CCG 源，再通过既有同步流程更新 Harness 快照；禁止直接把快照当运行时。

### M2 验收门

- [x] 并发创建至少 20 个 CCG sessions 无重名；并发写入 10 个 evidence item 无丢失且 JSON 有效。
- [x] 同一 thread 三标签批次分别完成并返回独立 hash/URL/watcher/evidence；第 4 项在本地排队且无页面写入。
- [x] 两个 thread 各运行三项时总并发为 6；第 7 项等待或返回 `ConcurrencySlotTimeout`，没有 click。
- [x] 模拟 batch/owner 进程死亡：可证明 pre-click 或 terminal 的槽位安全释放；sent/send-uncertain 只观察恢复且不重发；不可证明的槽位保持隔离并返回 `ConcurrencySlotRecoveryRequired`。
- [x] 批次部分失败、重复幂等键、pre-send 限流与 `send-uncertain` no-resend 均返回可审查结果。
- [x] 只读槽位列表与唯一诊断释放入口均通过测试；不满足 pre-click 未发送/已 terminal 证明时保持 `ConcurrencySlotRecoveryRequired`，不删除 reservation/claim、不授权 click。
- [x] 重算 task-local handoff 的三个 source SHA-256；预期任务变更更新 handoff 后复核，任何非预期漂移阻断 M2 review。
- [x] Grok 本地 diff review 在既有 tool-less profile 的 `GrokBuild:search_replace`/Read 依赖下两次均不可用，完整失败证据已保留；Antigravity 已完成绑定权威 D: worktree 的本地 diff review并报告无阻断发现。

M2 工程证据见 `research/m2-verification-evidence.json`，三份 task-local source
handoff 见 `research/product-manager-m2-source-evidence.json`。Pester `231/231`、
权威 CCG 与 Harness 快照各 `600` 通过（`3` 跳过）、Harness `452` 通过
（`3` 跳过），13 份源/快照文件逐字节一致。

## M3: 跨任务 live E2E 与交付门禁

### 3.1 更新 Harness 与规格

- [x] 更新 `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md`，记录 thread/page ownership、per-target mutex、batch RootWait、`3/6` 上限和跨任务隔离。
- [x] 更新 `.harness/adapter.json`、conflict 检查与 tests，使源、快照、Skill、transport 和命令合同一致。
- [x] 不修改归档任务和历史 evidence；不引入新 transport 或 fallback。

### 3.2 自动化验证

- [x] 重跑现有 Pester、Harness、CCG 测试以及 conflicts/doctor/verify:sources 门禁。
- [x] 运行 CCG change/quality/security/module 检查；安全审查覆盖跨线程越权、重复点击、命令注入、路径逃逸、并发丢写与认证数据泄漏。
- [x] 检查完整 diff，删除不能直接对应 R1-R7/AC1-AC11 的抽象、配置、兼容层和测试。

M3 pre-live 工程证据见 `research/m3-prelive-verification-evidence.json`。自动化测试、
conflicts、质量与安全检查已完成；`doctor`/`verify:sources` 仅因固定的 CCG source
commit 尚未发布到远端而待重跑。真实 Chrome preflight 已启动本地 daemon，但扩展
尚未连接，当前停在 `AgentBrowserTargetMissing`，未打开页面、未写 composer、未点击发送。

### 3.3 真实 E2E（需 Boss 提供已连接 Chrome）

- [x] 同一 Codex 任务用三个外部 ChatGPT 页面完成三个独立长请求；等待期间不模型轮询。
- [x] 两个不同 Codex 顶层任务各使用三个页面并行完成；切换任务/应用不影响后台结果。
- [x] 触发第 4/第 7 项排队与 timeout 行为，确认未提前打开页面或点击；现场未自然出现站点限流，明确采用 M2 单测中的 pre-send challenge/throttle 与 post-click `send-uncertain` 单击/no-resend 证据，不提高并发制造真实限流。
- [x] 关闭一个已绑定标签后仅恢复其 exact URL，不触碰另一任务页面，不重复发送。
- [x] 记录发送阶段的焦点变化；观察、等待和恢复阶段不得抢焦点。
- [x] 独立核验每项 prompt/response/URL/evidence hash 与 matching acknowledgement。
- [x] 审查本次 live run 的每项 slot wait 与 run duration；只有证据实际显示跨任务饥饿时才另立公平性需求，本任务不预置公平调度。

### M3 验收门

- [x] M1/M2 证据无漂移，live `3/6`、跨任务隔离、任务切换、精确恢复与焦点验收全部完成；站点限流分支按已记录的 M2 单测证据验收，未宣称观察到 live throttle。
- [x] 重算 task-local handoff 的三个 source SHA-256；预期任务变更更新 handoff 后复核，任何非预期漂移阻断最终 review。
- [ ] 执行 Trellis Phase 3.3 spec-update 判断、Phase 3.4 工作提交和最终 finish/archive。

## 回退

- [ ] adapter/watcher 与 CCG/Harness 同步变更保持可单独回退。
- [ ] 回退不删除 target claim、幂等 reservation、canonical URL、batch result 或 evidence；任何已点击但未确认项继续 no-resend。
