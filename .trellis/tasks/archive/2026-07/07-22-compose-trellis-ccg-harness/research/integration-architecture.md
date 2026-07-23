# Trellis + CCG Harness 集成架构研究

## 研究目标

确定一种能同时满足以下条件的组合方式：

- 保留 Trellis 的任务、PRD、规范、上下文注入和收尾闭环。
- 保留自定义 CCG 3.3.0 的多模型路由、Grok 外部证据、GPT Pro、质量门禁和 Codex 主编排能力。
- 两个上游可以独立升级。
- 新仓库不复制凭据、浏览器状态、模型日志或证据包。
- Windows 可直接使用，同时为 Linux/macOS 留出实现空间。

## 已验证事实

### Trellis

- Trellis 是仓库内的项目层；官方描述的持久化对象包括 `.trellis/spec/`、`.trellis/tasks/` 和 `.trellis/workspace/`。
- 官方流程是 Plan → Implement → Verify → Finish，需求澄清强调一次只问一个问题。
- 本项目已经由 Trellis 0.5.17 生成 `.trellis/`、`.agents/`、`.claude/`、`.codex/`、`.gemini/`。
- `.trellis/.template-hashes.json` 记录生成文件哈希，说明升级时需要区分上游模板文件与本项目自定义文件。
- Trellis 上游仓库采用 AGPL-3.0；如果新 Harness 公开发布，需要在首次发布前完成生成资产和派生修改的许可证核对。

### CCG

- 本机自定义 CCG 源码为 3.3.0，仓库为 `jed-zed/ccg-gptpro-worflow`。
- CCG 把模型路由、Grok ACP 外部情报、GPT Pro 入口、质量门禁、命令、技能、hooks 和 wrapper 安装到用户级目录。
- CCG 的 Codex 模式会写入用户级 `~/.codex/`，而 Trellis 当前文件是项目级 `.codex/`；两者可以分层，但 hooks 和配置必须显式合并、诊断。
- CCG 更新流程已有 backup → install → verify → rollback，但它保护的是 CCG 自己管理的用户级目录，不保护 Harness 的项目级适配器。
- CCG 插件缓存同步按 manifest 版本写入 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>`，适合由 Harness 校验版本，不适合由 Harness 复制整个缓存进 Git。
- CCG 上游仓库采用 MIT。

## 方案比较

### A. 分层编排 + 锁版本适配器（推荐）

结构：

1. Trellis 继续拥有仓库内任务、规范、上下文和完成状态。
2. CCG 继续以 CLI/Codex 插件形式安装到用户环境，并在 Harness manifest 中锁定兼容版本。
3. Harness 只拥有版本 manifest、适配器、bootstrap/update/doctor/rollback、契约测试和文档。

优点：

- 上游职责清楚，升级冲突最少。
- 不复制 CCG 插件缓存、Grok OAuth 或 Trellis 上游源码。
- 可以在 clean clone 中重建环境。
- Harness 的测试范围聚焦在“组合是否正确”。

缺点：

- 首次安装需要 Node、Python 和相关模型 CLI。
- 需要实现跨平台的版本检查、配置合并和回滚。
- CCG 用户级状态与 Trellis 项目级状态之间必须有明确 contract。

### B. 快照式 vendoring

把 Trellis 生成资产和 CCG 命令/技能的大量副本放进 Harness。

优点：

- 初始版本看起来更自包含。
- 可以在没有联网下载上游包时保留固定快照。

缺点：

- 每次升级都要解决大量重复文件和模板冲突。
- 容易把 CCG 用户级凭据/证据路径误当成项目资产。
- 会放大 Trellis AGPL 与 CCG MIT 的分发合规工作。
- 很难判断问题属于上游还是组合层。

结论：不适合作为 MVP 主方案。

### C. Git submodule / 源码组合

把 Trellis 与 CCG 源仓库作为 submodule 或 source checkout 组合。

优点：

- 能固定到精确 commit。
- 适合同时开发两个上游的深度维护者。

缺点：

- clean clone、递归更新、Windows 路径和 CI 操作更复杂。
- 用户真正需要的是可用 Harness，不是两套上游源码构建环境。
- CCG npm/插件安装与 Trellis CLI 初始化仍然需要额外适配层。

结论：可作为高级开发模式，不能作为默认安装模式。

## 推荐架构

选择方案 A，并定义三层：

```text
Project lifecycle layer   Trellis: task / prd / spec / context / finish
Harness integration layer manifest / adapters / bootstrap / doctor / rollback / CI
Model intelligence layer  CCG: Codex / Gemini / Claude / Grok / GPT Pro / gates
```

关键 contract：

- `harness.lock.json` 固定 Trellis、CCG、Node、Python 和最小 CLI 兼容范围。
- `.harness/` 只保存可提交的 schema、适配规则和无秘密状态。
- `.trellis/tasks/<task>/` 是任务事实源；CCG 只消费其受限摘要/计划，不改写 Trellis 生命周期。
- `.codex/ccg/intelligence/` 和 `.ccg/tasks/` 是本地证据状态，默认 Git 忽略。
- `doctor` 同时检查版本漂移、项目信任、hook 启用、插件缓存、Grok 登录边界和残留敏感状态。
- `update` 先创建组合层快照，再分别升级 Trellis/CCG，最后跑契约测试；失败时恢复组合层和原配置。

## MVP 建议

第一版只实现：

1. Windows PowerShell bootstrap + Node 跨平台入口。
2. 版本锁与 doctor。
3. 一个端到端命令：创建/选择 Trellis 任务 → CCG 规划/执行 → CCG 验证 → Trellis finish 前检查。
4. Grok 自动路由和 GPT Pro 显式入口可用性检查。
5. 配置/hook 冲突检测和安全 Git 忽略。
6. GitHub Actions 离线契约测试，不在普通 CI 调用付费模型。

## 来源

- Trellis 官方仓库：https://github.com/mindfold-ai/trellis
- 自定义 CCG 仓库：https://github.com/jed-zed/ccg-gptpro-worflow
- 本地 Trellis workflow：`.trellis/workflow.md`
- 本地 Trellis template hashes：`.trellis/.template-hashes.json`
- 本地 CCG 安装器：`I:\ai\ccg-workflow\src\utils\installer.ts`
- 本地 CCG 更新器：`I:\ai\ccg-workflow\src\commands\update.ts`
- 本地 CCG Codex 插件同步脚本：`I:\ai\ccg-workflow\plugins\ccg\scripts\sync-local-plugin-cache.ps1`
