# 修复 GPT Pro fresh 调用与 pre-invoke 槽位恢复

## Goal

让根首页的新独立任务明确使用 fresh 模式，持久化所有点击前失败并安全恢复未发送槽位，补组合回归后重新执行 PR #46 GPT Pro 审查。

## Requirements

### R1：新独立任务显式使用 fresh 模式

- 从 ChatGPT 根首页发起新的独立 GPT Pro 轮次时，权威 Skill 示例和流程必须显式传入 `-FreshConversation`。
- 已有会话的后续轮次继续要求精确 conversation URL，不得静默把首页推断为已有会话或自动降级。

### R2：点击前失败的耐久记录

- `agent-browser-cli-v2` 在实际 click 前发生的可捕获失败必须写入 `state.json`，状态为 `pre-invoke-failed`、`invokeAttempted=false`，并记录可校验的 thread、幂等键、prompt hash、target binding、失败类别和时间。
- 一旦 click 已尝试或边界不确定，仍必须进入现有 `send-uncertain`/no-resend 路径，绝不能误标为未发送。
- 继续复用既有 evidence、幂等 reservation、target claim 和原子写入机制；不新增 transport、依赖或自动重试。

### R3：槽位恢复与组合回归

- watcher 必须把上述 `pre-invoke-failed` 识别为可验证的 pre-click 证明，并正常自动释放 direct `run-root` 与 batch 槽位。
- 自动化测试覆盖“新独立任务 + 根首页 + fresh”、“adapter 点击前早期失败 + 耐久未发送记录 + 自动释放”以及 post-click no-resend 隔离。
- 对 2026-08-19 的旧失败轮次，仅在核验命令、目标、幂等 reservation 和证据目录均证明未点击后补写审计记录，再通过受支持的诊断释放入口释放对应槽位；不得触碰无关槽位。

### R4：安全重审

- 自动化和 Harness 冲突检查通过后，以新的 evidence directory 和新的幂等键显式使用 `-FreshConversation`，重新发起 PR #46 GPT Pro 只读审查。
- 审查只读取固定 base/head diff，不登录、不安装、不修改 PR/工作区；Codex 校验证据后再确认轮次。

## Out of Scope

- 不自动判断任意首页都应创建新会话。
- 不清理幂等 reservation、target claim 或无关并发槽位。
- 不提交、不推送、不修改 PR #46，除非 Boss 另行授权。

## Acceptance Criteria

- [x] AC1：权威新独立 `run-root` 示例显式包含 `-FreshConversation`，已有会话模式仍失败关闭。
- [x] AC2：至少一个发生在 URL/composer 等早期校验阶段的失败写出合法 `pre-invoke-failed`，且无 fill/click。
- [x] AC3：watcher 对该记录自动释放槽位；缺失、损坏或 post-click 证据仍返回 `ConcurrencySlotRecoveryRequired`。
- [x] AC4：adapter、watcher 相关 Pester 测试及 `node scripts/harness-adapter.mjs conflicts` 通过。
- [x] AC5：旧失败轮次留下可验证的“未发送”记录并只释放其对应槽位。
- [x] AC6：新的 GPT Pro 审查轮次使用 fresh、新 evidence、新幂等键，返回可校验的 terminal evidence，且没有重复发送。

## Notes

- Trellis 是需求与验收权威；Codex 是唯一工作区写入者和最终验证者。
- PR #46 固定审查范围：`base=main@fa503092372a7f33eaaae5398560b2d1a4f77940`，`head=codex/restore-license-attribution@c6f8c041`。
