# 重新审查架构耦合、重复与替代后死代码

## Goal

对 2026-08-18 的当前工作树重新进行只读架构审计，识别：

- 过度耦合、职责混杂或缺少 Locality 的 Module；
- 会造成规则漂移的重复 Implementation；
- 已无任何有效消费者的普通死代码；
- 已被新入口、新状态机、新 Adapter 或新数据流替代，但旧 Implementation、配置、测试、文档或兼容机制仍残留的“替代后死代码”。

最终结果应让 Boss 能明确区分必须处理的问题、可延后清理、合理保留的旧机制和证据不足的疑点。

## Background

- 2026-08-14 已做过一次只读审计；其结论只作为历史基线，本次必须依据当前源码重新验证，不能直接沿用。
- 当前工作树在任务创建时有 37 项未提交变更；这些内容属于现有工作，不得因 dirty 状态本身被判为缺陷，也不得被修改、还原或纳入其他操作。
- `components/ccg-workflow` 是受管 CCG 来源快照，不是 Harness 集成运行时；相似文件、平台投影和安全复核不能仅凭重复外形判错。

## Definitions and Evidence Standard

### Confirmed dead code

只有满足以下至少一种情况，并完成调用链核验，才能标为 `Confirmed`：

1. 定义没有任何生产入口、动态加载、配置引用或数据迁移消费者；或
2. 旧机制已经有可定位的新机制完整接管，且旧机制不再承担兼容、迁移、回滚、恢复、受管投影、来源证明、安全复核或用户数据读取职责。

仅被测试直接调用、仅有自证测试而没有生产调用的 export，应单独标为“测试维持的疑似死 Interface”，不能自动等同于已确认可删。

### Superseded mechanism proof

判定“已被替代”时必须同时给出：

- 旧入口、旧符号或旧状态的精确 `file:line`；
- 新入口、新符号或新状态的精确 `file:line`；
- 当前真实调用方为什么只走新路径；
- 旧路径不再承担兼容、迁移、回滚、恢复、安全或受管来源职责的证据；
- 删除后应通过的最小离线验证。

证据不完整时只能标为 `Suspected` 或 `Intentional legacy`。

## Requirements

### R1 — Current-state baseline

- 审计当前 HEAD、tracked/untracked 工作树、主要入口和测试入口。
- 明确列出自 2026-08-14 历史审计之后发生变化的相关区域。
- 上次发现必须逐项重新分类为：仍存在、已修复、已被替代、证据不足或不再适用。

### R2 — Coupling and module depth

- 使用 Module、Interface、Implementation、Seam、Depth、Leverage、Locality 和 deletion test 评估架构摩擦。
- 不能仅凭文件行数、函数数量或个人风格判断高耦合。
- 每项必须说明真实调用路径、修改扩散面和最小深化方向；不在审计阶段设计新 Interface。

### R3 — Duplication

- 查找跨文件重复的解析、规范化、状态校验、命令构造、配置映射、测试 fixture 和旧/新机制双轨实现。
- 区分偶然重复与有意的受管投影、平台差异、TOCTOU 复核和故障隔离。
- 只有合并能提高 Locality 且不会削弱安全或来源契约时，才建议合并。

### R4 — Dead and superseded code

- 同时检查源代码、export、CLI 入口、配置键、状态值、环境变量、脚本、测试、文档和兼容分支。
- 主动检索 `legacy`、`deprecated`、`compat`、`fallback`、旧版本号、旧命令名、旧状态名和替代说明，但不能仅凭命名判死。
- 对旧机制执行完整 deletion test，并记录替代链和残余消费者。

### R5 — Evidence-backed report

- 每项发现包含：严重度、置信度、推荐强度、`file:line`、符号、当前调用链或无引用证据、影响、最小处理方向和验证方式。
- 分开报告：已确认缺陷、架构摩擦、重复、已确认死代码、疑似替代残留、明确应保留的旧机制。
- 把完整证据写入任务的 `research/architecture-reaudit.md`，再向 Boss 提交精简结论。

### R6 — Read-only safety

- 不修改产品代码、测试、配置、受管快照或用户现有 dirty 文件。
- 不安装依赖、不调用 Provider、不登录、不提交、不推送、不发布、不同步 Harness。
- 只允许写本任务的 Trellis 规划和研究材料。

## Acceptance Criteria

- [x] 记录当前 HEAD、分支、工作树状态、代码入口和相对上次审计的相关变化。
- [x] 重新验证上次审计的每个主要结论，不把旧结论直接当成当前事实。
- [x] 每个 `Confirmed dead code` 或 `Confirmed superseded mechanism` 都满足本 PRD 的替代链证据标准。
- [x] 每个高耦合或重复候选都有真实调用/引用证据，且完成 deletion test。
- [x] 明确排除受管来源快照、平台投影、必要兼容/迁移/回滚和重复安全复核造成的误报。
- [x] 对最高风险候选运行能证明或反驳结论的最小离线测试；未运行的验证明确标注。
- [x] `research/architecture-reaudit.md` 包含精确 `file:line`、证据分类、影响和最小建议。
- [x] 最终报告列出优先级、确认事实、推断、未知和本次未修改项目代码的证明。

## Out of Scope

- 删除、修复或重构任何发现。
- 设计具体的新 Interface 或扩大现有产品功能。
- 全仓格式化、依赖升级、生成新 CodeGraph 索引或安装静态分析器。
- 网络搜索、Provider 调用、远程分支更新、PR/Issue 操作、提交、推送、发布、同步或安装。
- 清理任何现有未跟踪文件、任务目录或用户工作。

## Blocking Open Questions

None. Boss 已明确要求重新审查，并明确把“被新代码替代但仍残留的旧机制”纳入死代码口径。

## Notes

- 本任务只产出审计证据与建议；后续任何修复必须另行取得授权并按发现拆分范围。
