# Trellis CCG Harness

这是 `jed-zed` 的个人 AI 开发 Harness：用最新版 Trellis 管理任务、PRD、规范和工程记忆，用个人定制版 CCG 管理 Codex、Gemini、Claude、Grok、GPT Pro、外部证据和质量门禁。

> 重要：本仓库里的 CCG 不是重新从原作者仓库下载的默认版本。权威来源是 [`jed-zed/ccg-gptpro-worflow`](https://github.com/jed-zed/ccg-gptpro-worflow) 的个人主线，快照提交为 `7fba2c3`。原作者仓库只作为上游来源和版权归属记录。

这里的 Harness 不是第三套框架或另一个依赖。**Trellis + 个人 CCG 的组合本身就是 Harness**；本仓库的脚本、来源清单和 CI 只是让这套组合可以安全安装、验证、升级和迁移。

## 当前组成

| 层 | 版本/来源 | 职责 |
|---|---|---|
| Trellis | `@mindfoldhq/trellis@0.6.8` | 任务、PRD、设计、实施计划、规范、上下文与完成闭环 |
| CCG | `jed-zed/ccg-gptpro-worflow@7fba2c3` | 多模型编排、Grok 联网证据、GPT Pro、Codex 插件与质量门禁 |
| 组合仓库 | 本仓库 | 把 Trellis + 个人 CCG 固化为一个 Harness，并提供来源锁定、安装、诊断、验证、CI 与安全边界 |

CCG 的完整个人 tracked 源码位于 [`components/ccg-workflow`](components/ccg-workflow)。来源和 Git tree 记录在 [`harness.sources.json`](harness.sources.json)。

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

## 验证

```powershell
# 验证 Trellis/CCG 版本、个人来源 Git tree、远端和仓库隐私
pwsh -NoProfile -File .\scripts\doctor.ps1

# 只验证来源
pwsh -NoProfile -File .\scripts\verify-sources.ps1

# CCG 完整质量门禁
pnpm --dir .\components\ccg-workflow lint
pnpm --dir .\components\ccg-workflow typecheck
pnpm --dir .\components\ccg-workflow test
pnpm --dir .\components\ccg-workflow build
```

普通 CI 不调用 Grok、GPT Pro 或其他付费模型，也不会读取本机登录状态。Live smoke 必须由用户显式运行。

## 工作流

1. Trellis 创建任务并沉淀 `prd.md`、`design.md` 和 `implement.md`。
2. Codex 作为主编排器在当前会话 inline 执行。
3. CCG 根据任务语义调用 Gemini、Claude、Grok 或 GPT Pro。
4. Grok 自动判断是否需要联网搜索；required route 无证据时保持 fail-closed。
5. CCG 质量门禁与 Trellis check 共同验证。
6. Trellis 更新规范、提交并归档任务。

## 更新原则

### Trellis

```powershell
trellis upgrade
trellis update --migrate
```

更新后检查 `.trellis/.version` 和本地定制，尤其是 `codex.dispatch_mode: inline`。

### CCG

CCG 只能从个人 fork 或已验证的本地个人 checkout 更新。不得把原作者 `main` 直接覆盖到 `components/ccg-workflow`。

每次更新必须同步：

- `harness.sources.json` 中的 personal commit 和 Git tree；
- CCG 版本；
- 来源验证结果；
- lint、typecheck、test、build；
- 秘密和运行状态排除检查。

## 不会提交的内容

- `.ccg/` 任务与证据状态；
- `.codex/ccg/` Grok/GPT Pro 状态；
- OAuth、浏览器 profile、API key、token 和 `.env`；
- `output/`、`tmp/`、日志、coverage、dist、node_modules；
- Trellis runtime、备份、开发者身份和缓存。

受控测试 fixtures 属于源码的一部分，会随个人 CCG tracked tree 保留。

## 许可证

当前仓库是私有 Harness，集成层标记为 `UNLICENSED`。Trellis 为 AGPL-3.0，CCG 为 MIT；详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。在完成组合分发审查前不要改为公开仓库。
