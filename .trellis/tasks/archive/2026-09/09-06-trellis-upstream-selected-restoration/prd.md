# 恢复选定的 Trellis 官方规则与 Hook 行为

## Goal

按用户指定恢复复杂任务三份文档、分阶段审批、完整检查清单、原版工具示例、task_error 与平台识别优先级；保留其他快车道和 Harness 集成。

## Requirements

- 恢复复杂任务的 `prd.md`、`design.md`、`implement.md` 三份产物，分别承载需求、设计和执行计划。
- 恢复建任务与实施分开的授权，以及规划完成后的审核；仅建任务或笼统继续不能跳过规划审核。
- 恢复项目 lint、typecheck、tests 与新增函数单测、Bug 回归、变更行为测试清单。
- 将 GitNexus / ABCoder 说明恢复为官方 0.6.16 模板中的不带版本 / `@latest` 示例；本次不安装工具，不更改其他安装器。
- 恢复损坏任务记录的 `task_error` 和官方平台检测优先级，保留 Codex 产品经理提示及主会话执行。
- 保留低风险请求免建任务、按需上下文、防御性代码约束及不强制提交的其他快车道行为。

## Acceptance Criteria

- [x] workflow、相关 Skills、Gemini 入口、协作策略和 README 对前三项一致。
- [x] 第三方工具说明与官方 Windows 模板一致。
- [x] 实际 Hook 对缺失、非 JSON、非对象或缺失状态的任务记录输出 `task_error`，不输出 `no_task`。
- [x] 平台专用环境变量优先于 Claude 兼容变量；Codex 原生会话和无任务快车道仍正常。
- [x] 产品经理待验收提示保留，受管策略经支持命令投影，适用验证通过。

## Notes

- Boss 在对比表上逐项选定上述六项并明确要求“改回去”，已授权本次精确恢复。此前完整快车道实现及归档记录保留。
- 官方依据是本机 `@mindfoldhq/trellis@0.6.16` 的模板及其 Windows 渲染结果。
- 技术设计见 `design.md`，唯一执行计划见 `implement.md`。不提交、推送、安装或同步全局 Skill。
