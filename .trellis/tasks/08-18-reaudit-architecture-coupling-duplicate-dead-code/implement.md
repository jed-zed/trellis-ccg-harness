# Implementation Plan — 只读架构与替代后死代码重审

## Phase A — Freeze the evidence baseline

- [x] 运行 Harness context，确认当前任务和 read-only scope。
- [x] 记录 HEAD、分支、dirty 路径、tracked 代码规模和主要入口。
- [x] 找出自 2026-08-14 审计后与 Harness/Trellis/CCG 相关的提交和工作树变化，不 fetch、不改索引。

## Phase B — Map current and superseded mechanisms

- [x] 列出 CLI、package scripts、hooks、状态机、配置 schema、环境变量和 Adapter 入口。
- [x] 检索旧机制线索：`legacy`、`deprecated`、`compat`、`fallback`、旧版本/命令/状态名、替代说明。
- [x] 对每个候选建立旧路径与新路径对照，并检查生产调用、动态加载、兼容、迁移、回滚、恢复、安全和受管来源职责。
- [x] 重新验证 2026-08-14 审计的主要发现，记录仍存在/已修复/已替代/不再适用。

## Phase C — Parallel read-only audit slices

- [x] 按项目协作规则一次性派发最多 6 个 `default` 只读探子，`fork_turns="none"`：
  1. 当前更新与新旧机制替代链；
  2. Harness adapter/Product Manager；
  3. lifecycle/init/transaction；
  4. Trellis scripts/workflow/hooks；
  5. CCG 来源快照运行代码；
  6. tests/Skills/平台投影与无引用证据。
- [x] 派发后立即等待全部结果；探子只返回 `file:line`、符号、调用证据和分类，不修改文件。
- [x] 主代理点验关键出处，不重复通读已外包的外围材料。

## Phase D — Deletion tests and focused validation

- [x] 对每个高价值候选执行 deletion test，并验证替代链是否封闭。
- [x] 使用 `rg` 核验所有定义、导入、命令注册、配置消费者、测试和文档入口。
- [x] 对最高风险候选运行最小离线 focused tests；记录测试不能证明的空白。
- [x] 明确排除受管投影、来源快照、TOCTOU 复核、兼容/迁移/回滚/恢复路径和测试隔离惯例。

## Phase E — Report and gates

- [x] 写入 `.trellis/tasks/08-18-reaudit-architecture-coupling-duplicate-dead-code/research/architecture-reaudit.md`。
- [x] 报告必须含：分类、严重度、置信度、推荐强度、`file:line`、调用或无引用证据、替代链、影响、最小建议、验证状态。
- [x] 运行 `py -3.14 .\.trellis\scripts\task.py validate 08-18-reaudit-architecture-coupling-duplicate-dead-code`。
- [x] 运行 `node .\scripts\harness-adapter.mjs conflicts`，只记录结果，不修复现有冲突。
- [x] 检查 `git status --short`，证明除本任务材料外没有新增修改。
- [x] 向 Boss 提交精简报告，并明确本轮没有删除或修复任何产品代码。

## Focused Validation Commands

```powershell
py -3.14 .\.trellis\scripts\task.py validate 08-18-reaudit-architecture-coupling-duplicate-dead-code
node .\scripts\harness-adapter.mjs conflicts
git status --short --branch
```

候选相关测试在审计中按证据选择；不预设全仓测试，也不安装依赖。

## Risky Areas / Stop Conditions

- 任一命令准备修改产品文件、Git 索引、依赖、安装状态或 Provider 状态时立即停止。
- 无法证明动态消费者不存在时，不得把候选提升为 `Confirmed dead code`。
- 当前 dirty 文件与审计写入重叠时，停止并报告，不覆盖 Boss 的工作。
- 任何修复、删除、commit、push、发布、同步、安装或 Provider 调用都需要新的明确授权。
