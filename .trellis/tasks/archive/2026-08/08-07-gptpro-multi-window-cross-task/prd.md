# GPT Pro 多窗口与跨 Codex 任务隔离

## 目标

让一个 Codex 任务能够把已由 Codex/CCG 明确切分的独立 GPT Pro 请求分发到多个外部 Chrome ChatGPT 标签页并行执行；同时让不同 Codex 顶层任务各自拥有独立的 GPT Pro 页面池，后台运行、互不抢占、互不串线，并保留 V2 的精确一次发送和 RootWait 本地等待保证。

## 背景与已确认事实

- 当前 V2 通过 `browserId/profileId/tabId/sessionKey` 固化单一标签页目标，并在多标签但未给完整绑定时失败关闭；会话恢复只允许在同一 profile 后台重开精确 URL。证据：`.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md:9-30`、`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1:4022-4142`。
- 当前所有浏览器操作共享固定命名 mutex `Local\\ChatGptProSidebarV1`，因此不同标签页也无法并发。证据：`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1:547-560,4763-4767`。
- 当前 adapter 的 `state.json` 保存幂等键、提示哈希、响应基线、会话 URL 与目标绑定，但不保存 `CodexThreadId`；线程身份只在 RootWait watcher 状态/事件层校验。证据：`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1:3109-3155`、`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1:1454-1569`。
- 当前 `send`/`run` 在实际发送前没有从调用方接收完整目标绑定；发现多个 ChatGPT 标签页时会歧义失败。证据：`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1:4811-4818,4843-4858`。
- CCG bridge 已能用独立 session/round 目录表示多个请求，但 session 目录分配和任务级 `evidence.json` 读改写没有并发安全合同。证据：`components/ccg-workflow/plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py:1218-1226,1251-1253,1346-1463,1806-1908`。
- 已完成的单窗口 V2/RootWait 行为是兼容基线，不能以多窗口功能为由放宽：精确一次、禁止自动重发、目标四元组一致、精确 URL 恢复、无剪贴板、观察/恢复不抢焦点、最终由 Codex 审查并确认。

## 范围内需求

### R1：按 Codex 任务隔离的页面池

- 使用精确 UUID `CodexThreadId` 作为任务命名空间的一部分，为每个 Codex 顶层任务保存自己的 GPT Pro 目标绑定集合。
- 每个目标至少包含 `browserId/profileId/profileLabel/tabId/sessionKey/origin/url`；发送、等待、响应、导入和确认均必须校验线程身份与完整目标绑定。
- 不同 `CodexThreadId` 不得复用同一活动标签页；任何归属冲突必须在点击前失败关闭。

### R2：同一任务的多标签并行

- Codex/CCG 先生成有界的请求清单；纯本地脚本只负责分配目标、启动独立 round、等待和汇总证据，不使用模型进行语义拆分或轮询。
- 不同标签页可并行；同一标签页上的发送和 DOM 操作必须串行。
- 每个并行 round 使用独立 evidence directory、全局唯一幂等键、目标绑定、响应基线、watcher 与结果文件。

### R3：跨任务并行

- 多个 Codex 顶层任务可以同时运行各自的 GPT Pro round/page pool。
- 任务 A 的脚本、watcher、导入和确认不得读取、更新或确认任务 B 的页面、URL、响应、watcher 或 evidence。
- Codex Desktop 中切换到其他任务或使用其他应用不得使已启动的外部 Chrome 目标丢失；后台恢复仍只允许同 profile 的精确 URL。

### R4：后台行为与用户干扰

- 新页面使用已批准 profile 的 `open --background`；观察、等待、恢复不请求焦点。
- 仅实际向 composer 填充/发送时允许现有 V2 所需的最小焦点行为；结束后仍遵守当前焦点恢复合同。
- 不自动启动 Chrome，不操作登录、MFA、验证码、账单或账号选择。

### R5：精确一次与并发持久化

- 保留 per-evidence lock 和 per-user 全局幂等 reservation；并发调度不得产生第二次点击或自动重发。
- UI mutex 从全局单锁收窄为按完整目标身份派生的稳定锁；未知/不完整目标不能获得并行资格。
- CCG session 目录创建必须原子化；任务级 evidence 汇总必须使用锁与原子读改写，避免并发导入丢更新。

### R6：批次结果与失败语义

- 一个批次返回每个 round 的终态和证据路径；Codex 在同一根任务恢复后统一审查/综合，不由 watcher 或脚本生成模型结论。
- 单个 round 失败不得伪装为整个批次成功；已发送但不确定的 round 保持 `send-uncertain` 且禁止重试。
- 目标丢失、绑定漂移、跨线程访问、同标签冲突、重复幂等键、响应基线污染或并发写冲突均返回明确类别。
- batch timeout 默认 `7200` 秒；从未取得并发槽位的项目返回 `queued-timeout`，无法安全判断孤儿槽位是否可释放时返回 `ConcurrencySlotRecoveryRequired`。

### R7：并发额度与站点限流

- Boss 已决定：每个 Codex 任务最多同时运行 `3` 个 GPT Pro round；每用户全局最多同时运行 `6` 个 round。未经过新的计划修订不得运行时静默放宽。
- 单一任务超过 3 项的 batch 可继续包含更多独立项，但本地调度同一时刻最多启动 3 项；全局第 7 项及以后只在本地等待槽位，不打开新页面、不填充 composer、不点击发送。
- 等待槽位超过调用方的 batch timeout 时返回 `queued-timeout` 与 `ConcurrencySlotTimeout`，已运行项继续按各自终态汇总，不把排队项伪装为已发送。
- 槽位所有者消失时不得仅凭进程死亡释放；durable state 无法证明 pre-click 未发送或已经 terminal 时保留槽位，并返回 `ConcurrencySlotRecoveryRequired`。
- 提供只读槽位列表与唯一显式、可审计的诊断释放入口；释放只接受 pre-click 未发送或已 terminal 的证明，且不得清除幂等 reservation/target claim 或重新授权 click。
- ChatGPT 在点击前明确显示限流/挑战时返回明确的 pre-send terminal failure；点击已发生或是否发生不确定时保持 `send-uncertain`，禁止自动重发或提高并发规避限制。

## 不在范围内

- 不自动创建或登录 Chrome profile，不读取 cookies、storage、历史记录或无关标签页。
- 不允许同一 ChatGPT 标签页同时执行两个生成请求。
- 不使用 Codex Desktop 侧边浏览器、Windows UIA、坐标、剪贴板、CDP、Playwright、Selenium 或 ChatGPT 内部 API 作为兜底。
- 本地脚本不使用模型自动理解并拆分任意自然语言大任务；切片清单由当前 Codex/CCG 规划阶段生成。
- 不改变 ChatGPT Pro 的额度、速率限制或账号级并发规则；遇到站点限制时明确失败或等待，不规避限制。

## 验收标准

- [x] AC1：同一 `CodexThreadId` 的两个独立 prompt 可在两个不同完整目标绑定上并行发送一次、后台等待并分别返回正确响应证据。
- [x] AC2：两个不同 `CodexThreadId` 可同时使用各自页面；交叉读取、等待、导入或确认均在副作用前被拒绝。
- [x] AC3：同一标签页被两个 round 或两个任务声明时，最多一个获得目标锁，另一方在点击前失败，且无重复发送。
- [x] AC4：多标签存在时不再依赖猜测；已登记线程使用其精确绑定，未登记或歧义目标明确失败。
- [x] AC5：关闭某个已绑定会话标签后，只在同 profile 后台重开该精确 URL；不得选择另一任务的标签或主页。
- [x] AC6：每个 round 保留独立幂等键、prompt/response hash、URL、target binding、watcher/thread identity；任何不一致均失败关闭。
- [x] AC7：并发创建 CCG sessions 和并发导入任务级 evidence 不发生目录重名、覆盖或丢更新。
- [x] AC8：批次中一项失败时，成功项证据仍可审查，失败项状态明确，整个批次不得报告虚假全成功。
- [x] AC9：观察期间 Codex 不使用模型轮询；RootWait/批次等待只消耗本地进程资源，终态后恢复原 Codex 任务。
- [x] AC10：完整 E2E 证明同任务双页面、跨任务双页面、任务/应用切换、精确 URL 恢复、零自动重发和可观察焦点行为。
- [x] AC11：默认 batch timeout 为 `7200` 秒；同一任务第 4 个并发项与全局第 7 个并发项不会产生页面写入或 click，释放槽位后按本地队列继续，超时则返回 `queued-timeout` 与 `ConcurrencySlotTimeout`。只读列表可定位槽位；诊断释放仅在证明 pre-click 未发送或已 terminal 时成功。无法证明时返回 `ConcurrencySlotRecoveryRequired`；释放及该状态、站点 pre-send 限流和 post-click `send-uncertain` 均保留 claim/reservation、不重新授权 click 且不自动重发。

## 约束

- Trellis 是任务/需求/验收权威；CCG 负责模型编排和证据；Codex 是唯一工作区写入者与最终验证者。
- `components/ccg-workflow/` 必须继续是权威个人 CCG 源的精确快照，不能直接作为集成运行时修改。
- 保持 `chatgpt-pro-sidebar` 逻辑 Skill 名和 `agent-browser-cli-v2` transport 名。
- 规划阶段只写任务和 `.codex/ccg/plans/` 文档，不修改产品代码。

## 已确认产品决定

- Boss 于 2026-08-07 明确选择：每个 Codex 任务并发 `3`，每用户全局硬上限 `6`。
- 首次 live E2E 记录资源占用与站点限流表现；任何调整必须通过新的计划修订，不能在运行时自动扩容。
