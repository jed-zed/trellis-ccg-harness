# Implementation Plan

## 1. Focused regressions first

- [x] 更新 manifest validation tests：接受稳定 `latest` channel，拒绝仓库内
      具体 version/commit/integrity/lock/asset hash。
- [x] 添加 npm、Git、Ponytail、ripgrep resolver fixture；证明 apply 解析并记录
      实际 identity，稳定 manifest 不被运行时反写。
- [x] 添加旧 Harness-owned 固定版本升级、drifted/user-owned 拒绝测试。
- [x] 保留 default-skip、network approval、strict boundary、dependency 与 rollback
      回归。

## 2. Harness manifest and resolver

- [x] 升级 `.agents/skills/harness-init/assets/third-party-sources.json` schema，
      删除固定 artifact 字段及五份 npm lock assets。
- [x] 最小扩展 `third-party-approval.mjs`：status/plan 输出 channel；apply 在
      网络批准后解析 latest；plan digest 绑定稳定来源、选择与执行边界。
- [x] 扩展现有 Git/npm/release acquisition helpers，不创建第二套 transaction。
- [x] 更新 `third-party-global-actions.mjs` 与 MCP launcher，从批准 plan/ownership
      验证动态 artifact；保存实际 installed identity。
- [x] 更新 Skill/project/Ponytail 路径，从 resolved snapshot 计算 tree inventory。

## 3. Authoritative CCG add-on change

- [x] 在个人 CCG 最新主线的独立 worktree 中，仅为 Context7、Playwright、Exa、
      CodeGraph、fast-context add-on allowlist启用 `latest` channel。
- [x] 保留其他 CCG npm/Git executable 的精确来源验证。
- [x] 更新 CCG add-on/config MCP tests、README 与版本；运行 lint、typecheck、
      tests、build、质量/安全等价门禁。
- [x] 提交、推送、创建 CCG PR；远端 CI 通过并合并后记录 merge commit/tree。

## 4. Harness sync and public contract

- [x] 用正式 `pnpm harness:update` 同步合并后的 CCG snapshot 与
      `harness.sources.json`，不手改 plugin cache。
- [x] 同步 `.harness/third-party-sources.json` 投影。
- [x] 更新 README、`AI_INSTALL.md`、Harness Init Skill、`scripts/README.md`、
      design/spec，说明 latest resolution、网络要求和 per-plan freeze。
- [x] 搜索并删除过时的 pinned/exact/lockfile/version 文案和测试期望，仅保留
      Trellis/CCG core provenance 与未列入 scope 的 CCG pins。

## 5. Validation

Focused Harness:

```powershell
node --test tests/harness-third-party-approval.test.mjs
node --test tests/harness-third-party-global-actions.test.mjs
node --test tests/harness-third-party-mcp-launcher.test.mjs
node --test tests/harness-third-party-cli.test.mjs
node --test tests/harness-init-cli.test.mjs
```

Full Harness:

```powershell
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
```

CCG authoritative repo:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [x] 用 mocked registries/GitHub/Git 验证确定性；不让常规 CI 依赖实时 latest。
- [x] 用隔离 home 做一次批准的 live smoke：plan 绑定稳定 channel，apply 解析并安装
      同一 identity，status 显示实际安装结果。
- [x] 运行 `node scripts/harness-adapter.mjs conflicts` 和 CCG quality gates。
- [ ] 安全审查按 Boss 明确要求跳过；已完成功能 diff、依赖、lockfile 与可执行流程审查。

## 6. Delivery

- [x] 提交并推送 `codex/latest-third-party-addons`。
- [x] 创建 Harness PR，等待所有远端 CI；无问题后按用户授权合并。
- [x] 报告 CCG/Harness PR 链接、实际解析版本、测试、未验证风险和最终 Git 状态。

## Rollback Points

- CCG PR 未合并前不运行 Harness source sync。
- resolver 或 transaction gate失败时恢复对应 commit，保留原 pin installer。
- live smoke 只用隔离 home；不得覆盖当前用户全局安装。
