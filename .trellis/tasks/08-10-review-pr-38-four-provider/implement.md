# 执行计划：PR #38 四 Provider 联合审查

## Phase A: Bind review subject

- [x] 确认分支、`origin/main`、PR head、PR URL 与仅有用户未跟踪 `pnpm-lock.yaml`。
- [x] 生成 `.ccg-evidence/review/pr-38.diff`、manifest、文件清单、测试摘要和 SHA-256；稳定化前绑定 head `34de65d8`、diff `de04a736...7477`、151 文件，该 identity 只保留为历史台账。
- [x] 运行 `node scripts/harness-adapter.mjs context` 与 `conflicts`，记录当前合同状态为 0 blocking / 0 warning。

## Phase B: Independent reviews

- [x] Antigravity：受管 wrapper 在无头 `command` 权限处失败；已按用户新决定保存退出码、失败原因、实际默认模型与双日志 SHA-256，闭合该路但保持 missing。
- [ ] Grok：用受管 local-review wrapper 和 exact target flags 审查，验证 `CCG_GROK_REVIEW_JSON`。
- [ ] Claude：验证本机可信 executable、版本、登录、routing 和只读权限；运行 task-local product-manager review 并投影结果。
- [ ] 将前三路结果分为有效 finding、待核验、误报和缺失证据，写 Base CCG Routing Evidence。
- [ ] GPT Pro：创建 review bridge，会话发送一次、RootWait 至 completed、exact import，保存响应/evidence 哈希。

## Phase C: Codex verification and report

- [ ] 对四路每项 finding 定位当前 head 的 `file:line` 或合同证据；删除无法复现的断言。
- [ ] 运行发现所需的最小只读测试/静态检查；不修改产品代码。
- [ ] 汇总 Critical、Major、Minor、False Positives、Required Tests、共同发现与分歧。
- [ ] 只有四路证据全部有效且无未闭合 Critical/High/Major 时才给出建议合并；否则报告 incomplete 或不建议合并。
- [ ] 确认 PR head、Draft 状态、产品 tree 和用户 `pnpm-lock.yaml` 未改变。

## Validation

```powershell
git status --short --branch
git diff --check origin/main...HEAD
node scripts/harness-adapter.mjs conflicts
gh pr view 38 --json headRefOid,isDraft,mergeable,mergeStateStatus,statusCheckRollup
```

Provider-specific evidence validity is checked through the managed CCG wrapper, product-manager projection, and GPT Pro bridge/import contracts; a plain zero exit without the required final envelope/artifacts is not success.

## Risk and stop conditions

- PR head changes：停止并重建全部 binding。
- Provider 两次尝试仍失败：记录 missing，不替换 Provider，不给合并建议。
- GPT Pro `send-uncertain` 或非 completed：停止，不重发。
- 任意写工作区迹象：终止对应 Provider，保留证据并报告。

## Current checkpoint

- [x] 旧 Antigravity 报告绑定 head `7f8531a6`，因 head 变化已显式作废；稳定化前 head `34de65d8` 已重跑，并记录 wrapper 退出码、报告路径与实际默认模型。
- [x] 稳定化前 Antigravity 已按要求重跑一次：受管非沙箱 wrapper 退出 `1`，因 headless `command` 权限被拒而无响应；实际默认模型为 `gemini-3.1-pro-high`，原始日志为 `C:\Users\29933\.fastctx\jobs\j-irvoih\output.log`，该路记为 missing。
- [x] 稳定化前 Grok local review 退出 `0`，session `019febcd-7541-7eb0-975f-cfcf7157d1d8`，合法 envelope 覆盖 10 个精确目标且 `findings=[]`；正文 4 个候选仅进入 Codex 待核验队列，原始日志为 `C:\Users\29933\.fastctx\jobs\j-ochn1t\output.log`。
- [x] 稳定化前 Claude review 已完成并执行 `pm present`；用户以 fresh response 决定修订 AC2，接受 Antigravity 完整不可用记录闭合该路但最终继续标注 missing，`currentGate` 已清空、state revision `8`。
- [x] Codex 已核验 Antigravity 的无限 follow-up、`load_session` 参数类型及 deadline/thread/max-two/3-6 测试建议；均为已实现或已有回归覆盖，不计入阻断 finding。
- [x] Codex 交叉核验 Grok 候选，确认 watcher `status` 在生成期间思考模式控件隐藏时仍执行严格 Pro 断言，可能连续失败为 `probe-failed`；这是当前未闭合阻断项。
- [x] 注入 `UtcNowProvider` 的 observation 循环末尾仍读取系统 UTC；生产默认时钟一致，但测试 seam 不一致，记录为 required-test gap，不上调为生产 Critical。
- [x] MCP1 两部分均已完成：task-bound review evidence/精确目标 fail-closed 纳入；根部未跟踪 `pnpm-lock.yaml` 默认排除而普通未跟踪源码保留。CCG 源与 Harness 快照各 612 passed / 3 skipped，Harness 452 passed / 3 skipped，安装版复验 155/155 且 lockfile 未纳入。
- [ ] AC11 与 M2 复审暂不发起新的 live 点击；先闭合 watcher `status` 阻断项，避免把已知失败带入真实 Chrome E2E。
- [x] PR #38 已复核仍为 Draft；联合报告状态保持 `incomplete`，不给合并建议。

## Phase D: Authorized blocker remediation

- [x] 先补 `status` 隐藏模式控件失败回归：已绑定 exact conversation、生成中或停止后的 snapshot 可缺少模式控件；status 保持可观察，payload `ready=false`，watcher 不累计 probe failure；generic/send preflight 的严格 Pro 门槛不放宽。
- [x] 最小修改 `status` dispatcher，只保留 base readiness、URL/target 校验及结构化 payload；正式 Pester 用例已加入，并用直接回归证明红灯 `SelectedModeControlMissing` 转绿，严格 send preflight 保持不变。
- [x] 先补 injected-clock 回归，证明 observation loop 的 180/7200 秒条件不读取 wall clock；再将循环条件统一到现有 `UtcNowProvider`，不新增抽象。
- [x] 使用任务内已忽略的 Pester `5.6.1` 正式运行两个 suite；首次 278/279 暴露新增 status 测试的动态作用域错误，最小修复测试后完整 279/279 通过。红/绿原始日志与 SHA-256 已写入 tracked evidence 摘要。

## Phase E: MCP1 and review continuation

- [x] 定位 product-manager snapshot 共享构建器；增加固定 task-bound review evidence 与 Git-tracked 精确目标包含规则、required-missing 清单，并保留私密/凭据/密钥拒绝和容量上限。
- [x] 添加 MCP1 聚焦负向/正向测试：受限 diff、review manifest、test summary、`.agents/skills/chatgpt-pro-sidebar/**` 被纳入；缺失必需项或点名 `.env` 时 Provider 不启动。真实 PR 清单离线验证 144/144 纳入。
- [x] 已运行 product-manager/Harness 完整门禁、`context`、`conflicts`，并用 MCP1 快照完成一次 Claude 复审；该复审绑定旧 head `9fbcd414`，已按规则作废，只保留为 MCP1 输入完整性证明。
- [x] CCG 来源 `cf47e79967d140ac1489cce221acc1efcf0ccbe0` / tree `30777e0be936801d3203faf344bc1bc09045e92d` 已发布分支、通过受支持 lifecycle 更新 Harness 并安装全局 CLI；无临时 exclude 的安装版快照不含用户根部 lockfile。
- [ ] 一次性提交当前 tracked 修订形成稳定 review head；重建 diff/manifest 后只重跑仍能产出有效审查的 Grok、Claude 与 GPT Pro。Antigravity 不再重复消耗调用，沿用完整不可用记录并保持 missing。
- [x] 当前 Claude decision gate 已执行 `pm present`，逐字呈现 statement、findings、risks、adjustments、next action；fresh 用户响应已登记为修订 AC2，state revision `8`。
- [ ] 稳定 head 的 Grok、Claude 与 GPT Pro 证据闭合后，按父任务 AC11 执行真实 Chrome E2E，并生成 M2 source evidence；触发 M2 review/present，继续保持 Draft 与 joint report `incomplete` 直到全部验收。
