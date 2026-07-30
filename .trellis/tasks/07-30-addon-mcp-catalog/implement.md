# Implementation Plan

## 1. Authoritative CCG change

- [x] 从最新 `gptpro/main` 创建独立 CCG worktree；保持现有脏 checkout
      `I:\ai\ccg-workflow` 不变。
- [x] 为 add-on catalog 添加 Playwright、官方 DeepWiki、Exa，并补充来源、
      data-egress、credential guidance 和默认跳过测试。
- [x] 新增受控远程 MCP 配置支持；确保 Claude/Codex/Gemini 配置形状、
      ownership、adoption、卸载和恢复对称。
- [x] 把 DeepWiki 从失效 `mcp-deepwiki` 改为
      `https://mcp.deepwiki.com/mcp`，移除失效包 pin。
- [x] 更新 Exa key 获取入口和安全提示，保留 owner-only secret launcher。
- [x] 更新 CCG `README.md`、`README.zh-CN.md`、`AI_INSTALL.md` 和测试。
- [x] 按发布约定更新 CCG patch version，并运行定向及完整门禁。

## 2. CCG delivery gate

- [x] 审查 diff、来源 pin、URL allowlist 和 secret redaction。
- [x] 运行 `ccg:verify-change`、`ccg:verify-quality` 和
      `ccg:verify-security` 等价门禁。
- [x] 只在用户另行授权后提交、推送并创建 CCG PR。
- [x] 等 CCG PR 合并和远端 CI 通过后再开始 Harness 正式同步。

CCG delivery: commit `80c5dcb16ca514d2f5725bff19d8740843284adc`,
merged PR https://github.com/jed-zed/ccg-gptpro-worflow/pull/21,
merge commit `50c80c7d0830a40da6ab49e466a281b86d9e82c6`.

## 3. Harness distribution change

- [x] 从合并后的 CCG commit 运行正式 `pnpm harness:update`，同步
      `components/ccg-workflow/` 与 `harness.sources.json`。
- [x] 扩展 Harness third-party manifest/action schema，让四项出现在
      `pnpm addons` 状态、计划、交互审批和 AI 安装路径。
- [x] 实际 MCP 配置复用 CCG handoff；Harness 不收集或保存 Exa key。
- [x] 同步 `.agents/skills/harness-init/assets/` 与 `.harness/` 投影，并更新
      README、`AI_INSTALL.md`、spec 与回归测试。

Harness update receipt:
`2026-07-30T16-57-29-274Z-a2b538de-c333-412a-a219-d03a8521d255`.
The authoritative synchronized CCG source is merge commit
`50c80c7d0830a40da6ab49e466a281b86d9e82c6`, tree
`c1ee4e075a13843511ca0b34d4ba2c0cb911fa81`.

## 4. Validation

- [x] CCG focused:
      `pnpm vitest run src/commands/__tests__/addons.test.ts src/utils/__tests__/thirdPartySources.test.ts src/utils/__tests__/installerMcpOwnership.test.ts src/utils/__tests__/mcpSecrets.test.ts`
- [x] CCG full: lint、typecheck、test、build。
- [x] Harness focused:
      `node --test tests/harness-third-party-cli.test.mjs tests/harness-third-party-global-actions.test.mjs tests/harness-third-party-approval.test.mjs tests/harness-guided-init.test.mjs`
- [x] Harness full:
      `pnpm harness:test`, `pnpm doctor`, `pnpm harness:conflicts`,
      `pnpm verify:sources`, `pnpm ccg:lint`, `pnpm ccg:typecheck`,
      `pnpm ccg:test`, `pnpm ccg:build`。
- [x] 从干净临时 home 验证：默认回车零写入；四项状态可见；DeepWiki URL
      正确；Exa 输出含 dashboard 链接且不含测试 secret；回滚恢复原配置。

Validation evidence:

- Harness focused tests passed with concurrency 1.
- `pnpm harness:test`: 429 tests, 426 passed, 3 skipped, 0 failed.
- CCG: lint, typecheck, 43 test files (573 passed, 1 skipped), and build passed.
- `pnpm doctor`, indexed `pnpm harness:conflicts`, and authoritative
  `pnpm verify:sources` passed.
- CCG change and quality analyzers passed; the security scanner reported zero
  findings. The quality analyzer retained existing file-size and complexity
  warnings, with no errors.

## 5. Delivery

- [x] 只在用户另行授权后提交、推送并创建 Harness PR。
- [x] 先合并 CCG PR，再确认 Harness PR 引用的 commit/tree 与合并结果一致。
- [ ] 两个 PR 的远端 CI 均通过后才报告可合并。

Harness delivery: implementation commit
`cdf9c04079df12d1316cf74cfcd4414a9e9f06c1`, draft PR
https://github.com/jed-zed/trellis-ccg-harness/pull/20. CCG PR #21 remote
CI passed before merge; Harness PR CI remains pending.

## Risky Files / Rollback Points

- `components/ccg-workflow/src/utils/installer-mcp.ts`：跨主机配置与 ownership。
- `.agents/skills/harness-init/scripts/third-party-global-actions.mjs`：全局写入事务。
- 两份 `third-party-sources.json`：必须保持投影一致。
- `harness.sources.json` 与 `components/ccg-workflow/`：必须作为正式同步事务。
