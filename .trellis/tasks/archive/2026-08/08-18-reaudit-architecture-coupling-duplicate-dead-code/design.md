# Design — 重新审查架构耦合、重复与替代后死代码

## Audit Shape

本任务使用“当前状态基线 → 新旧路径对照 → 引用与入口核验 → deletion test → 最小验证 → 分级报告”的证据链。

审计不以文本匹配作为结论。`legacy`、`deprecated`、旧版本号、旧命令名和相似代码只用于发现候选；最终分类必须回到当前入口、调用方、配置消费者、数据迁移、恢复/回滚和受管来源契约。

## Evidence Layers

### 1. Current-state baseline

- 捕获 HEAD、分支和当前 dirty 路径，不读取或输出敏感内容。
- 对照 2026-08-14 的历史审计基线，定位后来变化的代码区域。
- 以当前工作树为审计对象；HEAD 只用于解释变化来源。

### 2. Runtime and authority map

- 根 Harness：`package.json`、`scripts/*.mjs`、`scripts/lib/**`、对应 tests。
- Trellis：`.trellis/scripts/**`、工作流状态、平台 hooks 和 specs。
- CCG：`components/ccg-workflow/**` 作为受管来源快照审计，但所有建议必须指出权威来源更新路径，不能把快照当集成运行时。
- Skills/投影：`.agents/skills/**`、`.codex/**`、`.gemini/**`，先确认来源与平台差异再判断重复或失效。

### 3. Replacement-chain analysis

每个疑似旧机制建立一条最小证据链：

```text
旧入口/状态/配置
→ 历史调用方
→ 新入口/状态/配置
→ 当前调用方
→ 兼容/迁移/回滚/恢复/安全/来源职责检查
→ Confirmed / Suspected / Intentional legacy
```

动态路径无法被 `rg` 证明不存在时，继续检查命令注册、配置 schema、文件名约定、测试 fixture 和文档中的可执行命令。仍无法封闭时保留为未知，不建议删除。

### 4. Architecture assessment

- 对高耦合候选检查调用扩散、状态所有权和测试 Surface，而不是按行数定罪。
- 对浅 Module 执行 deletion test：删除后复杂性消失，说明它可能只是 pass-through；复杂性重新散落到调用方，说明它仍有 Depth。
- 建议只描述应提高 Locality 的方向，不在本轮设计新 Interface。

### 5. Verification

- 先用 `rg` 和源码核验定义、入口与调用方。
- 只对最高风险、可离线复现的候选运行 focused test。
- 不为审计新增产品测试；如缺测试，把应补的最小回归写入建议。

## Report Taxonomy

每个候选使用以下分类：

- `Confirmed defect`
- `Architectural friction`
- `Confirmed duplication`
- `Confirmed dead code`
- `Confirmed superseded mechanism`
- `Suspected dead/superseded`
- `Intentional projection/safety/compatibility`

每项同时给出推荐强度：`Strong`、`Worth exploring` 或 `Speculative`。

## Safety and Rollback

- 审计只写当前任务目录下的规划/研究文件。
- 发现产品问题时不直接修复。
- 若审计命令意外产生仓库文件，立即停止，报告路径；不自动删除未知文件。
- 任务材料可单独回退，不触碰审计前已有的 37 项工作树变更。

## Important Trade-offs

- 不安装新的静态分析器，避免把工具引入变成任务本身；使用现有 `rg`、运行入口、测试和只读探子即可。
- 不把所有重复都集中到共享 helper；只有 Locality 收益大于耦合成本时才建议合并。
- 不把“新机制存在”等同于“旧机制已死”；兼容、迁移、回滚、恢复和受管来源证明优先于删除欲望。
