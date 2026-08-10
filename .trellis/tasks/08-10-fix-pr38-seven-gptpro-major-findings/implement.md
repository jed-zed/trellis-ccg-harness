# 执行计划：修复 PR #38 七个 GPT Pro 阻断缺陷

## Phase A: Baseline and failing regressions

- [x] 记录 Harness/source HEAD、clean/dirty 分类、PR Draft/head、用户 `pnpm-lock.yaml` SHA-256；冻结父审查文档以外的无关改动。
- [x] 在 watcher Pester 添加统一 retry-proof table：第一尝试出现 URL/user/generation、wrong composer SHA、attempt 编号重复/重排、ack=true、auto-resend=true、wrong thread；证明 capacity 与 RootWait 当前失败。
- [x] 添加 batch durable terminal 失败回归：stdout completed + durable 缺失/非 terminal/错 thread/watcher；release 注入失败仍不得 `allSucceeded=true`。
- [x] 添加 watcher admission 失败回归：key 128/129/非法字符、prompt 24000/24001、target 512/513/CRLF、7200/7201，并断言 capacity/child 调用数为 0。
- [x] 在 CCG 权威源对 template/plugin 参数化添加红灯：batch 7201、非法 key、composed prompt 超限、manifest/key/target/prompt/fresh/batch/round 篡改、V2 手工保存、跨绑定 follow-up 和并发 follow-up。

## Phase B: Watcher minimal fixes

- [x] 增加并复用完整 retry-not-submitted predicate；同步 adapter predicate 的 attempt 序号校验。
- [x] 让 RootWait terminal projection 与 capacity release 对同一 proof 得出一致安全结论；不放宽 recovery-required。
- [x] 让 batch terminal 只来自 exact durable watch-state/event；stdout 保持 diagnostic。
- [x] 修正 release failure 后 item/status 与 `allSucceeded` 判定。
- [x] 把 key/prompt/target 边界校验放入 manifest normalization、capacity acquisition 之前。
- [x] 运行 watcher/adapter focused Pester、PowerShell parser 和 fixed JS `node --check`，保存红/绿原始日志。

## Phase C: CCG authoritative bridge fixes

- [x] 将 batch timeout、key grammar、最终 composed prompt 边界统一到 adapter 合同；template/plugin 同步。
- [x] 创建并持久化 batch manifest hash 与每 round intent binding；import 在写入前验证全部来源身份。
- [x] 在共享 `save_response` 阻断 V2 无 metadata/伪造 metadata 写入，保留显式 legacy 兼容。
- [x] 用 session lock 覆盖 follow-up 完整 read-modify-write，并复核所有既有 binding。
- [x] 运行两 bridge 副本的 focused Vitest、Python compile、源仓库 lint/typecheck/test/build 与 diff/security checks。
- [x] 复核 template/plugin 安全相关实现 parity，创建本地权威源 commit；不推送。

## Phase D: Publication authorization gate

- [x] 向用户展示 source diff、测试结果、commit 与回滚点，单独请求推送/发布和 Harness lifecycle update 授权。
- [x] 获批后推送权威源，确认远端 commit/tree；禁止手工编辑 Harness snapshot。
- [x] 运行受支持 `pnpm harness:update --source-checkout G:\CodexWorktrees\gptpro-url-first-recovery-source`，核验 `harness.sources.json` 与 snapshot tree。

## Phase E: Integrated verification

- [x] 运行完整 adapter/watcher Pester；要求所有旧用例及新增安全回归通过。
- [x] 运行 `pnpm harness:test`、`pnpm doctor`、`pnpm verify:sources`、`pnpm harness:conflicts`、`pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build`。
- [x] 运行 PowerShell/Node/Python parse、`git diff --check`、变更影响/质量/安全检查；确认无 credential、prompt、browser identity 泄露到 tracked artifacts。
- [x] 重算用户 `pnpm-lock.yaml` SHA-256，确认未修改、未暂存。
- [x] Codex 对七个原 finding 做最终 file:line 复审；确认共同根因闭合，两个 Minor 仍 out of scope。
- [ ] 父联合报告位于原工作树的受保护未提交集合中；由其所有者整合 resolved/pending 状态，禁止从干净集成 worktree 覆盖。
- [ ] 提交 Harness PR 分支但保持 Draft；真实 Chrome/Provider 重审、Ready/merge 继续由父任务和用户决定。

## Verification evidence (pre-publication checkpoint)

- Baseline: Harness/PR head `1117cc26b56f93013e1bd51dd5086c30bffedc9d`; source baseline `cf47e79967d140ac1489cce221acc1efcf0ccbe0`; PR #38 remains `OPEN` and Draft.
- Source commit: `baf3330aab92c508cb396af560612b63f1886a96`, tree `f0a6282c2e50d9c1ff33aabd42d6277b5514be73`; source worktree clean and remote branch verified at the same commit.
- Source gates: focused Vitest `56/56`; full Vitest `617 passed, 3 skipped`; ESLint, `tsc --noEmit`, Python compile, build, `git diff --check`, local change/quality/security scans passed. Independent security/parity review found no remaining High/Critical blocker.
- Harness gates on final code: Pester `285/285`; Harness tests `452 passed, 3 skipped`; both PowerShell files parse with zero errors; both fixed JS files pass `node --check`; `doctor`, `verify:sources`, and `harness:conflicts` pass with zero blocking/warnings.
- Lifecycle transaction `2026-08-10T17-12-07-872Z-41880b03-bf2c-406d-9497-a824c5dd52a9` materialized Source `baf3330...` / tree `f0a6282...`; post-commit `doctor`, `verify:sources`, and conflicts all bind that exact identity with zero blocking/warnings.
- User `pnpm-lock.yaml` remains untracked and unstaged with SHA-256 `1ba6e57607589bbea6f8b679d914e91315e0f00d9da85dd79fbf3575131bd23f`.
- Raw red/green logs are retained under ignored `.ccg-evidence/verification/`. The CCG automatic external-intelligence route was stopped when it selected a Provider-backed contract investigation, because PRD R8 forbids Provider calls in this unit-fix phase; the local scanners were run directly instead.
- Clean integration commits: `3312f900e0ed4144a462b16e4050cca9577b4cad` (watcher/spec/task) and `edf31fe3fb91ae7ccb1759e896fdec351b8555be` (lifecycle snapshot/manifest). Lifecycle and explicit post-commit CCG tests each passed `617/3`; lifecycle Harness tests passed `452/3`.
- npm registry publication remains unavailable because `npm whoami` returned `ENEEDAUTH`. The commit-pinned Harness update does not depend on npm, but no npm package publication is claimed.
- Final Codex file:line review: Major 1 → adapter `chatgpt-pro-sidebar.ps1:648-693`, watcher `chatgpt-pro-sidebar-watch.ps1:1954-2029,2730-2740`; Major 2 → bridge `gptpro_bridge.py:1705-1710`, watcher `:2245-2251`; Major 3 → bridge `:1726-1752`, watcher `:2268-2309`; Major 4 → watcher `:2394-2485,2605-2676`; Major 5 → bridge `:1845-1898,1912-2052`; Major 6 → bridge `:2255-2430,2544-2596,2780-2805`; Major 7 → bridge `:1461-1528,1606-1675`.

## Validation commands

```powershell
# Harness focused
pwsh -NoProfile -Command "Invoke-Pester .agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-watch.Tests.ps1 -Output Detailed"
pwsh -NoProfile -Command "Invoke-Pester .agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar.Tests.ps1 -Output Detailed"
node --check .agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-agent-browser-v2.js

# CCG source
pnpm test -- src/utils/__tests__/gptproBridge.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Harness integration
pnpm harness:test
pnpm doctor
pnpm verify:sources
pnpm harness:conflicts
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
git diff --check
```

## Risk and rollback points

- retry proof 或 durable terminal 的误放宽会造成重复请求或错误释放 slot，任何不确定结果都回到 `ConcurrencySlotRecoveryRequired`。
- V2 manual-save gate 必须只按 recorded transport 区分，不能删除历史 legacy 兼容。
- follow-up lock 必须覆盖状态读改写，不得只锁最终 write。
- source publish、Harness update、安装和网络 Provider 调用均不得从“实现授权”推断；未获单独授权时停在本地 commit。
