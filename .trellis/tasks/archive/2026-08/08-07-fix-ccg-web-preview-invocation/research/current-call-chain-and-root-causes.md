# 当前调用链与根因取证

## 取证基线

- Harness 验证快照：`components/ccg-workflow`，由 `harness.sources.json` 绑定个人 CCG。
- 当前干净个人源基线：`I:\ai\ccg-gptpro-worflow-route-timeout-publish`，`ccg/3.4.6`。
- 本机运行时：`ccg/3.4.6`、`agy 1.1.11`。
- 本任务只规划；未修改个人 CCG 产品代码。

## Provider 与预览入口

| 角色/Provider | 既有入口 | 默认网页行为 | 当前缺口 |
|---|---|---|---|
| `codex` | Codex 主代理直接处理 | 不适用外部预览 | 无 |
| `gemini` | `invoke_gemini_preview.py` | helper 启动 loopback 预览并开浏览器 | Skill 有精确命令，但 plan/execute/review 顶层表述不一致 |
| `antigravity` | `ccg wrapper --backend antigravity ...` | 非 `--lite` 时 wrapper 开网页 | plan 只写“existing adapter”；输出仍按纯文本逐行读 |
| `grok` | `ccg wrapper --backend grok ...` | 非 `--lite` 时 wrapper 开网页 | plan/execute 顶层缺少确定命令；review 有额外绑定目标契约 |
| `pi` | `ccg wrapper --backend pi ...` | 非 `--lite` 时 wrapper 开网页 | plan/execute 顶层缺少确定命令 |

关键证据：

- `src/commands/wrapper.ts:14-82` 已提供稳定 shim，校验 Provider、解析受管理 wrapper，并用 `stdio: inherit` 原样转发；现有测试断言不注入 `--lite`。
- `plugins/ccg/rules/ccg-role-routing.md:41-47` 已规定 Antigravity/Grok/Pi 使用 `ccg wrapper`，默认保留 Web UI。
- `plugins/ccg/skills/ccg-executor/SKILL.md:103-112` 有确定 wrapper 规则；`ccg-plan/SKILL.md:101-108`、`ccg-execute/SKILL.md:23-25` 与 `ccg-review/SKILL.md:27-30` 仍以“existing adapter”代称。
- Gemini helper 的 `start_server` 绑定 loopback、打印 URL 并调用浏览器 opener；它不是当前 Go wrapper 的调用者。

## wrapper 数据流

```text
Skill
  -> Gemini: invoke_gemini_preview.py
  -> Antigravity/Grok/Pi: ccg wrapper --backend <provider>
       -> pinned codeagent-wrapper
       -> non-lite WebServer 127.0.0.1:0 + openBrowser
       -> StartSession
       -> provider stdout parser
       -> SendContentWithType
       -> SSE /api/stream/<session>
       -> browser Live Output
```

## 已确认根因

### 1. 工作流调用规范不够机械

底层 `ccg wrapper` 和 Gemini helper 均已存在且能自动开页；不需要新启动器。缺口位于顶层 Skill：不同命令对非 Gemini Provider 使用模糊代称，模型容易没有实际执行明确的 wrapper 命令。最小修复是让 plan/execute/review 直接复用 executor 中已有的确定调用契约与命令形状，不新增运行框架。

### 2. SSE 晚连接竞态

- `server.go:175-199` 把内容累计到 `SessionState.Content`，同时只广播给当时已连接的 client。
- 页面在 `server.go:379-402` 先轮询 session，再建立 EventSource。
- `server.go:493-527` 注册新 client 后明确“不发送历史内容”；若任务已结束只发送 `done`。

因此 Provider 在浏览器连接前输出的内容必然丢失；快速完成时页面可只看到完成状态。这是所有 wrapper-backed Provider 的共同根因。

### 3. Antigravity 仍走纯文本分支

- `backend.go:143-171` 只构造 `agy ... -p <prompt>`，未请求 `stream-json`。
- `executor.go:1149-1190` 将 Antigravity 特判为纯文本，`bufio.Scanner` 只有在 CLI 产生换行后才能发内容。
- 本机 `agy 1.1.11` 已支持官方 `stream-json`；结构化 `step_update` 才能稳定提供文本、工具、checkpoint、subagent 等中间状态。

## 假设与非根因

- CLI 是否将纯文本整段缓冲：可能加重静默，但无需继续依赖该行为；切换官方事件协议后可消除这项不确定性。
- 100 容量 client channel 满后丢事件：代码上存在，但没有本次复现证据；本任务不扩展为背压重构。
- 新建统一 Provider dispatcher：无必要，现有 Gemini helper 与 `ccg wrapper` 已覆盖入口。
- 改路由默认值、自动 fallback、重做 Web UI：与根因无关，不做。

## 计划中的最小回归点

1. Skill 契约测试：plan/execute/review 对 Gemini 给 helper 命令，对 Antigravity/Grok/Pi 给 `ccg wrapper --backend <provider>`；默认不出现 `--lite`。
2. SSE 测试：先写内容/结束会话，再连接 stream，断言历史内容先于 `done`。
3. Antigravity 参数与 parser fixture：断言 `--output-format stream-json`；覆盖 `init`、ACTIVE/DONE `step_update`、tool/subagent、成功/失败 `result`。
4. 保留现有 loopback、browser opener、stdio/exit code、显式 `--lite` 测试。

## 现场调用证据

- Antigravity 计划分析：`.ccg/tasks/fix-ccg-web-preview-invocation/frontend-antigravity-response.txt`，非空；stderr 记录 `Web UI: http://127.0.0.1:64555`。
- Grok 计划分析：`.ccg/tasks/fix-ccg-web-preview-invocation/backend-grok-response.txt`，非空；stderr 记录 `Web UI: http://127.0.0.1:50062` 与 session ID。

Grok 调用暴露了额外安全事实：通用 backend 参数使用 `--always-approve`，Provider 无视“禁用工具/写入”的 prompt，创建了 task research、修改 PRD 并创建平行 CCG plan。Codex 已删除这些越权产物，只保留 ignored `.ccg` 响应作为不可信证据。其“wrapper 不在 PATH 是主因”结论被本地 `ccg wrapper` 成功调用及 `src/commands/wrapper.ts` 否定；其 Antigravity stream-json 与 SSE no-replay 判断经源码独立验证后采纳。

产品经理离线状态已同步为 plan revision 1；`PLAN_REVIEW` 在 Provider 调用前被 Harness 拒绝：仓库 `harness.sources.json` expected CCG `3.4.5`，installed runtime 为 `3.4.6`。因此本次 `productManagerStatus=unavailable`，没有 Claude 网络/付费调用，也没有用旧 runtime 或直接 snapshot 绕过一致性门。
