# Implementation plan: original-style role routing

## Preconditions

- [x] 用户明确批准 v2 计划后才进入实现。
- [x] 不采用当前隔离 worktree 中误启动的未审查 prototype；实现时重新从
  审核后的 clean personal CCG commit 建立 worktree。
- [x] 保留当前 Harness/CCG 脏 checkout 和其他任务 worktree。
- [x] 记录 upstream `3.2.3`、personal `v3.3.3`、Harness pin、installed
  runtime 和 baseline gates。

## Phase 1: three-role compatibility core

- [x] 在 `src/types/index.ts` 定义 frontend/backend/search 三个大角色和
  `RoleRouting`，保留 collaboration mode/model options。
- [x] 在 `src/utils/config.ts` 规范化旧 frontend/backend 配置并补 search
  默认。
- [x] 增加 role list/get/set API；单 role 更新不改变另外两个角色。
- [x] 单元测试未知 provider、fallback 和单角色独立切换。

## Phase 2: original installer and templates

- [x] 把菜单改为三大角色 role-first、backend-second 的动态选择。
- [x] 保留原版 template refresh；切换不要求源码改动。
- [x] 注入 frontend/backend/search 变量，并兼容 `REVIEW_MODELS`。
- [x] 测试任一大角色可选择所有现有注册 provider。

## Phase 3: existing backend registry

- [x] 保留 Go `Backend` interface 和现有 Codex/Gemini/Claude/Antigravity/
  Grok backends。
- [x] 不修改 Go registry；GPT Pro 保持 explicit manual command。
- [x] 按用户边界延期 `CommandBackend` 和 generic fixture。
- [x] 运行现有 Go 全量测试验证 registry/session/process 行为。

## Phase 4: Codex skills and three-role classification

- [x] Codex Skills 将任务切片分类为 frontend/backend/search，再调用
  provider adapter；analysis/planning/review 属于角色内部阶段。
- [x] 删除 routable role 的 Gemini-first/Codex-only/Claude-permanent
  provider-name 规则；保留 Codex lead/workspace owner。
- [x] 按用户边界不实现 task override/permission/expiry 子系统。
- [x] 明确点名 Provider 的任务行为不修改持久路由。

## Phase 5: Harness projection and provenance

- [x] CCG 全门禁通过后提交个人源码，记录 version/commit/tree。
- [x] 使用现有 Harness transaction 更新 snapshot、manifest 和 installed
  runtime，并测试 rollback。
- [x] 不增加 Harness 路由投影、第二事实源或权限系统。

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
Push-Location .\codeagent-wrapper
go test ./...
Pop-Location

node --test .\tests\harness-adapter.test.mjs
pnpm harness:test
pnpm verify:sources
pnpm doctor
pnpm harness:conflicts
```

行为验证：

- [x] frontend/backend/search 分别切换到所有现有内置 backend。
- [x] analysis/planning/review 不作为独立持久化 route。
- [x] 每次 set 只改变目标 role。
- [x] 原版旧配置与旧模板兼容。
- [x] 未增加 generic backend 或 task override 子系统。
- [x] version/tree drift 仍是 blocking conflict。

## Rollback

- 配置 migration 使用备份和原子替换。
- CCG source 通过独立 commit 回滚。
- Harness 使用 transaction snapshot 回滚。
- 不 reset/clean 用户现有工作树。
