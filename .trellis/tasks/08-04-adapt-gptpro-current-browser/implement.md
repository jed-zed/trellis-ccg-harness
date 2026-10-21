# Implementation plan

## 当前修复阶段：New Chat 瞬态准备与零地址聚焦

### 首页发送后的延迟 URL 绑定

- [x] 红测：已确认的 fresh root send 可进入 `sent` + URL pending；普通 unbound
  `send-intent`/`send-uncertain` 与 follow-up 仍拒绝观察和 watcher。
- [x] adapter：发送确认后不再因 8 秒内无 exact URL 降为 uncertain；持久化冻结窗口、
  baseline、prompt/idempotency hash 与 pending 标志，最终响应落盘前仍须取得 exact URL。
- [x] watcher：仅接受上述严格 pending 状态，在相同 RuntimeId 上被动观察并采用首个
  canonical exact URL；URL 一旦绑定后发生变化仍终止，且任何路径都不得重发。
- [x] 本地验证：focused watcher 59/59、完整 Skill 208/208、parser 5/5、安全扫描
  8 个 Skill 文件 0 findings、Harness conflicts 17 passed / 0 blocking / 0 warning、diff check 通过。
- [x] RootWait 对 detached worker 进程做存活检查；worker 在写 event 前退出时立即生成
  no-resend `worker-crashed` 终态，且 worker stdout/stderr 留在 evidence 目录。
- [ ] 用全新请求完成 `completed` RootWait E2E。2026-08-06 已证明首页发送可进入
  `sent + conversationUrlBindingPending` 并启动 RootWait；真实 watcher 随后无事件退出，
  修复后的 `wait-root` 已用同一证据快速收敛并确认。`-KeepLauncherAlive` 的真实离线
  RootWait 已正常等待到 `timeout`，但最新 live 尝试因 evidence 初始目录不为空而在
  幂等预留和 Send 前失败，Send Invoke 为 0，完整成功验收仍待下一次全新请求。

- [x] 先写回归，证明旧实现不重试动作前 `CodexWindowMissing`、会为根 URL 聚焦地址栏，
  且会在同一 Codex 顶层内再次恢复焦点。
- [x] `Invoke-LiveNewChat` 仅在 Invoke 前复用现有瞬态分类，并把一次本身可达 5 秒的
  `RawViewTraversalTimeout` 纳入 15 秒只读恢复窗口；保持 immutable RuntimeId，
  hard barrier 立即失败，New Chat Invoke 在循环外最多一次。
- [x] `Get-LiveUrlState` 只读取并清洗当前 UIA address value/text；删除地址
  `SetFocus`、文本选择、focus 后重解析与相应无调用者 helper。
- [x] 同一 automation 顶层内的焦点恢复改为一律 no-op；只有原焦点来自另一顶层、
  当前焦点仍精确属于 automation 顶层时才允许一次恢复。
- [x] adapter Pester 先得到 5 个预期失败，修复后 128/128；完整 Skill 196/196，
  parser 0 错误，0 failed/0 skipped，`git diff --check` 通过。
- [x] CCG change/security 门通过；安全扫描 adapter 与测试 2 文件 0 发现。通用质量扫描器
  不支持 `.ps1`，`files_scanned=0` 不计为质量通过；由 parser/Pester/diff 审查覆盖。
- [x] Harness conflicts：17 passed、0 blocking、0 warning、3 info；当前会话未绑定
  Trellis task 是信息项。本地 `task.py` 另有既存语法错误，本阶段未越界修复。
- [x] 初次只读 live gate：3 次 `status -NoPanelRecovery -NoFocusRestore` 均以
  `RawViewTraversalTimeout` 失败（6.531–7.334 秒），0 panel recovery。两次焦点身份
  不变，一次发生无动作路径中的环境焦点切换；未达到 ready，禁止继续 UI mutation。
- [ ] 经 Boss 准备测试窗口后，执行三点 UIA focus 采样和一次全新的
  `new-chat -> send -> start -RootWait -> wait-root -> root validation -> acknowledge-root`。
  任何 uncertain 动作均停止且不重试。
- [x] Boss 准备窗口后，3 次只读 status 均 `ready=true`、同一 RuntimeId、0 panel
  recovery，前后 focused top-level/element 完全不变。
- [x] live New Chat Invoke 恰好一次，composer `ValuePattern.SetValue()` 多次返回时，
  pattern 返回后及恢复前焦点均不变；Send Invoke 始终为 0。
- [x] live 暴露的 `RawViewTraversalTimeout` 在 Send 动作前证明中改为仅限本地的
  15 秒只读重试；回归先 128/129，修复后 129/129，不扩大 hard barrier。
- [x] 最终 parser 5 文件 0 错误、完整 Skill Pester 197/197、安全扫描 2 文件
  0 发现、Harness conflicts 17 passed / 0 blocking / 0 warning、diff check 通过。
- [ ] 当前 Desktop 的 composer 仅暴露 Value/Text/ScrollItem；ValuePattern 标称可写
  但精确 prompt hash 不稳定或不出现，最终 `ComposerOrSendNotReady`。RootWait 未启动，
  完整 E2E 继续失败关闭，禁止 synthetic input/CDP/clipboard 等绕过。
- [x] Boss 允许输入阶段短暂聚焦后，前台探针在 RuntimeId `42.788972` 上聚焦唯一
  ChatGPT composer，精确标记连续读回两次，并按严格 marker 形状清空；New Chat/Send
  Invoke 均为 0。首次清空失败定位为探针把空字符串传给不接受空值的 helper，改用
  已证明 writable 的 `ValuePattern.SetValue('')` 后清理成功。
- [x] adapter 增加显式 `-AllowComposerFocus`，仅 `send`/`run` 有效；默认仍不聚焦。
  开启时只在唯一 composer 上、`ValuePattern.SetValue()` 前调用一次 `SetFocus()`，后续
  exact hash、Send 控件、URL、幂等和一次 Invoke 合同不变。
- [x] 正式 helper 的第二次 live probe 完整返回 `ok=true`、`markerPersisted=true`、
  `cleared=true`、`Send/New Chat=0`。最终 parser 5/5、adapter 130/130、完整 Skill
  198/198、安全扫描 2 文件 0 发现、Harness conflicts 17 passed / 0 blocking /
  0 warning、`git diff --check` 通过。
- [x] Boss 授权后发起一次全新真实 E2E。根页 `new-chat` 为零 Invoke；唯一一次
  `send -FreshConversation -AllowComposerFocus` 已调用并返回，但发送后 8 秒内未绑定
  exact `/c/...` URL，停止于 `ExactConversationUrlUnavailableAfterSend`。durable state
  为 `send-uncertain`、`invokeAttempted=true`、`invokeReturned=true`、禁止自动重发。
- [x] 失败后的只读裁决发现原 RuntimeId `42.788972` 已消失，唯一新候选为
  `42.1381948` 且无 ChatGPT Document。未重绑、未启动 watcher/RootWait、未创建
  terminal event/acknowledgement，也未换 key/目录重试。

## 当前修复阶段：顶层窗口遍历超时

- [x] 复现 `status -NoPanelRecovery -NoFocusRestore` 在发送前以 exit 20 /
  `TopLevelWindowTraversalTimeout` 失败；超时位于顶层窗口发现，不在侧栏或 watcher。
- [x] 红测证明旧实现仍创建 process-filtered `TreeWalker`；该过滤视图可能把匹配
  后代压平并在 `GetFirstChild(RootElement)` 内触发不可取消的深层 provider 搜索。
- [x] 最小修复改为 `RawViewWalker` 只枚举桌面直接子元素，再由现有 HashSet 按
  ProcessId 过滤；保留 512/5 秒边界、RuntimeId/文档/唯一性证明和所有失败关闭语义。
- [x] 删除仅供旧过滤 walker 使用的 `New-OrCondition`；未新增依赖、回退、焦点、
  面板、发送、重试或外部 transport。
- [x] adapter 红绿回归：旧实现 119/120，新实现 120/120；新增顶层 deadline 测试。
- [x] parser 5/5、完整 Skill Pester 188/188、CCG 安全扫描 2 文件 0 发现、
  scoped `git diff --check` 通过。Harness conflicts 的唯一 blocking 是本轮之外既有的
  CCG source-tree digest drift，未擅自恢复或覆盖。
- [x] 连续两次无动作 live status 均在外层 20 秒内越过顶层发现，稳定返回 exit 21 /
  `EmbeddedDocumentMissing`，不再返回顶层遍历超时。
- [ ] 当前侧边 ChatGPT Document 仍未由 UIA 独立暴露；不得放宽 selector 或用环境
  URL、截图、坐标、CDP、Cookie/Token、内部 API 冒充 UIA 桥接成功。

## 当前修复阶段：纯脚本 RootWait（Boss 已选定）

- [x] watcher 增加显式 `-RootWait` transport：复用现有 detached UIA worker，
  不注册 Stop Hook，状态/结果记录 `codex-root-wait`，并拒绝同一 evidence 切换 transport。
- [x] 增加 `wait-root`：根 agent 保持当前 turn 运行，以一个阻塞本地脚本只等待
  exact state/event 文件；校验 exact thread/watcher、terminal、需 Codex 审核和禁止重发，
  不读取响应正文、不写 acknowledgement、不操作 UI/网络。
- [x] 增加 `acknowledge-root`：复用本地 continuation 的严格校验与幂等写入，记录
  `codex-root-wait-reviewed`，不得生成 Stop claim/callback。CCG import 仍由 importer
  写现有 acknowledgement。
- [x] 更新项目 Skill、tooling spec、PRD、design 与 Harness continuation；RootWait
  不创建 Luna 子代理、scheduled turn、服务、队列、composer 写入、Desktop Wake 或
  `codex exec resume`。
- [x] parser 5/5、focused watcher Pester 53/53、完整 Skill Pester 187/187、
  Harness adapter 31/31、安全扫描 17 文件 0 发现、Harness conflicts 17/17 通过。
  质量扫描器仍不支持 PowerShell；它只报告未由本轮引入的 Python/MJS 结构警告。
- [ ] 新一次无害 live RootWait E2E：`new-chat -> send -> start -RootWait -> wait-root
  -> root validation -> matching acknowledgement`。不得重试任何旧 uncertain send。
  2026-08-06 的 foreground-input 尝试已在一次 Send 后因 exact URL 未绑定停止，
  因此仍未到达 watcher start；该保留 evidence 不得重试或改绑。

## 历史阶段：GPT-5.6 Luna low 子代理回报（已由 RootWait 取代）

- [x] 用一个 `agent_type="default"`、`fork_turns="none"` 的只读子代理验证代理邮箱
  链路；它从现有 exact evidence 读取 terminal `completed`、watcher/thread/URL 与
  response evidence 存在性，未读取正文、未写文件、未操作 UI 或网络，并成功回报主代理。
- [x] watcher 增加显式 `-AgentMonitor` transport：不注册 Stop Hook，保留现有后台
  UIA worker，状态/结果记录 `codex-agent-monitor`，同一 evidence 不允许切换 transport。
- [x] 增加 `acknowledge-monitor`：仅接受 `agentMonitor=true`、exact thread/watcher、
  terminal event、`requiresCodexReview=true`、`automaticResendAllowed=false`；不得伪造
  Stop claim/callback。CCG import 继续由 importer 写现有 acknowledgement。
- [x] 更新 Skill 与 tooling spec：根 agent 必须保持当前 turn 运行，spawn 一个 Luna
  low 子代理并以不超过 60 秒的 `wait_agent` 切片等待；子代理只监控本地 evidence，
  主 agent 收到报告后独立读取、审核和导入。
- [x] parser 5/5、focused watcher Pester 47/47、完整 Skill Pester 181/181、
  安全扫描 8 文件 0 发现和 Harness conflicts 19/19 全部通过；未重发 ChatGPT。

## 当前修复阶段：跨 Codex 会话的被动观察

### 已复现事实

- [x] 同一 Codex 顶层窗口切换到另一个任务时，原任务的 ChatGPT
  Document、canonical URL 和 composer 会从 UIA 树中消失；切回后同一
  RuntimeId 立即重新暴露完整目标。
- [x] 当前应用未暴露可唯一证明且支持 `InvokePattern` 的“新建/独立窗口”
  UIA 控件，因此自动创建专用后台窗口不是受支持路径。

### 最小修复

- [x] watcher 将 `CodexWindowMissing`、`CodexWindowTargetMissing`、
  `EmbeddedDocumentMissing`、`AddressControlMissing` 和
  `BrowserPanelUnavailable` 视为绑定表面暂时不可见，在现有总超时内被动等待。
- [x] 暂时不可见不累计普通 probe failure，不重绑、不导航、不重发、不恢复
  焦点；原窗口与 exact conversation URL 再次暴露后继续观察和 finalize。
- [x] 非表面故障仍受 `MaxProbeFailures` 限制；目标到总超时仍未恢复时记录
  `timeout` 与 `pending-manual`。
- [x] 更新 Skill、tooling spec 和任务文档，把当前表面准确描述为右侧浏览器。

### 验证

- [x] 先写失败回归，确认旧状态机会在三次 `EmbeddedDocumentMissing` 后终止。
- [x] watcher focused Pester：42/42 通过。
- [x] PowerShell parser：5/5；完整 Pester：174/174 通过。
- [ ] 真实跨会话 smoke：发送一次后切换到同一窗口的另一 Codex 任务，确认
  watcher 保持 running；切回原任务后确认 exact URL 恢复并完成响应提取。
- [ ] 真实 Stop Hook claim 与 acknowledgement 仍需单独证明；不能用
  `continuationRegistered=true` 代替 claim 证据。

### Stop Hook 会话映射修复

- [x] 真实 watcher 已完成并持久化响应，但自然结束 Codex turn 后只有
  registration，没有 `watch-stop-hook.claim`、callback 或当前线程的 Hook 日志。
- [x] 用户级 Hook 配置、definition trust、`features.hooks=true` 和项目 trust 均存在；
  官方 Stop payload 契约只保证 `session_id` 字符串，不保证它一定是 UUID。
- [x] Hook 不再在单个 payload 值不匹配 UUID 时无声放弃。它按 payload 候选与
  UUID 校验后的 `CODEX_THREAD_ID` 顺序查找，只接受实际拥有未确认 watcher
  registration 的精确线程。
- [x] 无可用线程时只记录 `hasSessionId` / `hasCodexThreadEnvironment` 布尔值，
  不记录原始标识符，也不枚举其他任务。
- [x] Stop Hook focused Pester：15/15；完整 Skill Pester：176/176。
- [x] 已完整重启 Codex Desktop；新 PID 109724 晚于 Hook 配置与信任写入。
  重启后多次自然结束仍没有 claim/callback、当前线程 Hook 日志或
  `hook/started`，因此旧进程未装载配置的假设已排除。
- [x] Boss 在 Desktop `/hooks` UI 确认所有 Hook 均启用；本轮
  `UserPromptSubmit` 仍成功注入 `<codex-mode>` 与 `<workflow-state>`，证明当前
  Desktop 能执行用户 Hook，但没有派发 `Stop`。
- [ ] 等待 Codex Desktop 修复/恢复 Stop-event 派发后，用当前未确认 terminal
  registration 自然结束一次 Codex turn，要求真实 Hook 生成 claim/callback，
  Codex 审核后再执行 exact-thread acknowledge。不得重发 ChatGPT 请求。
- [x] 不添加 scheduled turn、`codex exec resume`、主 composer 写入或 Desktop Wake
  作为绕过；这些路径会扩大产品边界或破坏 exact-task/低打扰合同。

### 能力边界

同一窗口的非当前任务没有可访问 UIA 子树，因此纯 UIA 无法在用户长期停留于
另一任务时读取该任务的 ChatGPT 页面。连续后台观察需要用户保留一个独立 Codex
顶层窗口；当前代码不会自动创建窗口或改写用户正在使用的另一任务侧栏。

## 当前修复阶段：Codex 本地计划（不使用 Grok/GPT Pro/Claude）

本阶段由 Codex 根据本地代码、保留证据和 2026-08-04 审核发现制定。
CCG 自动情报门因 `grok` 不存在而退出 `4`，Boss 已决定不使用 Grok；
因此本节是 Trellis 权威的 Codex-only 修复计划，不宣称已通过 CCG 外部情报门或多模型审查。

### 目标与边界

- 修复 Raw View 全量 `FindAll()` 的无效事后上限，避免再次在 durable
  `send-intent` 之后无限等待。
- 枚举同一 Codex/ChatGPT 进程拥有的全部 UIA 顶层窗口，再执行现有唯一性、
  RuntimeId 和文档证明；不得把 `MainWindowHandle` 当成唯一窗口证明。
- 在动作前从结构上证明底部面板 toggle；`ToggleState=Off` 只能决定是否需要
  toggle，不能决定哪个控件是目标。
- 保留当前 adapter 的 UIA-only、exact-once、幂等预约、canonical URL、
  immutable operation binding、被动 watcher 和 Stop Hook 合同。
- 不修改 watcher/Stop Hook，不新增依赖、服务、`user32`/`DllImport`、坐标、
  合成输入、剪贴板、截图/OCR、浏览器驱动、CDP、Cookie/Token、内部 API 或外部浏览器。
- 保留现有 uncertain evidence 和全局幂等预约；本阶段不得清理、重试或换目录绕过。

## A. 先写失败测试（5 点）

**文件**：`.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar.Tests.ps1`

- [x] **A.1 Raw View 增量边界**（2 点）
  - 删除“源码同时出现 `FindAll` 和 limit 名称即算 bounded”的形状断言。
  - 用可注入 walker/时钟 fixture 覆盖：正常结束、访问节点超过 `10000`、
    deadline 到期、`ElementNotAvailable`、兄弟/父级循环或重复 RuntimeId。
  - 断言越界时返回结构化兼容错误，且没有 composer write、New chat 或 Send Invoke。
- [x] **A.2 单进程多顶层窗口**（1 点）
  - 构造同一 ProcessId 下两个可见 Codex 顶层窗口；验证二者都进入候选集，
    未显式绑定时因歧义失败，显式 RuntimeId 只选择完全匹配项。
  - 覆盖其中一个窗口在 operation binding 后消失，确保不会重绑到同进程另一窗口。
- [x] **A.3 底部面板结构证明**（1 点）
  - 覆盖“右侧栏 Off / 底部栏 On”和相反状态；两种情况下都选中与唯一
    `ExpandPanel` 同行且关系唯一的 toggle。
  - 缺少关系、两个关系同样成立、非有限 geometry 时必须失败且零 UIA mutation。
- [x] **A.4 不确定发送回归**（1 点）
  - fixture 保持 `send-intent`、空 `conversationUrlBound` 和
    `automaticResendAllowed=false`；任何 wait/recovery/新命令均不得 Invoke 或建立新预约。

## B. 修复 Raw View 发现（5 点）

**文件**：`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1`

- [x] **B.1** 保留 `Find-LiveElementsByNames` 与
  `Find-LiveElementsByControlTypes` 的调用合同，替换共享的
  `Find-LiveRawElementsByCondition` 内部实现。
- [x] **B.2** 使用 UIA `RawViewWalker` 增量深度优先遍历，不再调用
  `Root.FindAll(TreeScope.Descendants, ...)`；记录访问节点数并以 `10000` 为硬上限。
- [x] **B.3** 为每次遍历传入固定 UTC deadline（默认 5 秒），在每次 walker
  调用前后检查；超限分别返回 `RawViewElementLimitExceeded` 与
  `RawViewTraversalTimeout`。单个不可取消的 UIA Provider 调用仍由外层进程超时兜底，
  并作为 Windows UIA 残余限制写入验证报告，不再把结果数检查表述为 wall-clock 保证。
- [x] **B.4** 仅在 element 的 control type/name 与查询匹配后调用现有
  `ConvertTo-LiveRecord`，避免为所有 Raw View 节点读取 geometry/pattern。
- [x] **B.5** 保持 `TransientUiRerender` 分类和 Raw View ancestry；不得降级到
  Control View 或吞掉非瞬态异常。

## C. 修复顶层窗口完整性（4 点）

**文件**：`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1`

- [x] **C.1** `Get-Process` 只提供候选 ProcessId/产品名提示，不再用每个进程的
  单个 `MainWindowHandle` 作为候选全集。
- [x] **C.2** 从 `AutomationElement.RootElement` 使用只匹配候选 ProcessId 的
  UIA condition + 增量 `TreeWalker` 枚举全部直接顶层子元素；保持 `512` 上限，
  禁止 `Condition.TrueCondition` 的桌面全量 `FindAll()`。
- [x] **C.3** 对每个候选继续执行现有可见性、顶层名称、`Document=Codex`、
  RuntimeId 非空/有界/不重复证明；产品名和 ProcessId 都不能单独授权动作。
- [x] **C.4** 若 process-filtered 顶层 walker 在 live probe 中仍出现不可接受阻塞，
  该版本必须以明确 compatibility blocker 停止，不得回退为“取第一个
  `MainWindowHandle`”或引入 `user32/DllImport`。

## D. 修复面板控件选择（3 点）

**文件**：`.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1`

- [x] **D.1** 扩展现有 `Select-RelatedPanelControlRecord` 的几何关系逻辑，先从
  sidebar toggles 与 `ExpandPanel` 形成的候选对中证明唯一底部行。
- [x] **D.2** 选择唯一关系成立的 toggle 后，才读取 `TogglePattern`；On 为 no-op，
  Off 只执行一次 toggle，Indeterminate/缺失 pattern 继续失败关闭。
- [x] **D.3** 每次 panel/expand mutation 后沿用 immutable
  `$Script:TargetWindowRuntimeId` 重新解析；不得复用旧 element 或改动其他 Codex 窗口。

## E. 本地验证与文档校正（4 点）

- [x] **E.1 聚焦验证**：PowerShell parser 5/5；adapter focused Pester；随后完整
  `.agents/skills/chatgpt-pro-sidebar/tests` Pester，要求 0 failed / 0 skipped。
- [x] **E.2 安全与影响门**：`git diff --check`、禁止 transport/source regressions、
  CCG security scanner、`node scripts/harness-adapter.mjs conflicts`；记录通用质量扫描器
  不支持 `.ps1`，不得把 `files_scanned=0` 写成通过。
- [x] **E.3 只读 live smoke**：仅运行 `status -NoPanelRecovery -NoFocusRestore` 和
  无动作 UIA probes；由外层进程设置 10 秒超时，重复 5 次，记录每次耗时、RuntimeId、
  ready/category 以及前后 focused top-level identity。不得运行 `new-chat`、`send`、
  watcher 或 Stop Hook callback。
- [x] **E.4 校正任务证据**：更新 `task.json`、`verification.md` 和
  `research/current-uia-surface.md`，准确记录已有 `send-intent`、无绑定 conversation URL、
  未启动 watcher/回调、自动重发被禁止，以及 Boss 已放弃 Grok 外部计划通道。
- [x] **E.5 继续验收 preflight**：重新证明唯一 RuntimeId、ChatGPT 文档、地址、
  composer、Pro、idle generation 和根 URL；验证一次面板恢复前后焦点顶层身份不变。
- [x] **E.6 独立一次性发送**：使用全新无害提示、key 和证据目录调用一次
  `send -FreshConversation`；超时后保留 `send-uncertain`，不得重试。
- [x] **E.7 关闭态面板回归**：live UIA 证明完全关闭时为 1 个精确 toggle、
  0 个 `ExpandPanel`。允许该唯一 toggle；多个 toggle 仍失败关闭，且补红绿测试。
- [x] **E.8 观察性裁决**：Boss 手动恢复 Codex 可见窗口和 Browser 后，只读检查
  composer/response hash/exact URL。原 RuntimeId `42.788972` 重新出现，但 URL 仍为
  `https://chatgpt.com/`（非 exact）；页面 idle、composer 为空、可见 assistant 响应和
  预期 marker 命中均为 0。Prompt evidence hash 匹配，未执行 UI 写入；无法恢复精确
  会话，旧请求保持 `send-uncertain` 且禁止重发。
- [ ] **E.9 回调验收**：仅在旧提交被精确 URL 绑定后启动 watcher，核验 Stop Hook
  callback 并 acknowledge；URL 仍未绑定则保持人工裁决，不得启动 watcher。

## F. 完成门与回滚（2 点）

- [ ] **F.1 本地交付门**：前述测试和只读 smoke 全部通过后，只能标记为
  “local repair candidate”；在 Boss 继续禁止 GPT Pro live run 时，原 PRD 的
  `new-chat -> send -> watcher -> Stop Hook -> acknowledge` 验收仍未满足，任务不得完成或归档。
- [ ] **F.2 回滚**：仅回退本阶段对 adapter、adapter tests 和当前 Trellis 任务文档的
  diff；保留旧 uncertain evidence、幂等预约、watcher 历史证据和其他 dirty files。

## 实施顺序

`A 失败测试 -> B Raw View -> C 顶层窗口 -> D 面板关系 -> A/全量测试 -> E 门禁与只读 smoke -> E.4 文档 -> F 完成判定`

本计划不自动进入实现，不提交、不推送，也不调用任何外部 Provider。

## 历史基线（保留，仅供上下文；当前执行以以上 A-F 为准）

## 1. Re-establish the live capability baseline

- Record branch, commit, dirty state, active installed Skill path, Codex/ChatGPT app process identity, and harmless `status` output.
- Run a bounded read-only UIA probe for top-level window identity, RuntimeId/ProcessId availability, documents, edits, browser controls, supported patterns, and URL-bearing values. Do not dump unrelated text or conversation titles.
- Prove whether Codex can safely nominate/focus the intended window and whether the adapter can map that hint back to exactly one independently verified UIA candidate. Record that this hint is non-authoritative.
- Probe each candidate recovery action separately for foreground and focused-top-level side effects while the user is in another application and another Codex task. Do not classify an action as background-safe from API shape or fixtures alone.
- Decide the gate:
  - always allow the independently verified generic window-discovery/operation-lock hardening and its deterministic tests to proceed; do not claim that this alone restores the current browser bridge;
  - add a current-layout resolver only if a unique ChatGPT surface + composer + canonical URL is exposed;
  - otherwise leave the current-layout resolver absent, preserve fail-closed status, and report the missing app accessibility capability as the remaining live blocker.

## 2. Write failing deterministic tests

- Add fixtures for the verified current-layout shape only; do not invent a selector shape that live UIA did not expose.
- Cover legacy preservation, current-layout selection, main Codex composer rejection, missing/ambiguous surface, missing/ambiguous URL, security barriers, generation state, and no action on failure.
- Cover `Get-LiveCodexWindow` enumeration failure and the existing `TopLevelWindowLimitExceeded` contract, plus explicit target, unique candidate, unique browser-bearing candidate, unique focused candidate, no first-record fallback, and empty/duplicate RuntimeId rejection.
- Add a target-loss fixture in which the first window is proved and then disappears while a different window becomes uniquely eligible. Assert that every repeated resolution in `send`, `new-chat`, acknowledgement, URL binding, and watcher observation fails against the frozen target instead of rebinding.
- Add URL-recovery fixtures that separate the durable exact `conversationUrlBound` from ephemeral window/surface RuntimeIds: close the bound surface, reopen and navigate only inside the still-bound top-level target, re-prove identity/auth/URL, record the replacement RuntimeId, and assert zero `new-chat`/`send` calls.
- Add multi-session silence fixtures: the user remains focused in another application or Codex task; recovery performs no task/window activation, panel/URL/composer mutation, or focus restoration. A focus change between proof and action must defer before the UIA mutation.
- Add a call-graph/source fixture proving detached recovery cannot reach `Address.SetFocus()`, address text selection, or the existing focus-based `Get-LiveUrlState` fallback; direct focus-free exact URL reads remain allowed.
- Add target-window-loss fixtures with another Codex window remaining. Assert that the remaining window is never repurposed even when it is the only browser-bearing or focused candidate, and that no `codex://threads/...`, application launch/relaunch, default URL handler, or Desktop Wake path runs.
- Add a missing-background-navigation fixture that persists a pending/manual recovery category and retains the exact URL without acting. Mocked fixtures validate state and cardinality only; they cannot mark a live UIA action background-safe.
- Cover `ElementNotAvailable` and pattern-capability loss before action as structured fail-closed errors; preserve the existing no-resend rule when action outcome is uncertain.
- Assert that any current-layout URL candidate using non-HTTPS, a non-default port, or a host other than canonical `chatgpt.com` is rejected before action.
- Cover exactly one `ValuePattern.SetValue` preparation and exactly one `InvokePattern.Invoke` send with no retry after uncertainty.
- Preserve the existing watcher UUID validation and unacknowledged Stop Hook claim replay tests; extend them only if the compatibility change touches those contracts.

## 3. Apply the minimal root-cause change

- Extend the shared live-context resolver with one current-layout branch that normalizes to the existing context contract.
- Reject empty or duplicate candidate RuntimeIds before a window can be used for an acting operation.
- After the first successful proof in an acting command, freeze the RuntimeId through the existing command-scoped target binding before the next `Resolve-LiveContext`, prompt write, intent write, or UI action. Reuse that binding for panel recovery, commit preparation, acknowledgement, URL binding, wait, and watcher observations.
- Convert target disappearance/replacement and stale UIA elements into explicit invalidation; require a new command for rediscovery and never silently rebind inside the current operation.
- Reuse the exact bound conversation URL for bounded surface recovery inside an already-running Codex instance. Keep the original top-level target when it still exists; re-prove URL/auth/security/Pro/conversation evidence before accepting a new ephemeral surface/window RuntimeId.
- Add one pre-mutation silence gate at the shared recovery boundary: re-check frozen target identity, sample current focused top-level identity, and allow a stable external/other-Codex focus only for a live-proved focus-free UIA action. Any proof-to-action focus change or unproved action persists pending/manual recovery with zero UI action and no focus restoration.
- Exclude `Invoke-LiveDesktopWake`, `Start-Process codex://threads/...`, application launch/relaunch, and main Codex composer writes from recovery. If the original top-level target is gone, never navigate another existing Codex window.
- Keep `send-intent`/`send-uncertain` recovery observational: exact URL reopen/read is allowed only through the same silence gate; no send, new chat, replacement idempotency reservation, or retry.
- Reuse existing UIA discovery, cardinality, hashing, canonical URL, action, and evidence helpers.
- Keep legacy behavior unchanged and keep all prohibited transports absent.
- Update the project Skill text only if operator-visible compatibility/error behavior changed.

## 4. Focused validation

- Parse the adapter, watcher, Pester tests, and Python Stop Hook.
- Run focused adapter Pester tests first, then `Invoke-Pester -Path .agents/skills/chatgpt-pro-sidebar/tests -Output Detailed` for the full project Skill test directory, including the Python Stop Hook exercised by its Pester harness.
- Verify the new operation-lock tests against both automatic discovery and explicit `-WindowRuntimeId`; confirm the full legacy fixture set is unchanged.
- Verify foreground/focused-top-level identity is unchanged for every action classified background-safe; verify deferral and zero UI calls for another-app, another-Codex-task, focus-race, target-loss, and missing-navigation cases.
- Add a source regression that keeps `codex://threads/...`/Desktop Wake unreachable from watcher recovery and prevents application launch/relaunch or main-composer writes from entering the recovery call graph.
- Run Stop Hook deterministic tests and security source regressions, including invalid/missing `CODEX_THREAD_ID` and replay-until-acknowledged behavior.
- Run CCG quality and security review on the actual diff; use the configured Antigravity frontend route as a read-only cross-review input, with Codex retaining final judgment.

## 5. Real end-to-end acceptance

- Require live `status` ready with one selected window/surface/composer, Pro state, no barriers, idle generation, and canonical allowed URL.
- Before sending, let Codex nominate/focus the intended window, then require the adapter's live `status` to return the independently proved RuntimeId. Pass or persist that exact identity for the acting command; a changed identity aborts the run.
- Run a separate harmless live recovery smoke before the send E2E: close only the bound built-in browser surface, keep another application or Codex task focused, and require either (a) exact-URL recovery with a replacement ephemeral RuntimeId and unchanged foreground/focus, or (b) a clean pending/manual result with zero mutation. Never force the action to make the smoke pass.
- Use a harmless unique prompt in a new empty evidence directory.
- Execute `new-chat`, then one `send -FreshConversation` with a unique opaque idempotency key.
- Start the detached watcher with the exact current `CODEX_THREAD_ID`, then end the Codex turn so the trusted Desktop Stop Hook can fire naturally.
- On continuation, inspect `watch-event.json`, require terminal `completed`, validate non-empty response and all URL/hash/thread/watcher bindings, then acknowledge the continuation.
- Record the exact conversation URL, timestamps, SHA-256 values, runtime IDs, terminal event, callback, and acknowledgement.

## 6. Completion gate

- Run the full affected test suite and `node scripts/harness-adapter.mjs conflicts`.
- Review the complete task diff for unrelated dirty-file overlap.
- If the live URL/surface capability is unavailable or the Stop Hook does not resume this exact task, do not claim completion and do not substitute fixture evidence.
- If no current UIA navigation action proves background-safe, ship the durable pending/manual recovery behavior and report automatic reopening as capability-blocked rather than weakening the no-interference requirement.
- Present the task-owned commit plan separately; do not commit or push without the required confirmation.

## Review and rollback points

- Before code: Antigravity reviews this plan for unsafe assumptions and missing tests.
- After code: Antigravity reviews the bounded diff; Codex independently validates findings.
- Before live send: rerun harmless status and stop on any non-zero result.
- After any uncertain send: preserve evidence and never retry automatically.
- After any focus/foreground drift or another-Codex-window candidate: preserve the exact URL, perform no recovery mutation, and require a later safe observation or one manual action.
- Roll back only task-owned adapter/test/documentation edits; preserve unrelated user changes and diagnostic evidence.
