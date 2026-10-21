# 修改源、生成目标与授权边界

这是方案 v1 的路径说明。当前状态仍为 planning，以下实施及分发步骤均未执行。

| 阶段 | 已核实的修改源 | 生成/同步目标 | 需要的授权 |
|---|---|---|---|
| 本地 CCG 源规则修改 | 基于 `G:\CodexWorktrees\ccg-simplify-mcp-research` 的 `87592d37578193bf36c8a074e5224a4803951ce3` 建立隔离工作树；修改 design 列出的五份 `plugins/ccg/skills/*/SKILL.md` 与必要测试。 | 新隔离树内的本地 diff 与测试产物；当前 CLI/plugin 不变。 | 用户对本方案 v1 的首次实施批准，尚待取得。 |
| 本地 Harness 源规则修改 | 基于 `G:\CodexWorktrees\harness-simplify-mcp-research` 的 `b45c2ea72141bc0fa7f36232e102e8e5971602ed` 建立隔离工作树；修改 workflow、三个 Skill、collaboration-policy 源、指南与必要测试。 | 新隔离树内的本地 diff；临时 fixture 中的 owned policy/AGENTS 投影用于验证。 | 同一次 v1 批准；不会再为同一具体方案询问第二次。 |
| 后续 coupled distribution update | 获准提交后的准确个人 CCG tracked Git tree。 | 经用户指定并批准的 Harness 分发工作树中的 `components/ccg-workflow/`、`harness.sources.json` 等受支持更新产物。当前安装源 G: 仅作来源证据，不自动覆盖。 | **不在 v1 授权动作内**。先取得提交/同步授权，并按 provenance/事务与完整门验证。 |
| 后续 CCG 运行时安装 | 上一阶段通过验证的分发源及其准确版本。 | 当前实际 CLI 根 `C:\Users\29933\AppData\Roaming\npm\node_modules\ccg-workflow`；插件缓存 `C:\Users\29933\.codex\plugins\cache\ccg-gptpro-worflow\ccg\<approved-version>`；支持流程维护 `C:\Users\29933\.agents\harness\codex-plugin.json`。当前缓存为 `3.4.15+codex.1`。 | **不在 v1 内**。安装版本、目标和必要 reload 分别在安装阶段批准/验收，不手改缓存冒称源码生效。 |
| 后续 Trellis 平台 Skill 投影 | 经批准的 Harness 分发源 `.agents/skills/`。当前安装记录仍指 `I:\ai\trellis-ccg-harness-ccg-3.4.12-sync`。 | `C:\Users\29933\.agents\skills\trellis-{start,brainstorm,continue}` 等已拥有的目标；支持流程维护 `.agents\harness\global-skills.json`。 | **不在 v1 内**。全局 Skill 同步/安装需要明确授权，不自动更改 personal-skills catalog 或用户已有 Skill。 |
| 后续已初始化项目策略更新 | `.agents/skills/harness-init/assets/collaboration-policy.md` 的批准版本。 | 由支持的项目更新流程生成目标项目 `.harness/policies/collaboration-policy.md` 与根 `AGENTS.md` 的受管投影。 | **不在 v1 内**。先明确目标项目及更新授权，保留用户内容并执行事务/CAS 验证。 |

本次唯一实际新增目标是 `I:\ai\trellis-ccg-harness\.trellis\tasks\09-30-simplify-ccg-trellis-approvals` 的任务/方案证据。所有原始工作区改动、另行 PR 活动、当前 main 与已安装内容继续受保护。

独立审计提供的现状与本次路径一致：Harness 本地 main 为 `ab9c2597054fbafb0353024a1593fea3798a7e8d`，实际安装源仍 b45c2ea/CCG 3.4.15/Trellis assets 0.6.9。全局 Trellis CLI 0.6.16 不证明其新快车道/await 规则已加载；PR51 的固定 head 工作树不是日常入口；未定位到 ccg-codex-workflow checkout，也不假设当前插件具备 PR16 的完整 scorecard 契约。这些是独立审计输入，本任务未再次做远端 PR/main 审计。

因此 v1 只使用本次已证实的原生 Skill 和 Trellis task/meta 能力，不引入 PR51/PR16 的机制，不扩大成安装、同步或合并任务。
