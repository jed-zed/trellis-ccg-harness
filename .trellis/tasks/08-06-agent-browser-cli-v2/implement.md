# 实施计划：GPT Pro agent-browser-cli V2

> Boss 已通过 `/ccg:execute` 批准执行。原子 RootWait、生成态观察、长会话 turn 虚拟化兼容与完整长任务 E2E 均已完成，进入最终质量门禁、提交与 Trellis 收尾。

## 1. 冻结边界与建立回归

- [x] 记录当前 dirty worktree，逐文件区分 Boss 既有修改与本任务修改；不得覆盖 `08-04` 任务遗留改动。
- [x] 新增 `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md`，并在 tooling index 中把 UIA 规格标为历史、V2 标为活动合同；不手改受管 `AGENTS.md` 块。
- [x] 在现有 Pester/Node 测试中加入回归用例：目标歧义、首页同 tab URL 采用、旧幂等键、click 后断连、回复稳定性、登录挑战、RootWait 绑定和 Harness transport drift。

## 2. 迁移唯一实时 adapter

**主要文件**

- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1`
- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-agent-browser.js`（仅在固定 DOM 脚本确有需要时新增）
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar.Tests.ps1`

**动作**

- [x] 保留现有命令入口、证据锁、全局幂等登记、hash、canonical URL、`send-uncertain` 与 no-resend 状态机。
- [x] 删除活动调用链中的 UIA discovery/panel/focus/pattern 路径；增加最窄的 `agent-browser-cli` 参数数组调用与单 JSON stdout 校验，不创建通用 transport interface。
- [x] 直接执行 `tabs`/`open`/`exec` 等目标命令；只在明确失败后运行 `status`/`doctor` 诊断。
- [x] 严格绑定 profile/browser/tab/session/origin/URL；同 exact URL 多标签、身份漂移、登录/MFA/CAPTCHA/权限页均零发送失败。
- [x] 发送前占用原幂等键、捕获 baseline、参数化 fill、composer 回读 hash、重新解析唯一 send；click 最多一次，任何 post-click 不确定写 `send-uncertain`。
- [x] 首页首次发送后只采用同一 tab 的 `/c/<id>`；已有 canonical URL 才允许在同 Profile 中重开并重新绑定临时 ID。
- [x] 用行为型 DOM fixture 验证新 user turn、唯一新 assistant turn、生成结束与连续两轮稳定 hash；不依赖单一按钮文案或持久 `@e`。

## 3. 改造 watcher，不改 RootWait 语义

**主要文件**

- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1`
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-watch.Tests.ps1`

**动作**

- [x] 把 watcher 的 `WindowRuntimeId` 状态和 adapter 调用改为 V2 target binding；保留 worker、terminal evidence、RootWait、ack 和 hash 复核。
- [x] 保证 watcher 不调用模型、不写 Codex composer、不依赖 Stop Hook；旧 Stop Hook 文件不注册为活动路径，也不作为 fallback。
- [x] 用自动化回归覆盖任务切换不改变 target binding、Chrome 非活动标签、目标标签关闭后 exact URL 恢复和超时 no-resend；真实任务与应用切换 E2E 已通过。
- [x] 增加单一 `run-root` 命令，把一次 `send`、立即启动 watcher 与本地 RootWait 合并在一个工具调用中；保留拆分命令仅用于已有 post-send evidence 的恢复/诊断。

## 4. 收紧 Harness 与 CCG 合同

**Harness**

- `.harness/adapter.json`
- `scripts/lib/harness-adapter/conflict-static.mjs`
- `tests/harness-adapter.test.mjs`

**CCG**

- `components/ccg-workflow/plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py`
- `components/ccg-workflow/templates/engine/tools/gptpro/gptpro_bridge.py`
- `components/ccg-workflow/src/utils/__tests__/gptproBridge.test.ts`
- `components/ccg-workflow/plugins/ccg/skills/ccg-gptpro-bridge/SKILL.md`
- 对应 `gptpro-plan`、`gptpro-review`、`gptpro-exc` plugin/template 文档中仍声称 UIA/side panel/禁止 DOM 的活动说明
- `components/ccg-workflow/docs/gptpro-manual-bridge.md`

**动作**

- [x] 保留逻辑 protocol/skill `chatgpt-pro-sidebar`，给 Harness 活动合同增加并强校验 `transport=agent-browser-cli-v2`。
- [x] 更新 CCG importer：新 round 只接受 V2；历史已终止 `windows-uia` 证据只读兼容，历史等待态不可继续且保留 no-resend。
- [x] 更新 bridge 状态输出，明确 DOM automation 由批准 Skill 执行，删除错误的 `WEB_AUTOMATION=0`/side-panel 声明。
- [x] 通过现有组件生成/同步流程保持 plugin 与 template 两份受管源一致，不手工制造第三份实现。
- [x] 只更新活动说明；历史 task、changelog 和归档 evidence 不改写。

## 5. 更新 Skill 合同

**文件**

- `.agents/skills/chatgpt-pro-sidebar/SKILL.md`
- `.agents/skills/chatgpt-pro-sidebar/agents/openai.yaml`

**动作**

- [x] 说明 Skill 名称为兼容逻辑标识，唯一活动传输是外部 Chrome `agent-browser-cli-v2`。
- [x] 写清正常命令不做健康预检、精确目标约束、RootWait/no-resend、手动登录边界、焦点与后台实测要求。
- [x] 校验清单不再把 UIA 或 Stop Hook 文件当作 V2 活动依赖。

## 6. 最小验证顺序

### 静态与单元

```powershell
Invoke-Pester -Path .agents\skills\chatgpt-pro-sidebar\tests\chatgpt-pro-sidebar.Tests.ps1 -Output Detailed
Invoke-Pester -Path .agents\skills\chatgpt-pro-sidebar\tests\chatgpt-pro-sidebar-watch.Tests.ps1 -Output Detailed
node --test tests\harness-adapter.test.mjs
pnpm --dir components\ccg-workflow test -- gptproBridge
node scripts\harness-adapter.mjs conflicts
```

- [ ] 上游与 Harness 快照同步后，重跑仓库要求的 `pnpm harness:test`、`pnpm doctor`、`pnpm verify:sources`、`pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build`；RootWait live-fix 已通过 Pester 234/234、Harness Node 31/31 与 conflicts 0 blocking/0 warning。
- [x] 检查 diff，并以暂存区独立 worktree 验证；旧 Stop Hook 线程映射、Codex provider/Grok 规格和其他任务改动均保留在工作树但排除出本提交。
- [x] Phase 3.3 规格判断：RootWait 原子命令、生成态归一化与虚拟化 turn 后缀属于活动传输合同，已同步更新 `chatgpt-pro-agent-browser-v2.md`；无需修改其他层规格。

### 真实 E2E（需要 Boss 保持已登录 Chrome，可随时终止）

- [x] 能力门禁：唯一 Profile/标签 live 成功；重复 exact URL、未登录、MFA/CAPTCHA、权限挑战由自动化 fixture 验证零发送。
- [x] 首页 fresh round：一次 fill、一次 click、同一发送标签获得 canonical URL、唯一新 assistant 回复、hash 稳定。
- [x] no-resend：真实 composer 回读失败发生在 click 前；真实 click 后断连进入 `send-uncertain` 并只观察恢复；重复幂等键由回归确认零次第二 click。
- [x] 后台：目标标签非活动，Boss 切换 Codex 任务并使用其他应用，watcher 仍在超时内完成。
- [x] 恢复：关闭目标标签或重启 Chrome 后，以同一持久 Profile + exact URL 在后台重开并继续观察，不重新发送；至少保留一个连接的普通页面，最后页面关闭时明确 fail closed。
- [x] 焦点：已记录 status/open/fill/click/watcher 前后前台窗口；产品路径未改变前台窗口，测试辅助启动最后一个 Chrome 窗口不属于产品恢复能力。
- [x] RootWait：同一 root turn 对已完成真实发送证据做隔离回放，独立核对 thread/watcher/prompt-response-evidence hash/URL/response 后只写一次 matching ack；回放没有发送或修改 prompt。
- [x] 原子长任务 E2E：使用新 evidence 目录与新幂等键，在一个 `run-root` 调用内发送、启动 watcher、等待终态；完成后独立复核并 acknowledgement。

### Live evidence 说明

- 真实发送证据位于忽略目录 `live-e2e-20260807-061129-retry2/evidence`；一次 click 后进入 `send-uncertain`，随后仅观察恢复并得到两行稳定回复。
- RootWait 回放终态位于忽略目录 `live-e2e-20260807-061129-rootwait-replay7/evidence`；`terminalStatus=completed`、两次稳定 status、一次 finalize、零模型轮询、一次 matching ack。
- 回放发现并修复两项真实缺陷：watcher 等待 daemon 继承 stdout EOF，以及普通 `tabs` 截断长 URL 后误报会话漂移。
- 任务/应用切换专项 live smoke 位于忽略目录 `live-e2e-20260807-061129-task-switch-confirmed-retry3/evidence`；Boss 确认在约 75 秒窗口内切换到另一 Codex 会话并使用其他软件，watcher 完成 10 次探测、0 次失败，`terminalStatus=completed`、`pollingConsumesModelTokens=false`，四个 evidence hash 匹配并只写一次 matching acknowledgement。
- 失败的组合长任务证据位于忽略目录 `live-e2e-20260807-long-10m/evidence`：发送发生于 `2026-08-07T18:38:47Z`，watcher 直到约 13 分钟后才启动，只观察到已完成回复；RootWait 未实际运行，因此没有 acknowledgement。该证据只作为根因记录，不计为通过。
- 原子 v2 证据位于忽略目录 `live-e2e-20260807-atomic-rootwait-long-v2/evidence`：发送后约 0.23 秒启动 watcher，但正常 `GenerationAlreadyActive` 被误计为探测失败；同一 evidence 后续只观察恢复，零重发。
- 原子 v3 证据位于忽略目录 `live-e2e-20260807-atomic-rootwait-long-v3/evidence`：54 次探测连续观察约 10 分钟生成，0 次探测失败；ChatGPT DOM 卸载旧 turn 前缀导致 finalize `ResponseBaselineMismatch`。同一 evidence 经 hash 后缀修复只观察恢复，零重发。
- 最终通过证据位于忽略目录 `live-e2e-20260807-atomic-rootwait-long-v4/evidence`：一次 `run-root` 阻塞约 7 分 29 秒，`submittedExactlyOnce=true`、发送到 watcher 创建/启动约 0.28/0.36 秒、35 次探测（33 次生成中、2 次稳定停止、0 失败）、`terminalStatus=completed`；prompt/response/URL/evidence 四个 SHA-256 独立匹配，exact URL、thread/watcher 绑定一致，末行 marker 匹配，复核后只写一次 `codex-root-wait-reviewed` acknowledgement。

## 7. 回退点

- [x] V2 变更保持为可单独回退的提交范围；失败时用 Git 恢复旧实现，不生成 `.legacy` 副本。
- [x] 回退不得删除任何 evidence、canonical URL 或幂等预约；`send-uncertain` 继续禁止重发。
- [x] 真实 E2E 未发现 CLI 必然抢焦点或后台标签超时限制；继续交付且不启用 UIA fallback。
