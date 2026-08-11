# 执行计划：PR38 三项 Major 修复与 CCG 3.4.10 对齐

> M1 与 FINAL 已获 fresh 验收；CCG source 已发布，PR #38 的发布身份与 CI 正在重签，归档前保持 task `in_progress`。

## M1: CCG 3.4.10 alignment and three Major fixes

### Phase A — Freeze identities and start safely

- [x] 重新核对 PR #38 base/head/Draft/checks、phase-d worktree状态、个人 CCG source HEAD/remote/status，以及 `harness.sources.json` 当前 3.4.9 identity。
- [x] 记录并保护所有非本任务 dirty/untracked 路径；不得 clean/stash/reset。
- [x] 用 `py -3.14` 启动本 Trellis task；运行 `node scripts/harness-adapter.mjs context`，确认 current task 与工作树一致。
- [x] 建立 task-local ignored evidence 目录并写 preflight identity；此时不调用 Provider、不修改 PR 状态。

### Phase B — Integrate personal CCG source to 3.4.10

- [x] 在 clean personal source branch 上保留 `baf3330` 历史并合入 `0b30802`；不 rebase、不 force，不从官方原版替换个人 fork。
- [x] 只处理实际冲突；预期交集为 `CHANGELOG.md` 与 `plugins/ccg/.codex-plugin/plugin.json`。任何 bridge 文件冲突或删除立即停止。
- [x] 核对 package `3.4.10`、plugin `3.4.10+codex.*`，以及 PR38 12 个 bridge/RootWait commits 均仍可达。
- [x] 在权威 source 的 template/plugin bridge 实现同目录临时文件 + flush/fsync + `os.replace`，保持现有幂等与 V2 import gate。
- [x] 新增最小故障注入回归，覆盖旧完整文件不被截断、首次失败无半文件、临时文件清理、相同响应重放成功、不同响应拒绝；两份 bridge 都参与验证。
- [x] 运行 source focused tests、Python compile、lint/typecheck/test/build；review source diff 后创建本地 clean integration/fix commit，记录最终 commit/tree。

### Phase C — Supported Harness alignment

- [x] 从最终 clean personal source 执行 `pnpm harness:update -- --source-checkout <path>`；不手改 component snapshot 或 manifest。
- [x] 核对 transaction 只更新预期 CCG snapshot、`harness.sources.json` 与生命周期记录；失败使用受支持 recover/rollback。
- [x] 验证 snapshot 的 bridge tests/实现与最终 source 语义一致，manifest version/commit/tree 精确匹配，managed runtime 报告兼容 `3.4.10+codex.*`。
- [x] 运行 source/lifecycle focused gates：`tests/harness-lifecycle.test.mjs`、`tests/harness-gates.test.mjs`、`tests/verify-sources.test.mjs`、plugin parity/installer tests。

### Phase D — Enforce capacity for direct run-root

- [x] 在 watcher 现有 capacity helper 上实现“一 round 一 claim”：direct `run-root` 自行 acquire；batch child 验证并复用 parent handoff，不 double-acquire。
- [x] 保证 acquire 在 adapter/browser 前；无槽路径不启动 adapter、不打开页面、不写 composer、不点击 Send。
- [x] 复用现有 release proof：pre-click-unsent、完整 `retry-not-submitted`、terminal 可释放；`recovery-required` 与不完整 orphan 保留并返回 `ConcurrencySlotRecoveryRequired`。
- [x] 新增 Pester：direct 第 4/第 7 阻断、batch handoff 单计数、错误 claim fail closed、pre-click safe release、retry proof release、recovery retention、no-resend。
- [x] 复核现有 batch、absolute deadline、target binding、one-click/two-attempt tests 无回退。

### Phase E — Align PR39 Product Manager contract

- [x] 修改 `.trellis/spec/tooling/product-manager-review.md` 的已知四类旧 allowlist 语义，并精确检索全部同义 capability 断言；采用 disposable snapshot 内 upstream permission mode，同时保留仅描述结果/证据为 read-only 的正确语句。
- [x] 保留 canonical workspace/Trellis lifecycle authority、no-fallback、network/payment authorization、snapshot/identity/schema/timeout/output/CAS/hard-gate 边界。
- [x] 核对 CCG 3.4.10 snapshot 的 `ccg-product-manager.md` 与 `src/product-manager/DESIGN.md` 已同步新合同；若仍漂移，只在权威 source 修正后重新走 Harness update，不直接改 snapshot。
- [x] 更新受影响的合同测试，只删除“工具类别本身即 invalid”的旧断言，不放宽 canonical authority 或 gate 测试。

### Phase F — Validation and M1 hard gate

- [x] Parse：PowerShell watcher、固定 JavaScript、两份 Python bridge。
- [x] Focused：watcher Pester、sidebar Pester、`gptproBridge.test.ts`、Product Manager state/concurrency/e2e、Harness adapter/lifecycle/source tests。
- [x] Full CCG：`pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build`。
- [x] Full Harness：`pnpm harness:test`、`pnpm doctor`、`pnpm harness:conflicts -- --ci`、`pnpm verify:sources`、`git diff --check`。
- [x] 重算 PR base/head/diff/checks、source commit/tree、Harness manifest、installed version；生成 M1 四份 evidence 摘要与 AC1-AC10 台账。
- [x] 独立复审三项修复；Critical/High/Major 未闭合则停在 M1，不给合并建议。
- [x] 触发 Product Manager `MILESTONE_REVIEW` checkpoint `M1`；若有效，执行 `pm present`，完整呈现 advice 并停止等待 Boss fresh response。
- [x] 只有后续 fresh `accept` 才把 M1 标记完成；PR #38 仍保持 Draft。

### Post-acceptance publication

- [x] 按 Boss 授权推送个人 CCG source `28a428ce`，并用默认远端模式重跑 doctor/verify:sources，精确命中 commit/tree。
- [x] 合入最新 `origin/main`，保留个人 CCG provenance，重跑 CCG/Harness 全门禁并记录 runner 超时与稳定重跑。
- [x] 推送 PR #38 新 head，等待该 head 的 required checks 全绿并重签 base/head/diff。
- [ ] 在当前发布 identity 下完成最终 Provider gate 后，才把 PR #38 从 Draft 改为 Ready；不执行 merge。

## Focused validation commands

```powershell
py -3.14 .\.trellis\scripts\task.py start .trellis\tasks\08-10-fix-pr38-three-major-and-ccg-3410
Invoke-Pester -Path .agents\skills\chatgpt-pro-sidebar\tests -Output Detailed
python -m py_compile components\ccg-workflow\plugins\ccg\skills\ccg-gptpro-bridge\scripts\gptpro_bridge.py
python -m py_compile components\ccg-workflow\templates\engine\tools\gptpro\gptpro_bridge.py
pnpm --dir components/ccg-workflow test -- src/utils/__tests__/gptproBridge.test.ts
node --test tests/product-manager-state.test.mjs tests/product-manager-concurrency.test.mjs tests/product-manager-e2e.test.mjs
node --test tests/harness-adapter.test.mjs tests/harness-lifecycle.test.mjs tests/harness-gates.test.mjs tests/verify-sources.test.mjs
```

`task.py start` 只在本计划收到后续明确批准后执行。实际 source test 命令以 3.4.10 package scripts 为准，禁止通过跳过测试或修改门禁来取得绿色结果。

## Stop conditions

- PR38 head/base、CCG baseline、source tree 或 manifest identity 与规划不符。
- CCG merge 冲突超出已知文件，或 PR38 bridge/RootWait 行为被 3.4.10 覆盖删除。
- Harness source checkout 不 clean，lifecycle transaction 不可恢复，或 snapshot/manifest 不匹配。
- direct `run-root` 在无槽时仍能到达 adapter/browser，或 batch 出现 double claim。
- response fault injection 产生半文件、丢失旧完整响应或阻断相同响应重放。
- Product Manager 合同放宽了 canonical workspace/lifecycle、no-fallback、network/payment 或 hard-gate 边界。
- 任一 required gate 红灯、M1 evidence 漂移或 Product Manager hard gate 未获 fresh response。

## Commit and external-action boundaries

- 计划内本地提交：个人 CCG 3.4.10 integration/fix commit；Harness snapshot/fix/spec/test work commit；Trellis task/evidence commit。
- 计划外且需另行授权：push 任一远端、npm publish、GitHub PR Ready/merge/close、全局/其他机器安装、live ChatGPT E2E。

## Rollback

- CCG：回到记录的 `baf3330` 安全点；不重写远端历史。
- Harness update：使用 transaction 自带 recover/rollback 恢复原 component + manifest。
- Harness-local fix：按独立提交逆向，不 reset/checkout 用户文件。
- Evidence：identity 漂移时标记 stale 并重建，不覆盖历史原始日志。
