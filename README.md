# Trellis CCG Harness

这是 `jed-zed` 的个人 AI 开发 Harness：用最新版 Trellis 管理任务、PRD、规范和工程记忆，用个人定制版 CCG 管理 Codex、Gemini、Claude、Grok、GPT Pro、外部证据和质量门禁。

> 重要：本仓库里的 CCG 不是重新从原作者仓库下载的默认版本。权威来源是 [`jed-zed/ccg-gptpro-worflow`](https://github.com/jed-zed/ccg-gptpro-worflow) 的个人主线，快照提交为 `b0f2c41`。原作者仓库只作为上游来源和版权归属记录。

这里的 Harness 不是第三套框架或另一个依赖。**Trellis + 个人 CCG 的组合本身就是 Harness**；本仓库的脚本、来源清单和 CI 只是让这套组合可以安全安装、验证、升级和迁移。

## 当前组成

| 层 | 版本/来源 | 职责 |
|---|---|---|
| Trellis | `@mindfoldhq/trellis@0.6.8` | 任务、PRD、设计、实施计划、规范、上下文与完成闭环 |
| CCG | `jed-zed/ccg-gptpro-worflow@b0f2c41` | 多模型编排、Grok 联网证据、GPT Pro、Codex 插件与质量门禁 |
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

个人 CCG 主线相对捕获时的原上游 merge base 有 20 个个人独有提交和 369 个差异文件，其中包含：

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

1. 只读检查仓库、工具链、现有规范、Hook、CI、来源与安全边界；
2. 对仓库无法回答的决定调用 `grill-me`，每轮只问一个问题，并给出推荐项与取舍；
3. 汇总完整项目约束，等待用户对最新版摘要明确批准；
4. 批准后才写入 `.harness/project.json`、协调 Trellis/CCG，并通过
   `trellis-spec-bootstrap` 生成基于现有代码事实的规范；
5. 运行离线 doctor、冲突、来源和质量门禁。

初始化阶段默认不调用 Grok、Claude、GPT Pro、付费模型或联网服务，
也不会读取密钥值。现有文件在没有所有权清单前一律按用户资产处理。

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
3. CCG 可按项目策略调用只读 Gemini 或手动 GPT Pro；Claude 被 Harness 禁用。
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
trellis upgrade
trellis update --migrate
```

更新后检查 `.trellis/.version` 和本地定制，尤其是 `codex.dispatch_mode: inline`。

### CCG

CCG 只能从个人 fork 或已验证的本地个人 checkout 更新。不得把原作者 `main` 直接覆盖到 `components/ccg-workflow`。

```powershell
# 预检个人仓库完整 commit/tree、运行 CCG + Harness 门禁，然后事务式替换
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout I:\ai\ccg-workflow

# 恢复上一份由 Harness 创建的快照
pnpm harness:rollback

# 只撤销 Harness 确认拥有且未被用户修改的全局安装状态
pnpm harness:uninstall
```

更新过程使用独占锁、候选目录、来源 Git tree、全量门禁和可恢复快照。
任何中断或后置验证失败都会自动回滚；被用户修改的全局状态会保留并以
非零状态提示人工处理。

每次更新必须同步：

- `harness.sources.json` 中的 personal commit 和 Git tree；
- CCG 版本；
- 来源验证结果；
- lint、typecheck、test、build；
- 秘密和运行状态排除检查。

准备提交 Harness 时，使用以下命令校验**暂存区**是否精确等于
`harness.sources.json` 声明的个人 CCG Git tree；未跟踪或残留的组件文件会阻断：

```powershell
pwsh -NoProfile -File .\scripts\verify-sources.ps1 -Index
```

## 不会提交的内容

- `.ccg/` 任务与证据状态；
- `.codex/ccg/` Grok/GPT Pro 状态；
- OAuth、浏览器 profile、API key、token 和 `.env`；
- `output/`、`tmp/`、日志、coverage、dist、node_modules；
- Trellis runtime、备份、开发者身份和缓存。

受控测试 fixtures 属于源码的一部分，会随个人 CCG tracked tree 保留。

### Windows 安全软件提示

部分 Windows 端点防护会因为文件名和安全研究内容，拒绝读取 CCG 中的 `templates/skills/domains/security/pentest.md` 和 `red-team.md`。这属于本地误报：Harness 使用提交对象中的 Git tree 做来源校验，CCG 安装器也会主动省略该安全参考目录。遇到这种情况不要把工作区里的异常读取结果重新暂存；以 `scripts/verify-sources.ps1` 的 Git tree 校验和 GitHub CI 为准。

## 许可证

当前仓库是私有 Harness，集成层标记为 `UNLICENSED`。Trellis 为 AGPL-3.0，CCG 为 MIT；详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。在完成组合分发审查前不要改为公开仓库。
