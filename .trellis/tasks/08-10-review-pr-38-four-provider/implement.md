# 执行计划：PR #38 四 Provider 联合审查

## Phase A: Bind review subject

- [ ] 确认分支、`origin/main`、PR head、PR URL 与仅有用户未跟踪 `pnpm-lock.yaml`。
- [ ] 生成 `.ccg-evidence/review/pr-38.diff`、manifest、文件清单、测试摘要和 SHA-256。
- [ ] 运行 `node scripts/harness-adapter.mjs context` 与 `conflicts`，记录当前合同状态。

## Phase B: Independent reviews

- [ ] Antigravity：用受管 review wrapper 审查绑定文件与 diff identity，保存完整报告及退出状态。
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

- [x] Antigravity 已通过非沙箱受管 wrapper 完成审查；报告绑定 base `66da1493327b4905c4c2180f7056d8f30e8796b8`、head `7f8531a6ab6f76618eaba9f24e9c984f32a186a5` 与 diff SHA-256 `e0b659dcc7bb60c1f20f4c146608c4d47b557f8b2d81be73db5d62cfdec39017`，且未留下 workspace 写入。
- [x] Codex 已核验 Antigravity 的无限 follow-up、`load_session` 参数类型及 deadline/thread/max-two/3-6 测试建议；均为已实现或已有回归覆盖，不计入阻断 finding。
- [x] Codex 交叉核验 Grok 候选，确认 watcher `status` 在生成期间思考模式控件隐藏时仍执行严格 Pro 断言，可能连续失败为 `probe-failed`；这是当前未闭合阻断项。
- [x] 注入 `UtcNowProvider` 的 observation 循环末尾仍读取系统 UTC；生产默认时钟一致，但测试 seam 不一致，记录为 required-test gap，不上调为生产 Critical。
- [ ] 用户要求的 MCP1 快照包含修复仅在审查无阻断项时启动；当前条件未满足，未修改快照规则，未重跑 Claude。
- [ ] AC11 与 M2 复审暂不发起新的 live 点击；先闭合 watcher `status` 阻断项，避免把已知失败带入真实 Chrome E2E。
- [x] PR #38 已复核仍为 Draft，head 未变；联合报告状态保持 `incomplete`，不给合并建议。

## Phase D: Authorized blocker remediation

- [x] 先补 `status` 隐藏模式控件失败回归：已绑定 exact conversation、生成中或停止后的 snapshot 可缺少模式控件；status 保持可观察，payload `ready=false`，watcher 不累计 probe failure；generic/send preflight 的严格 Pro 门槛不放宽。
- [x] 最小修改 `status` dispatcher，只保留 base readiness、URL/target 校验及结构化 payload；正式 Pester 用例已加入，并用直接回归证明红灯 `SelectedModeControlMissing` 转绿，严格 send preflight 保持不变。
- [x] 先补 injected-clock 回归，证明 observation loop 的 180/7200 秒条件不读取 wall clock；再将循环条件统一到现有 `UtcNowProvider`，不新增抽象。
- [ ] 运行 PowerShell parse、固定 JS parse、两个 Pester suite，并记录红灯与绿灯原始证据。

## Phase E: MCP1 and review continuation

- [x] 定位 product-manager snapshot 共享构建器；增加固定 task-bound review evidence 与 Git-tracked 精确目标包含规则、required-missing 清单，并保留私密/凭据/密钥拒绝和容量上限。
- [x] 添加 MCP1 聚焦负向/正向测试：受限 diff、review manifest、test summary、`.agents/skills/chatgpt-pro-sidebar/**` 被纳入；缺失必需项或点名 `.env` 时 Provider 不启动。真实 PR 清单离线验证 144/144 纳入。
- [ ] 运行 product-manager 与 Harness 聚焦测试、`context`、`conflicts`；用修复后的 snapshot 重跑已授权 Claude review。
- [ ] 对新 review 执行 `pm present`，逐字呈现 statement、findings、risks、adjustments、next action，列出三种允许响应并结束该 turn，等待 fresh 用户决定。
- [ ] Claude gate 获 fresh 接受后，按父任务 AC11 执行真实 Chrome E2E，并生成 M2 source evidence；触发 M2 review/present，继续保持 Draft 与 joint report `incomplete` 直到全部验收。
