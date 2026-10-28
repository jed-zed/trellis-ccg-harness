# Provider 网页预览中间事件合同（2026-08-08）

## 结论

原版 CCG 可复用的是非-lite 自动启动、loopback Web UI、stdout parser callback、SSE 和单页渲染链；原版当前没有“所有 Provider 都展示中间过程”的统一实现。个人分支必须按各 CLI 的官方协议分别解析公开事件，并用同一 `ContentEvent`/SSE 形态展示。

## 当前实现与缺口

| Provider | 当前个人分支 | 官方可用的 terminal 前事件 | 规划修复 |
|---|---|---|---|
| Claude | `buildClaudeArgs` 只有 `stream-json --verbose`；parser 只处理最终 `result` | `--include-partial-messages` 后的 `stream_event` text delta、tool lifecycle、`tool_progress`、`system/api_retry` | 请求 partial；显示 text 和安全状态；terminal 去重并在 EOF 完成 |
| Antigravity | 专用 parser 已显示 `step_update` 的 agent/tool/checkpoint/subagent，`result.response` 收束 | `init`、`step_update`、`result` | 保留并回归，不重写 |
| Grok | 只显示 `text`；`thought` 丢弃；tool 事件被 review observer 提前吞掉 | `text`、`tool_call`、`tool_call_update`、`plan`、`usage`、`end`、`error` | 显示 text 和安全 tool/plan 摘要；继续丢弃 thought；保留 review fail-closed |
| Pi | 只在 `message_end`/`turn_end` 显示整轮文本 | `message_update.assistantMessageEvent` delta、`tool_execution_start/update/end`、`message_end`、`agent_end` | 显示 text delta 和安全工具状态；message_end 补尾、agent_end 完成 |
| Gemini | Python helper 只把 assistant 文本交给 Live Output | `message`、`tool_use`、`tool_result`、`error`、`result` | 在同一 helper 显示安全 tool/error 状态；保留 result status/exit code |

当前 Go WebServer 只把累计 `SessionState.Content` 作为一个 `message` 回放，晚连接会丢失 command/reasoning 类型。最小共同修复是在会话内保留 `[]ContentEvent` typed history，并按 history -> live -> done 回放；不落盘、不增加 EventSource ID 或跨重连确认协议。

## 原版 CCG 对照

- [backend.go](https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/backend.go)：当前原版 wrapper backend 参数；支持 Codex、Claude、Gemini、Antigravity、Grok，没有 Pi。
- [parser.go](https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/parser.go)：Codex 显示消息/reasoning/command，Gemini 显示 content，Grok 显示 text 并丢弃 thought；Claude 仅消费最终 `result`。
- [executor.go](https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/executor.go)：parser callback 进入 WebServer；Antigravity 仍是逐行纯文本 Scanner。
- [server.go](https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/server.go)：原版页面按 content type 渲染，但 SSE 晚连接只发 `done`，不回放历史。

因此本任务“参考原版”不等于复制当前 parser 缺口，而是保持其 UI/生命周期形式并补全 fork 已注册 Provider 的公开事件。

## 官方协议证据

### Claude Code

- [Programmatic/headless 文档](https://code.claude.com/docs/en/headless)：`--output-format stream-json --verbose --include-partial-messages` 才会在生成时输出 token；顶层 `stream_event` 包装 raw API event，最后 `result` 含最终响应和 session metadata。
- [Agent SDK streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)：text delta 位于 `content_block_delta -> text_delta`；tool use 有 start/delta/stop；`tool_progress` 只提供运行心跳。
- 安全取舍：只显示 assistant text、工具名/状态/elapsed 与 retry 分类；不显示 thinking block、tool input/result、subagent text。

### Pi

- [JSON Event Stream](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/json.md)：`--mode json` 输出 JSONL；`message_update.assistantMessageEvent` 是 delta-only，示例为 `text_delta/contentIndex/delta`；工具事件为 `tool_execution_start/update/end`，`message_end` 是最终权威 message。
- 安全取舍：显示 text delta 与 tool name/status；丢弃 `thinking_*`、`toolcall_*` argument delta、partialResult 和 raw result。

### Grok Build

- [Headless output formats](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)：`streaming-json` 是 type-tagged JSONL；公开事件含 `text/tool_call/tool_call_update/plan/usage/end/error`，`thought` 明确是 internal reasoning，`end` 总是最后事件。
- 安全取舍：显示 text、tool name/title/status、plan 安全标题；usage 只进入进度日志，thought/rawInput/rawOutput/content 不进入 UI。

### Gemini CLI

- [官方输出类型](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/output/types.ts)：`stream-json` 事件为 `init/message/tool_use/tool_result/error/result`；assistant message 可带 delta，result 提供 status/stats。
- 安全取舍：显示 assistant content、tool name/status 与 warning/error；不显示 parameters、tool output 或 token stats 内容。

### Antigravity

- 个人分支已按官方 `init/step_update/result` 契约实现并真实验证；本次只做跨 Provider 回归，不扩大事件字段。

## 不变量

1. 只显示协议公开事件，不显示隐藏 chain-of-thought。
2. 工具事件只显示名称和生命周期，不显示参数、文件内容或原始输出。
3. terminal 结果/状态和进程退出码保持权威；缺 terminal、失败 status、空结果或非零退出不得成功。
4. 已显示增量与 terminal 最终文本不得重复。
5. 原版 Web UI、loopback、非-lite 自动打开、session/resume 和 read-only 边界不退化。
6. 真实 Provider smoke、commit/push、release/publish、Harness 同步和全局安装继续分别授权。

## 阻塞问题

无。实现前只需按本任务最终规划重新获得 Boss 的执行批准。
