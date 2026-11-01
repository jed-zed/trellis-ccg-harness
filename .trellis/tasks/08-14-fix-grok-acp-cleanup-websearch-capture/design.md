# Design — Grok ACP cleanup error precedence and one-shot event capture

## Authority and Worktree Boundary

永久修改从个人 `jed-zed/ccg-gptpro-worflow` 的干净 `gptpro/main` worktree 开始。Harness 中的 `components/ccg-workflow/`、全局 npm 包和 Codex plugin cache 都是后续交付投影，不是编辑目标。

实施时先重新核验 remote URL、local `gptpro/main` ref、commit、tree、package version 和 clean status，再创建新的 `codex/fix-grok-acp-cleanup-error-precedence` worktree。当前带用户改动的 CCG/Harness checkout 全部只读保护。

## Existing Failure Flow

```text
ACP main operation
  -> main/protocol error may already exist
  -> finally
       stopChild() throws
       X stdout settle skipped
       X capture close/delete skipped
       X credential-home restore skipped
  -> outer finally
       release credential lease
  -> surfaced reason becomes cleanup error
```

当前 spawn catch 也有同样问题：capture deletion 失败会覆盖 spawn error，并阻止 credential-home restore。

## Error-Precedence Contract

在同一 `acp-client.mjs` 内使用一个最小 cleanup collector，不增加用户配置或公共 Provider 行为：

1. 主操作 catch 保存 `primaryError`，保持原 Error 对象和 message。
2. 每个 cleanup step 单独 `try/catch`，按顺序继续执行并收集 normalized cleanup errors。
3. 存在 `primaryError` 时，将 cleanup errors 作为非枚举内部诊断属性附加到该 Error，然后继续抛出同一个主 Error；`runner.failureText()` 因此仍输出真正主错误。
4. 不存在 `primaryError` 但 cleanup 失败时，抛出第一个 cleanup Error，并附加其余 cleanup errors；成功不得掩盖清理失败。
5. outer credential lease release 使用相同 contract。即使 inner cleanup 已失败，lease release 仍执行；release failure 只能作为次生诊断，不能覆盖已有主错误。

内部诊断属性不进入成功结果、canonical evidence 或公开 stdout。它只用于 focused tests 和必要的本地诊断。

## Cleanup Ordering and Invariants

```text
cancel session (best effort)
-> terminate child tree
-> settle pending stdout work
-> close exclusive capture handle
-> remove exclusive capture file
-> restore volatile credential-home snapshot
-> release credential-home lease
```

collector 只改变错误传播和“继续执行”的控制流，不改变：

- Windows `taskkill /PID <pid> /T /F` 与既有等待窗口；
- child exact environment、filesystem/terminal permission denial；
- raw byte/event/line caps、owner-only directory、symlink/junction/reparse rejection；
- browser OAuth/API-key separation、secret redaction；
- session close/cancel、timeout/abort 和 no-fallback 语义。

## Regression Design

复用 `src/utils/__tests__/grokIntelligenceAcp.test.ts` 的 fake ACP child，并为 `createGrokAcpClient()` 增加仅供内部/测试使用的 termination function dependency injection，默认仍为现有 `terminateChild`。

确定性用例：

- fake child 产生已知 primary protocol error；injected termination 先实际结束 child，再抛出 synthetic shutdown cleanup error；断言最终仍为 primary error。
- synthetic termination failure 后检查 raw capture 不存在、Grok persistent login/config 保留、volatile artifacts 恢复、lease path 不存在。
- 成功主路径搭配相同 synthetic cleanup failure，断言调用 fail closed 且 surfaced error 是 cleanup error。
- 保留现有 timeout/abort 进程树断言，并运行 projection parity。

不依赖真实时间竞争来制造测试失败，不延长生产 timeout，不增加 sleep-based flaky assertion。

## One-Shot Live Capture Design

真实捕获不是永久产品功能。创建任务本地 ignored diagnostic harness：

```text
exact failing task/plan/dependency bindings
-> runGrokIntelligence(config.max_retries = 0, force refresh)
-> injected runAcp wrapper
     -> patched createGrokAcpClient.run()
     -> receive already-redacted notifications
     -> select only correlated WebSearch tool_call/tool_call_update slice
     -> exclusive private temporary JSONL
-> normal runner normalization (may reproduce the error)
-> inspect field structure and compute SHA-256
-> delete private raw slice
-> retain structural summary only
```

捕获 harness 不复制 auth/token，不打印完整事件，不把 user prompt、agent prose、query text 或 source URLs 写入 tracked artifact。结构摘要只报告 field path/type/length/count/hash。

## Classification

| Evidence | Conclusion | Action in this task |
|---|---|---|
| completed WebSearch has no non-empty query anywhere relevant | `provider_empty_or_missing_query` | 保留 strict validator；报告 Provider malformed event |
| same correlated event has non-empty query in a different explicit field | `parser_schema_mismatch` | 报告 exact shape；停止，等待新的 parser-fix 授权 |
| failure occurs before capture or event does not recur | `not_reproduced_or_inconclusive` | 报告边界；不重试 |

## Authorized WebSearch Variant Follow-up

一次捕获已确认完成态 WebSearch action 有三种结构：搜索结果 `query/sources/type`、URL `type/url`、Pattern `pattern/type/url`。解析器只在 action 具有 URL 或 Pattern 辅助动作结构且不具有 search-result 字段时走辅助分支：

- 该 call 仍记为 completed，避免 correlation 完整性误报；
- 原始通知保留在现有 `unknownEvents`，不新增公共事件类型；
- 不写入 `events` 或 `searches`，因此不伪造搜索证据；
- 其余 action 继续进入既有严格校验，实际搜索结果的空/缺失 query 或非数组 sources 仍 fail closed。

修复只改共享 normalization 根因和两份 byte-identical projection，不增加配置、fallback、重试或第二次 Provider 调用。

## Security and Privacy

- Official Grok CLI ACP only; one model invocation; no fallback.
- Existing isolated credential home and exact environment remain authoritative。
- Private capture uses exclusive create、owner-only/0600、bounded bytes/events。
- Raw slice is local and transient；final response、Trellis tracked artifacts、Git、memory 只接收 structural summary。
- Credential、token、authorization header、raw prompt/response 永不输出。

## Rollback

- 永久 source change 尚未 commit 时：只反向应用两份 ACP projection 和 focused test hunks。
- 若 focused/full/security gate 失败：停止在干净 source worktree，保留可审查 diff，不同步 Harness、不安装。
- one-shot harness 与 private raw slice 是 ignored transient evidence；分析后删除，不成为产品 rollback 项。
- 发布、Harness sync、安装若未来获批，必须使用正常 source revert 与 supported Harness transaction；禁止手改 cache 回滚。
