# Add Context7 Playwright DeepWiki Exa add-ons

## Goal

让从 GitHub 链接或交互式菜单安装 CCG/Harness 的用户，在默认不安装任何
第三方组件的前提下，能明确看到并快捷进入 Context7、Playwright、DeepWiki
和 Exa 的安装/配置流程；其中 Exa 必须先展示官方 API key 获取入口，并按
现有密钥安全边界处理凭据。

## Background

- `ccg init` 的辅助 MCP 菜单已经列出四项，但 `ccg addons` 只公开 Context7。
- Harness 的 `pnpm addons` 目前只公开 Context7，没有 Playwright、DeepWiki
  和 Exa。
- CCG 的第三方清单已经固定 `@playwright/mcp@0.0.78` 与
  `exa-mcp-server@3.2.1`。
- CCG 仍把 DeepWiki 配成非官方 `mcp-deepwiki@0.0.10`；该项目已明确声明
  当前不可用，并建议改用官方远程 MCP。
- 官方 DeepWiki 服务是无需认证的远程 Streamable HTTP MCP：
  `https://mcp.deepwiki.com/mcp`。
- Exa 官方支持 `https://mcp.exa.ai/mcp` 的基础远程服务，也支持使用
  `EXA_API_KEY` 的本地 npm 模式；用户要求显式引导获取 API key。

## Requirements

1. Context7、Playwright、DeepWiki、Exa 都必须出现在首次推荐、`ccg addons`
   和 Harness `pnpm addons` 的可发现路径中。
2. 所有推荐项默认未选择；仓库 URL、推荐标记和 AI 安装文档都不得视为安装、
   联网、登录、浏览器下载或凭据授权。
3. 快捷入口必须复用 CCG 的受控 MCP ownership、冲突检测、回滚和三端同步
   路径，不得创建第二套未经 ownership 保护的配置写入器。
4. DeepWiki 必须使用官方 `https://mcp.deepwiki.com/mcp`，不得继续推荐或
   新装失效的非官方 `mcp-deepwiki` npm 包。
5. Playwright 必须使用已经固定的 `@playwright/mcp@0.0.78`；浏览器二进制
   下载、复用现有登录态和非隔离浏览器配置不随推荐自动授权。
6. Exa 必须显示官方 API key 获取页
   `https://dashboard.exa.ai/api-keys`，并说明基础远程服务、提高限额/生产
   使用和本地 npm 模式的差异。
7. 当用户选择需要 Exa API key 的模式时，密钥不得写入仓库、任务、计划、
   日志、命令行参数或 URL；只能进入现有 owner-only secret launcher/host
   secret 配置边界，并在输出中保持遮蔽。
8. Context7 继续复用已审核的精确来源，不因本任务自动升级依赖；Playwright
   和 Exa 继续使用精确 npm selector 与 SRI。远程 DeepWiki 必须记录官方
   文档和固定服务 URL，并明确远程服务本身不是可用 SRI 锁定的本地制品。
9. `AI_INSTALL.md` 必须让“把 GitHub 链接交给 AI 安装”的路径先展示四项、
   影响、数据外发、密钥获取方式和审批步骤，再等待用户逐项批准。
10. CCG 是权威实现源；Harness 只能在 CCG PR 合并后用正式
    `pnpm harness:update` 同步 `components/ccg-workflow/` 和
    `harness.sources.json`。

## Acceptance Criteria

- [ ] `ccg addons --json` 返回四个 MCP 候选，全部 `selected: false`，并为
      每项给出真实来源/服务、网络与数据外发说明及可执行的下一步。
- [ ] `ccg addons` 的人类可读输出包含 Context7、Playwright、DeepWiki、
      Exa，且明确“默认跳过”和“推荐不等于授权”。
- [ ] `ccg init` 的 DeepWiki 安装结果使用
      `https://mcp.deepwiki.com/mcp`，不再执行 `mcp-deepwiki`。
- [ ] `ccg init` 的 Exa 流程先显示
      `https://dashboard.exa.ai/api-keys`；测试证明密钥不会出现在配置、
      日志、argv 或 URL 中。
- [ ] Harness `pnpm addons -- --status ...` 返回四项，并能把批准后的实际
      配置动作安全地交给现有 CCG MCP 流程；未批准时零写入、零执行、零联网。
- [ ] Harness 交互菜单对四项均默认 `no`，网络和最终执行仍需独立批准。
- [ ] `AI_INSTALL.md` 与 README 对直接交给 AI 的 GitHub 安装方式给出同样
      的四项清单、Exa key 获取入口和逐项审批边界。
- [ ] 非官方 `mcp-deepwiki` 不再存在于可执行清单、辅助 MCP 配置和相关
      “required package” 测试中。
- [ ] CCG 定向测试、类型检查、lint、build 与安全/变更门禁通过。
- [ ] CCG 合并后，Harness 用正式更新命令同步，来源验证、Harness 全门禁
      和两个仓库的远端 CI 均通过后才可声称可合并。

## Out of Scope

- 自动注册 Exa 账号、自动创建/读取 API key 或代用户登录。
- 自动把密钥放进 URL query、仓库 `.env` 或普通 MCP JSON/TOML。
- 自动下载 Playwright 浏览器、复用用户浏览器 profile 或授予网站权限。
- 为 DeepWiki 私有仓库配置 Devin 账号或 Devin API key。
- 在没有新授权的情况下提交、推送、创建或合并新的 CCG/Harness PR。

## Open Questions

无阻塞产品问题。实现必须保留现有“推荐但默认跳过”的用户选择。
