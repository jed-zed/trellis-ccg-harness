# 实施计划：GPT Pro fresh 调用与 pre-invoke 槽位恢复

## M1：冻结回归与任务合同

- [x] 补齐 PRD、设计、根因证据和任务 scope，校验并正式 `task.py start`。
- [x] 增加组合失败测试：根首页新独立轮次、点击前早期失败状态、槽位自动释放。

## M2：最小实现

- [x] 更新权威 Skill/流程，让新独立根首页轮次显式传 `-FreshConversation`。
- [x] 在 adapter 的共享 pre-click 边界写入可验证 `pre-invoke-failed`。
- [x] 复核 watcher 释放证明；只补必要校验，不改 post-click no-resend 语义。

## M3：验证、旧轮次恢复与重审

- [x] 运行 adapter/watcher Pester、Harness conflicts 和与变更风险相称的检查。
- [x] 更新 tooling spec，检查 task scope/diff 并运行 `trellis-check`。
- [x] 为旧失败轮次补写有来源的未发送记录，经 `release-slot` 仅释放对应槽位。
- [x] 以 fresh、新 evidence、新幂等键安全发起 PR #46 GPT Pro 只读审查并校验证据。
- [x] 执行 `trellis-update-spec` 判断。
- [x] 提交前向 Boss 展示 commit plan，未授权则不提交。

## 主要文件

- `.agents/skills/chatgpt-pro-sidebar/SKILL.md`
- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar.ps1`
- `.agents/skills/chatgpt-pro-sidebar/scripts/chatgpt-pro-sidebar-watch.ps1`（仅在验证证明需要时）
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar.Tests.ps1`
- `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar-watch.Tests.ps1`
- `.trellis/spec/tooling/chatgpt-pro-agent-browser-v2.md`
- 本任务 Trellis 工件
