# Implementation: Persistent provider routing closeout

## Ordered Steps

- [x] 更新适配器契约：将外部模型从永久 `enabled=false` 改为
  `routable=true`、`workspaceWrite=false` 与运行时 CLI 可用性说明。
- [x] 更新 `checkModelPolicy` 与 informational findings，只验证 Codex
  唯一写入边界，并区分角色路由与 Grok external intelligence。
- [x] 先补失败测试，再更新现有 adapter/context/conflict 断言。
- [x] 同步根 `AGENTS.md`、Layered Harness Adapter 规范、
  `docs/trellis-ccg-conflicts.md` 和必要的设计说明。
- [x] 运行聚焦 adapter 测试与 `git diff --check`。
- [ ] 将持久 Harness checkout 安全对齐远端 `main`，通过
  `scripts/install.ps1 -PluginOnly` 的受支持路径更新 marketplace、CCG
  插件登记与 Codex Mode。专用非 sparse worktree 已建立；最终缓存收敛
  尚待当前旧插件会话退出前的最后重装验证。
- [ ] 验证 `ccg --version`、`ccg routing list`、`codex plugin list`、
  插件 doctor 与 Grok runtime 文件完整性。
- [ ] 运行全部 Harness、来源与 CCG 门禁。
- [ ] 运行 Gemini 只读 review；Claude 本次按用户限定和现行项目规则禁用。
- [ ] 提交、推送、创建 PR，等待 CI 后合并。

## Validation Commands

```powershell
node --test tests/harness-adapter.test.mjs
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
git diff --check
ccg --version
ccg routing list
codex plugin list --marketplace ccg-gptpro-worflow
```

## Risk and Rollback Points

- 修改 marketplace 前确认持久 checkout 干净且历史分支仍可恢复。
- 插件安装必须走现有 Harness transaction；禁止直接删除或覆盖缓存。
- 若来源、插件身份或任何 blocking gate 不一致，停止并保持旧登记。
- Claude/Grok 只读角色路由不得扩大为工作区写入或付费自动调用。
