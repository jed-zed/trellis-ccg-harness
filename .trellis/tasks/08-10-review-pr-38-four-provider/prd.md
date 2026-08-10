# PR #38 四 Provider 联合审查

## Goal

对 PR #38 当前固定版本进行 Antigravity、Grok、Claude 产品经理与 GPT Pro 四路独立审查，由 Codex 核验每项发现；对本轮已确认且获用户授权的阻断根因做最小修复和回归，再继续 MCP1、Claude、AC11 与 M2 复审。PR 在全部门槛闭合前保持 Draft，联合报告保持 `incomplete`。

## Confirmed Facts

- 审查仓库为 `jed-zed/trellis-ccg-harness`，PR 为 `#38`。
- 审查基线固定为 `origin/main@66da1493327b4905c4c2180f7056d8f30e8796b8`；稳定化前的重绑 head 为 `34de65d8fe10499f431a04a6f13b0a8cb0bcdf1a`。
- 稳定化前 diff 包含 151 个文件、14929 行新增、2203 行删除，SHA-256 为 `de04a736647e7cc1266d7b27f70495ecc962f4074c08398c5d3fbbcf82cc7477`；该 identity 仅保留为历史台账。最终稳定 head 由包含本任务修订的提交建立，并在提交后重建 ignored shared evidence bundle。
- 用户已明确授权本次四个 Provider 调用，并授权创建本审查任务。
- `pnpm-lock.yaml` 是用户未跟踪文件，不属于 PR，也不得进入 Provider 输入或任务提交。

## Requirements

### R1. Exact review binding

- 所有审查证据必须记录相同的 base/head、diff SHA-256、文件清单和测试摘要。
- Provider 只接收审查所需的受限 diff、明确目标文件、规范和测试证据；不得接收凭据、浏览器身份材料或任意用户文件。

### R2. Four independent providers

- Antigravity 使用受管 CCG wrapper。完成的模型报告计为有效审查；若 Provider 不可达，用户已接受由退出码、失败原因、实际默认模型及原始日志 SHA-256 组成的完整不可用记录闭合该路，但最终报告必须明确标注该 Provider 缺失，且该记录不等同于有效审查结论。
- Grok 只做本地代码审查，绑定明确的 workspace-relative 目标文件并要求有效 `CCG_GROK_REVIEW_JSON`；本任务不依赖当前外部事实，不启用 Grok external-intelligence route。
- Claude 只通过已授权的 Trellis task-local product-manager 快照运行，限制为 Read/Glob/Grep、无写入、无终端、无子代理、无 fallback。
- GPT Pro 只通过安装的 `chatgpt-pro-sidebar`、RootWait 与 exact import 合同运行；只接受 `completed`、URL/thread/target/hash/ack 全部通过的证据。

### R3. Review coverage

- 覆盖发送前严格 Pro 检查、URL-first/一次安全重试、exact-once/no-resend、RootWait 绝对截止时间、capacity 3/6、跨任务隔离、bridge import、来源同步和回归测试。
- 每个 Provider 必须检查隐藏 bug、安全/兼容风险、边界条件、测试缺口和可能的误报。

### R4. Codex verification

- Codex 独立检查每项 Provider finding，只有能定位到当前 head 的 `file:line` 或可重复合同证据才进入最终发现。
- 冲突意见必须列明各自证据与 Codex 判定；不得用多数投票替代代码核验。

### R5. Failure and merge recommendation

- 四路中任一路缺少有效证据时，联合审查状态必须为 `incomplete`，不得给出“建议合并”。
- Antigravity 的完整不可用记录只闭合“已如实处置该路”，不把 missing 提升为成功，也不解除上述 `incomplete` 约束。
- Critical/High 或未闭合 Major finding 存在时，不建议合并；仅在用户明确授权后，才可修复已由 Codex 复现的根因。

### R6. Controlled remediation

- 只允许修复两个已确认问题：watcher `status` 在发送后隐藏模式控件时的误失败，以及 post-click observation loop 混用注入时钟和系统 UTC。
- 修复必须先加最小失败回归，保持发送前严格 `Pro` 门槛、exact-once、no-resend、URL/thread/target/hash、capacity 3/6 和 focus 合同不变。
- 两项修复通过后，按 MCP1 只修 product-manager snapshot 的显式证据包含规则与缺失清单，再重跑 Claude；随后推进父任务 AC11 与 M2 复审。
- 未经单独授权不提交、不推送、不把 PR 从 Draft 改为 Ready；用户 `pnpm-lock.yaml` 始终不触碰。

## Acceptance Criteria

- [ ] AC1：所有有效审查证据引用同一 base/head、diff 哈希、文件清单和测试摘要；不可用记录写明其尝试绑定并保持 missing，不冒充有效审查。
- [ ] AC2：Antigravity 有完成报告，或有用户已接受的完整不可用记录并在最终报告标注 missing；Grok 有有效最终 JSON envelope，Claude 有有效 task-local product-manager 投影，GPT Pro 有 completed import 与响应哈希。
- [ ] AC3：Codex 对所有发现完成 file:line/合同点验，并分为 Critical、Major、Minor、False Positive、Required Tests。
- [ ] AC4：最终报告明确四路状态、共同发现、分歧、剩余风险及合并建议；任一路无效时不给合并建议。
- [x] AC5：`status` 对已发送观察不再因隐藏模式控件失败；generic readiness 仍以 `ready=false` 暴露非 Pro，`send` 的最终点击前严格 Pro 校验不放宽。
- [x] AC6：post-click observation loop 只使用注入的 `UtcNowProvider` 判断 180/7200 秒截止，并有失败转绿回归。
- [x] AC7：MCP1 快照包含规则能显式纳入受限 diff、manifest、test summary 与 `.agents/skills/chatgpt-pro-sidebar/**`；缺失项 fail closed，且根部未跟踪 `pnpm-lock.yaml` 默认排除。安装版复验为 155/155 必需项、0 缺失、`rootPnpmLockIncluded=false`。
- [ ] AC8：父任务 AC11 live E2E 和 M2 复审按原验收合同推进；Claude 新硬门槛仍需 `pm present` 后的 fresh 用户响应。
- [x] AC9：PR 始终保持 Draft；用户 `pnpm-lock.yaml` 未改变；所有提交、推送、来源更新和安装均在用户授权范围内。

## Out of Scope

- 修复本轮未确认或未获授权的 Provider finding，以及与两个根因/MCP1 无关的重构。
- 安装、登录、修复或更换 Provider CLI。
- Grok 联网事实检索、外部 API/版本判断或额外 Provider 替代。
- 自动批准、合并或关闭 PR。

## Open Questions

无。
