# 设计：PR38 三项 Major 修复与 CCG 3.4.10 对齐

## 1. Authority and integration topology

- Trellis 本任务拥有需求、计划、里程碑和完成状态；Codex 是唯一 canonical workspace writer 与最终验证者。
- CCG 权威源是个人仓库 `jed-zed/ccg-gptpro-worflow`。以 PR38 source `baf3330` 保留桥接功能，以 `0b30802` 引入 3.4.10 Provider/snapshot 修订。
- 两线共同基线为 `bf9f962`。采用 merge 保留两侧历史，不 rebase 已发布提交；只对 `CHANGELOG.md` 与 plugin manifest 的实际交集作人工语义合并。
- 最终 clean source commit 是 Harness provenance 的唯一来源。Harness snapshot 与 manifest 只由 lifecycle transaction 生成，不手工复制。

```text
personal CCG baf3330 (PR38 bridge)
          +
CCG main 0b30802 (3.4.10 / PR37)
          -> clean integrated source commit
          -> atomic response fix + regression
          -> final clean CCG commit/tree
          -> supported harness:update transaction
          -> Harness-local RootWait + Trellis spec changes
          -> tests / M1 evidence / hard gate
```

PR39 Harness commit不得被整棵盲目 cherry-pick。若实现阶段能读取该 ref，只用于 diff 对照；最终 snapshot 仍由本任务的 clean source commit 生成，以避免覆盖 PR38 bridge。

## 2. RootWait capacity ownership

容量的最小不变量是“一个逻辑 round 恰好一个 claim”。

- 直接 `run-root`：在 `Invoke-WatchAdapterSend` 前取得 claim，记录 thread/evidence/owner identity；无槽即返回现有容量类别，且不进入任何 browser path。
- batch：父进程继续在 child 启动前取得 claim，通过内部参数传递 `SlotId` 与 `ClaimId`。child 重新读取 claim，验证 slot、claim、thread 和 evidence binding 后复用，不再次 `Acquire-CapacitySlot`。
- release：负责该 round 的路径只释放一次。pre-click failure 标记 durable unsent 后释放；完整 `retry-not-submitted` 或 watcher terminal proof 后释放；`recovery-required`、child crash 且 proof 不完整时保留。
- 用户可直接传入错误 handoff 时 fail closed；handoff 仅是内部 ownership 证明，不删除 idempotency/target claim，也不授权点击。

不新增第二套 scheduler、配置或容量数据库；复用现有 six slot files、capacity mutex、claim proof 与 error categories。

## 3. Atomic response persistence

在两份 bridge 的共享 `save_response` 行为上采用同一 stdlib 写法：

1. 保持现有 response bytes 校验与 existing-content conflict 检查。
2. 在 `response.md` 同目录创建唯一临时文件。
3. 写完整 bytes，`flush()`，`os.fsync()`。
4. `os.replace(temp, response.md)`；同卷替换避免可见半文件。
5. `finally` 删除尚存临时文件。
6. 继续执行现有 evidence/status 更新；若后续步骤失败，相同 response replay 仍按幂等路径补齐。

不把本次修复扩大为通用事务框架。只有当最终 3.4.10 调用链证明同一 session 可并发进入 existing-read/replace 临界区时，才复用已有 session lock 或加一个最窄的 per-session lock，锁顺序固定为 session -> response/evidence/status；不得引入新依赖。

## 4. Product Manager permission contract

规范的已知 capability-class 旧断言位于执行权限段、Claude 权限段、validation matrix 的 tool-class 拒绝项和 required-test 的 read/search allowlist 断言。实施时对整份规范及对应 CCG rule/design/tests 做一次精确检索，清除所有同义旧断言；`final-eligibility`、Provider evidence 等描述“只读结果/证据”的语句不属于进程权限，不应误删。

新合同：Provider 在 verified disposable snapshot 中使用所选官方基线的常规权限；CCG 仍以 `shell:false`、provider-scoped minimal environment、timeout 与 output cap 启动。工具使用只作用于 disposable snapshot，不赋予 canonical workspace 或 Trellis lifecycle authority。

其余边界保持原样：snapshot manifest/caps/cleanup、selected-provider/no-fallback、network/payment explicit authorization、identity/digest/schema、retry audit、CAS、presentation-before-response 和 fresh user gate。

## 5. M1 evidence model

M1 只有一个工程验收集合：

- `source-identity.json`：3.4.10 baseline、最终 source commit/tree/version、合并冲突处置。
- `harness-alignment.json`：manifest commit/tree/version、installed plugin identity、doctor/verify:sources。
- `major-fixes.json`：三个 finding 到代码、测试与 AC 的映射。
- `validation-summary.md`：命令、退出码、测试计数、PR base/head/diff/checks 与 dirty-path 分类。

原始长日志放 task-local ignored evidence；tracked research 只存有界摘要、路径和 SHA-256。PR head 或 source identity 变化后，旧 M1 evidence 标记 stale 并重建。

## 6. Failure and rollback boundaries

- source merge 前记录 `baf3330`；冲突超出已知两个文件或 bridge 功能丢失时终止 merge并回到该 commit。
- Harness update 前记录当前 `harness.sources.json` 与 component tree；transaction 失败使用受支持的 recover/rollback，不手工还原 snapshot。
- RootWait/spec 修改分别保持小提交；focused test 未过不进入 full gates。
- M1 review 只在全部工程证据不漂移时触发。任何 hard gate 在 `pm present` 后暂停。
- push、publish、Ready、merge 和其他环境安装不属于本地回滚链。
