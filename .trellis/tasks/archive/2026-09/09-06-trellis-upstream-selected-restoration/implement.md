# 执行计划

1. 对照已安装的官方 0.6.16 模板，记录恢复范围与现有 dirty 基线。
2. 先更新实际 Hook 和 workflow 回归以表达六项验收，确认新断言在修改前失败。
3. 恢复选定流程要求、工具示例和 Hook 行为；同步策略资产、入口、README 与规范。
4. 升级协作策略版本，经支持的 apply 投影；运行聚焦验证，再运行要求的完整离线门。
5. 验证无越界 diff、任务及策略状态；记录完成结果，mark-ready 并只归档本任务，使用 `--no-commit`。

## 验证触发

- Hook 的任务错误和平台路由改变 -> 实际入口回归、产品经理现有回归 -> 预期状态、平台和提示全部正确。
- 共享 workflow/Skill/owned policy 改变 -> 策略及生命周期聚焦门、完整 Harness 和适用 CCG 门、Doctor/source/conflicts -> 通过且投影一致。
- 原 CCG/Go 源码未改变 -> 沿用已完成的 Go 验证，不新增其测试。

## 范围与回退

本次指令直接批准已列出的六项恢复；不将新写出的流程规则反向解释成撤销用户已给出的本次实施授权。后续任务按恢复后的独立规划审核执行。
修改前 Git 状态和 patch 保存在 ignored `.ccg/trellis-restore-before-*`；回退仅恢复本次拥有的修改。原工作区、其他任务、全局 Skill 和 Provider 均不变。

## 完成记录

- 六项恢复已实施。协作策略由版本 9 升为 10，使用 approved 合同副本经支持的 `apply` 更新受管文件；完整门结束前保持 approved。
- 修改前新增断言按预期失败：复杂任务文档、规划审核/检查清单、损坏任务和平台顺序，见 `.ccg/trellis-restore-red.log`。
- Hook/workflow 与产品经理回归 14 项通过；补充失效会话目录回归后 Hook 专项 6 项通过；初始化器 63 项通过、1 项按平台跳过。
- `mcp-setup.md` 与官方 0.6.16 Windows 渲染模板逐字节一致；未执行示例安装命令。
- CCG lint、typecheck、build 通过；全套 CCG 测试 643 项通过、3 项按原配置跳过。构建保留上游 Browserslist 数据过期和空 chunk 提示，不影响退出码或产物。
- Doctor、来源校验和冲突检查通过；冲突检查为 0 blocking、0 warning。
- 安全/范围复核：任务错误不再进入无任务流程；Hook 仅提供提示，不写任务或调用 Provider；真实平台变量优先，原生 Codex 与产品经理硬门保留。失效任务分支保持统一四字段返回，避免产品经理集成解包失败。未改动其他安装器、CCG 源码、全局 Skill 或原工作区。
- 完整 Harness 最终验证通过：470 项，467 通过、3 项按平台条件跳过、0 失败、0 取消，退出码 0，约 30.3 分钟。见 `.ccg/trellis-restore-native-final.stdout.log` 与 `.ccg/trellis-restore-native-final.exit.json`；stderr 为空。
- 首次完整运行暴露旧测试仍要求固定 GitNexus/ABCoder 版本；已按本次官方示例恢复要求修正该断言，专项 4 项通过，且包含在最终完整通过结果中。中间一次重跑因 FastCtx 控制中心中断而终止，无最终退出码，保留为中断证据，不计为通过或代码失败。
- 收尾回退点：`J:/CodexBackups/overnight-20260908-1415/checkpoints/harness/2026-09-08T17-13-45.895Z-restoration-closeout`。写入前再次逐字节确认 9 个任务、会话及 readiness 文件与备份一致；中断日志另存 `2026-09-08T17-33-50.036Z-native-final-test` 检查点。
- 已经支持命令标记 ready，并以 `--no-commit` 归档本任务；完成日期为 2026-09-08。最终冲突检查退出码 0：0 blocking、0 warning、3 info、17 passed；变更范围审计及 `git diff --check` 通过。不提交、推送或同步全局安装。另行审计发现不属于本次六项恢复，未修改相关实现。
