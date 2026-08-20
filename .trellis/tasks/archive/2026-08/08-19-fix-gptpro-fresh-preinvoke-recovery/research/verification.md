# 验证证据：fresh、pre-invoke 恢复与 GPT Pro 重审

## 自动化与项目门

- adapter Pester：191/191 通过。
- watcher Pester：134/134 通过。
- `node scripts/harness-adapter.mjs conflicts`：19 passed，0 blocking，0 warning。
- `npm run doctor`：通过。
- `npm run verify:sources`：通过。
- PowerShell parser：Windows PowerShell 5.1 与 PowerShell 7.6.4 各解析 4 个变更脚本/测试，
  均为 0 error。
- `pnpm harness:test`：458 项中 454 通过、1 失败、3 跳过。唯一失败是未改动的
  `harness-skill-repository.test.mjs` 在 Windows 临时事务目录清理时偶发 `ENOTEMPTY`；
  同一测试随后在本分支单跑通过，并在 `main@fa503092` 单跑通过，因此记录为环境时序
  flake，不是本次 GPT Pro diff 的确定性回归。
- `pnpm ccg:lint/typecheck/test/build` 均已尝试，但受管 CCG snapshot 没有
  `node_modules`，分别缺少 `eslint`、`tsc`、`vitest`、`unbuild`，未进入代码检查。
  本任务不安装依赖，也不把这些运行时缺失伪报为通过。
- CCG security scanner：扫描 5 个脚本，Critical/High/Medium/Low 均为 0。
- CCG quality checker 当前不识别 PowerShell，报告扫描 0 文件；因此质量结论以完整
  Pester、PowerShell parser、diff check 和人工调用链复核为准。
- CCG 外部情报路由两次进入 pending 且无输出，已在 60 秒边界停止；这是 advisory
  通道失败，不替代也不阻塞本地质量/安全门。

## 旧轮次未发送恢复

- 旧 evidence：`gptpro-evidence`；旧幂等键 hash
  `585107f9639141a29ea742a2670785fa70f5aa592e6c967272233610e7b8ebfe`。
- 原样重放旧命令仍在 `ExistingConversationUnproved` 失败，且发生在 reservation、fill、
  click 之前。
- adapter 写出 `phase=pre-invoke-failed`、`invokeAttempted=false`、
  `submissionAcknowledged=false`、`automaticResendAllowed=false`。
- watcher 返回 `durable-pre-click-unsent`，受支持的 `release-slot` 只删除 slot 3 claim；
  slot 1/2 保持原样。

## 新 GPT Pro PR #46 审查

- 固定范围：`base=fa503092372a7f33eaaae5398560b2d1a4f77940`，
  `head=c6f8c041a381274d2db02e1d409488146b2a64ea`。
- 使用新 evidence `gptpro-evidence-v2`、新幂等键 `pr46-gptpro-review-c6f8c041-v2`
  和显式 `-FreshConversation`。
- terminal：`completed`；一次 click attempt；submission acknowledged；精确 conversation
  URL 在 send 与 completion evidence 中匹配；`observationalRecovery=false`；
  `automaticResendAllowed=false`。
- response SHA-256：
  `3ac2260bfb6e4d0f18e489a4ceaca33cc5c587952f69deb6fbf10fd76ea84241`，与
  `response.md` 文件一致；Codex continuation acknowledgement 已落盘。
- GPT Pro：`VERDICT: APPROVE`，`FINDINGS: NONE`。唯一残余风险是第三方标识仍靠人工
  镜像，未来可能再次漂移；当前 `harness.sources.json` 权威快照一致。
