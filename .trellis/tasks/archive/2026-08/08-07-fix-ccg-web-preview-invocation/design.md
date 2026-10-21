# 设计：CCG 全 Provider 自动网页预览与公开事件流

## 1. 权威与实施边界

Trellis 保存需求、设计、实施计划和状态；CCG 只提供 Provider 证据与质量门。本任务不创建平行 `.codex/ccg/plans`。实现先进入个人 CCG 权威源的干净隔离 worktree，完成干净提交并获批后才同步 `components/ccg-workflow` 与 `harness.sources.json`。

不修改当前有无关 dirty changes 的 `I:\ai\ccg-gptpro-worflow`，不修改 plugin cache/global install。新增范围继续使用现有 clean 任务 worktree `C:\Users\29933\.codex\worktrees\fix-ccg-web-preview-invocation` 和 Draft PR #35；规划批准不等于修改该 worktree。

## 2. 最小方案

现有两个入口已经够用：

```text
configured role
  ├─ codex -> Codex 直接处理（无外部预览）
  ├─ gemini -> invoke_gemini_preview.py -> Python Live Output
  └─ claude/antigravity/grok/pi
       -> ccg wrapper --backend <provider> --read-only --progress - <workdir>
       -> verified Go wrapper -> loopback Web UI -> SSE
```

因此不新增 dispatcher、路径解析器或 Web UI。`ccg wrapper` 已解决受管理 binary 的绝对路径、摘要验证、stdio 与退出码转发；现有 PR #35 已把 Skill 的模糊规则变成确定命令，本轮只补事件解析和回放。

## 3. Provider 启动契约

### 3.1 Skills

在 `ccg-executor` 保存共享 Provider Launch Contract，并让含独立分发表述的 `ccg-plan`、`ccg-execute`、`ccg-review`、`ccg-analyze`、`ccg-frontend`、`ccg-backend` 使用同一字面命令：

```text
ccg wrapper --backend <claude|antigravity|grok|pi> --read-only --progress - "<workdir>"
```

prompt 必须通过 stdin 传入；非空响应才算证据。`--lite` 只在 Boss 明确要求 headless 时加入。Gemini 继续使用已有 helper 命令与 prompt template。Grok/Antigravity 特殊 review 继续使用已有 `--grok-review-target` / `--antigravity-review`，不降级为通用调用。

只更新 Skills 和共享 routing rule；顶层 command 文件已把执行委托给对应 Skill，无需复制命令块。

### 3.2 `--read-only`

在 Go wrapper 增加一个窄的显式 flag/config 字段，仅供工作流内部外部 Provider 调用：

- Claude：Node shim 复用 product-manager 已有的本机原生程序校验，把已验证绝对路径只传给子进程；Go wrapper 在 `--read-only` 下使用 `--safe-mode --permission-mode plan`，仅开放 Read/Glob/Grep，并禁用 MCP、slash commands、Chrome、session persistence 与 settings。不得传 `--dangerously-skip-permissions`。
- Antigravity：复用现有 `--sandbox --mode plan --dangerously-skip-permissions --disable-slash-commands` 组合；仍允许读取上下文但不得写真实工作区。
- Grok：复用现有 review 的禁写环境变量与 no-tools/no-MCP/no-memory/no-subagents 参数，但不生成 review envelope，也不要求 review targets；Codex 把所需片段放进 prompt。
- Pi：现有参数已经仅开放 `read,grep,find,ls`，只需保持并测试。

手工未带 `--read-only` 的 wrapper 行为保持兼容。独立 Claude frontend/backend 与 product-manager 保持分离；前者只提供 bounded evidence，不取得产品经理任务状态或授权。Skill 回归保证所有自动调用都显式带该 flag。

## 4. Provider 公开中间事件

共同契约保持原版 CCG 的 stdout -> parser callback -> WebServer -> SSE -> 单页渲染链，不新增 dispatcher 或第二套网页。各 Provider 只解析官方协议公开字段：assistant 响应增量映射为 `message`，经过脱敏的工具生命周期映射为 `command`，公开 checkpoint/retry/plan 状态映射为 `reasoning`。Grok `thought`、Pi `thinking_*`、Claude thinking block、工具参数和原始工具输出一律不转发。

每个 parser 分别维护已显示的 assistant 文本；terminal 结果仍是 `TaskResult.Message` 权威。terminal 文本以已显示内容为前缀时只补尾；完全不一致时发送显式 `replace_message` 事件，让网页替换本轮 assistant 文本并继续保留 tool/reasoning 状态。未知非关键事件有界忽略，关键 terminal 缺失、失败 status、空最终响应和非零进程退出保持 fail closed。

### 4.1 Antigravity 启动参数

`buildAntigravityArgs` 在 `-p <prompt>` 前固定加入：

```text
--output-format stream-json
```

本机与官方契约均支持该参数；不添加纯文本自动 fallback。协议不受支持或输出无效时，沿现有 stderr/exit code 路径明确失败。

### 4.2 Antigravity 专用解析器

在现有 `parser.go` 中增加小型 `parseAntigravityStream`，复用 `readLineWithLimit` 与既有 callbacks，不把 Antigravity 对象塞进 `UnifiedEvent.Result string`，从而避免扰动其他 Provider。

事件不变量：

1. `init`：记录初始化信息；首次非空 `conversation_id` 触发 session callback。
2. `step_update`：按输入顺序处理；非空 `text_delta` 恰好转发一次。`agent_response` 映射为 `message`，公开 tool/checkpoint/subagent 摘要映射为现有 `command`/`reasoning` 类型；空 delta 不制造文本。
3. `result`：最多一次；`response` 是 `TaskResult.Message` 权威来源，status 非成功返回 terminal error；触发 complete。
4. 若已流式输出是最终 response 的前缀，只补缺失后缀，避免最终文本重复；完全不一致时记录有界 warning 并以 result 为终端返回值。
5. 无 terminal result、无最终 response、过长/损坏关键事件均不得伪装成功。

`executor.go` 删除 Antigravity 纯文本 Scanner 特判，只为该 backend 调用专用解析器；其他 backend 继续走现有统一 parser。

### 4.3 Claude partial stream

`buildClaudeArgs` 在既有 `--output-format stream-json --verbose` 后加入 `--include-partial-messages`。统一 parser 增加 Claude raw event 字段并识别：

- `stream_event.event.type=content_block_delta` 且 `delta.type=text_delta`：立即转发文本；
- `content_block_start/stop` 的 `tool_use` 与顶层 `tool_progress`：只转发工具名、状态和可用 elapsed time，不转发 input/result；
- `system/api_retry`：只转发 attempt/max_retries/retry_delay/error category；
- `result`：校验 `subtype`/`is_error`，保存最终文本和 session ID，在 EOF 后完成 Web session，避免 result 后公开 system event 被提前 `done` 截断。

完整 `assistant` 消息只用于结果校验，不再次显示已流式文本；不开启 `--forward-subagent-text`，避免扩大现有调用范围。

### 4.4 Pi JSON event stream

在现有统一 parser 增加 `assistantMessageEvent`、`toolCallId`、`toolName`、`isError` 等最小字段：

- `message_update.assistantMessageEvent.type=text_delta`：按 `contentIndex` 顺序转发 `delta`；
- `tool_execution_start/update/end`：转发安全的工具名与 running/completed/error 状态；
- `message_end`：提取最终 assistant message 并按前缀补尾；`agent_end` 才完成 session；
- `thinking_*`、`toolcall_*` argument delta、`partialResult` 与 raw result 不转发。

Pi 官方 `message_update` 已是 delta-only，不需要 diff cumulative message，也不使用 RPC 模式。

### 4.5 Grok streaming-json

继续使用原版相同的 `streaming-json`：

- `text` 维持实时 `message`；
- `tool_call`/`tool_call_update` 只显示 `toolName`/title/status，不显示 rawInput/rawOutput/content；
- `plan` 只显示条目状态和安全标题，不显示隐藏 reasoning；`usage` 只进入进度日志；
- `thought` 继续丢弃，`end` 保持最后事件与 stop reason/session 权威。

Grok review 先执行现有 `grokReviewEvidence` 观察与 forbidden-tool 校验，再把允许的安全摘要交给 UI；不能用 `continue` 提前吞掉所需展示事件或绕过失败证据。

### 4.6 Gemini Python Live Output

工作流继续使用 `invoke_gemini_preview.py`，不切换到 Go wrapper。`stream_output` 在现有 assistant `message` 文本之外处理：

- `tool_use`：显示工具名与 started；
- `tool_result`：显示同一 tool ID 的 success/error，不显示 parameters/output；
- `error`：显示 severity 与安全 message，并保留失败状态；
- `result`：以 `status` 收束，统计字段只记事件日志。

复用现有 `STATE.append_content` 和 Live Output 页面，不增加第二种前端事件协议。

## 5. SSE 晚连接顺序

`SessionState.Content` 继续作为 `/api/sessions` 兼容累计快照；`SessionState` 另保留只存在于当前进程和会话生命周期内的 `[]ContentEvent` typed history，并给每个事件分配会话内单调 ID。history 是传输权威，client channel 只作为可合并的唤醒信号。`handleStream`：

1. 解析可选 `Last-Event-ID` 并注册一个容量 1 的唤醒 channel；
2. 在锁内读取所有 ID 大于游标的 typed history，解锁后逐条发送 `id:` + `data:`；
3. live/terminal 写入只追加 history 并非阻塞地唤醒客户端；即使通知被合并，下一次读取仍会取得全部缺失事件；
4. 发送 terminal `done` 后退出；重连只重放游标之后的事件。

由于 `SendContentWithType` 和 terminal 收束使用同一锁，新 live event 不会插到 history 前面。history 不序列化到 `/api/sessions`、不落盘；SSE ID 只解决当前进程内断线续传，不扩展成确认、持久化或跨进程协议。Gemini helper 复用相同的序号/history/`Last-Event-ID` 语义。

## 5.1 权威 terminal 收束

parser 的 `onComplete` 只解除等待/排水；`executor` 在最终 `TaskResult` 已确定后统一、幂等地写入一个 terminal event，携带 `status` 与 `exit_code`。网页仅对成功 terminal 显示完成通知和自动关闭，对失败保持页面可见。`replace_message` 只删除/替换 assistant message 元素，不删除 task、command 或 reasoning 元素。

## 6. 测试设计

### Go focused tests

- `backend_test.go`：Antigravity stream-json 参数；read-only Claude/Antigravity/Grok/Pi 参数与禁写环境；Claude 受管绝对可执行文件覆盖。
- 新的小型 Antigravity parser test：`init -> ACTIVE/DONE step_update -> result`、短响应仅 DONE/result、失败 result、未知事件、缺 terminal。
- `main_test.go`：Claude partial text/tool/retry/result 与去重；Pi `message_update`/tool lifecycle/message_end/agent_end 与 thinking/原始输出抑制；Grok text/tool/plan/thought/end 与 review evidence。
- `server_test.go`：mixed content types before connect、超过旧 channel 容量的 live burst、失败 terminal、`Last-Event-ID` 重连，断言 typed history 在 live/done 前按序且仅一次。
- 保留/运行现有 parser、Grok review、loopback opener、resume、stdio 与错误测试。

### TypeScript/Skill tests

- 在现有 plugin parity/installer 测试中扫描直接分发 Skills：Gemini helper marker 存在；wrapper Provider 的字面命令包含 `--read-only --progress`，不含隐式 `--lite`，不再使用“existing adapter”代替动作。
- `src/utils/__tests__/wrapper.test.ts` 继续证明 shim 只安全转发参数，不自行注入 lite 或 shell。
- `geminiPreviewTemplate.test.ts` 增加 assistant delta、tool use/result、warning/error/result、晚连/重连和 terminal divergence fixture，断言 Live Output 在 terminal 前收到安全摘要且不包含参数/原始输出。

### Fake E2E 与人工门

- isolated fake `claude/agy/grok/pi` 输出 fixture 与 fake Gemini stream，验证 URL/opener、terminal 前事件、typed late replay、去重、退出码和只读 argv/env；不登录、不联网、不付费。
- 真实 Claude/Antigravity/Grok/Gemini/Pi smoke 只在 Boss 另行授权后逐个运行；每个 Provider 必须看到至少一个 terminal 前公开事件，认证失败不能算通过，真实结果不替代离线测试。

## 7. 发行与同步

实现通过后使用新的 package patch 版本和 wrapper patch 版本；更新 preset binary、SHA-256、package/plugin/marketplace manifests 与 CHANGELOG。个人源 commit/push/release/npm publish、Harness source sync、Harness commit/PR、全局安装分别请求授权。

## 8. 风险与取舍

| 风险 | 处理 |
|---|---|
| Antigravity schema 漂移 | 官方 fixture + 未知事件有界忽略；terminal result fail closed |
| 中间 delta 与最终 response 重复 | 前缀补尾规则；result 保持最终消息权威 |
| Provider schema 事件类型不同 | 每个 backend 最小专用分支和官方 fixture；不建设通用反射事件框架 |
| 公开状态误带敏感参数/思维链 | UI 只接收文字 delta、工具名/状态与公开 checkpoint/retry/plan 摘要；原始参数、输出、thought/thinking 丢弃 |
| Grok 再次尝试写入 | `--read-only` 参数、强制 env、forbidden-tool 检测与工作区 bytes 不变测试 |
| 独立 Claude 绕过产品经理安全边界 | 复用可信原生程序校验；受管 wrapper 强制只读 argv；产品经理合同继续独立 |
| history replay 在瞬断重连时重复 | 会话内单调 SSE ID + `Last-Event-ID`；不持久化、不跨进程确认 |
| 相同版本不同 bytes | 发布新 patch 版本并耦合校验 manifests/digests |
| Harness 与个人源漂移 | 只从获批 clean committed tree 同步并运行 `verify:sources` |

## 9. 安全门

本任务涉及命令执行、Provider 权限、工作区写入边界、stdout 协议解析和 localhost 服务。实施阶段必须运行 CCG security gate，重点核对 shell=false/argv、prompt stdin、只读 flag 不可绕过、Claude 可执行文件信任与工具限制、Grok tool/env 禁用、Antigravity sandbox、loopback 监听和日志不泄露敏感信息。
