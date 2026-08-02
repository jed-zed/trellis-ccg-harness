# 并发 `fix-ccg-plan-snapshot` 重叠核验

## 事实（截至 2026-08-03）

- 主工作区 `I:/ai/trellis-ccg-harness` 为 `main...origin/main [behind 2]`，存在 13 个已修改路径及多个未跟踪路径；其中 `.trellis/tasks/08-03-fix-ccg-plan-snapshot/` 仍是 `status: "in_progress"`（`task.json:1-6`），其 PRD 明确要求修复 `.codex/ccg/plans/*.md` 的 Grok 快照排除（`prd.md:1-18,33-42`）。这只是未提交工作区状态，不是已交付事实。
- PM 计划基准目录的 `prd.md` 仍为 TBD（`I:/ai/trellis-ccg-harness-pm-workspace-access/.trellis/tasks/08-03-product-manager-workspace-access/prd.md:1-20`），`task.json` 仍为 `status: "planning"`（`.../task.json:1-18`）。因此以下 PM 侧重叠判断是基于现有 PM 合同/实现的依赖核验，不能替代待填写的需求与验收标准。

## 快照 helper：直接重叠与边界

当前未提交 diff 对 Grok 快照新增一条显式计划白名单链路：

- 两个运行时副本均新增 `normalizeAllowedCcgPlanPaths()`，只接受 `.codex/ccg/plans/<单层文件>.md`（不允许目录、子目录、其它后缀或 traversal），并在 `exclusionReason()` 中仅对精确绑定路径豁免 `.codex` 段；禁止 basename 和 `.ccgignore` 检查仍随后执行（插件源 `components/ccg-workflow/plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/lib/snapshot.mjs:35-65`，模板副本同一行号）。
- `createFocusedSnapshot()` 的新参数为 `allowedCcgPlanPaths`（插件源 `.../lib/snapshot.mjs:184-206`）；`command.mjs` 只从 `kind === 'plan'` 的绑定中计算它（插件源和模板 `.../command.mjs:399-407`），`runner.mjs` 再向 helper 透传（两副本 `.../runner.mjs:140-147`）。普通 `--file` 没有该集合，仍拒绝 `.codex`。
- 两副本必须保持字节一致；现有分发回归在 `components/ccg-workflow/src/utils/__tests__/grokIntelligenceDistribution.test.ts:101-106` 逐文件比较。新增行为测试覆盖未绑定、非 Markdown、嵌套、`AGENTS.md`、`.ccgignore` 与显式绑定成功（`.../grokIntelligenceRunner.test.ts:134-173`）；命令分发测试验证 `runnerOptions.allowedCcgPlanPaths`（`.../grokIntelligenceDistribution.test.ts:123-171`）。

PM workspace-access 计划若直接复用 `createFocusedSnapshot`，会与上述 API/两副本同步规则发生实质重叠：必须保持 `allowedCcgPlanPaths` 的“仅显式 plan 绑定”语义，不能把 PM 的普通 workspace 读取变成 `.codex` 通用白名单。若不复用，PM 侧应新建/抽取一个通用 bounded snapshot helper，并明确不改 Grok helper 的安全策略；否则会在同一 helper、两份副本及测试中重复实现。

现有 PM 调用并未读取真实项目：`invokeProvider()` 创建空的临时目录（`components/ccg-workflow/src/commands/product-manager.ts:253-277`、`258`），Codex/Claude/Gemini 都以该目录为 cwd/workspace（`:296-305,319-326,357-365`）。PM 读取能力的最小接入点是“在该目录中填充有界、只读快照”，而不是给 Provider 真实 workspace 写权限；provider adapters 目前已声明 `readOnly: true`、`shell: false`（`src/product-manager/provider-registry.ts:30-50`）。

## Schema：可能同文件，不同语义

- 未提交 diff 修改的只是 `skills.globalEssential`：`minItems/maxItems` 从 13 改为 15，并增加 `chatgpt-pro-sidebar`、`grill-with-docs` 的 `contains`（`.harness/project.schema.json:115-200`；对应源资产 `.agents/skills/harness-init/assets/project-contract.schema.json:115-200`）。PM 计划若改 `.harness/project.schema.json`，必须保留这 15-Skill 变更，不能用旧 schema 覆盖。
- `.harness/project.schema.json` 的 PM 约束位于 `productManager`（`:319-375`），Provider capability `$defs.readOnlyProductManagerProvider` 要求 `readOnly: true`、`workspaceWrite: false`、`terminal/subagents: false`、网络/付费均 `explicit-per-call`（`:408-439`）。允许 PM 读取快照不能把 `workspaceWrite` 改为 true；如需声明读取能力，应新增明确字段并同步源资产，且保持写入/工具边界不变。
- 该 project schema 的 digest 被 `.harness/ownership.json:schemaSha256` 绑定（当前值在 `ownership.json:4-6`）。PM 计划修改 project schema 时必须在保留当前 15-Skill 内容的基础上重新生成 digest；若改动 `.harness/project.json` 还要更新 `contractSha256`。`.harness/product-manager.schema.json` 是另一份 task projection schema（当前 319 行），不要把 Provider workspace 输入字段误加到输出 projection schema。

## Tests / docs：重叠位置

- 当前脏 diff 的 Harness 测试只新增 15-Skill schema 断言（`tests/harness-init-skill.test.mjs:202-216`），未改 PM 测试。PM 现有覆盖入口包括 Provider/contract/command 测试（`components/ccg-workflow/src/product-manager/__tests__/command.test.ts:17-63,191-249`；`contracts.test.ts:53-121`）和 Harness E2E/state/concurrency 套件（合同要求见 `.trellis/spec/tooling/product-manager-review.md:225-261`）。PM 计划应在这些既有套件增加“快照可读、写入仍拒绝、秘密/链接/.ccgignore 仍拒绝”的最小回归，不要复制 Grok 专用测试。
- 共享文档 `layered-harness-adapter.md` 的未提交新增段落只描述 Grok 计划例外（`:97-99`）；PM 读取约束的权威文档是 `.trellis/spec/tooling/product-manager-review.md:140-144`（临时目录、workspace writes/tools/MCP/subagents 禁止）及 `components/ccg-workflow/src/product-manager/DESIGN.md:18-27,36-54`、`README.md:5-23`。若 PM 计划允许“读快照”，须改成“有界只读快照”而保留禁止真实 workspace 写入、命令、工具、凭据和网络的措辞；不要把 Grok 段落改成 PM 通用规则。
- `scripts/DESIGN.md:198-201` 也明确 PM 可在 no-tool、non-persistent 模式运行且不得 workspace 写入。若改变上下文来源，需要在此说明读取的是一次性快照，且生命周期/状态仍由 Trellis/Codex 负责。

## 合并前置条件与计划建议（推断）

1. 先把 `fix-ccg-plan-snapshot` 的未提交状态隔离（提交、单独 worktree 或明确 rebase 基线）；PM 计划不能把这些修改当成已交付，也不能在同一文件上静默覆盖。至少把当前两份 `snapshot.mjs`、两份 `command.mjs/runner.mjs`、相关测试和 schema digest 作为待合并冲突清单。
2. PM 计划先补全自身 `prd.md` 的输入范围/安全边界/验收，再选择“复用 Grok helper”或“独立 PM snapshot helper”之一。复用时必须明确调用者传入的 selected paths/plan allow-set，并运行分发字节一致测试；独立时不要复制 Grok 的 `.codex` 例外逻辑，抽取公共安全原语而非再造第二套规则。
3. 若触碰 project schema，按“源资产 `.agents/.../project-contract.schema.json` → `.harness/project.schema.json` → ownership digest → schema/initializer tests”的顺序更新，并在 diff 中保留 `globalEssential` 15 项。若只扩展 PM 输入/Provider 能力，优先改 CCG `contracts.ts`/provider adapters 与 PM 专用 schema/tests，避免无必要修改 Harness project contract。
4. 合并验收至少包括：Grok 的显式 `--plan` 与普通 `--file` 分流仍通过；PM 快照不能写真实 workspace，不能读秘密/指令/链接/`.ccgignore` 内容；两份 Grok runtime 保持 byte-identical；PM 合同 digest/identity 与现有 Harness state CAS 测试继续通过。任何未运行的测试和个人 CCG 安装同步都应标为未验证。
