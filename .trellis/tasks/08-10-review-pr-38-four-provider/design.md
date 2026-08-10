# 设计：PR #38 四 Provider 联合审查

## 1. Authority and scope

- Trellis 子任务是本次审查唯一任务权威；父任务继续拥有 PR 产品实现与验收。
- PR identity 固定为 `66da149...7f8531a`。若 head 变化，本轮证据失效，必须重新绑定并重审。
- 审查是纯本地代码判断；Grok 不走 external-intelligence route。用户已授权在同一子任务内闭合两个已确认阻断根因和 MCP1，不创建平行任务。

## 2. Shared evidence bundle

在任务忽略目录 `.ccg-evidence/review/` 生成并校验：

1. `pr-38.diff`：`git diff --binary origin/main...HEAD`。
2. `review-manifest.json`：base/head、diff SHA-256、文件清单、工作树状态和 PR URL。
3. `test-summary.md`：本地门禁与 GitHub 10/10 CI 结果。
4. `review-prompt.md`：统一风险清单与禁止写入边界。

原始 Provider 请求、响应和日志保留在忽略目录；可跟踪任务文件只记录必要的摘要、哈希和结论。

## 3. Provider contracts

### Antigravity

通过 `ccg wrapper --backend antigravity --progress --antigravity-review` 启动。提示词绑定 shared manifest、diff identity 与高风险文件集；只有进程成功且存在完成报告才计为有效。

### Grok

通过 `ccg wrapper --backend grok --progress` 启动，并为明确的 bridge、adapter、watcher、import 与测试文件逐一传入 `--grok-review-target`。要求成功退出及有效 `CCG_GROK_REVIEW_JSON` envelope；不接受普通文本或联网搜索结果代替。

### Claude product-manager

将 `product-manager` routing 显式解析为 Claude，运行 task-local、snapshot-bound review。快照只含本任务规划、父任务需求、shared manifest、受限 diff/测试摘要与必要规范；工具仅 Read/Glob/Grep。有效结果必须投影到本任务 `product-manager.json`。

### GPT Pro

先形成普通 CCG review/Base Routing Evidence，再用 review bridge 创建会话。通过 external Chrome exact target、`run-root`、completed watch event 和 exact import 取得响应；任何非 completed、hash/URL/thread/target mismatch 都是无效证据且不重发。

## 4. Remediation boundaries

1. `status` 保持只读：它仍校验登录、挑战、composer、URL 和 exact target，但把 `selectedMode*` 留在 payload/`ready` 中，不在观察命令里把隐藏模式控件升级为失败；真正的 `send` 继续通过 `Ensure-AgentBrowserProMode` 与 commit preflight 严格证明 Pro。
2. post-click observation deadline 的循环条件复用现有 `UtcNowProvider`，一次取值同时比较 observation 和 response absolute deadline；不新增时钟抽象。
3. MCP1 复用现有 product-manager snapshot builder 和 manifest；只给固定 task-bound review evidence 与 manifest 声明的 Git-tracked 精确目标增加包含入口。私密目录、凭据、密钥和秘密文件仍 fail closed；显式审查目标可越过 instruction/plugin 目录排除，且 2000/2MiB/64MiB 上限不变。
4. Claude 使用修复后的 task-local snapshot；有效 review 产生新 hard gate，必须 present 后停止等待 fresh 用户响应。

## 5. Sequencing

1. Codex 固定 PR identity 并创建 shared evidence bundle。
2. Antigravity、Grok 和 Claude 使用同一 identity 独立审查。
3. Codex校验前三路并形成普通 CCG review/Base Routing Evidence。
4. GPT Pro 接收相同 diff identity、测试摘要及已验证/未验证 finding 列表，做最终第二意见。
5. Codex逐项点验；若确认阻断 finding 且用户授权，先添加失败回归，再做最小根因修复。
6. 两项修复全绿后实施 MCP1、重跑 Claude，然后推进父任务 AC11 与 M2 复审。
7. 在 Claude 新硬门槛、AC11 或 M2 未闭合前，联合报告保持 `incomplete`，PR 保持 Draft。

## 6. Safety and rollback

- 不把 Provider 输出直接写入产品文件；Codex 只依据已复现根因修改产品文件。
- 不自动重发 GPT Pro，不让任何 Provider 改工作区。
- 任务中断时保留证据和哈希，可从缺失 Provider 继续；head 变化则全部证据作废并重建。
- 两个 adapter 修复独立回滚到各自测试与最小代码行；MCP1 独立回滚 snapshot builder 与聚焦测试。任何门槛失败都不改 PR Draft 状态。
