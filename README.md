# Trellis CCG Harness

这是 `jed-zed` 的 AI 开发 Harness：用 Trellis 管理任务、PRD、规范和工程记忆，用 Codex-only CCG 管理 Codex、Gemini、Grok、GPT Pro、外部证据和质量门禁。

> 重要：本仓库里的 CCG 不是重新从原作者仓库下载的默认版本。权威来源是 [`jed-zed/ccg-gptpro-worflow`](https://github.com/jed-zed/ccg-gptpro-worflow) 的个人主线；精确 commit、Git tree 和捕获时间只以 [`harness.sources.json`](harness.sources.json) 为准。原作者仓库只作为上游来源和版权归属记录。
> `harness.sources.json` 中的 CCG 版本只描述仓库内的源码快照，不锁定本机
> 已安装的个人 CCG CLI/插件版本；个人 CCG 与 Harness 的跨版本兼容性由同一
> 所有者维护。

这里的 Harness 不是第三套框架或另一个依赖。**Trellis + 个人 CCG 的组合本身就是 Harness**；本仓库的脚本、来源清单和 CI 只是让这套组合可以安全安装、验证、升级和迁移。

> 如果你准备把本仓库链接直接交给 AI 安装，请同时让它遵守
> [`AI_INSTALL.md`](AI_INSTALL.md)。仓库链接只授权只读检查和计划，不代表
> 已批准全局写入、可选扩展、第三方联网、Provider 登录或付费调用。

## 当前组成

| 层 | 版本/来源 | 职责 |
|---|---|---|
| Trellis | `@mindfoldhq/trellis@0.6.9` | 任务、PRD、设计、实施计划、规范、上下文与完成闭环 |
| CCG | `jed-zed/ccg-gptpro-worflow` 个人源码快照（见来源清单） | 多模型编排、Grok 联网证据、GPT Pro、Codex 插件与质量门禁 |
| 组合仓库 | 本仓库 | 把 Trellis + 个人 CCG 固化为一个 Harness，并提供分层适配器、来源锁定、诊断、验证、CI 与安全边界 |

CCG 的完整个人 tracked 源码位于 [`components/ccg-workflow`](components/ccg-workflow)。来源和 Git tree 记录在 [`harness.sources.json`](harness.sources.json)。

## 分层适配器

```text
Trellis 生命周期层
  ↓ canonical task / PRD / design / plan / spec
Harness 内部适配器
  ↓ context / policy / conflict audit / provider boundary
CCG 智能层
  Codex / Gemini / optional Grok / manual GPT Pro / quality gates
```

`.harness/adapter.json` 是无密钥的权责契约，`scripts/harness-adapter.mjs`
提供规范化上下文、冲突审计和显式 provider 探针。它们只是 Harness
内部胶水，不是第三套框架。

## 为什么采用个人源码快照

个人 CCG 主线相对原上游共同基线包含持续演进的个人提交与源码差异，其中包括：

- Grok Build CLI 隔离 ACP 外部情报层；
- Web/X 证据、缓存、保留和导出；
- GPT Pro plan/review/execute 证据桥；
- Codex 原生插件、commands、skills 和 doctor；
- CCG 自动搜索路由和 fail-closed 验证；
- Gemini 预览、可选外部 Provider 引导与完整回归测试。

为了避免把这些工作替换成原作者当前版本，Harness 的更新和验证都以个人 fork URL、commit 和 Git tree 为准。

## 快速开始

前置要求：

- Node.js 20+
- Python 3.9+
- PowerShell 7+
- pnpm/Corepack
- Go（CCG wrapper 的 test/build 门禁必需）
- Codex CLI（精确安装本地 CCG Codex 插件所必需）
- Gemini、Grok、Claude Code CLI 均为独立可选 provider；Global Setup 不会隐式安装或登录 Claude，
  只有显式授权的产品经理调用才会启动已有 Claude CLI

```powershell
git clone --branch v0.2.0 --depth 1 https://github.com/jed-zed/trellis-ccg-harness.git
Set-Location trellis-ccg-harness
corepack enable
corepack prepare pnpm@10.17.1 --activate

# 公开基线：逐项预览、选择和批准；个人 Skill catalog 默认跳过
pnpm setup
```

`pnpm setup` 是面向用户的 **Global Setup**，每个用户环境运行一次。它会：

1. 在任何写入前预览并检查精确 Trellis 版本、来源清单记录的当前 CCG 快照指纹、首次
   `ccg codex-mode install` 或已有 Codex mode 的只读 doctor、当前 Harness snapshot 的本地 Codex marketplace /
   CCG 插件、13 个 bundled platform Skills、个人 catalog 选择和 provider
   状态；
2. 交互模式逐项确认核心动作，随后执行 Global Init；自动化模式必须给出
   完整 flags 和所有批准开关；
3. 对相同 snapshot 保持幂等；仅当旧 marketplace/plugin 的精确身份仍匹配
   Harness ownership 且上一组已验证快照可用于回滚时，才事务式升级；
   未被 Harness 所有或发生路径/版本漂移时 fail closed，不会覆盖；
4. 只把 provider 的 `install` / `login` 选择记录为待单独批准动作并输出
   status/guidance，绝不把安装或登录塞进本次总授权；安装始终按官方文档手动
   完成。独立命令会绑定 Codex/Grok 的固定 auth-only 指引并要求第二次确认，
   但不会启动 Provider CLI；Gemini 没有获准的 auth-only 子命令，也只提供
   手动登录指导，不启动其完整交互 agent；
5. Global Setup 中 Claude 安装/登录默认 `skip`，只提供官方文档，不探测、不启动。显式选择 Claude
   安装/登录会被标为退出 zero-`.claude` profile，但仍不会由 Harness 执行；
6. 每个 Harness-owned 步骤后比较用户级和项目级 `.claude` 状态；已有内容
   保持不变，任何创建或修改都会立即停止后续步骤。

如果 13 个平台 Skill 已由早期 Skill-platform migration 管理，Global Init
只在旧清单、目标路径和每个 Skill tree digest 全部匹配时接受该状态；它不会
重写旧清单、备份链、保留的外部 Skill 或项目迁移记录。

尚未发布到权威远端的当前 CCG 快照只能从明确给出的干净源码 checkout 联动安装：

```powershell
pnpm setup -- -CcgSourceCheckout I:\path\to\clean-ccg-checkout
```

第三方 Skill、插件和 MCP/CLI 不属于这 13 个核心项。先运行
`node .\scripts\harness-init.mjs third-party-plan --home-dir <absolute-user-home>`
查看固定来源、许可、写入范围、hook、网络与数据外发影响；四个分组默认全部
不选，只有用户对具体候选明确批准后才安装。初始化器会明确推荐适用候选，
包括 Ponytail、Caveman、Context7、fast-context 和 CodeGraph，但推荐不会
自动勾选或授权安装。Context7 会发送文档查询和库标识，`fast-context`
会发送查询和目录/检索数据；受严格数据边界时两者必须保持未选。
最终交互批准会同时展示第三方 `planSha256`、批准的 package/command roots、
子进程配置根和绑定命令身份；批准只覆盖这一份完整计划。非交互模式只要
选中了任意第三方候选，就必须在 source manifest 摘要之外再传
`--third-party-plan-sha256 <reviewed-planSha256>`；拒绝全部候选时仍可使用
明确的 `none` 公共基线。
选中需要下载的候选后，交互初始化还会单独询问第三方网络授权，列出候选、
固定仓库/提交和 source manifest 摘要，默认 `no`。拒绝网络只跳过这些候选，
不阻塞 13 个 core Skills/Trellis/CCG。私人 catalog clone 使用另一项
`AllowCatalogNetwork`，不会与第三方下载共用授权；自动化若确需下载第三方，
必须显式传 `AllowThirdPartyNetwork`/`--allow-third-party-network`。
批准安装的 MCP 会生成 Harness-owned 本地 launcher；每次启动前都会
重新验证批准清单摘要、ownership、精确包版本/SRI、lockfile、完整安装树
指纹和唯一入口，任何漂移都会 fail closed。由于 Codex host 当前没有
原子 create-only 的 MCP 注册接口，初始化器不会覆盖或自动新增同名配置；
注册 launcher 保持 `manual-pending`，先向用户展示现有状态和人工命令。

首次 Global Setup 会明确说明“推荐不等于选择”，每个第三方候选仍默认
`no`/跳过；完成后会列出仍未安装或需要处理的推荐项。以后可随时运行：

```powershell
# 交互菜单；每项默认 skip
pnpm addons

# 只读状态
pnpm addons -- --status --home-dir <absolute-user-home> --repo-root .

# 只读 AI/自动化计划；三个全局分组必须全部显式给出
pnpm addons -- `
  --plan-only `
  --home-dir <absolute-user-home> `
  --repo-root . `
  --third-party-global-skills none `
  --third-party-global-plugins none `
  --third-party-mcp-cli none
```

`pnpm addons` 只管理全局候选；项目专属 Skills 仍由 `project-init` 的同一
Trellis contract 管理。`--status` 和 `--plan-only` 都是只读命令。
非交互 apply 必须重复计划中的精确候选，并同时传
`--third-party-source-sha256`、`--third-party-plan-sha256` 和
`--approved`；计划含网络候选时还要单独传
`--allow-third-party-network`。完整的 AI 状态机和命令见
[`AI_INSTALL.md`](AI_INSTALL.md)。

当 Global Init 返回 `needs-provider-actions` 时，先为单个待办生成只读计划：

```powershell
node .\scripts\harness-init.mjs provider-action-plan `
  --home-dir <absolute-user-home> --repo-root <absolute-project> `
  --provider codex --action login
```

确认 `planSha256` 后，用第二个独立命令显示 Codex/Grok 的固定 auth-only
手动指引：

```powershell
node .\scripts\harness-init.mjs provider-action-run `
  --home-dir <absolute-user-home> --repo-root <absolute-project> `
  --provider codex --action login `
  --plan-sha256 <reviewed-planSha256> --approved
```

该命令会弹出默认 `cancel` 的 `cancel/show-guide` 选择，并拒绝非交互执行。
计划会绑定规范绝对可执行文件/Node 入口、包版本与文件哈希，供用户核对；
Harness 不启动命令、不继承 Provider 终端、不生成 Provider action receipt，
也不记录输出、URL、设备码、账号或 token。所有 Provider 安装与登录均由
用户在审阅指引后手动完成；这也避免把完整 Gemini agent 误当作认证助手，
并保证 Claude 永远不会被 Harness 探测或启动。
Provider 状态探测和第三方来源/安装辅助只运行已绑定且再次验证的绝对命令；
子进程使用计划内 home/config roots 构造的最小环境，不继承
`NODE_OPTIONS`、`NODE_PATH`、`LD_PRELOAD`、`DYLD_*`、ambient `GIT_*`
或其他未允许变量。

公开、无私人 catalog 的非交互示例：

```powershell
pnpm setup -- `
  -NonInteractive `
  -HomeDir <absolute-user-home> `
  -CatalogMode skip `
  -ProviderActions "codex=later,gemini=later,grok=later,claude=skip" `
  -Approved `
  -ApproveTrellis `
  -ApproveCcgCli `
  -ApproveCodexMode `
  -ApproveCcgPlugin `
  -ApproveGlobalInit
```

`scripts/bootstrap.ps1` 仍是 Harness 生命周期和维护者使用的内部工具链安装
入口，不等价于 Global Setup，也不会替代 Global Init。Global Setup 不调用
legacy `ccg init`。

维护者可用提交或发布标签运行完整的公开 clean-install 验收。该命令在系统
临时目录创建隔离的 `HOME`、`USERPROFILE`、`CODEX_HOME`、npm prefix 和
项目目录，逐阶段检查没有创建或修改 `.claude`：

```powershell
pwsh -NoProfile -File .\scripts\clean-install-acceptance.ps1 `
  -Live `
  -HarnessRef v0.2.0 `
  -ProjectContract .\tests\fixtures\public-baseline-approved-contract.json
```

## Global Init 与 Project Init

- **Global Init**：由 `pnpm setup` 调用，管理用户级 Trellis/CCG runtime、
  Codex plugin、13 个公开 bundled platform Skills、provider 状态与个人
  catalog 决策。
- **Project Init**：每个项目单独执行，先只读发现仓库，再批准项目约束与
  项目 Skill 选择，最后写入该项目的 Harness contract 并运行 gates。

公开基线路径应先用 `CatalogMode skip` 跑通。之后如确实需要个人 Skills，
可重新运行 Global Init，选择已有本地 Git catalog（`local`），或在单独
批准联网后 clone 已有权限的 catalog（`clone`）；私人 catalog 不是公开
Harness 的运行前提。

## Project Init / 项目初始化 Skill

在新项目开始或把已有仓库接入 Harness 时，先让 Codex 使用
`$harness-init`（也可以直接说“使用 harness-init 初始化本项目”）。
这个 Skill 位于 [`.agents/skills/harness-init`](.agents/skills/harness-init)，
执行顺序固定为：

1. 首次触发时在已明确批准安装 `grill-me` 时用它细化 Skill 使用规范；否则直接逐项询问，并让用户选择跳过个人
   catalog、使用已有本地 Git catalog，或在单独批准联网后 clone
   credential-free catalog URL；只有选择 catalog 时才保存其规范路径，
   以后初始化可直接复用；
2. 只读检查仓库、工具链、现有规范、Hook、CI、来源与安全边界，并从
   已保存仓库中推荐一小组与本项目相关的 Skill；
3. 对仓库无法回答的决定在已批准 `grill-me` 时调用它，否则保持同样的逐项提问；每轮只问一个问题，并给出推荐项与取舍；
4. 汇总完整项目约束和逐项 Skill 选择理由，等待用户对最新版摘要明确批准；
5. 交互 `project-init` 接受已填完非 Skill 约束的 `draft` contract：先展示
   技术发现与推荐，逐项选择 catalog/第三方项目 Skill（推荐不等于选中），在
   最终确认后用文件指纹 CAS 原子写入固定来源摘要、选择理由和精确托管路径，
   将该 candidate 提升为 `approved`，然后才执行初始化。已有 `approved`
   contract 只允许确认并执行其已经记录的集合；非交互模式也只接受完全匹配的
   `approved` contract。`security.strictDataBoundary` 在 draft 可为 `null`，
   但在批准时必须固化为布尔值；命令行 `--strict-data-boundary` 只能额外收紧，
   不能放宽合同中已批准的严格边界。随后验证器拒绝凭据、越权 provider 和托管目标冲突，
   以及畸形或冲突的规则标记；已有安全 `.harness/` 目录只有在所有托管
   目标均不存在时才可增量接入，已有策略/规则块还必须逐字节匹配。验证器用
   项目锁、含权限元数据的 CAS、pending
   journal、只读合同/Schema 前置条件和已验证备份事务写入
   `.harness/project.json`、Schema、策略副本与所有权清单，
   并把统一协作策略投影到根 `AGENTS.md` 的独立托管块；
6. 把批准的非全局 Skill 复制到项目级 `.agents/skills/`，写入
   `.harness/project-skills.json`，并校验仓库快照摘要、契约选择与目标所有权；
7. 协调 Trellis/CCG，并通过
   `trellis-spec-bootstrap` 生成基于现有代码事实的规范；
8. 运行离线 doctor、冲突、来源和质量门禁；全部通过后用所有权感知
   `mark-ready` 原子推进合同状态和摘要。

Project Init 默认不调用 Grok、Claude、GPT Pro、付费模型或联网服务，
也不会读取密钥值。13 个公开 platform Skills 已由 Global Init 安装；
Project Init 只从已明确选择的私人/本地 catalog 安装项目相关 Skills。
第三方项目 Skill 同样必须在项目合同中记录固定来源摘要和逐项批准，不能从
`main`、`latest` 或 `@latest` 安装。
现有全局 Skill 不会被初始化过程擅自删除或移动，清理由独立的所有权感知
迁移处理。现有文件在没有所有权清单前一律按用户资产处理。
协作规则的发行版上游来源是
[`collaboration-policy.md`](.agents/skills/harness-init/assets/collaboration-policy.md)；
每个初始化项目固定一份项目来源到
`.harness/policies/collaboration-policy.md`，`AGENTS.md` 是它的派生块。
初始化器会保留块外定制，并在旧 ownership 或策略升级时只覆盖摘要仍匹配
原所有权记录的托管内容；它拒绝降级未来策略版本，也拒绝未提升版本号的策略
内容变化。事务或锁完成后会先原子重命名为专用 GC tombstone 再递归清理，
硬中断后的下一次执行不依赖可能已被部分删除的内部元数据。事务 owner、journal
和 commit marker 使用仓库外的
`~/.harness-init/project-transaction.key` 做真实性校验；没有有效凭据的仓库内
残留只保留并报错，不会重放。锁同时绑定 PID 与进程启动/boot 身份，PID 被复用
时不会把旧事务永久误判为活跃。跨平台 CAS 不承诺
保留 ACL、扩展属性或 Windows 安全描述符；依赖这些元数据的仓库需使用平台
专用工具单独验证。
所有新增目标都必须 create-only 发布；已有 owned 目标必须先原子 claim 到
事务目录，再对被 claim 的同一对象验证、恢复或删除。若 claim、发布、恢复或
ownership 写入遇到并发/用户内容碰撞，事务 fail closed，保留被 claim 对象、
碰撞对象和诊断供人工处理，不覆盖任何一方，也不对仍在原路径上的未知对象做
递归删除。

```powershell
# 只读发现；不会创建 .harness
node .\scripts\harness-init.mjs inspect --repo-root .

# 公开基线 Project Init：批准的 contract 不选择私人项目 Skills
node .\scripts\harness-init.mjs project-init `
  --repo-root . `
   --home-dir <absolute-user-home> `
   --contract .\approved-contract.json `
   --no-project-skills `
   --third-party-project-skills none `
   --third-party-source-sha256 <sha256-from-third-party-plan> `
   --non-interactive `
   --approved

# 交互项目初始化：先从 template 填完项目、工具链、质量和安全约束，保持 draft；
# 工具会展示技术发现，并把最终明确选择编译到同一个 contract 后再应用。
node .\scripts\harness-init.mjs project-init `
  --repo-root . `
  --home-dir <absolute-user-home> `
  --contract .\draft-contract.json

# 首次细化并批准后保存 Skill 仓库；以后 catalog-skills 自动复用此路径
node .\scripts\harness-init.mjs configure-skills `
  --repository <absolute-skill-repository> `
  --global-essential "harness-init,trellis-before-dev,trellis-brainstorm,trellis-break-loop,trellis-channel,trellis-check,trellis-continue,trellis-finish-work,trellis-meta,trellis-session-insight,trellis-spec-bootstrap,trellis-start,trellis-update-spec" `
  --guidance "<approved-selection-guidance>" `
  --exclude "<optional-comma-separated-exclusions>" `
  --approved
node .\scripts\harness-init.mjs catalog-skills

# 完成逐项约束澄清且用户批准最终约束后
node .\scripts\harness-init.mjs validate --contract .\approved-contract.json
node .\scripts\harness-init.mjs apply --repo-root . --contract .\approved-contract.json
node .\scripts\harness-init.mjs install-skills `
  --repo-root . `
  --skills "<approved-comma-separated-skill-names>" `
  --approved
# 所有批准的离线门禁通过后
node .\scripts\harness-init.mjs mark-ready --repo-root .

# 把可独立运行的初始化 Skill 导出到另一个项目；遇到同名目录会拒绝覆盖
node .\scripts\harness-init.mjs export-skill --target <repository>
```

## 验证

```powershell
# 验证 Trellis/CCG 版本、个人来源 Git tree、远端和仓库隐私
pwsh -NoProfile -File .\scripts\doctor.ps1

# 查看当前 Trellis canonical context（自动脱敏）
node .\scripts\harness-adapter.mjs context

# 审计 Trellis/CCG 权责、版本、hook、dispatch 和运行时冲突
node .\scripts\harness-adapter.mjs conflicts

# Harness 全量离线测试
pnpm harness:test

# 只验证来源
pwsh -NoProfile -File .\scripts\verify-sources.ps1

# CCG 完整质量门禁
pnpm --dir .\components\ccg-workflow lint
pnpm --dir .\components\ccg-workflow typecheck
pnpm --dir .\components\ccg-workflow test
pnpm --dir .\components\ccg-workflow build
```

普通 CI 不调用 Grok、GPT Pro 或其他付费模型，也不会读取本机登录状态。Live smoke 必须由用户显式运行。完整冲突矩阵见 [`docs/trellis-ccg-conflicts.md`](docs/trellis-ccg-conflicts.md)。

## 工作流

1. Trellis 创建任务并沉淀 `prd.md`、`design.md` 和 `implement.md`。
2. Codex 作为主编排器在当前会话 inline 执行。
3. CCG 可按项目策略调用只读 Gemini 或手动 GPT Pro；Claude 仅可作为显式选择的只读
   产品经理 Provider。GPT Pro
   证据直接写入 Trellis task 内的 `.ccg-evidence/`，不会创建第二套 `.ccg/tasks` 生命周期。
4. Grok 当前是默认关闭的可选提供方，不阻塞普通工作；将来重新启用时，联网证据仍需 fail-closed。
5. CCG 质量门禁与 Trellis check 共同验证。
6. Trellis 更新规范、提交并归档任务。

产品经理 review 成功后，Harness 会把产品经理原话、findings、risks、process adjustments、
唯一推荐下一步和 Provider 身份写入 tracked `latestAdvice`。Codex 必须先执行
`pm present`、向用户复述这份意见并停止；只有展示后的新鲜显式回复才能进入 `pm respond`。
关卡清除后，`pm status` 仍保留最近建议，通用 Trellis resume action 不会覆盖它。

## 模型与提供方边界

| 能力 | 默认状态 | 约束 |
|---|---|---|
| Codex | 启用 | 唯一工作区写入者，inline 执行 |
| Gemini | 启用 | 只读分析与复审 |
| Claude | 可选启用 | 仅限显式授权的产品经理评审；无工具、无工作区写入、无会话持久化 |
| GPT Pro | 启用 | 仅通过 CCG 的手动证据命令 |
| Grok | 禁用、可选 | 未配置或不可用时不阻塞 |

OpenAI 兼容 Grok 探针只读取以下进程环境变量：

- `HARNESS_GROK_BASE_URL`
- `HARNESS_GROK_API_KEY`
- `HARNESS_GROK_MODEL`（可选，默认 `grok-4.5`）

显式运行模型列表探针：

```powershell
node .\scripts\harness-adapter.mjs grok-probe
```

显式运行可能计费的推理和联网搜索探针：

```powershell
node .\scripts\harness-adapter.mjs grok-probe --live
```

官方 Grok CLI/ACP 与兼容 API 是两个不同适配器，前者使用
`XAI_API_KEY` 或隔离浏览器登录，后者只使用 `HARNESS_GROK_*`。

## 更新原则

### Trellis

```powershell
# 在稀疏临时 worktree 中用精确版本生成候选，校验 npm integrity，
# 保留项目覆盖层并通过共享快照事务落地
pnpm harness:update -- --trellis-version <exact-semantic-version>
```

一次事务只能更新 Trellis 或 CCG 其中一个来源。Trellis 更新会跳过并保留
已修改的项目覆盖层，继续强制 `codex.dispatch_mode: inline`；候选中若出现
`.new` 冲突、副本越界或受保护路径被物化，事务会在写入前失败。

### CCG

CCG 只能从个人 fork 或已验证的本地个人 checkout 更新。不得把原作者 `main` 直接覆盖到 `components/ccg-workflow`。

```powershell
# 推荐：从干净 checkout 的当前 HEAD 解析 commit/tree，运行 CCG + Harness 门禁，
# 然后联动替换 snapshot、manifest 和匹配运行时
pnpm harness:update -- --source-checkout I:\ai\ccg-workflow

# 可选：审计重放或远端拉取时仍可显式给出完整 commit
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout I:\ai\ccg-workflow

# 恢复上一份由 Harness 创建的快照
pnpm harness:rollback

# 进程被终止后，显式恢复持久化事务日志或清理已死亡 PID 的锁
pnpm harness:recover

# 只撤销 Harness 确认拥有且未被用户修改的全局安装状态
pnpm harness:uninstall
```

CCG 更新不是长期锁版，而是“联动打包更新 + 当前快照来源指纹”：每次事务从
干净 checkout 的当前 HEAD（或显式 commit）构建候选，在同一事务刷新组件快照、
`harness.sources.json` 和匹配的 CLI/plugin。manifest 中的精确 commit、Git tree、
包版本和内容摘要只描述当前快照，供校验和回滚使用。

更新过程不依赖外部 `tar`：它从选定 commit 的 blob 构建候选，并逐项校验
路径、类型、blob SHA 和 POSIX 可执行位。候选激活后，会在最终组件路径重新
执行 frozen install、lint、typecheck、test、build、Go 门禁、tracked-tree
校验、本地 CLI smoke；若全局 `ccg` 由 Harness 管理，还必须通过真实
`ccg --version`。

事务使用独占锁、严格 schema 的持久化阶段日志、内容身份和可恢复快照。
普通异常或后置验证失败会恢复原组件与可工作的全局命令；进程被强制结束时，
`pnpm doctor` 会阻断并引导运行 `pnpm harness:recover`。回滚前会覆盖 tracked、
staged、untracked、ignored、rename 等全部 live 组件内容；只要更新后发生任何
变化就拒绝回滚，且不修改组件、索引、manifest、snapshot 或 transaction record。
更新前如果 live CCG 组件存在 ignored 文件，或来源仓库声明任何 sparse 排除，
替换会在首个组件变更前失败关闭；Harness 不会把这类状态静默移入快照。成功更新
只保留当前 `last-transaction.json` 引用的一个回滚快照，并清理已被新事务取代的
旧快照。

全局 ownership 对普通 npm 包记录完整内容树身份，而不只比较
`package.json`。Harness 只会首次接管原本不存在的普通 Trellis 全局包；如果已有
普通包，因无法保证逐字节恢复其中的本地补丁，会在安装前拒绝接管。CCG CLI 从当次
Harness snapshot 打包安装为普通全局目录，并把依赖收进该包的 nested tree，避免运行时
junction 回指可变 snapshot 或把无关全局包纳入 CCG 身份；重复 bootstrap 只有在当前
状态仍匹配上次 Harness fingerprint 时才允许续管。

`harness-init` 重复应用时会同时验证 project contract、schema 和严格 ownership
摘要；`export-skill` 会逐段拒绝 `.agents/skills` 中的 symlink、junction 或
reparse point，避免把 Skill 写出目标仓库。

每次更新必须同步：

- `harness.sources.json` 中当前快照的 personal commit、Git tree 和内容摘要；
- CCG 版本；
- 来源验证结果；
- lint、typecheck、test、build；
- 秘密和运行状态排除检查。

准备提交 Harness 时，使用以下命令校验**暂存区**是否精确等于
`harness.sources.json` 声明的个人 CCG Git tree；未跟踪的组件文件会阻断。
`-Index` 只读取暂存 Git tree，因此端点防护造成的已跟踪工作区漂移不会被误暂存，也不会污染验证结果：

```powershell
pwsh -NoProfile -File .\scripts\verify-sources.ps1 -Index
```

## 不会提交的内容

- `.ccg/` 任务与证据状态；
- `.codex/ccg/` Grok/GPT Pro 状态；
- Trellis task 内的 `.ccg-evidence/` 适配器证据；
- OAuth、浏览器 profile、API key、token 和 `.env`；
- `output/`、`tmp/`、日志、coverage、dist、node_modules；
- Trellis runtime、备份、开发者身份和缓存。

受控测试 fixtures 属于源码的一部分，会随个人 CCG tracked tree 保留。

### Windows 安全软件提示

部分 Windows 端点防护会因为文件名和安全研究内容，拒绝读取 CCG 中的 `templates/skills/domains/security/pentest.md` 和 `red-team.md`。这属于本地误报：Harness 使用提交对象中的 Git tree 做来源校验，CCG 安装器也会主动省略该安全参考目录。遇到这种情况不要把工作区里的异常读取结果重新暂存；以 `scripts/verify-sources.ps1` 的 Git tree 校验和 GitHub CI 为准。

## 许可证

当前仓库公开可见，但 Harness 集成层仍标记为 `UNLICENSED`；公开可见不等于授予复用许可。Trellis 为 AGPL-3.0，CCG 为 MIT，其他可选来源及固定版本详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。在完成组合分发审查前，不发布包产物，也不擅自更改集成层许可证。
