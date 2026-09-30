# Strategy: Deep Research — 深度研究

## Research

Use existing independent research agents with grok-search MCP. Search actively and
verify key conclusions against original sources; check versions/licenses when
reusing code and experiment conditions when adopting papers. Mark unverified findings.
Archived instructions below are inactive: ordinary work does not run Grok CLI/ACP,
wait for its gates, or require its manifests and hash packages.

<!-- Legacy Grok CLI/ACP reference; inactive in ordinary research.
## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow analyze --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Run this potentially long route with the host's tool-managed background execution and wait mechanism; never put it under a foreground timeout shorter than the runner's 10-minute timeout. If the host cancels or terminates the job before a terminal state is written, run `ccg route recover --state-file <state-file> --status cancelled --reason "<reason>"` (or use `--status failed`); recovery refuses to overwrite a live owner.

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.
-->

> 适用于技术方案研究、对比分析。独立代理按问题并行检索，主代理综合。

## 适用条件
- 用户提出研究/分析/对比类问题
- 不涉及代码修改（纯研究）
- 任何复杂度级别

<!-- Legacy research instructions; inactive in ordinary MCP research.
## 前置加载

```
Read("~/.claude/.ccg/engine/model-router.md")
```

---

## 工作流状态机

[phase-state:1-clarify]
当前阶段：明确研究问题
📍 Next: 问题明确后启动多模型探索
[/phase-state:1-clarify]

[phase-state:2-explore]
当前阶段：多模型并行探索
Gate: 研究问题已明确 ✓
📍 Next: 双模型结果返回后进入综合
[/phase-state:2-explore]

[phase-state:3-synthesize]
当前阶段：综合分析
Gate: 双模型探索已返回 ✓
📍 Next: 输出结构化报告后进入讨论
[/phase-state:3-synthesize]

[phase-state:4-discuss]
当前阶段：交互式讨论
📍 Next: 用户满意后结束
[/phase-state:4-discuss]

---
-->

按当前项目任务流程推进：明确问题、并行检索、综合发现、按需继续讨论；无需额外加载模型路由或等待固定双模型门禁。

## 阶段详情

### Phase 1: 明确问题 [required]

1. 解析用户的研究意图：
   - 要研究什么？
   - 研究目的是什么？（做决策？了解现状？评估可行性？）
   - 有什么约束或偏好？

2. 如果问题太宽泛，先收窄：
   ```
   📋 研究范围
     问题: [明确的研究问题]
     目的: [决策/了解/评估]
     约束: [时间/技术/资源约束]
   ```

<!-- Legacy research instructions; inactive in ordinary MCP research.
### Phase 2: 多模型并行探索 [required]

**Task 更新**：`currentPhase → "2-explore"`, `nextAction → "双模型并行探索"`

**并行调用**（`run_in_background: true`）：
- **backend 模型**：analyzer 角色
  ```
  <TASK>
  需求：研究分析 [问题]
  上下文：[项目上下文、技术栈、约束]
  </TASK>
  OUTPUT: 技术分析报告（可行性、架构选项、风险、成本估算）
  ```
- **frontend 模型**：analyzer 角色
  ```
  <TASK>
  需求：研究分析 [问题]
  上下文：[项目上下文、用户场景、约束]
  </TASK>
  OUTPUT: 用户/体验视角分析（UX 影响、用户流程、设计选项）
  ```

等待双模型返回。

### Phase 3: 综合分析

**Gate check**: 双模型探索已返回

交叉对比双方视角。

**持久化研究成果**（如有任务目录）：
- 将双模型原始分析写入 `.ccg/tasks/{task-name}/research/backend-analysis.md`
- 将双模型原始分析写入 `.ccg/tasks/{task-name}/research/frontend-analysis.md`
-->

### Phase 2: 独立代理并行检索

把可独立回答的问题派给现有 `web_search`，使用 grok-search MCP 搜索和读取原始资料；相关问题继续深挖，不固定模型数量或要求再跑一条 Grok CLI。返回有用发现、来源和未核实项。

### Phase 3: 综合分析

主代理结合项目约束综合已有结果。关键结论对应原文；实际复用代码查版本和许可证，采用论文结论查实验条件。缺少关键资料时说明具体限制，不等待旧证据门禁。按任务需要记录有用结论，不强制两份模型原始报告。

按问题选择清晰的表达方式；需要比较方案时可参考：

```
📋 研究报告: [主题]

## 选项对比

| 维度 | 方案 A | 方案 B | 方案 C |
|------|--------|--------|--------|
| 概述 | ... | ... | ... |
| 优势 | ... | ... | ... |
| 劣势 | ... | ... | ... |
| 复杂度 | S/M/L | S/M/L | S/M/L |
| 风险 | low/mid/high | ... | ... |
| 预估工期 | ... | ... | ... |

## 推荐

**推荐方案 [X]**
理由：[简明理由]

## 注意事项
- [关键风险或注意点]
```

### Phase 4: 交互式讨论

用户可以：
- 追问某个方案的细节
- 要求更深入分析某个方面
- 要求 POC / 原型验证
- 确认结论并结束

```
📍 研究已完成。如需实施推荐方案，可以用 /ccg:go implement [方案描述]
```

**Task 更新**（如有）：`status → "completed"`, `nextAction → "研究完成，可实施推荐方案"`

---

## 铁律

- **纯研究模式，不做代码修改** — 除非用户明确要求 POC
<!-- Legacy research instructions; inactive in ordinary MCP research.
- **结果必须结构化输出** — 表格对比，不是自由聊天
-->
- 以方便理解为准，返回有用发现、来源和必要的不确定说明。
- **必须给出推荐** — 不可只列选项不做判断
<!-- Legacy research instructions; inactive in ordinary MCP research.
- **双模型探索必须并行** — 独立视角更有价值
-->
- 独立问题积极并行检索，由主代理综合，无需固定双模型核验。
