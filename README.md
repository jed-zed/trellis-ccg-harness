# Trellis CCG Harness

这是 `jed-zed` 的个人 AI 开发 Harness：用最新版 Trellis 管理任务、PRD、规范和工程记忆，用个人定制版 CCG 管理 Codex、Gemini、Claude、Grok、GPT Pro、外部证据和质量门禁。

> 重要：本仓库里的 CCG 不是重新从原作者仓库下载的默认版本。权威来源是 [`jed-zed/ccg-gptpro-worflow`](https://github.com/jed-zed/ccg-gptpro-worflow) 的个人主线；精确 commit、Git tree 和捕获时间只以 [`harness.sources.json`](harness.sources.json) 为准。原作者仓库只作为上游来源和版权归属记录。

这里的 Harness 不是第三套框架或另一个依赖。**Trellis + 个人 CCG 的组合本身就是 Harness**；本仓库的脚本、来源清单和 CI 只是让这套组合可以安全安装、验证、升级和迁移。

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
- Gemini 预览、Claude 协作与完整回归测试。

为了避免把这些工作替换成原作者当前版本，Harness 的更新和验证都以个人 fork URL、commit 和 Git tree 为准。

## 快速开始

前置要求：

- Node.js 20+
- Python 3.9+
- PowerShell 7+
- pnpm/Corepack
- Go（CCG wrapper 的 test/build 门禁必需）
- 按需安装 Codex、Claude Code、Gemini、Grok CLI

```powershell
git clone https://github.com/jed-zed/trellis-ccg-harness.git
Set-Location trellis-ccg-harness

# 安装依赖并构建个人 CCG
pwsh -NoProfile -File .\scripts\bootstrap.ps1

# 如果要让全局 ccg 命令直接指向本仓库的个人快照
pwsh -NoProfile -File .\scripts\bootstrap.ps1 -LinkCcg
```

## 项目初始化 Skill

在新项目开始或把已有仓库接入 Harness 时，先让 Codex 使用
`$harness-init`（也可以直接说“使用 harness-init 初始化本项目”）。
这个 Skill 位于 [`.agents/skills/harness-init`](.agents/skills/harness-init)，
执行顺序固定为：

1. 首次触发时用 `grill-me` 细化 Skill 使用规范，让用户指定一个独立
   Skill 仓库路径（不能与正在加载的全局 Skill 目录重叠），并把路径与
   最小全局 Skill 集保存在用户配置中；以后初始化直接复用，不重复询问有效路径；
2. 只读检查仓库、工具链、现有规范、Hook、CI、来源与安全边界，并从
   已保存仓库中推荐一小组与本项目相关的 Skill；
3. 对仓库无法回答的决定调用 `grill-me`，每轮只问一个问题，并给出推荐项与取舍；
4. 汇总完整项目约束和逐项 Skill 选择理由，等待用户对最新版摘要明确批准；
5. 批准后由可执行验证器拒绝草稿、凭据、越权 provider 和已有目录冲突，
   以及畸形或冲突的规则标记；它用项目锁、含权限元数据的 CAS、pending
   journal、只读合同/Schema 前置条件和已验证备份事务写入
   `.harness/project.json`、Schema、策略副本与所有权清单，
   并把统一协作策略投影到根 `AGENTS.md` 的独立托管块；
6. 把批准的非全局 Skill 复制到项目级 `.agents/skills/`，写入
   `.harness/project-skills.json`，并校验仓库快照摘要、契约选择与目标所有权；
7. 协调 Trellis/CCG，并通过
   `trellis-spec-bootstrap` 生成基于现有代码事实的规范；
8. 运行离线 doctor、冲突、来源和质量门禁。

初始化阶段默认不调用 Grok、Claude、GPT Pro、付费模型或联网服务，
也不会读取密钥值。全局默认只保留 `harness-init` 与 `grill-me` 两个
必要 Skill；现有全局 Skill 不会被初始化过程擅自删除或移动，清理由独立的
所有权感知迁移处理。现有文件在没有所有权清单前一律按用户资产处理。
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

```powershell
# 只读发现；不会创建 .harness
node .\scripts\harness-init.mjs inspect --repo-root .

# 首次细化并批准后保存 Skill 仓库；以后 catalog-skills 自动复用此路径
node .\scripts\harness-init.mjs configure-skills `
  --repository <absolute-skill-repository> `
  --global-essential "harness-init,grill-me" `
  --guidance "<approved-selection-guidance>" `
  --exclude "<optional-comma-separated-exclusions>" `
  --approved
node .\scripts\harness-init.mjs catalog-skills

# grill-me 完成且用户批准最终约束后
node .\scripts\harness-init.mjs validate --contract .\approved-contract.json
node .\scripts\harness-init.mjs apply --repo-root . --contract .\approved-contract.json
node .\scripts\harness-init.mjs install-skills `
  --repo-root . `
  --skills "<approved-comma-separated-skill-names>" `
  --approved

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
3. CCG 可按项目策略调用只读 Gemini 或手动 GPT Pro；Claude 被 Harness 禁用。GPT Pro
   证据直接写入 Trellis task 内的 `.ccg-evidence/`，不会创建第二套 `.ccg/tasks` 生命周期。
4. Grok 当前是默认关闭的可选提供方，不阻塞普通工作；将来重新启用时，联网证据仍需 fail-closed。
5. CCG 质量门禁与 Trellis check 共同验证。
6. Trellis 更新规范、提交并归档任务。

## 模型与提供方边界

| 能力 | 默认状态 | 约束 |
|---|---|---|
| Codex | 启用 | 唯一工作区写入者，inline 执行 |
| Gemini | 启用 | 只读分析与复审 |
| Claude | 禁用 | 不参与本 Harness 工作流 |
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
# 预检个人仓库完整 commit/tree、运行 CCG + Harness 门禁，然后事务式替换
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout I:\ai\ccg-workflow

# 恢复上一份由 Harness 创建的快照
pnpm harness:rollback

# 进程被终止后，显式恢复持久化事务日志或清理已死亡 PID 的锁
pnpm harness:recover

# 只撤销 Harness 确认拥有且未被用户修改的全局安装状态
pnpm harness:uninstall
```

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
普通包，因无法保证逐字节恢复其中的本地补丁，会在安装前拒绝接管。CCG 全局链接
仍可按其精确 source path 恢复。重复 bootstrap 只有在当前状态仍匹配上次 Harness
fingerprint 时才允许续管。

`harness-init` 重复应用时会同时验证 project contract、schema 和严格 ownership
摘要；`export-skill` 会逐段拒绝 `.agents/skills` 中的 symlink、junction 或
reparse point，避免把 Skill 写出目标仓库。

每次更新必须同步：

- `harness.sources.json` 中的 personal commit 和 Git tree；
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

当前仓库是私有 Harness，集成层标记为 `UNLICENSED`。Trellis 为 AGPL-3.0，CCG 为 MIT；详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。在完成组合分发审查前不要改为公开仓库。
