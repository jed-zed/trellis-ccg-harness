# Fix Grok ACP cleanup and capture WebSearch events

## Goal

修复个人 CCG 权威源码中的 Grok ACP 清理路径，使清理异常不再覆盖真正的业务/协议错误，并保证同一轮剩余清理步骤继续执行；随后只运行一次无自动重试、无 Provider fallback 的真实 Grok ACP 调用，取得足以判断 WebSearch action variant 的私有、脱敏、结构保持事件切片，并按后续明确授权修复已确认的 parser schema mismatch。

## Confirmed Facts

- 2026-08-14 的真实失败包含两个不同症状：第一次为 `ACP child did not terminate after forced shutdown`；第二次为 `WebSearch ... query must be a non-empty string`。
- 外层任务不是空字符串。失败路由记录的任务长度为 5163 字符；第二个错误来自完成态 WebSearch 工具事件的 `rawOutput.action.query` 校验。
- 当前 CCG `3.4.14` 权威源码在 `templates/engine/tools/grok-intelligence/lib/acp-client.mjs:885-900` 的 `finally` 中直接 `await stopChild()`；该步骤一旦抛错，后续 stdout 收尾、capture 关闭/删除、credential-home 恢复均被跳过，并可覆盖先前错误。
- 同一 `run()` 外层的 credential lease release 也是清理步骤，必须保证它不会再次覆盖已经捕获的主错误。
- spawn 失败分支也按顺序执行 capture 删除和 credential-home 恢复；其中任一步失败会覆盖 spawn 错误并跳过后续步骤，属于同一清理根因。
- 当前 ACP 单测覆盖正常清理、timeout/abort、credential-home 恢复和 lease 回收，但没有覆盖“主错误与清理错误同时发生”及“前一清理步骤失败后仍执行后续步骤”。
- ACP 客户端已返回脱敏的 `notifications`；runner 随后才调用 `normalizeAcpEvents()`。因此可以用一次性、忽略目录内的诊断 harness 在 normalization 前截取 WebSearch 事件，无需把永久调试开关加入产品代码。
- 当前命令只有 normalization 成功后才生成 canonical `raw-stream.jsonl` bundle。空 query 在 normalization 阶段抛错时不会留下该 bundle。
- 个人 `jed-zed/ccg-gptpro-worflow` 是权威源码。当前本地 `refs/remotes/gptpro/main` 指向 CCG `3.4.14` commit `9d94210f5a9132eb0637c9db3303760bf5c93c5f`；现有 `I:/ai/ccg-gptpro-worflow-main-3.4.14` 有四个无关改动，受本任务保护，不能直接使用。
- 当前 Harness checkout 的 `harness.sources.json` 仍记录旧 CCG `3.4.5` snapshot，且项目 Harness Grok 自动路由为 disabled/manual-only。真实捕获必须作为用户明确授权的 CCG 源码级手动诊断执行，不能修改 Harness Provider 配置或直接手改 snapshot。
- 用户已批准创建本任务并进入规划；实现仍需在最终规划摘要之后再次明确批准。

## Requirements

### R1 — 在干净的个人 CCG 权威 worktree 中修改

基于实施时重新核验的 `gptpro/main` 精确 commit/tree 创建新的干净 `codex/` worktree。只修改两份 byte-identical Grok ACP runtime projection 及其直接回归测试；不得触碰现有脏 CCG checkout、当前 Harness 的无关改动、已安装 npm 包或 Codex plugin cache。

### R2 — 保留主错误并记录次生清理错误

当业务/协议路径已产生错误时，任何 child termination、capture、credential-home 或 lease 清理错误都不得替换原始 error message/identity。次生清理错误必须以内部诊断属性保留，供测试和本地诊断读取，但不得把原始 raw 内容、凭据或 secret 写入公开输出。

如果主路径成功但清理失败，调用仍必须 fail closed 并返回清理错误，禁止伪造成功。

### R3 — 清理步骤相互隔离并全部尝试

同一运行中，以下适用步骤必须按既有安全顺序逐项尝试；前一步失败不能阻止后一步：

1. 取消 session / 终止 child process tree；
2. 收束 stdout queue；
3. 关闭并删除 exclusive raw capture；
4. 恢复 Grok credential-home volatile snapshot；
5. 释放 shared credential-home lease。

spawn 同步失败也必须使用相同错误优先级和 cleanup collector 语义。现有路径包含、ACL、reparse、容量、exact environment 和 credential preservation 约束不得放宽。

### R4 — 添加稳定的离线回归

在现有 `grokIntelligenceAcp.test.ts` seam 中注入确定性的 termination cleanup failure，并至少证明：

- 主错误与 cleanup error 同时存在时，最终抛出的仍是主错误；
- cleanup error 作为诊断信息仍可检查；
- capture 已删除、credential state 已恢复、lease 已释放；
- 主路径成功但 cleanup 单独失败时仍 fail closed；
- 两份 runtime projection 保持 byte-identical，相关 timeout/abort/credential tests 不回归。

### R5 — 仅一次真实 Grok 受控捕获

只有离线测试和安全检查通过后，才允许执行一次真实 Grok ACP 模型调用：

- 使用当前失败请求的精确 task/plan/dependency 绑定，`mode=contract`、`depth=normal`、`force_refresh=true`；
- 从全局 CCG 配置只读解析必要字段，在内存中强制 `max_retries=0`；不得修改全局或项目配置；
- 使用 official Grok CLI ACP、现有 isolated browser OAuth credential home、无 MCP fallback、无其他 Provider；
- 一次性 ignored diagnostic harness 通过 runner 的 `runAcp` 注入点，在 `normalizeAcpEvents()` 前仅截取相关 `tool_call` / `tool_call_update` 事件；
- 捕获文件必须位于任务本地 ignored/private 目录，exclusive create、owner-only/0600、大小和事件数受限；不得进入 Git、终端完整输出、最终报告或 memory；
- 分析只保留脱敏结构摘要：correlation id、status、对象键集合、query 所在路径/类型/trim 后长度、source 数量和捕获 SHA-256。分析后删除私有原始事件切片；保留无原文的结构摘要和 hash；
- 不自动重试。若调用在捕获前失败或本次未复现，只记录 exact non-secret blocker/inconclusive，不发第二次调用。

### R6 — 归因 WebSearch action variant

根据一次捕获归入以下结论之一：

- `provider_empty_or_missing_query`：完成事件没有任何可接受的非空 query；
- `parser_schema_mismatch`：同一 correlated 完成事件在另一个明确字段携带非空 query，而当前 CCG 只读取 `rawOutput.action.query`；
- `not_reproduced_or_inconclusive`：本轮未出现相同事件或在捕获前失败。

一次捕获已确认 `parser_schema_mismatch`：完成态 action 同时存在搜索结果 `query/sources/type`、URL `type/url` 和 Pattern `pattern/type/url` 三种结构；失败 action 为 `type/url`。该证据已展示，用户随后明确授权修复 WebSearch action variant 解析。

### R8 — 严格区分搜索结果和辅助 Web action

`events.mjs` 必须把已观察到的 URL/Pattern action 作为同一 WebSearch call 的完成态辅助动作处理：允许其完成 correlation bookkeeping，保留为 unknown event，但不得计入 search evidence。只有实际搜索结果仍要求非空 `query` 和数组 `sources`；不得放宽空 query、猜测字段、增加 fallback 或再次调用 Provider。

### R7 — 保持 Provider、交付和来源边界

不得修改 Grok 登录、模型、路由、权限、MCP、fallback、Harness enablement、其他 Provider 或 retained raw-evidence policy。原规划不自动授权任何交付动作；Boss 已于 2026-08-15 另行授权源码 commit 和使用受支持流程进行 Harness sync。Push、PR、merge、release、本机安装和再次 live Provider 调用仍未授权。

## Acceptance Criteria

- [x] 修复前，新增 focused regression 在预期的“cleanup 覆盖主错误/中断后续清理”边界失败；修复后通过。
- [x] 主错误与 synthetic child-shutdown cleanup error 同时发生时，调用保留原始 error message/identity，并携带可测试的 cleanup diagnostics。
- [x] termination cleanup 失败后，capture close/delete、credential-home restore 和 lease release 仍全部被尝试并通过可观察断言。
- [x] 无主错误但 cleanup 失败时，调用保持失败而不返回成功结果。
- [x] 两份权威 runtime projection byte-identical；focused ACP、event、runner/parity tests 通过。
- [x] lint、typecheck、完整 Vitest、build、change/quality/security gates 通过，或准确报告与本任务无关的既有 blocker。
- [x] 真实捕获最多启动一次 Grok 模型调用，runner attempts 为 1，无 retry、无 fallback、无其他 Provider 调用。
- [x] 结构摘要能够判定三种 R6 结论之一；完整 raw notification、prompt、credential 和 secret 不进入 tracked files、最终回复或 memory。
- [x] 私有原始事件切片在分析完成后删除；只保留不含原始 query/URL/prompt 的结构摘要、版本、时间和 SHA-256。
- [x] 离线 fixture 证明搜索结果、URL 和 Pattern 三种完成态 action 可共存；URL/Pattern 不触发空 query 错误、不计入 searches，真实搜索结果仍保持严格 query/sources 校验。
- [x] 两份 `events.mjs` projection byte-identical，focused event/runner/parity tests 与完整离线 gates 通过。
- [x] 实现和验证阶段保持当前 Harness 与其他 CCG checkout 的既有改动不变；未修改安装/cache/config，且在取得交付授权前未 commit、push、发布、同步或安装。
- [ ] 个人 CCG 源码 commit 仅包含本任务六个已验证文件，且工作树在 commit 后保持 clean。
- [ ] Harness sync 只通过干净工作树中的受支持 `harness:update -- --source-checkout <clean-checkout>` 流程执行；同步结果经验证后单独 commit。
- [ ] 交付过程不 push、不创建 PR、不 merge、不 release、不安装，也不再次调用 Provider。

## Out of Scope

- 放宽实际搜索结果的非空 `query` / `sources` schema 校验。
- 为未观察到的 hypothetical schema 添加通用 fallback、字段猜测、重试、自动切换 Provider 或吞错。
- 更新/安装/登录 Grok CLI，修改 browser OAuth 状态或复制 credentials。
- Push、PR、merge、release、本机安装、Provider 调用，以及修改已安装 CLI/plugin cache。
- 修改 Harness Provider enablement、`harness.sources.json`、vendored snapshot、全局 npm 包或 plugin cache。
- Commit、push、PR、merge、release、Harness synchronization 或本机 installation。
- 调用 Gemini、Claude、Antigravity、Pi、GPT Pro 或第二次 Grok。
