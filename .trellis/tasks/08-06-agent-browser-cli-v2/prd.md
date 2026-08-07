# GPT Pro agent-browser-cli V2

## 目标

把 GPT Pro 桥接从 Codex Desktop 侧边浏览器 UIA 改为用户真实 Chrome 中的 `agent-browser-cli` 扩展桥，使 ChatGPT 请求与回复监控不再依赖当前 Codex 顶层窗口或当前任务页面，同时保留现有 exact-once、证据链、RootWait 与 no-resend 安全语义。

## 背景与已确认事实

- Boss 已决定停止继续修补侧边浏览器 UIA 路径，V2 使用外部 Chrome。
- Boss 已安装浏览器扩展；登录由 Boss 在 Chrome 中手动完成，规划不得假定或复制登录态。
- `agent-browser-cli 2.x` 能按 `profile_id`/label、`browser_id`、`tab_id`、`session_key` 精确绑定真实 Chrome 标签，并以 loopback daemon/extension bridge 工作。
- 现有桥接已经具备幂等预约、prompt/response SHA-256、canonical conversation URL、send-uncertain、no-resend、detached watcher、RootWait、matching acknowledgement 与 Codex 独立复核语义；这些语义应复用，UIA 细节不应复用。
- 当前 Trellis UIA-only 规格与本需求冲突；实现前必须由本任务的新规格明确取代活动传输契约。
- 本次规划不使用 Grok。只读外部分析指定为 Antigravity `claude-opus-4-6-thinking` 与 Gemini CLI，Codex 负责最终核验与综合。

## 范围内需求

### R1：单一外部浏览器传输

- V2 的活动传输只能是 `agent-browser-cli-v2`；不得同时运行 UIA、自动 fallback、双写或静默切换。
- 允许从 ChatGPT 首页发起新对话；首次发送后取得并持久绑定 canonical `https://chatgpt.com/c/<id>` URL。
- 后续运行优先使用已绑定的精确会话 URL，在相同 Chrome Profile 中重新打开或恢复该会话，减少打扰；恢复要求该 Profile 至少保留一个已连接普通页面。

### R2：精确目标绑定

- 每次动作前必须唯一验证允许的 Chrome Profile、当前 `browser_id`、`tab_id`、`session_key`、页面 origin 与当前 canonical URL；不得选择第一个候选。普通标签列表可能截断长 URL，URL 必须以实际页面检查结果为准。
- 同一 exact URL 出现多个候选标签、页面或标签身份变化、登录页、MFA、CAPTCHA、权限页或 URL 漂移必须 fail closed。
- 从首页首次发送后，只能采用同一 `tab_id` 跳转得到的 canonical conversation URL；不得用另一个标签的 URL 补绑定。
- `@e` 引用属于临时快照，不得作为持久绑定或长期 watcher 身份。

### R3：exact-once 与 no-resend

- 发送前保留全局幂等预约、prompt hash、composer 回读证明、唯一发送控件证明和 response baseline。
- 单次发送动作最多执行一次。动作返回异常、超时或确认不完整时记录 `send-uncertain`，不得自动重试、重新绑定或换传输。
- 旧 UIA uncertain evidence 与已占用幂等键必须保留，V2 不得重放。

### R4：后台观察与 RootWait

- 回复 watcher 必须是纯本地脚本，不调用模型、不消耗监控 token，不依赖 Stop Hook 唤醒。
- watcher 只观察精确绑定标签中的新 assistant turn；切换 Codex 任务或使用其他应用时仍应继续工作。
- 新回复必须相对发送前 baseline 唯一出现、生成已停止，并在连续轮询中保持同一规范化内容；旧回复、生成中内容、被中断内容和页面控件文本都不得成为完成证据。
- root task 通过同一 turn 的 RootWait 等待本地终态，随后独立复核 thread/watcher/hash/URL/response 绑定并写入匹配 acknowledgement。
- 新 round 必须用一个原子 RootWait 命令完成一次发送、立即启动 watcher 与本地等待；不得在三个动作之间返回模型回合。
- 默认不抢焦点。若任何输入/发送动作在实际 Chrome 中会抢焦点，live smoke 必须如实报告，不能把文档推断当作后台安全证明。
- live smoke 必须让目标标签保持后台/非活动状态，验证 Chrome 节流不会让 watcher 在合同超时内失效；未通过时不得宣称支持后台等待。

### R5：安全与隐私

- 不读取、复制、导出或持久化 Cookie、Token、密码、浏览器历史或 Chrome Profile 文件。
- 不自动完成登录、MFA、CAPTCHA 或扩展授权。
- daemon API 与扩展 WebSocket 只允许既有 loopback 地址；本任务不改端口、不开放 LAN、不安装依赖、不修改 Chrome 配置。
- 不使用官方 `@Computer`/`@Chrome` 控制 ChatGPT，不调用内部 ChatGPT API。

### R6：集成迁移

- Harness、CCG import、Skill 标识、协议标识、规格与测试必须指向同一个 V2 传输合同。
- 迁移保留现有 evidence/import schema 中与传输无关的字段与哈希语义；传输特有字段必须显式版本化并严格校验。
- UIA 专属 Raw View、窗口/侧栏选择、`ValuePattern`/`InvokePattern`、焦点恢复与 Stop Hook 注册不得继续成为活动路径。

## 验收标准

- [x] 在不读取敏感浏览器数据的前提下，能力门禁能唯一绑定 Boss 指定的 Chrome Profile 和 ChatGPT 标签；歧义或未登录时零发送。
- [x] 同一 exact URL 存在多个标签，以及发送前后出现登录、MFA、CAPTCHA 或扩展权限挑战时，流程以明确终态失败且零重发（负向分支由自动化 fixture 覆盖，不操作 Boss 账号安全页面）。
- [x] 从 `https://chatgpt.com/` 可发送一条唯一测试请求，且发送动作证明为一次；获得 exact conversation URL 后写入不可漂移绑定。
- [x] 首页到 `/c/<id>` 的绑定发生在同一发送标签；Chrome 重启后的临时 browser/tab/session 标识只在相同持久 Profile 与 exact URL 均有证明时重绑。
- [x] composer 回读、发送确认或 URL 绑定任一不确定时进入失败或 `send-uncertain`，重复执行使用同一幂等键时零重发。
- [x] watcher 在 Boss 切换到另一个 Codex 任务并使用其他应用期间继续观察同一 Chrome 标签，不要求原 Codex 顶层窗口保持活动。
- [x] 目标 Chrome 标签保持非活动状态时，watcher 仍能在合同超时内识别唯一且稳定的新 assistant turn；生成中或中断状态不会提前完成。
- [x] terminal evidence 包含匹配的 thread、watcher、prompt/response hash、canonical URL 与稳定的新 assistant turn；RootWait 复核后只写一次匹配 acknowledgement。
- [x] 原子 RootWait 命令在同一工具调用内完成 `send -> watcher start -> local wait`，发送后 watcher 启动无模型回合空窗，并通过新的长任务 E2E。
- [x] 关闭目标标签或重启 Chrome 后，仅在相同 Profile、已持久绑定 exact URL 且至少一个普通页面仍连接时恢复；最后一个普通页面关闭或身份不确定时 fail closed。
- [x] live smoke 分别记录 `open`、composer 输入、发送与 watcher 阶段的焦点行为；产品路径未请求焦点，最后窗口关闭后的测试辅助启动不计入产品恢复能力。
- [x] 现有 transport-independent 单元/集成测试继续通过，并新增最小的 agent-browser CLI child-process/JSON 合同、exact-once、response isolation、RootWait 与 Harness import 回归测试。
- [x] Harness conflict 检查只接受 V2 transport，不存在 UIA/agent-browser 双活动传输。
- [x] Antigravity 与 Gemini 的非空只读规划响应被 Codex 实际读取；最终计划记录分歧、证据位置与 Codex 决策。

## 不在范围内

- 自动安装、升级、登录或修改 `agent-browser-cli`、Chrome 扩展、Antigravity、Gemini 或任何 Provider。
- 通用浏览器自动化框架、Cookie/CDP 网络抓包、ChatGPT 私有 API、坐标点击或截图 OCR fallback。
- UIA 与 agent-browser-cli 的兼容层、运行时开关或自动降级。
- 通过模型子代理持续监控回复，或重新依赖 Desktop Stop Hook 唤醒。
- 在本规划回合实现代码、启动 Trellis Phase 2、提交或推送。

## 阻塞问题

无。实现仍需 Boss 在最终规划摘要之后另行明确批准。
