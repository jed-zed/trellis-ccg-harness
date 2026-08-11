# 实施计划：GPT Pro URL-first 与一次安全重试

> 本任务已迁移到目标实现工作树；这里的检查和后续执行均以当前工作树为唯一任务权威。

| Milestone | Title | Weight |
|---|---|---:|
| M1 | URL-first 与 attempt 状态机 | 45 |
| M2 | RootWait、capacity、文档与完整验证 | 55 |

## AC × Milestone 覆盖矩阵

| AC | M1 工程证据 | M2 / 最终证据 |
|---|---|---|
| AC1 | URL-first 单测与 adapter 状态 | RootWait 完成、import 与 live E2E |
| AC2 | 已有 URL 的延迟/格式变化单测 | 完整回归与 live E2E |
| AC3 | durable retry gate 单测 | watcher 终态与 live E2E |
| AC4 | max-two guard 与 click 计数单测 | live E2E 第三 click 为 0 |
| AC5 | 同 request/idempotency attempt 状态 | 同 capacity slot 与 3/6 回归 |
| AC6 | 两种 attempt outcome 与提示 payload | RootWait 原任务通知、释放/隔离证明 |
| AC7 | duplicate exact-URL resolver 单测 | 只读恢复 live E2E |
| AC8 | 请求级绝对 deadline 状态 | RootWait 剩余时限回归 |
| AC9 | background-only 参数与 focus 断言 | Boss 确认焦点未被打断 |
| AC10 | 保留 adapter 身份/幂等不变量 | Harness/CCG/import/3-6 全套回归 |
| AC11 | 无 | 三条 live E2E 路径与用户验收 |

M1 里程碑只按“M1 工程证据”列验收；M2 完成时必须补齐右列并覆盖 AC1-AC11，不能把 M1 的局部通过当成最终验收。

## 执行前门槛

- [x] 用户审阅并明确批准本次最新规划摘要；规划批准不等于此前 review/PR 批准。
- [x] 若启用 CCG product-manager，完成本次 Claude 显式授权、只读计划复审和建议呈现；未授权时记录 `declined`，不得伪造证据。
- [x] 在 `G:/CodexWorktrees/gptpro-url-first-recovery-harness` 确认分支为 `codex/gptpro-url-first-recovery-migrated`、基线包含 `80ed5d2`、worktree clean。
- [x] 运行 `node scripts/harness-adapter.mjs context` 并重新读取本任务 PRD/design/implement 与目标分支最新 `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md`。

## M1：URL-first 与 attempt 状态机

- [x] 在 `chatgpt-pro-sidebar.Tests.ps1` 先添加失败回归：exact URL 早于 user turn、已有 URL 的 user turn 延迟/格式变化、fresh homepage durable retry gate、最多两次点击、同 idempotency/request identity、7200 秒不重置。
- [x] 在 `chatgpt-pro-sidebar.ps1` 把 exact URL capture/persist 提前到 rendered user-turn 检查之前；保留 baseline 后只允许一个新 user turn 的结构校验，移除新增 turn 与原始 prompt SHA 的相等门槛。
- [x] 复用 `New-SendIntentState` 与 atomic state writer，增加 `requestStartedAtUtc`、`firstClickAtUtc`、`responseDeadlineAtUtc`、最多两项 attempts 和 `retryOutcome`。
- [x] 将一次安全 retry 封装在同一个 `Invoke-AgentBrowserSend` 逻辑请求中：同 profile background tab、同 evidence/idempotency、旧 tab 不再操作、单一 `attemptCount < 2` guard。
- [x] 更新 exact-URL observation resolver：完整原 binding 优先；否则只在同 profile 同 exact URL 候选中稳定排序选择，发送目标匹配仍保持严格。
- [x] 与 adapter 行为同批更新 active V2 spec 的三处旧合同：Exact-once send（现第 51-54 行）、Wait and continuation（现第 128-129 行）和 Required checks（现第 157-159 行）；移除“渲染 user turn SHA 必须等于原 prompt SHA”的硬门槛，并明确一次 retry 只能由 durable proved-not-submitted 状态机授权，`automaticResendAllowed` 仍为 false。
- [x] 聚焦运行 adapter PowerShell parse 与 `chatgpt-pro-sidebar.Tests.ps1`。
- [x] 在 M1 复审前生成 task-local `research/product-manager-m1-source-evidence.json`，记录 adapter、adapter Pester 与 V2 spec 的路径、SHA-256 和目标提交，供只读快照核对。
- [x] 按第一次 M1 用户验收意见补齐关键 Pester 用例名、AC 映射、157/7 红灯到 164/0 绿灯记录，并把合成 V2 importer 回归及安装版 `3.4.6+codex.3` 结果写入同一交接件。
- [x] 将 importer 从“无需修改”的既定结论改为 M2 首要待证问题；M1 不单独发布，与 M2 同一交付批次同步运行时和文档。
- [x] 重新触发独立 product-manager `MILESTONE_REVIEW`；修订建议已呈现，用户已 fresh 验收通过，M1 台账标记完成。

## M2：RootWait、capacity、文档与完整验证

- [x] 首先验证 importer：同一份合成 V2 completed evidence bundle（SHA-256 `50774df683308925907d4c71ae40dcd8379b12fe34a881ccc78d4ccebf5ae177`）对 Harness 快照和已安装 `3.4.8+codex.1` importer 均 `importExitCode=0`，response SHA 与稳定 ack 字段一致；历史安装版 `3.4.6+codex.3` 漂移已由受支持安装闭合。
- [x] 在真实 Chrome E2E 前重建并重装 CCG bridge，再以同一份合成 V2 completed evidence 复验：安装插件、Harness 快照及权威 Git 内容的规范化 bridge SHA-256 均为 `55ad9841c9068ab602f67c24f881cb1ccfa1f882f0680366acd9ce6a5d1c962c`，两侧 `importExitCode=0`。此前 `4bf23deb…` 是权威源 G 盘 CRLF 工作树的原始字节哈希，规范化为 LF 后即为 `55ad9841…`；`9db48cc…` 则是 3.4.6 的历史 template 文件哈希，两者都不是当前安装 plugin 的准入身份。
- [x] 在 CCG importer 回归中增加未知或非 `completed` 的 `terminalOutcome` 负向用例；只有 completed import/hash/ack 合同与该负向用例都成立时，才判定权威 importer 源码无需额外修改。
- [x] 在 `chatgpt-pro-sidebar-watch.Tests.ps1` 先添加失败回归：adapter send 时间计入绝对 deadline、终态立即回原 thread、`retry-not-submitted` 安全释放、`recovery-required` 保持隔离、batch 不把两者算成功。
- [x] 从 M2 起把新增失败回归的原始红灯输出持久化到 task-local evidence，至少包含失败用例名与断言摘要；不得再只记录汇总数字。
- [x] 在 `chatgpt-pro-sidebar-watch.ps1` 让 `run-root` 从第一次点击共享绝对 7200 秒截止；只把剩余秒数交给 worker。
- [x] 用既有 atomic event helper 为 adapter 终止结果写 `stopped-unverified + terminalOutcome`；保持 `requiresCodexReview=true`、`automaticResendAllowed=false`、exact CodexThreadId/watcher identity。
- [x] 扩展 capacity release proof，仅接受 durable `retry-not-submitted` 完整证明；`recovery-required` 返回 `ConcurrencySlotRecoveryRequired` 且不释放。
- [x] 更新 `SKILL.md` 与 V2 spec 的 watcher/UX 部分：180 秒、7200 秒、duplicate observation、两种 `terminalOutcome` 的不同用户提示、原 task 通知及 no-focus 合同；M1 已更新的 acknowledgement 条款不得回退。
- [x] 真实页面暴露“极高被误认作 Pro”后，增加发送前严格模式门槛：固定 DOM 只接受唯一的 composer-adjacent 模式控件；非 `Pro` 时只操作唯一思考强度子菜单与唯一 `Pro` 单选项并复验。后续 live PR review 又证明 ChatGPT 会在 fill 后隐藏已验证控件，因此同一 target mutex 内允许沿用 pre-fill `Pro` 证明，同时继续复验 URL/composer/send；若控件仍可见则歧义或漂移仍在 Send click 前失败，wait 不再重选或重查模型。覆盖用例为 `switches one unique thinking-mode control to Pro and verifies it before send preparation`、`fails before the send click when the selected mode drifts away from Pro after fill`、`adopts the same tab URL when the model control hides after exact Pro preflight`、`waits through generation without re-requiring the hidden model control`。
- [x] 运行完整离线门槛（受支持 Harness 生命周期全绿；当前主工作树的额外复跑主机超时单独保留，未冒充第二次全绿）：
  - [x] PowerShell adapter/watcher parse；固定 JS parse。
  - [x] 两个 Pester suite：adapter 现为 `168/168`（严格 Pro 门槛与 fill 后控件隐藏修复后复跑），watcher `83/83`。
  - [x] `pnpm harness:test`：受支持的 3.4.8 更新事务为 `452 passed / 0 failed / 3 skipped`；当前主工作树复跑因本机 PowerShell 进程启动和 hard-kill 标记等待超时未形成第二份全绿终态，完整区分见 `.ccg-evidence/m2/pre-live-offline-gates.log`，不得伪称当前复跑通过。
  - [x] `pnpm doctor`
  - [x] `pnpm harness:conflicts`
  - [x] `pnpm verify:sources`
  - [x] `pnpm ccg:lint`
  - [x] `pnpm ccg:typecheck`
  - [x] `pnpm ccg:test`：`609 passed / 3 skipped`。
  - [x] `pnpm ccg:build`
  - [x] `/ccg:verify-change`、`/ccg:verify-quality`、`/ccg:verify-security`、`/ccg:verify-module`：外部路由均 local-only skip；变更与安全通过。通用 quality scanner 不识别 PowerShell，module scanner 也不识别本项目 `SKILL.md + scripts + tests + Trellis spec` 布局，因此以 parse、Pester、Skill、active V2 spec 与 conflicts 的项目合同证据补足，不新增平行 README/DESIGN。
- [ ] 真实 Chrome E2E：
  - exact URL 先出现、渲染 turn 后出现仍完成并可 import；
  - 证明未提交后只进行一次后台 retry；
  - 第二次 180 秒 intact-composer 与 recovery-required 两分支均回原 Codex task；
  - 两次尝试共享 slot/idempotency，第三 click 为 0；
  - 同 profile duplicate URL 的只读恢复；
  - 记录用户输入焦点未被打断；
  - 对 `responseQuality=incomplete` 显式取证：同时记录页面可见完整 assistant 文本及其 SHA-256、抽取 `response.md` 及其 SHA-256；若文本或哈希不一致，先修复稳定性判定，不得宣告 E2E 完成；
  - 记录每次 click 到首次 exact `/c/<id>` 出现的耗时；本任务不据此擅自调整 180 秒常数。
- [x] pre-live 工程证据检查点：parse/Pester/Harness/CCG/conflicts/doctor/verify:sources 已固化；安装版 bridge 规范化 SHA 对齐，同一份合成 V2 evidence 对快照与安装版均 import exit 0。真实 Chrome 前置准入已满足。
- [ ] 在 M2 复审前生成 task-local `research/product-manager-m2-source-evidence.json`，记录 adapter、watcher、两个 Pester、Skill、V2 spec 与必要 importer 回归文件的路径、SHA-256 和目标提交。
- [ ] 触发 M2 product-manager review 候选；若授权调用，呈现建议并取得 fresh 用户验收。

## 完成与交付

- [ ] Trellis Phase 3.3：明确判断并更新 active V2 tooling spec；不创建平行规范。
- [ ] Trellis Phase 3.4：审阅 diff，确认未触碰 Stop Hook、UIA、登录、其它任务或旧脏改动；提交任务代码与规划工件。
- [ ] 当前 PR 必须包含本次严格 `Pro` 发送前检查/切换代码，以及对应的提示词、Skill、规范和回归测试改动；不得在提交 PR 时遗漏这些文件。
- [ ] 复审 CCG backend/search evidence 与最终 diff；任何 required Provider 两次失败则如实停止。
- [ ] 在所有 gate、live E2E 和用户验收完成后执行 Trellis finish/archive，记录 commit/PR。

## 风险文件与回退点

| 文件 | 风险 | 回退 |
|---|---|---|
| `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1` | click/identity/attempt 状态错误可能重复提交 | 保持单一 max-two guard；失败即恢复该文件及匹配测试 |
| `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1` | deadline、终态或 slot proof 错误会卡任务或提前释放 | terminal/batch/capacity 回归先行；不得手工删除 claim |
| 两个 Pester 文件 | mock 可能掩盖真实焦点/页面行为 | 单测之外必须做 live Chrome E2E |
| `SKILL.md` / V2 spec | 文档与运行时漂移 | 同一提交更新并跑 conflicts/verify:sources |
