# Technical Design

## Architecture

本任务沿用现有分层：

1. 个人 CCG fork 是 MCP 配置行为与 `ccg addons` 目录的权威源。
2. Harness 的 `pnpm addons` 负责展示审批证据和提供快捷入口，但不复制
   CCG 的 MCP ownership/secret/sync 实现。
3. Harness 只在 CCG 变更合并后通过 `pnpm harness:update` 同步权威快照。

## CCG Changes

### Add-on catalog

扩展 `src/commands/addons.ts`：

- 保留 Context7。
- 增加 Playwright、DeepWiki、Exa。
- Playwright 与 Exa 从 `third-party-sources.json` 读取精确 npm 来源。
- DeepWiki 使用官方远程服务来源元数据，不再引用 `mcp-deepwiki`。
- 每项继续为只读、默认跳过，并指向 `ccg init` 的辅助 MCP 菜单。

### Auxiliary MCP installer

调整 `src/commands/config-mcp.ts` 和 MCP 配置工具：

- Context7、Playwright、Exa 继续走受 pin 校验的 stdio 配置。
- 新增受控远程 MCP 配置入口，DeepWiki 只允许官方 HTTPS endpoint。
- 远程入口复用 `configureMcpInClaude`、ownership ledger、备份、回滚及
  Codex/Gemini mirror；目标主机输出必须采用各自支持的 URL 配置形状。
- CCG-owned MCP ID 集合加入 Playwright、DeepWiki、Exa，确保安装、同步、
  卸载和恢复对称。
- 删除 `mcp-deepwiki` 的 npm 可执行来源及相关测试期望。

### Exa credential boundary

- 菜单先展示 `https://dashboard.exa.ai/api-keys`。
- 默认说明官方远程服务可先使用基础免费额度；选择本地/自有 key 模式时才
  请求 key。
- 本地 npm 模式继续使用 `exa-mcp-server@3.2.1`，通过
  `createSecretBackedMcpConfig` 写入 owner-only secret spec，由 launcher
  注入 `EXA_API_KEY`。
- 禁止把 key 写入 URL、argv、普通 MCP config、计划和日志。
- URL/headers 型 Exa 自带 key 配置不在本次自动写入范围内。

## Harness Changes

- 在 `.agents/skills/harness-init/assets/third-party-sources.json` 增加三项，
  并把分发镜像 `.harness/third-party-sources.json` 保持字节一致。
- 候选条目公开来源、effects、data egress、credentials guidance 和下一步；
  Context7/Playwright/DeepWiki/Exa 均为推荐但默认未选。
- 对实际 MCP 配置采用 “CCG-managed/manual handoff” action：Harness 可
  生成经摘要绑定的计划并在用户批准后显示/调用固定 CCG 子命令，但不得在
  Harness 中复制密钥采集或 MCP ownership 写入。
- 如果现有第三方 action schema 无法安全表达 handoff，则先扩展为显式
  `manual-pending`/`ccg-managed` action，并让状态、计划、交互菜单和 AI
  文档一致；不得把手工待办误报为 installed。

## Compatibility

- 现有 Context7 安装继续可识别，不迁移或覆盖用户自有同名配置。
- 旧的 CCG-owned `mcp-deepwiki` 若存在，只能在用户明确卸载/迁移批准后
  释放；安装新 `deepwiki` 时不得静默删除用户配置。
- 遇到同名未归属配置时继续 fail closed，并提供显式 adoption 选择。

## Rollback

- CCG：ownership ledger 恢复原 MCP entry，删除仅由 CCG 创建且未漂移的
  secret spec；不触碰用户自有配置。
- Harness：恢复第三方 manifest、动作 schema、文档和测试；正式
  `harness:update` 失败时回滚整个 CCG snapshot/source manifest 事务。
