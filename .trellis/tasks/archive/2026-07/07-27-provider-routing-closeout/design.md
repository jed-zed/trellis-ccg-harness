# Design: Persistent provider routing closeout

## Architecture

保持现有三层边界：

1. CCG `3.4.0` 是角色路由与 Provider 包装器权威。
2. Harness 只声明写入权限、来源与冲突边界，不维护第二份角色映射。
3. Codex marketplace 从持久的 Harness CCG 快照安装插件，不直接编辑缓存。

## Provider Contract

- `.harness/adapter.json` 中的模型条目描述 `routable`、
  `workspaceWrite` 与运行时 CLI 判定方式，不再用 `enabled=false`
  表示永久禁用。
- Codex 保持 `workspaceWrite=true`；所有外部 Provider 保持
  `workspaceWrite=false`。
- `checkModelPolicy` 只验证写入所有权与 Provider 只读边界，不再检查
  `HARNESS_ENABLE_CLAUDE` 或要求 Claude 永久禁用。
- 角色的实际 Provider 由已安装 CCG 的
  `ccg routing get frontend|backend|search --json` 解析。
- Provider CLI 缺失时，由 CCG 包装器/doctor 报可用性错误；Harness
  不把缺失状态持久化成项目策略。

## Grok Boundary

`models.grok.routable` 表示 Grok 可以被三角色选择。独立的
`providers.officialGrokCliAcp` 与 `[intelligence] enabled` 继续表示
付费 external-intelligence opt-in。两者不得再用同一句 “Grok disabled”
混合描述。

## Persistent Plugin Registration

1. 保留历史分支，令持久 checkout 切到并快进远端 `main`。
2. 从该 checkout 运行现有 Harness 安装脚本，使 marketplace 根目录与
   CCG `3.4.0` 来源一致。
3. 由 `codex plugin marketplace` / `codex plugin add` 更新登记状态与缓存。
4. 用 `codex plugin list`、doctor 和缓存内容验证；不手工复制缓存。

## Compatibility

- 不改 CCG 三角色配置格式。
- 不改 Provider 凭据命名与 Grok 付费 opt-in。
- 保留 Codex 唯一工作区写入与最终验证边界。
- 历史归档任务不回写；只更新当前规范与运行代码。

## Rollback

- 仓库变更可通过收尾提交回退。
- Harness 安装脚本现有 ownership/transaction 记录负责恢复插件与
  marketplace 旧状态。
- 不删除旧分支、旧 checkout 或用户 Provider 配置。
