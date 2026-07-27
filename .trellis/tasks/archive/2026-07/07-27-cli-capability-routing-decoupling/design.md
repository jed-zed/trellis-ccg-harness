# Design: minimal role-map extension of original CCG

## Architecture decision

不再采用 v1 的“中立配置根 + 独立 Harness routing 文件 + Node dispatcher +
Go registry 删除”方案。v2 直接扩展原版 CCG：

```text
user runs original-style installer/config command
        |
        v
existing CCG config.toml
  routing.frontend
  routing.backend
  routing.search
        |
        +--> original template variable injection / refresh
        +--> read-only role resolver for Codex Skills
        +--> existing Go codeagent-wrapper Backend factory
        +--> Harness context/conflict projection
```

CCG config 是路由唯一事实来源。installer、模板、Codex Skills、wrapper 和
Harness 读取同一结构，不再各自定义“谁负责前端/后端”。

## Configuration contract

在现有 `config.toml` 内演进，不迁移到新的全局目录：

```toml
[routing]
mode = "smart"

[routing.frontend]
primary = "gemini"
models = ["gemini"]
strategy = "fallback"

[routing.backend]
primary = "codex"
models = ["codex"]
strategy = "fallback"

[routing.search]
primary = "grok"
models = ["grok"]
strategy = "fallback"
```

持久配置只包含 frontend/backend/search。analysis、planning、review 是
每个大角色内部的阶段，由 Skill 按任务切片选择对应大角色 Provider。

旧配置的 `routing.frontend/backend` 继续读取；缺失 search 时补默认。
`REVIEW_MODELS` 仅作为旧模板兼容变量保留，不再代表独立 review 路由。

## Backend registry

保留 Go `Backend` 接口和现有 Codex/Gemini/Claude/Antigravity/Grok
backends，不修改 process/stream/session/timeout。GPT Pro 继续是明确点名
的 manual bridge，不进入通用角色列表。本次不增加 `CommandBackend` 或
可执行文件注册层。

## Role selection

installer 菜单展示三个大角色，然后：

1. 选择 frontend/backend/search；
2. 从 backend registry 动态选择 provider；
3. 可选设置该 provider 的 model；
4. 仅替换 `routing.<selected>`；
5. 使用原版 installer 刷新生成内容。

非交互入口提供 list/get/set，所有写操作复用同一 writer。analysis、
planning、review 不出现在切换菜单。

## Template and Codex-mode behavior

原版 Claude 模式继续通过模板变量调用 `codeagent-wrapper --backend
<resolved-provider>`。注入器从 role map 动态生成
`{{<ROLE>_PRIMARY}}`/`{{<ROLE>_MODELS}}`，并保留旧变量。

Codex plugin Skills 改成 provider-neutral：

1. 将任务切片分类为 frontend/backend/search 并查询有效 route；
2. 根据 provider adapter 调用现有 Gemini preview、Grok ACP、GPT Pro
   manual bridge 或 codeagent-wrapper；
3. 获取补丁/证据；
4. Codex 审查并执行最终工作区修改和验证。

这里不增加通用 Node dispatcher；“role resolver + 现有 adapters”足够。

## Task-local explicit selection

用户在当前提示中明确点名 Provider 时，Codex 仅在当前任务内按该要求执行，
不回写持久配置。本次不建立 task override 文件、权限或 expiry 子系统。

## Harness integration

`.harness/adapter.json` 保持 lifecycle/runtime/source boundary，不保存第二份
角色路由。本次 Harness 只通过现有 transaction 同步 CCG commit/tree/
version/snapshot，不新增角色投影或权限系统。

## Version reconciliation

原版 upstream `3.2.3` 没有在 3.2.1–3.2.3 重写 backend 架构；个人
`v3.3.3` 是 Codex/Grok/GPT Pro 扩展线。实现基线使用审核后的个人
`gptpro/main`，同时比较 upstream 最新提交，避免遗漏原版修复。

完成 CCG 源码提交后，只通过 `harness:update` transaction 导入；事务必须
验证 clean worktree、完整 commit/tree、版本、生成资产和回滚。

## Rejected alternatives

- **新 Node dispatcher**：复制 wrapper 执行职责，扩大偏离。
- **删除 Go backend registry**：破坏原版成熟的 stream/session 边界。
- **新增 `.harness/routing.json`**：形成第二事实源。
- **移动到 `~/.ccg`**：不是当前自由切换的必要条件。
- **硬编码每个 role/provider 组合**：下一个 CLI 会再次要求大改。
