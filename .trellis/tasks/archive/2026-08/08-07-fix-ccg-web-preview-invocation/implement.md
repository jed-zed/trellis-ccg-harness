# 实施计划：修复 CCG 全 Provider 自动网页预览与中间输出

**状态**：已完成；个人源 PR #35 与 Harness PR #37 已合并，preset、全局安装、PR/main CI 门禁已完成；npm 公共发布取消，Pi 真实登录验收延期  
**权威任务**：`.trellis/tasks/08-07-fix-ccg-web-preview-invocation/`  
**职责 Providers**：`frontend=antigravity`、`backend=grok`、`search=grok`、`product-manager=claude`  
**外部证据**：`.ccg/tasks/fix-ccg-web-preview-invocation/frontend-antigravity-response.txt`、`backend-grok-response.txt`、Grok route evidence  
**伴随状态**：`searchStatus=invoked`；`productManagerStatus=unavailable`（Harness 在调用前因 expected CCG `3.4.5` / installed `3.4.6` 漂移而 fail closed；未调用 Claude）

## 1. 决策摘要

- 复用现有 Gemini helper、`ccg wrapper` 和 Go Web UI；不新增 dispatcher 或路径解析。
- 把直接分发 Skills 的模糊“existing adapter”改成可执行的非-lite、stdin、只读 wrapper 命令。
- 在 wrapper 增加显式 `--read-only`，防止自动 Grok/Antigravity 辅助调用写真实工作区。
- 现有 PR 已让 SSE 回放累计字符串；新增范围升级为当前会话 typed history 与会话内 SSE ID/`Last-Event-ID`，但仍不建设持久事件库或跨进程确认协议。
- Antigravity 固定使用官方 `stream-json`，采用专用 parser，不改其他 Provider 的统一 parser。
- Claude frontend/backend 使用同一非-lite wrapper 预览，但受管调用只允许经校验的本机原生程序与 Read/Glob/Grep-only 参数；不复用产品经理状态机。
- Claude、Pi、Grok、Gemini 分别解析其官方公开中间事件；不把不同 schema 强塞进一个通用事件抽象，也不展示 thought/thinking、工具参数或原始工具输出。
- WebServer 额外保存当前会话的 typed `ContentEvent` history，使浏览器晚连或断线重连时仍按类型/顺序显示缺失过程；不增加持久化或跨进程确认协议。
- Trellis 是唯一计划权威；不创建 `.codex/ccg/plans`。

## 2. WBS

### A. 隔离基线与失败回归（3 点）

**权威源**：个人 CCG 新隔离 worktree（从实施时 clean `main` 创建）

- [x] **A.1** 经 Boss 授权后创建 `codex/fix-ccg-web-preview-invocation` worktree；确认 clean、remote、package/wrapper 当前版本与 user dirty checkout 隔离。
- [x] **A.2** 先加失败测试：直接分发 Skills 缺少确定 wrapper 命令、Grok 通用分析能越权写入、Antigravity args 无 stream-json、SSE 完成后连接只见 done。
- [x] **A.3** 固化官方 Antigravity `init/step_update/result` 最小 fixture；不记录凭据或真实 prompt 内容。

### B. Provider 只读与自动调用契约（6 点）

**主要文件**：`codeagent-wrapper/config.go`、`backend.go`、`executor.go`、`plugins/ccg/rules/ccg-role-routing.md`、相关 Skills

- [x] **B.1** 增加并解析 `--read-only`，贯穿 `Config`/`TaskSpec`/backend args；普通未带 flag 的手工 wrapper 兼容不变。
- [x] **B.2** Antigravity read-only 复用现有 sandbox/plan 参数；Grok read-only 复用禁写 env 与 no-tools/no-MCP/no-memory/no-subagents 参数；Pi 保持现有 read-only 工具集合。
- [x] **B.3** 在 `ccg-executor` 定义唯一 Provider Launch Contract；prompt 经 stdin，默认不加 `--lite`。
- [x] **B.4** 更新 `ccg-plan`、`ccg-execute`、`ccg-review`、`ccg-analyze`、`ccg-frontend`、`ccg-backend` 的直接分发文字；保留 Grok/Antigravity 特殊 review 路径。
- [x] **B.5** 验证 wrapper missing、Provider start failure、empty response 和 forbidden tool 均明确失败，无 fallback。
- [x] **B.6** 允许 frontend/backend 路由选择 Claude；受管 shim 传递已验证的原生可执行文件，Go wrapper 的 read-only Claude 参数禁写、禁 MCP、禁持久会话且不使用危险权限跳过。

### C. Antigravity 结构化中间事件（5 点）

**主要文件**：`codeagent-wrapper/backend.go`、`executor.go`、`parser.go`、focused tests

- [x] **C.1** `buildAntigravityArgs` 固定加入 `--output-format stream-json`，保持 `-p`、`--conversation`、`--add-dir` 顺序契约。
- [x] **C.2** 增加专用 `parseAntigravityStream`，复用行长度限制、日志和 callbacks。
- [x] **C.3** 映射 conversation/session、response delta、公开 tool/checkpoint/subagent 摘要和 terminal result；实现前缀补尾去重。
- [x] **C.4** status failure、无 terminal、无 response、损坏关键行返回真实错误；不降级纯文本。
- [x] **C.5** `executor.go` 删除 Antigravity plain Scanner 分支，其他 Provider parser 零行为改动。

### D. SSE 历史回放（2 点）

**主要文件**：`codeagent-wrapper/server.go`、`server_test.go`

- [x] **D.1** 在 `handleStream` 注册锁内入队累计 content，再按需入队 done；后续 live event 沿用现有 channel。
- [x] **D.2** 测试运行中晚连、完成后晚连、空内容完成、请求取消；断言 history-before-live/done。

### E. 验证、发行与 Harness 同步（5 点）

- [x] **E.1** 运行个人源 focused TypeScript/Go tests，再运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`go test -short ./...`、`go build ./...`。
- [x] **E.2** 运行 CCG change/quality/security gates；change 与 quality 通过，37 个本任务变更文件使用同一 security rules 扫描为 Critical/High 零。全仓扫描仍有 9 个未修改基线 High，均不在本任务 diff；外部 intelligence route 为 disabled/skipped、exit 0 且未联网调用。
- [x] **E.3** 个人源版本、wrapper preset/digest、manifests/CHANGELOG、commit/push 与 GitHub release 已完成：PR #35 合并为 `a0d735c`，main CI run `31317029373` 与六平台 preset run `31317029370` 全绿，preset release 含六个平台资产。Boss 随后明确取消 npm 公共发布，因此 npm 不再是本任务交付项。
- [x] **E.4** 从 clean 合并提交 `a0d735c` 同步 Harness；提交 `593d2f8` 已由 PR #37 合并为 `66da149`。Node 22 下 source equality、CCG lint/typecheck/test/build、Harness tests、doctor/conflicts 及 Go test/build 全部通过；PR CI run `31320170275` 与 merge 后 main CI run `31323797234` 的 10 个 macOS/Ubuntu/Windows、Node 20/22 与 Go 检查均全绿。本机 Node 24 的进程锁/硬终止计时失败经相同代码在 CI 对齐的 Node 22 下排除为快照回归。
- [x] **E.5** 已安装全局 `ccg 3.4.8`、Codex plugin `3.4.8+codex.1` 与 wrapper `5.12.8`；`ccg doctor --platform codex` 通过，安装前后四角色路由不变，未调用 Provider、未改变登录态。Pi 真实复测由 H.3 单独保持延期。

### F. 全 Provider 公开中间事件（7 点）

**主要文件**：`codeagent-wrapper/backend.go`、`parser.go`、`main_test.go`、Gemini preview helper 与测试

- [x] **F.1** Claude 启动参数加入 `--include-partial-messages`；fixture 先证明当前 parser 会忽略 `stream_event`。
- [x] **F.2** Claude 解析 assistant `text_delta`、安全 tool lifecycle 与 `system/api_retry`；以 terminal `result` 为最终权威并做前缀补尾，EOF 后再发送 complete。
- [x] **F.3** Pi 解析 `message_update.assistantMessageEvent.text_delta` 与 `tool_execution_start/update/end`；`message_end` 校验/补尾、`agent_end` 完成，丢弃 thinking、参数和原始结果。
- [x] **F.4** Grok 保留 `text`，增加安全的 `tool_call`/`tool_call_update`/`plan` 映射；继续丢弃 `thought`，保持 `end`、review evidence 和 forbidden-tool fail-closed。
- [x] **F.5** Gemini helper 显示 assistant delta、tool use/result 与 warning/error 安全摘要；`result.status`、响应文件和退出码保持权威。
- [x] **F.6** 为 Claude/Pi/Grok/Gemini 各加最小 fixture，断言至少一个 terminal 前 UI callback、最终文本恰好一次、未知事件有界、失败/缺 terminal 不成功。
- [x] **F.7** 回归 Antigravity 既有 `step_update`/result、Codex parser 与全部 session/resume 行为，禁止为统一测试重写已工作的 backend。

### G. Typed SSE 晚连接回放（2 点）

**主要文件**：`codeagent-wrapper/server.go`、`server_test.go`

- [x] **G.1** `SessionState` 在保留累计 `Content` 的同时记录不序列化的 typed `ContentEvent` history；`SendContentWithType` 在同一锁内追加历史并广播。
- [x] **G.2** `handleStream` 逐条回放 history 后再接 live/done；测试 message/command/reasoning 混合顺序、完成后晚连和内容恰好一次。

### H. 新范围验证与 PR 更新（5 点）

- [x] **H.1** 先运行 Claude/Pi/Grok/Antigravity parser、server 和 Gemini helper 聚焦测试，再运行个人源完整 Node/Go 门禁与 `git diff --check`。
- [x] **H.2** 运行 CCG change/quality/security gates，重点检查 raw tool payload、隐藏 reasoning、terminal 错误、SSE loopback 和命令参数边界。
- [x] **H.3** 经 Boss 单独授权后，在任务临时 `CODEX_HOME` 逐个切换 backend 做真实工作流验收；每轮恢复路由、核对全局配置 hash、进程和端口。Gemini、Claude、Antigravity、Grok 均通过；Pi 因缺少 API key 明确失败，Boss 已明确延期其登录与复测并将其移出本任务完成门，不伪报 Pi 通过。
- [x] **H.4** 已确认 `3.4.8`/wrapper `5.12.8` 尚未发布，保留版本并用提交 `ec86afd` 刷新六平台 wrapper digest；GitHub Actions run `31316205217` 的六平台构建/摘要校验和 run `31316207827` 的 PR 矩阵全部通过。
- [x] **H.5** Boss 已授权并完成 GitHub 交付：个人源 PR #35 合并为 `a0d735c`，main CI 与六平台 preset 全绿；Harness 同步提交 `593d2f8` 已由 PR #37 合并为 `66da149`。全局 runtime/plugin 已安装并通过 doctor；npm 公共发布经 Boss 明确取消。

### I. 联合审查高/中风险修复（5 点）

**授权**：Boss 已批准直接复用本任务修复 3 High + 2 Medium，不创建重复任务。  
**主要文件**：`codeagent-wrapper/{server,executor,parser}.go`、相关 Go tests、Gemini preview helper 与测试

- [x] **I.1 High** 以会话 history + 唤醒通知替换会丢包的有限事件 channel，保证回放期间/慢客户端不丢 live 与 terminal `done`。
- [x] **I.2 High** terminal response 与已显示文本不一致时发送 `replace_message`，使 Go Web UI、Gemini Live Output、CLI 返回值和 response file 使用同一权威文本。
- [x] **I.3 High** 把 Web session 收束延后到最终 `TaskResult` 分类，terminal event 携带真实成功/失败和 exit code；失败不显示成功或自动关闭。
- [x] **I.4 Medium** Gemini helper 保存当前进程内的 typed event history，晚连接按原顺序收到内容与 terminal。
- [x] **I.5 Medium** Go wrapper 与 Gemini helper 发出 SSE `id:` 并消费 `Last-Event-ID`，断线重连只补缺失事件。

## 3. 关键文件

| 文件 | 动作 | 目的 |
|---|---|---|
| `codeagent-wrapper/config.go` | 修改 | `--read-only` 配置贯穿 |
| `codeagent-wrapper/backend.go` | 修改 | Provider 只读参数、Antigravity stream-json |
| `codeagent-wrapper/executor.go` | 修改 | 只读 env、Antigravity parser 路由 |
| `codeagent-wrapper/parser.go` | 修改 | 保留 Antigravity 专用解析，并补 Claude/Pi/Grok 公开事件、terminal 去重与失败语义 |
| `codeagent-wrapper/server.go` | 修改 | typed SSE history-before-live/done |
| `codeagent-wrapper/backend_test.go`、`main_test.go`、`server_test.go`、Antigravity parser test | 修改 | 每 Provider terminal 前事件与历史回放回归 |
| `plugins/ccg/rules/ccg-role-routing.md` | 修改 | 自动调用与只读契约 |
| `plugins/ccg/skills/ccg-{executor,plan,execute,review,analyze,frontend,backend}/SKILL.md` | 修改 | 确定的 Provider 调用动作 |
| `plugins/ccg/skills/ccg-gemini-preview/SKILL.md`、Gemini helper | 修改 | 工具层后台生命周期、Windows 快照清理及 tool/error 公开状态 |
| `src/utils/model-routing.ts`、`src/commands/wrapper.ts` | 修改 | Claude frontend/backend 路由与可信原生程序传递 |
| `src/utils/__tests__/pluginParity.test.ts`、`wrapper.test.ts`、routing tests | 修改 | Skill/shim/路由契约 |
| package/plugin manifests、`CHANGELOG.md`、preset digest | 已修改 | 新版本一致性 |
| `components/ccg-workflow/**`、`harness.sources.json` | 已同步并合并 | Harness source equality；commit `593d2f8` / PR #37 / merge `66da149` |

## 4. 验证命令

个人 CCG 权威源：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
Push-Location codeagent-wrapper
go test -short ./...
go build ./...
Pop-Location
```

Harness 同步后：

```powershell
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
Push-Location components/ccg-workflow/codeagent-wrapper
go test -short ./...
go build ./...
Pop-Location
```

## 5. 显式授权门

1. 当前：先由独立任务/授权消除 Harness expected CCG `3.4.5` 与 installed `3.4.6` 漂移；之后 Claude 产品经理 `PLAN_REVIEW` 仍需逐次授权。
2. 实施开始：新 worktree/branch 与产品代码写入授权。
3. 个人源 commit、push、release/npm publish。
4. Harness 快照同步、commit、push/PR。
5. 全局 runtime/plugin 安装与真实 Provider smoke。

任何前一门授权不自动覆盖后一门。

本轮新增范围、个人源 GitHub 发布、Harness 同步/合并和全局安装均已分别获批并按门执行。Boss 明确取消 npm 公共发布，并延期 Pi 登录与复测；两者均不再是本任务完成门，且未改变任何 Provider 凭据。

## 6. 回滚

1. 实现未提交：删除任务隔离 worktree，个人主 checkout 不变。
2. wrapper/Skill 提交后未发布：revert 任务提交；不更新 digest/manifests。
3. 新 release 出错：保留旧 package/preset；Codex-mode transaction 恢复旧 binary。
4. Harness 未同步：保持旧 `harness.sources.json`；已同步则以单独 revert 恢复上一 clean tree。
5. 本机安装失败：用安装前 ownership/transaction 备份恢复旧 runtime，不触碰 Provider 登录态。

## 7. 真实 Provider smoke 与最终门禁证据

- 早期真实 smoke 使用隔离 worktree 构建的 wrapper 与仓库内 Gemini helper；完成验收后已按独立授权安装全局 `ccg 3.4.8`、plugin `3.4.8+codex.1`、wrapper `5.12.8`。`ccg doctor --platform codex` 通过，Provider 调用前后未发现模型写入真实工作区。
- Antigravity `agy 1.1.11`：Web UI `http://127.0.0.1:49332`，session `13182b09-925c-424e-a312-b0bf4edca534`；在最终 `ANTIGRAVITY_LIVE_SMOKE_OK` 前真实收到 user、agent、tool、checkpoint 等 progress 事件，exit 0。
- Grok `0.2.118`：首次真实调用 fail closed，错误为 `skip_read_before_edit=false requires a Read tool in the toolset`；共同根因是 `search_replace` 未列入禁用工具。补一项禁用参数和回归断言后，Web UI `http://127.0.0.1:56917`，session `019fe04e-b1a6-7b90-983c-1d38330fb008`，返回 `GROK_LIVE_SMOKE_OK`，exit 0。
- Gemini：真实 `--detach` 调用虽成功打开预览端口，但 Codex 工具宿主在父命令退出时回收完整后代进程树；Win32 检查确认工具命令处于 Job Object，breakaway 诊断进程也会被宿主回收。因此按原版 CCG 形式把自动 Skill 契约改为“前台 helper 命令运行在 tool-managed background job”，Codex 工作流禁止传 `--detach`。用该契约真测时浏览器打开 `http://127.0.0.1:63981`，1 文件/388 bytes 快照，返回 `GEMINI_LIVE_FOREGROUND_OK`，helper exit 0，快照已删除。
- Gemini 首次前台真测暴露 Windows 临时锁会让 `TemporaryDirectory.cleanup()` 覆盖成功退出码；增加 5 次有界 `PermissionError` 重试，仍失败则继续明确报错。聚焦回归先红后绿。
- 最终个人源门禁：Node lint/typecheck/build 通过，`597 passed / 3 skipped`；Go test/vet/build 通过；`git diff --check` 通过。CCG change/quality/security gates 通过，最终 Claude shim/config 复扫为 Critical/High/Medium/Low 全零。Harness 同步后又完成 source equality、doctor/conflicts、`601 passed / 3 skipped`、Harness `452 passed / 3 skipped` 与 Go test/build。
- 发行交付：package/marketplace `3.4.8`、Codex plugin `3.4.8+codex.1`、wrapper `5.12.8` 已对齐；PR #35 合并为 `a0d735c`，main CI run `31317029373` 和 preset run `31317029370` 全绿，六个平台资产已发布到 GitHub `preset` release。npm 公共发布经 Boss 明确取消。

### 隔离临时路由的真实 `/ccg:execute` 入口验收（2026-08-08）

- 使用个人源提交 `6001a3e` 的 `ccg 3.4.7`、受信任 `codeagent-wrapper 5.12.7` 和任务 worktree 内已忽略的临时 `CODEX_HOME`；临时 `search=codex`、`product-manager=codex`，因此每轮只会调用当前 backend Provider。真实全局配置 SHA-256 在每轮前后均为 `fb530be1d54507b4ced7101e367bdcd0ca28931e31586baa1045cdfe36c50c01`，全局路由保持 `frontend=antigravity`、`backend=grok`、`search=grok`、`product-manager=claude`。
- 顶层 `ccg route --workflow execute --phase intake` 使用规范 `.ccg/tasks/<id>/...` 证据路径返回 `enabled=false`、`status=skipped`、exit 0，未额外联网。
- Gemini：临时 `backend=gemini` 后由 bundled foreground preview helper 自动打开 `http://127.0.0.1:60276/`，`CCG_GEMINI_BROWSER_OPENED=1`；只复制 1 文件/166 bytes 快照，返回 `GEMINI_WORKFLOW_ENTRY_OK`、exit 0，响应非空且快照已删除。
- Pi：临时 `backend=pi` 后由非-lite read-only wrapper 自动打印 Web UI `http://127.0.0.1:65378`；Provider 明确返回 `No API key found for the selected model`、exit 1。未安装、未登录、未重试登录，因此只证明自动预览入口，不能宣称真实响应成功。
- Antigravity：临时 `backend=antigravity`；首轮 Web UI `http://127.0.0.1:55414` 在 terminal 前持续收到 `user_input`、`agent_response`、`error_message`、`checkpoint`，最终因上游 retryable network error 退出 1；同一请求唯一一次重试在 `http://127.0.0.1:54771` 收到 `agent_response ACTIVE -> DONE`、`checkpoint` 后返回 `ANTIGRAVITY_WORKFLOW_ENTRY_OK`、exit 0。
- Grok：临时 `backend=grok` 两次分别自动打印 Web UI `http://127.0.0.1:57601` 与 `http://127.0.0.1:64791`；模型均试图 inspect，read-only wrapper 禁止工具后以 stop reason `cancelled`、exit 1 fail closed。没有放宽权限或伪造成功，只证明自动预览入口与只读阻断有效。
- Codex backend 恢复为临时默认并由当前 Codex 直接处理，不启动外部网页。该轮把 Claude 排除为普通 backend 的结论已被 Boss 明确纠正，不能作为最终验收；其余六个 preview 端口关闭、测试 PID 退出和工作区 clean 证据仍有效。

### Claude 独立 Provider 补充验收（2026-08-08）

- [x] 在已忽略的临时 `CODEX_HOME` 真实复现当前 `3.4.7` 的双重阻断：`routing set backend claude` 报 role 不支持，`ccg wrapper --backend claude` 报仅限 product-manager；临时配置 SHA-256 前后不变。
- [x] 核验 `CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE` 指向本机原生 `claude.exe 2.1.220`，并确认当前 CLI 提供 safe mode、工具 allowlist、空 MCP、无 session/browser/settings 等只读参数。
- [x] 更新任务合同、routing、shim、Go backend 与 Skills；聚焦回归和完整个人源质量/安全门均通过。
- [x] 在任务内临时 `CODEX_HOME` 将单一 backend 路由切到 Claude，经真实 `/ccg:execute` 分发形状调用本机 `claude.exe 2.1.220`：自动打开 Web UI `http://127.0.0.1:62152`，session `af4c4ac6-3c93-4793-a1b9-98f384a052f0`，返回 `CLAUDE_WORKFLOW_ENTRY_OK`、exit 0；fixture 与全局配置 SHA-256 不变，临时 backend 已恢复为 `codex`，无残留进程/端口。
- [x] 最终 `5.12.8` 构建产物再以 fake Claude 验证只读 argv、Web UI `http://127.0.0.1:54639`、stdin、stream-json 与 exit 0；PID `32856` 和端口均已回收。

### 全 Provider 中间事件新增验收（真实验收已执行，Pi 仍被认证阻断）

- [x] 离线 fixture/门禁：Claude、Pi、Grok、Gemini 均在 terminal 前产生安全 UI callback，Antigravity/Codex/Grok review 回归通过；typed history 按 `message/command/reasoning` 顺序回放。Node lint/typecheck/build、`599 passed / 3 skipped`、Go test/vet/build、`git diff --check` 全绿；CCG change/quality/security 通过，本次 8 个变更文件 Critical/High/Medium/Low 全零，external route 三次均 disabled/skipped、exit 0。
- [x] Claude：真实工作流自动打开 Web UI `http://127.0.0.1:64469`；terminal 前 `/api/sessions` 已有安全 `Glob`/`Read` 工具生命周期且 `done=false`，最终 `CLAUDE_INTERMEDIATE_LIVE_OK`、exit 0。
- [ ] Pi：真实工作流自动打开 Web UI `http://127.0.0.1:54380`，但 Provider 返回 `No API key found for the selected model`，随后缺少 terminal `agent_end`、exit 1；未登录失败不算通过，也未改凭据。
- [x] Grok：真实工作流自动打开 Web UI `http://127.0.0.1:53008`；SSE 连续发送 `message` 增量，最后才 `done=true`，最终 `GROK_INTERMEDIATE_LIVE_OK`、exit 0；未显示 `thought`。
- [x] Gemini：真实 foreground helper 自动打开 Live Output `http://127.0.0.1:63971/`；SSE 在 `done` 前收到三段 assistant delta，raw stream 另确认 tool use/result 在 terminal 前，最终 `GEMINI_INTERMEDIATE_LIVE_OK`、exit 0，snapshot 已删除。
- [x] Antigravity：本轮真实工作流自动打开 Web UI `http://127.0.0.1:53168`；SSE 先收到安全 tool ACTIVE/DONE、checkpoint 和 assistant message，最后才 `done=true`，最终 `ANTIGRAVITY_INTERMEDIATE_LIVE_OK`、exit 0。
- [x] 浏览器晚连：fake E2E 证明 typed history 按产生顺序回放，再收到 `done`。

### 联合审查 3 High + 2 Medium 修复验收（2026-08-09）

- [x] Go SSE 以 history 为传输权威、容量 1 channel 仅作唤醒；阻塞客户端期间连续写入 110 条 live 内容再结束，最终收到 110 条内容和唯一 `done`，无旧 100-buffer 丢包。
- [x] Go wrapper 与 Gemini helper 均发出会话内递增 `id:` 并按 `Last-Event-ID` 只回放缺失事件；Gemini 使用真实 loopback HTTP SSE 测试验证 CRLF/LF 均可消费。
- [x] Claude、Pi、Antigravity 与 Gemini terminal divergence 均发送 `replace_message`；页面只替换 assistant 文本，保留 task、command 与 reasoning。
- [x] Go Web session 在最终 `TaskResult` 返回前统一收束；Pi parser 失败回归证明 terminal 携带 `status=failed` 与真实 exit code，失败页不通知、不自动关闭。
- [x] 最终门禁：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`601 passed / 3 skipped`；`go test -short -count=1 ./...`、`go vet ./...`、`go build ./...` 与 `git diff --check` 均通过。`go test -race` 因本机未启用 CGO 且无 GCC 无法运行；对应并发回归已额外连续运行 50 次通过，未安装编译器或修改全局环境。

## 8. Trellis 交接

Boss 已批准并完成本任务最终 GitHub 交付范围：Gemini、Claude、Antigravity、Grok 的真实中间输出 smoke 已通过；Pi 认证 smoke 明确延期且不伪报通过。联合审查的 3 High + 2 Medium 已完成修复与门禁；个人源 PR #35 合并为 `a0d735c`，main CI、六平台 preset 与 GitHub release 全绿。Harness 提交 `593d2f8` 已由 PR #37 合并为 `66da149`，PR CI run `31320170275` 与 main CI run `31323797234` 均全绿；全局 runtime/plugin 已安装且 doctor 通过，路由未改变。Boss 明确取消 npm 公共发布；任务已满足最终批准范围，可以归档。
