# Decouple CLI role routing with original CCG semantics

## Goal

以原版 `fengshao1227/ccg-workflow` 为架构基线，只做两类必要差异：

1. 把原版固定的 frontend/backend/review 扩展为可独立配置的职责集合；
2. 在 Codex 模式下由 Codex 取代 Claude Code 成为主编排器和最终工作区写入者。

用户应能通过原版风格的安装器/配置入口，把任一已注册 CLI 独立分配给
frontend、backend、search 三个大角色；切换一个角色不需要修改源码，也
不能改变其他角色。analysis、planning、review 是这三大角色内部的工作
阶段，不是独立 Provider 路由。

## Baseline invariants

- 保留原版 `config.toml -> installer -> generated templates -> codeagent-wrapper`
  主链路，不引入平行 orchestration framework。
- 保留 Go `Backend` 接口、stream/session/timeout 行为和预编译 wrapper
  发布方式。
- 保留外部 CLI 交付补丁/证据、主编排器审查后落地真实工作区的边界。
- 原版模式仍可由 Claude Code 编排；Codex 模式只替换 lead orchestrator，
  不改变 provider/backend 的基本抽象。

## Requirements

### R1. Three top-level roles

- 持久配置只包含 frontend、backend、search 三个可切换大角色。
- 每个大角色独立保存 primary、models/fallbacks、strategy。
- analysis、planning、review 按任务领域在对应大角色内部执行。
- 修改一个大角色必须保持另外两个大角色的有效配置不变。

### R2. Registered backends

- 内置 backend 保留 Codex、Gemini CLI、Claude Code、Antigravity、Grok，
  并接入本项目已有 GPT Pro bridge。
- frontend/backend/search 是工作角色，不是 provider 类型；任一现有注册
  backend 均可承担任一大角色。
- 本次只使用现有 Go wrapper registry，不增加通用 executable 注册平台。

### R3. Original-style installer

- 继续使用原版安装器/菜单作为主要切换入口。
- 流程改为“选择三大角色之一 -> 选择 backend -> 确认”，动态列出注册
  backend。
- 切换只写所选角色；如生成模板需要刷新，复用原版刷新机制。
- 同时提供非交互命令，供测试和 Codex Skill 查询有效职责。

### R4. Provider-neutral Codex skills

- Codex Skills 不再写死 Gemini=frontend、Codex=backend 或 Claude 永久禁用。
- Skill 先把任务切片分类为 frontend/backend/search，再调用该角色的
  backend adapter/helper；分析、计划、审查沿用同一角色 Provider。
- Codex 始终是 Codex 模式的主编排器、真实工作区默认写入者和最终验证者。
- backend 选择与 `workspace_write` 权限分离。

### R5. Task-local explicit requests

- 用户在当前任务明确点名的 Provider 只覆盖当前任务行为，不改持久配置。
- 不新增 task permission、expiry 或 authorization 子系统。

### R6. Backward compatibility

- 旧 frontend/backend 继续读取；search 缺失时补默认。
- 保留旧模板变量 `FRONTEND_PRIMARY`、`BACKEND_PRIMARY`、`REVIEW_MODELS`
  的兼容注入；review models 由对应代码角色或旧模板输入生成。
- 现有默认仍是 Gemini frontend、Codex backend、Grok search；Codex
  模式 lead 仍为 Codex。
- 未安装 backend 明确报错或只使用该职责显式 fallback。

### R7. Harness projection, not second authority

- CCG 配置是职责路由唯一事实来源；Harness 不新增第二份项目路由。
- Harness 只声明 Codex lead/workspace boundary、provider availability、
  task authorization 和来源身份，并展示 CCG effective routing。
- 删除 provider-name 等于职责的永久规则；保留权限、安全和来源漂移门禁。

### R8. Provenance-safe update

- 原版 upstream 当前已验证为 `3.2.3`；个人远端当前为 `v3.3.3`。
- 当前 Harness 固定 `3.3.0`、已安装 CLI 较新，属于真实来源/版本漂移。
- 实现必须从个人权威仓库的干净 worktree 开始，并通过现有 Harness
  transaction 同步 package version、commit、tree、snapshot 和 runtime。
- 不通过手改版本字符串掩盖漂移。

## Acceptance criteria

- [ ] installer 可把 frontend、backend、search 分别切换到现有注册的
  Codex、Gemini、Claude、Antigravity 或 Grok。
- [ ] 切换一个大角色时，另外两个大角色的有效配置不变。
- [ ] analysis、planning、review 不作为持久化独立路由项。
- [ ] 切换不需要源码修改；刷新行为沿用原版 installer。
- [ ] 旧配置迁移后有效默认不变，旧模板变量仍可生成。
- [ ] Codex Skills 不含 routable role 的 provider-name 强制策略。
- [ ] routed helper 默认不能直接写真实工作区；Codex 保持最终 owner。
- [ ] 不新增 generic command backend 或 task authorization 子系统。
- [ ] Harness 只投影 CCG 路由，没有第二份路由事实源。
- [ ] CCG/Harness source、version、commit、tree 和安装 runtime 一致。
- [ ] TypeScript、Go wrapper、installer、migration、Harness 和安全门禁通过。

## Out of scope

- 新建 Node role dispatcher、全新 host-neutral 配置体系或第二套路由文件。
- analysis、planning、review 的独立 Provider 配置。
- generic executable registry、task permission/expiry 系统。
- 重写 Go wrapper 的 stream/session/process 实现。
- 让项目仓库注册任意可执行命令或授予 workspace write。
- 本次规划调用 Claude Code。
- 把本任务的 Gemini/Grok/GPT Pro 授权写成永久默认。
