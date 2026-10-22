# 原版 CCG 与 Antigravity 官方契约

## 原版 CCG 行为

原版的可复用部分是 wrapper 形态，不是另造预览系统：

- 非 lite 时，每个任务启动 WebServer、注册 session，并自动打开浏览器；`--lite` 明确表示更快且无 Web UI。
- WebServer 绑定随机本地端口、打印 Web UI URL，通过 SSE 发送 `content/content_type/done`。
- 工作流模板用后台 `codeagent-wrapper --progress --backend <provider> ...` 调用，并通过 session ID 支持恢复。

官方源码：

- <https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/main.go#L31-L35>
- <https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/executor.go#L832-L847>
- <https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/server.go#L50-L135>
- <https://github.com/fengshao1227/ccg-workflow/blob/main/templates/commands-legacy/workflow.md#L219-L277>

## 原版 Antigravity 适配的边界

原版当前源码仍使用 `agy ... -p <prompt>` 与纯文本 Scanner；CCG changelog 把它描述为“line-by-line streaming to Web UI”且明确“no JSON streaming”。这能解释原版设计意图，但不是当前 CLI 最可靠的中间事件契约。

- <https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/backend.go#L108-L137>
- <https://github.com/fengshao1227/ccg-workflow/blob/main/codeagent-wrapper/executor.go#L1026-L1064>
- <https://raw.githubusercontent.com/fengshao1227/ccg-workflow/main/CHANGELOG.md#L98-L115>

## Antigravity 官方 headless 契约

Antigravity 1.1.8 起提供 strongly typed NDJSON `stream-json`：

1. 一次 `init`；
2. 零个或多个 `step_update`；
3. 恰好一个终止 `result`。

`step_update` 的 `step_type` 包括 agent response、tool、checkpoint 等，状态为 ACTIVE/DONE；agent response 可产生多个 ACTIVE 文本增量，工具与 subagent 有结构化信息。stdout 用于协议事件，诊断/错误走 stderr，失败应非零退出。

- <https://antigravity.google/docs/cli/headless#L67-L104>
- <https://antigravity.google/docs/cli/headless#L220-L296>
- <https://raw.githubusercontent.com/google-antigravity/antigravity-cli/main/CHANGELOG.md#L41-L58>

## 版本与兼容判断

- 本机 `agy --version` 为 `1.1.11`，高于引入 `stream-json` 的 1.1.8。
- 官方 issue 记录过旧版本在 non-TTY 下零输出/挂起；后续 changelog 声称已修复。不能把旧 issue 当成 1.1.11 当前故障证明。
- 本任务无需兼容旧于受支持协议的 CLI，也不添加静默纯文本 fallback；doctor/启动失败应明确报告版本或协议错误。

相关 issue：

- <https://github.com/google-antigravity/antigravity-cli/issues/76>
- <https://github.com/google-antigravity/antigravity-cli/issues/318>

## 设计结论

“参考原版 CCG”落在三点：复用 wrapper、默认非 lite 自动开页、沿用 session/SSE 生命周期。Antigravity 输出解析则采用当前官方 `stream-json`，这是为满足“真实中间输出”而做的有证据升级，不照搬原版已过时的纯文本假设。

