# Install latest optional third-party integrations

## Goal

让 GitHub 仓库的可选第三方安装流程不再随仓库固定具体版本、Git commit、
release tag、SRI 或 npm lockfile。每次用户明确选择安装时，流程解析当时最新
上游版本，并安全安装该次解析结果。

## Background

- 当前 `third-party-sources.json` 固定 Matt Pocock Skills、Caveman、Ponytail、
  CodeGraph、fast-context、Context7、Playwright、Exa 和 ripgrep 的 commit、
  release、integrity、lockfile 或资源摘要。
- Harness 的计划摘要、Git 获取、npm 工具安装、MCP launcher、ownership 和
  测试均依赖这些固定字段。
- CCG snapshot 还为相关 add-on MCP 生成精确 npm selector；Context7、
  Playwright、Exa、CodeGraph 和 fast-context 因此仍会落到固定版本。
- 用户明确要求 GitHub 仓库不再指定这些可选插件/Skill/MCP/CLI 的版本，
  直接使用最新版。

## Requirements

1. 仓库不得为下列可选 add-on 保存具体版本、release tag、Git commit、
   Git tree、npm SRI、npm lockfile 或 release asset SHA：
   - `grill-me + grilling` 及 Matt Skills 项目 Skill；
   - Caveman；
   - Ponytail plugin、hooks 与全局 `full` 默认；
   - CodeGraph、fast-context、Context7、Playwright、Exa、ripgrep。
2. 仓库内置的 `chatgpt-pro-sidebar`、`grill-with-docs` 等 Harness 平台 Skill
   继续随仓库版本发布；它们不是外部浮动安装项，不新增第二套更新通道。
3. Trellis、个人 CCG 源码 snapshot、CCG CLI/plugin 自身、Provider runtime
   和其他未列出的 CCG 依赖继续使用现有固定来源规则。
4. 每次安装计划必须从官方 npm registry、credential-free HTTPS Git 仓库或
   官方 GitHub release 解析当前最新版。解析动作需要现有第三方网络批准。
5. 计划展示稳定来源和 `latest` channel；apply 在获得单独网络批准后解析、验证
   并记录实际 version/commit/tree/integrity，不得把结果写回仓库固定清单。
6. 下一次新 apply 重新解析最新版；status 与 plan-only 保持本地只读，不能声称
   已验证远端最新版。
7. npm/Git/release 解析结果与下载内容仍须进入 Harness 私有 cache、ownership、
   transaction、rollback 和 drift 检查；用户自有目标不得被覆盖。
8. CCG 管理的 add-on MCP 使用明确的 `@latest` 通道或等价最新版解析，且只
   放宽本任务列出的 allowlist；其他 CCG 可执行依赖继续精确校验。
9. 现有推荐项仍默认未选择。仓库 URL、推荐标记或一次普通 setup 不得自动
   授权第三方下载、hook trust、浏览器下载、登录、凭据或 `codegraph init`。
10. 已由 Harness 管理的旧固定版本可在新明确审批后升级；drifted 或 user-owned
    安装继续 fail closed，不得静默接管。
11. README、`AI_INSTALL.md`、Harness Init Skill、tooling spec 与 CLI 输出必须
    统一解释最新版解析和单次事务冻结语义。

## Acceptance Criteria

- [ ] 分发 manifest 只记录稳定来源/channel/capability 元数据，不含上述候选的
      数字版本、40 位 commit/tree、SRI、lockfile 或 release asset SHA。
- [ ] `pnpm addons -- --status` 保持本地只读，显示安装状态与 `latest` channel，
      不声称已验证远端最新版。
- [ ] `--plan-only` 输出选中候选的官方来源、`latest` channel 和绑定选择/策略的
      `planSha256`，不联网且不写入安装目标。
- [ ] apply 在单独网络批准后解析并验证当时的最新版；实际 identity 进入
      ownership/journal，仓库 manifest 保持稳定且不被运行时反写。
- [ ] 新计划可解析出更新版本，并把 Harness-owned 旧版本报告为可升级而不是
      drifted/user-owned。
- [ ] Git Skill、Ponytail、npm MCP/CLI 和 ripgrep 各有至少一个最新版解析与
      ownership/事务回归测试。
- [ ] CCG add-on 配置对 Context7、Playwright、Exa、CodeGraph、fast-context
      使用最新版通道；未列入 allowlist 的 CCG 依赖仍拒绝 mutable selector。
- [ ] 两份 Harness third-party manifest 投影保持一致；过时 npm lock assets
      被删除且没有残余引用。
- [ ] 默认跳过、独立网络批准、strict-data boundary、ownership、rollback、
      secret redaction、`codegraph init` 禁令全部保留。
- [ ] Harness focused/full gates、CCG lint/typecheck/test/build、来源验证和远端
      CI 通过。

## Out of Scope

- 取消 Trellis/CCG 核心版本与个人 CCG commit/tree provenance。
- 自动安装所有推荐项或取消逐项批准。
- 自动信任 Ponytail hooks、运行 `codegraph init`、下载 Playwright 浏览器、
  登录第三方服务或读取/生成 API key。
- 让离线安装声称拿到远端最新版。
- 为未列出的 CCG executable dependency 改成 `latest`。

## Key Decisions

- 仓库声明浮动 `latest` channel；apply 保存动态解析出的实际 identity。
- status 与 plan-only 保持离线；只有用户选择安装并批准网络后才解析远端最新版。
- 复用现有 approval、cache、ownership、transaction 和 rollback，不建第二套
  安装器。
- CCG 权威源先改并合并，再通过正式 Harness update 同步 snapshot。

## Open Questions

无阻塞产品问题。
