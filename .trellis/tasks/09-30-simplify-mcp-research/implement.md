# CCG 实施计划：简化 MCP 搜索调研

**状态**：已按 Boss 的 `/ccg:execute` 启动，任务为 `in_progress`。源码整改、验证及 CLI/plugin 安装同步已完成；新接口的临时 MCP 搜索和原文读取通过，常驻接口切换与独立子代理验收尚未完成，详见 `execution.md`。
**任务权威**：本目录的 `task.json`、`prd.md`、`design.md`；本文件是唯一实施计划。
**角色分析**：后端/工具链由 `backend=codex` 直接执行；前端不适用。个人配置已改为 `search=codex`、`auto_route=false`，其他角色未变。
**伴随状态**：`searchStatus=invoked`：用户新接口的临时真实搜索通过，MCP 默认模型已保存为 `grok-4.7-latest`；常驻配置仍指向原不可用接口。`productManagerStatus=authorization_required`，未授权、未调用、无产品经理证据。

## 规划依据与冲突处理

用户已明确取消普通研究的旧 ACP 调用和搜索门禁。因此覆盖已安装 Skill 的 Automatic External Intelligence Gate 与全局旧双通道要求；本轮不为写计划再次调用它们。Trellis 对任务/计划的权威高于 Skill 默认 `.codex/ccg/plans/` 保存位置，不建立第二份计划。

Codex 综合了两个只读子代理对当前基线的入口清点、GPT Pro 桥接分析，并点验关键代码。结论是优先改指令与现有配置，保留严格校验实现；不新增运行时适配器。模型选择沿用用户已接受的 Luna/high，不再开展模型升级或强制对比实验。

## 执行顺序

### 1. 固定实现范围

- [x] 获得后续执行指令后，按 Trellis 流程启动本任务并读取 `trellis-before-dev`；保持 inline 模式，由 Codex 写入和验证。
- [x] 记录两仓既有修改，从已核实的个人 3.4.15 基线创建隔离工作树，使用 `codex/` 分支；与活动安装的相关文件核对差异，不覆盖旧脏分支。
- [x] 从 `workflow-coverage.json` 获取实际入口，补查共享规则、生成的 AGENTS 模板和 GPT Pro flags。只纳入仍含自动搜索要求的内容。

### 2. 解除自动链路

- [x] 在现有共享角色规则写入 MCP 主检索、积极拆分调研和必要核验要求。
- [x] 同步注释命令、策略、Skill 中的旧搜索 intake/final-verify、必须等待、重跑及豁免要求；活动文本明确这些归档内容不执行。
- [x] 注释 GPT Pro 三个工作流和 bridge Skill 默认注入的外部情报要求及参数；保留普通路由证据和非搜索契约。无需改 `gptpro_bridge.py` 校验实现。
- [x] 同步生成模板及直接描述默认行为的文档；保留手动旧命令与底层实现，停止普通流程对它们的自动引用。

### 3. 调整现有个人配置并恢复 MCP 可用性

- [x] 在实际落地阶段保存将改字段/规则段的可回退副本；注释全局旧双通道要求，更新 `web_search.toml` 的工具与分工说明，保持 Luna/high/只读。
- [x] 使用 `ccg routing set search codex`，定点将既有 `auto_route` 设为 `false`；解析 TOML、读回单一角色，确认其他角色和旧手动参数未变。
- [x] 针对“Grok API URL 未配置”检查有效 MCP 配置、启动环境和生效进程，只修复实际缺项。已有授权配置可复用；缺端点/凭据时明确该依赖，不能猜测或输出密钥。环境转发已验证，已有接口无监听，真实搜索仍待验收。

### 4. 验证实际变更

- [x] 更新现有 `grokIntelligenceWorkflowBehavior.test.ts`：检查活动内容不要求旧 route/manifest/门禁，同时归档原文仍在；不能只靠旧字符串仍存在就判定成功。
- [x] 更新 `gptproBridge.test.ts` 中强制九个说明入口携带外部情报参数的旧断言；以一个聚焦回归覆盖“无该参数、已有旧任务 pointer 时，普通会话不要求 ACP 包”。保留显式旧校验测试。
- [x] 核对 `grokIntelligenceRouting.test.ts` 已有自动路由关闭用例、`installer.test.ts` 的配置保持和 `pluginParity.test.ts` 的来源一致性。优先复用现有检查，不增加一套调研测试框架。
- [x] 在个人源码工作树运行下面的定向检查及仓库要求的检查；一次通过后不无故重复：

```text
pnpm exec vitest run src/utils/__tests__/grokIntelligenceWorkflowBehavior.test.ts src/utils/__tests__/grokIntelligenceRouting.test.ts src/utils/__tests__/gptproBridge.test.ts src/utils/__tests__/grokIntelligenceDistribution.test.ts src/utils/__tests__/pluginParity.test.ts src/utils/__tests__/installer.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 5. 同步安装与一次验收

- [x] 源码改动审阅后，按已授权范围使用受支持的清洁源码更新流程同步 Harness 快照、来源清单和活动 CLI/plugin；需要提交、发布或安装而尚未授权时，先给出具体改动和命令，不绕过来源要求。
- [x] 实际更新 Harness 后执行其要求的 `pnpm harness:test`、`pnpm doctor`、`pnpm harness:conflicts`、`pnpm verify:sources` 及 `pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build` 对应检查；受支持更新器额外包含 Go 检查，已通过。这是变更发布检查，不是日常搜索门禁。
- [ ] 用现有 `web_search` 完成一个有代表性的真实项目调研：查找类似开源实现和相关论文，读取关键原文；仅对拟复用/采用的项目查版本、许可证或实验条件。观察本次未启动 ACP、未要求旧证据包；没有固定额外轮数。
- [x] 确认 MCP 失败能如实报告，不自动调用旧 CLI；已有缺配置观测可用于问题记录，不为制造故障破坏真实凭据。
- [ ] 检查最终 diff 与原有修改边界，回填验收状态和验证结果，再按 Trellis 完成流程交付。模型不变，旧实现未删除，未成功的实际搜索不得标记完成。

## 回退

### 执行中新增的版本要求

Boss 已要求取消阻断安装的 Trellis CLI 精确版本门禁。对应修改 `scripts/doctor.ps1`、`scripts/bootstrap.ps1`、`scripts/install.ps1`：报告现有版本，仅在未安装时安装已记录版本，已有命令失败则如实报告；不因版本差异降级。用现有 doctor/installer 测试覆盖 CLI 0.6.16 与项目资产 0.6.9 共存，并同步来源规范。此项纳入同一任务，不修改项目资产版本来掩盖差异。

源码回退只处理本任务提交或工作树；个人配置按保存的原字段和规则段恢复，不覆盖后来产生的无关修改。旧调用原文与实现一直保留，需要恢复时由明确指令重新启用。保持当前安装至新版完成验证，避免拿旧 3.4.5 脏工作树作恢复包。

## 交接

Boss 已通过以下指令授权执行。CCG 入口按 Trellis 权威读取该文件，不复制到默认计划目录，也未新增路径兼容代码：

```text
/ccg:execute .trellis/tasks/09-30-simplify-mcp-research/implement.md
```

执行进度与验证见 `execution.md`。源码已按授权本地提交，安装同步及临时真实搜索已通过。Boss 后续明确授权推送两个仓库并创建 PR；发布工作保留当前安装与其他任务修改，不自动合并或归档。
