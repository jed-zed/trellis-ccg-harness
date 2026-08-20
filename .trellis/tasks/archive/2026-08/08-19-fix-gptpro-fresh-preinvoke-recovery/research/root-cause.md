# 根因证据：2026-08-19 GPT Pro PR #46 未发送轮次

- FastCtx job：`j-esct71`；实际 `run-root` 命令未包含 `-FreshConversation`。
- adapter 失败：`ExistingConversationUnproved`；当时目标 URL 为 `https://chatgpt.com/`，
  `urlExact=false`、`generating=false`。
- evidence：`I:\ai\trellis-ccg-harness-license-attribution\.ccg\reviews\pr46\gptpro-evidence`；
  仅有 `.chatgpt-pro-sidebar.lock`，没有 `state.json`、`prompt.md`、watch state 或 response evidence。
- 幂等键：`pr46-gptpro-review-c6f8c041-v1`；SHA-256
  `585107f9639141a29ea742a2670785fa70f5aa592e6c967272233610e7b8ebfe`；全局
  `idempotency-v1` 无对应 reservation。
- capacity：slot 3 仍为 schema 2 `run-starting`、`submissionAttempted=true`，owner
  已死亡。slot 1/2 属于其他旧任务，本任务不处理。

调用链：watcher 在调用 adapter 前标记 `submissionAttempted=true`；adapter 在 URL 模式
校验处、reservation/fill/click 之前抛错；早期错误未写 `pre-invoke-failed`，因此 watcher
无法验证 pre-click 状态，只能返回 `ConcurrencySlotRecoveryRequired`。
