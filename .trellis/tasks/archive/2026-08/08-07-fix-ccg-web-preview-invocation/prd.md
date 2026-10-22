# 修复 CCG 全 Provider 网页预览与中间输出

## 目标

恢复并补齐个人 CCG 的原版 wrapper 使用体验：工作流决定调用外部职责 Provider 后，应自动进入既有网页输出预览入口；Gemini、Claude、Antigravity、Grok、Pi 均应在最终结果前持续显示其官方协议公开提供的响应增量、工具生命周期或阶段状态，并保持最终结果、错误和退出码真实。

## 已确认事实

- `ccg/3.4.6` 已提供 `ccg wrapper`，它会定位并校验 Codex-owned wrapper、继承 stdin/stdout/stderr，且不会自动注入 `--lite`。本次 Antigravity/Grok 计划调用均成功打印 loopback Web UI URL，因此“不在 PATH”不是当前根因。
- Gemini 使用独立的 `invoke_gemini_preview.py`；Claude/Antigravity/Grok/Pi 使用 Go wrapper。Codex 直接处理、Grok external-intelligence、产品经理、GPT Pro 侧栏不是同一预览管道。
- 初始基线中，`ccg-plan`、`ccg-execute`、`ccg-review`、`ccg-analyze`、`ccg-frontend`、`ccg-backend` 只有“existing adapter”式模糊表述；现有 PR #35 已把它们改成确定的 helper/wrapper 命令。
- 初始 Go WebServer 只累计 `SessionState.Content` 且晚连接只见 `done`；现有 PR #35 已回放累计文本，但统一标为 `message`，仍丢失 command/reasoning 类型。
- 初始 Antigravity 只传 `-p` 并走纯文本 Scanner；现有 PR #35 已按本机 `agy 1.1.11` 的官方 `init/step_update/result` stream-json 契约修复并真实验证。
- 初始通用 Grok wrapper 的 `--always-approve` 路径曾越权写入任务文件；现有 PR #35 已让自动 Skills 使用显式 read-only 路径。本次新增展示不得削弱该 fail-closed 边界。
- 原版 CCG 当前复用了同一 Go Web UI/SSE，但并未统一实现所有 Provider 的中间事件：Claude parser 只消费最终 `result`，Grok 只转发 `text`，Antigravity 仍走逐行纯文本，且原版没有 Pi backend。因此“参考原版”指复用其自动启动、单页输出和 SSE 形态，不能照搬这些能力缺口。
- 当前个人分支只有 Antigravity 已真实证明在 terminal 前显示多类事件；Claude 只显示最终 `result`，Pi 只在 `message_end`/`turn_end` 显示整轮文本，Grok 不显示公开工具/plan 事件，Gemini helper 只把 assistant 文本写入 Live Output。
- 官方协议已提供最小可用事件：Claude `stream_event`（需 `--include-partial-messages`）、Pi `message_update.assistantMessageEvent` 与 `tool_execution_*`、Grok `text/tool_call/tool_call_update/plan/end`、Gemini `message/tool_use/tool_result/error/result`；模型隐藏 thinking/thought 不属于可展示输出。

详细证据见 `research/current-call-chain-and-root-causes.md`、`research/upstream-and-antigravity-contracts.md` 与 `research/provider-intermediate-stream-contracts.md`。

## 范围内需求

### R1. 确定的自动预览调用契约

- 当角色解析为 `gemini` 时，工作流直接调用现有 Gemini preview helper；不得要求 Boss 先手动运行 `/ccg:gemini-preview`，也不得改走 raw Gemini CLI。
- 当 frontend/backend 角色解析为 `claude`、`antigravity`、`grok` 或 `pi` 时，工作流直接调用 `ccg wrapper --backend <provider>`，prompt 走 stdin，保留 `--progress` 与工作目录，默认不得添加 `--lite`。
- 只修改实际包含 Provider 分发表述的共享/顶层 Skills；已仅加载 `ccg-executor` 的命令复用共享契约，不复制第二套 dispatcher。
- wrapper/helper 缺失、启动失败或无非空响应时明确失败；不得静默跳过、fallback 或伪造多模型证据。

### R2. 工作流内部 Provider 只读边界

- 自动规划、分析、原型和审查调用必须使用 wrapper 的显式只读模式；Codex 继续是唯一真实工作区写入者。
- Claude 必须使用经校验的本机可信原生程序，并在 `--safe-mode`/plan 下仅开放 Read/Glob/Grep，禁用 MCP、slash commands、Chrome、session persistence 与外部 settings；不得使用 `--dangerously-skip-permissions`。Antigravity 复用现有 sandbox/plan 能力；Grok 复用现有禁写环境与工具禁用参数；Pi 保留已有 read/grep/find/ls-only 参数。
- 独立 Claude frontend/backend 调用与 product-manager 是两份互不替代的合同；前者不取得产品经理状态、授权或任务生命周期权限。
- 特殊 Grok/Antigravity review 契约继续优先，不削弱其 snapshot/target/envelope 校验。
- 手工 wrapper 兼容路径不被静默改写；只读模式由 CCG 工作流明确传入并由测试约束。

### R3. SSE 晚连接回放

- `SessionState.Content` 继续保留兼容累计文本；同一会话内额外保存按发送顺序排列的 `ContentEvent`，不持久化到磁盘。
- 每个会话内事件分配单调递增 ID；新 SSE 客户端按 `Last-Event-ID` 只回放缺失事件，再发送后续实时事件；已完成会话必须按“typed history -> terminal done”顺序返回。
- live/terminal 事件以 history 为权威，client 通知只负责唤醒，慢客户端或回放期间不得因有界 channel 满而丢失事件或 `done`。
- 不新增数据库、跨进程持久化或确认协议；序列 ID 只在当前进程/会话内用于 SSE 断线续传。

### R4. Antigravity 官方中间事件

- `buildAntigravityArgs` 请求 `--output-format stream-json`，不保留静默纯文本 fallback。
- 使用专用的小型解析分支处理 `init`、`step_update`、`result`；本轮只在 Claude/Pi/Grok/Gemini 各自分支补公开事件，不改 Antigravity 语义。
- `conversation_id` 继续作为 resume/session 证据；非空文本增量实时进入 Web UI；`result.response` 是最终消息权威；失败 status 与进程非零退出保持失败。
- 未知事件可忽略并记录有界诊断；缺少有效 terminal result/response 不得报告成功。

### R5. 个人源、发行与 Harness 同步

- 先在个人 CCG 权威源的干净隔离 worktree 实现和验证，不直接修改 plugin cache 或把 `components/ccg-workflow` 当运行时。
- 功能验证后使用新 patch 版本，避免相同版本对应不同 bytes；wrapper preset、摘要、package/plugin manifests 和 CHANGELOG 同步。
- commit、push、GitHub release、可选 npm publish、Harness 快照同步和本机安装均保留各自显式授权门，不由规划阶段执行；Boss 最终选择 GitHub 作为交付边界，不要求 npm 公共发布。

### R6. 全 Provider 公开中间事件

- **Claude**：受管命令必须请求 `--include-partial-messages`；只解析顶层 `stream_event` 中公开的 assistant `text_delta`、安全的 tool lifecycle 与 `system/api_retry` 状态。最终 `result` 是返回值权威，流式前缀不得在 terminal 时重复显示。
- **Pi**：解析 `message_update.assistantMessageEvent` 的 `text_delta`，并把 `tool_execution_start/update/end` 映射为不含参数和工具输出的安全状态；`message_end` 是最终 assistant message 权威。`thinking_*` 与 tool-call argument delta 不进入网页。
- **Grok**：保留 `text` 增量，增加 `tool_call`/`tool_call_update` 与 `plan` 的安全摘要；`end` 保持 terminal 权威。`thought` 不进入网页，特殊 review 的 forbidden-tool 证据校验不得因展示逻辑失效。
- **Gemini**：现有 Python preview helper 除 assistant `message` 增量外，还显示 `tool_use`/`tool_result` 与 warning/error 的安全摘要；最终 `result.status` 决定成功或失败，不切换到 raw Gemini wrapper。
- **Antigravity**：保留已完成的 `step_update` 映射与 terminal `result.response` 去重逻辑，并纳入同一跨 Provider 验收矩阵。
- 所有 parser 均忽略未知非关键事件并给出有界诊断；不得把缺失 terminal、错误 status、非零退出或空响应报告为成功。

### R7. 权威终态与网页一致性

- parser 的 terminal callback 只用于解除进程等待，不得提前把 Web UI 标为成功；Web session 只能在进程退出、terminal 校验和最终 `TaskResult` 分类完成后收束。
- terminal `result.response` 与已显示 assistant 文本不一致时，网页必须用显式替换事件纠正为权威最终文本；CLI 返回值、response file 与网页最终可见文本保持一致。
- terminal SSE 事件携带真实成功/失败状态与退出码；失败页面不得显示成功文案、成功通知或自动关闭。

## 验收标准

- [x] Skill 契约测试证明：Gemini 自动走 preview helper；Claude/Antigravity/Grok/Pi 自动走 `ccg wrapper` 的非-lite、只读、stdin prompt 路径；不再以“existing adapter”代替实际动作。
- [x] fake Provider E2E 证明非-lite wrapper 会打印 `http://127.0.0.1:<port>` 并调用浏览器 opener；显式 `--lite` 不启动 WebServer/浏览器。
- [x] SSE 回归先写内容并结束 session、再连接 stream，仍按序收到完整历史内容和 `done`。
- [x] Antigravity fixture 在最终 `result` 前产生至少一个可见 `step_update`；最终消息、conversation ID、失败 status 与退出码语义均正确。
- [x] Grok 只读回归模拟 Provider 尝试工具/写入时 fail closed，且工作区 bytes 不变；本次暴露的 `--always-approve` 通用规划路径不再被自动 Skills 使用。
- [x] Claude frontend/backend 路由可被逐角色选择；受管 wrapper 只执行已校验的本机原生 Claude，且只读参数、loopback、stdio、stream-json、resume 与错误路径有回归约束。
- [x] Codex/Claude/Gemini/Grok/Pi 既有 parser、Grok 特殊 review、loopback、stdio、resume 与错误路径回归不退化。
- [x] 个人源 focused/full gates、Go test/vet/build 及所需 CCG change/quality/security gates 通过。
- [x] Harness 已从个人源合并提交同步；source equality、doctor、conflicts、Node/Go 门禁通过，提交 `593d2f8` 已由 PR #37 合并为 `66da149`。
- [x] Boss 另行授权真实 Provider smoke 后，Antigravity Web UI 可在 done 前看到中间内容；未授权时该人工项保持待办，不用假结果替代。
- [x] Boss 授权后，临时 `backend=claude` 的真实工作流入口自动启动 Web UI、返回非空 marker 且 exit 0；fixture、全局配置和路由不变，无残留测试进程或监听端口。
- [x] Claude fixture 在最终 `result` 前显示至少一个 assistant text delta 和一个安全 tool/retry 状态；最终文本只显示一次，失败/无 terminal 保持失败。
- [x] Pi fixture 在 `message_end`/`agent_end` 前显示至少一个 `text_delta` 和一个安全 tool lifecycle 状态；`thinking_*`、参数和工具输出不泄露，最终文本只显示一次。
- [x] Grok fixture 在 `end` 前显示 `text` 及安全的 tool/plan 状态；`thought` 不显示，特殊 review 的 forbidden-tool 校验与失败语义不退化。
- [x] Gemini helper fixture 在 `result` 前显示 assistant delta、tool use/result 与 warning/error 状态；terminal status、响应文件和退出码保持真实。
- [x] 浏览器在事件产生后才连接时，仍按原 `content_type` 和产生顺序收到各 Provider 的历史中间事件，再收到 `done`。
- [x] 经 Boss 另行授权真实 Provider 调用后，Gemini、Claude、Antigravity、Grok 均通过真实工作流入口展示 terminal 前公开事件；Pi 因缺少 API key 未通过，Boss 已明确延期其登录复测并将其移出本任务完成门，未把认证失败算作通过。
- [x] 回放期间连续写入超过旧 channel 容量的事件并结束会话时，客户端仍逐条收到全部 live 内容和唯一 terminal `done`。
- [x] 带 `Last-Event-ID` 重连时只收到缺失事件，不重复已确认历史；Go wrapper 与 Gemini helper 使用相同语义。
- [x] Claude/Pi/Antigravity/Gemini 的 terminal 响应与流式文本不一致时，网页以替换事件显示权威最终文本，返回值与 response file 不变。
- [x] Provider terminal status、parser 校验、进程退出或只读校验失败时，网页显示失败及真实 exit code，不显示成功或自动关闭。

## 不在范围内

- 规划阶段不修改产品代码；实施仅在 Boss 授权后进入隔离 worktree，提交、安装、发布与 Harness 同步仍是独立授权门。
- 不重写 Web UI，不增加通用 Provider 调度框架、事件数据库、跨进程重连确认协议或新的前端样式系统。
- 不让 external-intelligence、产品经理、GPT Pro 侧栏或 Codex 直接处理强行进入 wrapper Web UI。
- 不把独立 Claude frontend/backend 调用解释为 product-manager 调用，也不改变产品经理逐次授权门。
- 不改变 Provider 登录态、凭据、角色默认路由或自动 fallback。
- 不展示或持久化模型隐藏思维链；只显示官方协议提供的响应增量和可公开步骤元数据。
