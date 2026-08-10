# Fix PR38 RootWait capacity, atomic response persistence, and PR39 contract alignment

## Goal

将 PR #38 保持在 Draft 状态，先把个人 CCG 权威源从现有 PR38 分支安全合入 CCG `3.4.10`，再通过受支持的 Harness 生命周期同步精确 commit/tree；在同一任务中关闭三项已核实 Major：独立 `run-root` 绕过 `3/6` 容量、`response.md` 非原子写、PR38 Product Manager 规范与 PR39 有意权限模型冲突。所有工程证据通过后进入 M1 Product Manager 复审与 Boss 硬验收。

## Confirmed Facts

- PR #38 当前审查对象为 `jed-zed/trellis-ccg-harness` Draft，规划时 head 为 `8bc75450e7d6b4a155876daaf50ed7b735eca5f8`；任何后续 head 变化都必须重算验证与审查证据。
- Harness 当前固定 CCG `3.4.9`：commit `baf3330aab92c508cb396af560612b63f1886a96`，tree `f0a6282c2e50d9c1ff33aabd42d6277b5514be73`。
- 个人 CCG `3.4.10` 基线为合并提交 `0b308021bef7f1190a07be55286bef38fda1c826`，tree `00b1850d22556c8b338244fb26b19069ca90ffe4`；package 为 `3.4.10`，Codex plugin manifest 为 `3.4.10+codex.1`。
- `baf3330` 与 `0b30802` 的共同基线为 `bf9f962`，两侧分别有 12 与 4 个独有提交。桥接改动与 3.4.10 Provider 权限改动没有代码路径交集；已知交集仅 `CHANGELOG.md` 与 `plugins/ccg/.codex-plugin/plugin.json`。
- CCG 3.4.10 的 template 与 plugin bridge 仍分别在 `save_response()` 中直接调用 `response_file.write_bytes(...)`，会在进程中断时留下截断响应并阻断相同完整响应重放。
- `chatgpt-pro-sidebar-watch.ps1` 仅在 `run-batch-root` 父进程取得容量；直接 `run-root` 在发送前没有容量申领。
- PR39 的权限放宽是 Boss 已确认的产品变更：Provider 可在 disposable snapshot 内使用所选官方基线的常规权限，但仍没有 canonical workspace 或 Trellis lifecycle authority，且 identity/schema/timeout/output/no-fallback/network/payment/user-gate 合同不变。

## Requirements

### R1. CCG 3.4.10 authority and Harness alignment

- 保留 PR38 个人源的 12 个现有提交，不 rebase 或重写已发布 SHA；将 `0b30802` 合入该线，手工核对仅有的实际冲突，禁止用上游整棵覆盖桥接实现。
- 最终个人源必须是 clean、可追溯的 `3.4.10` commit/tree；原子响应修复先落在权威 source，再通过 `pnpm harness:update -- --source-checkout <clean-checkout>` 同步 Harness。
- 不手工编辑 `components/ccg-workflow` 或 `harness.sources.json`。同步后 manifest 的 version/commit/tree 必须与最终权威 source 完全一致，安装运行时必须解析为兼容的 `3.4.10+codex.*`。
- 若 3.4.10 合并产生除已知两个文件外的冲突，或 snapshot 更新会删除 PR38 bridge/RootWait 功能，立即停止并修订计划。

### R2. Direct RootWait capacity enforcement

- 每个逻辑 GPT Pro round 在进入 adapter/browser 发送前必须持有一个容量槽；限制仍为同一 Codex task 最多 3、同一 local user 最多 6。
- 直接 `run-root` 必须自行申领容量；批量父进程已申领的槽必须以内部 claim identity 交给 child `run-root`，child 只验证并复用，不能二次计数。
- 未取得容量时不得启动 adapter、打开页面、写 composer 或点击 Send。
- 释放仍只接受 durable pre-click-unsent、完整 `retry-not-submitted` 或 terminal proof；`recovery-required` 和无法证明的 orphan 必须保留槽并返回 `ConcurrencySlotRecoveryRequired`。
- 不改变 one-click、one-safe-retry、absolute deadline、exact target binding 或 no-resend 语义。

### R3. Atomic response persistence

- template 与 plugin bridge 必须在同目录用临时文件写完整 UTF-8 bytes，执行 `flush`、`fsync` 后以 `os.replace` 原子替换 `response.md`，失败时清理临时文件。
- 保留现有空响应/2 MiB 上限、相同内容幂等、不同内容拒绝、V2 completed import gate、response hash、evidence/status 更新顺序。
- 任何注入的写入或 replace 失败都不得把已存在的完整 response 变成截断内容；首次失败后同一 completed evidence 必须可以安全重放。
- 不为此新增依赖、通用存储框架或无关 JSON 事务重构。

### R4. PR39 Product Manager contract alignment

- 只修改 PR38 中仍声明固定 Read/Glob/Grep-only 的规范语句，使其与 PR39 一致：Provider 在 verified disposable snapshot 中使用所选官方基线的常规权限。
- 必须继续禁止 Provider 获得 canonical workspace 写入权、Trellis task/status/milestone/finish/archive authority、provider fallback，以及未授权 network/payment 行为。
- 保留 snapshot containment、secret/plugin/cache 排除、文件/大小上限、identity/digest binding、single-flight、timeout、output schema、redaction、CAS、hard-gate presentation 与 fresh user response 合同。
- 同步后的 CCG 3.4.10 rule/design 与 Trellis spec 必须语义一致；不保留互相矛盾的测试断言。

### R5. M1 gate and evidence

- M1 包含 CCG 3.4.10 精确对齐、三项 Major 修复、focused/full tests、source provenance 和 PR diff 复核。
- 进入 M1 Product Manager review 前，必须记录最终 CCG commit/tree、Harness manifest identity、安装版本、PR base/head/diff hash、测试命令/退出码和三项 AC 映射。
- `MILESTONE_REVIEW` 必须绑定当前 M1 evidence；若产生 hard gate，执行 `pm present` 后停止并等待 Boss 的 fresh response，不得代答或自动继续。
- M1 未通过前不得把 PR #38 改为 Ready、给出合并建议或进入 Trellis finish/archive。

### R6. Change and publication boundaries

- 只修改三项根因、必要规范、对应测试、权威 source/snapshot pin 与本任务证据；不修本轮未要求的 stop-hook 权限、legacy UIA、诊断 release-slot 或其他 Minor/Required Tests。
- 允许为 Harness 生命周期创建本地个人 CCG integration/fix commit 和 Harness work commit；push、npm publish、GitHub merge、PR Ready 或安装到其他环境仍需单独明确授权。
- 保留所有现有 dirty/untracked 用户文件；不得 clean、stash、reset 或把其他工作树改动带入本任务。

## Acceptance Criteria

- [ ] AC1：最终 clean 个人 CCG source 以 `0b30802` 为 3.4.10 基线且完整保留 `baf3330` 的 PR38 bridge 功能；package/plugin 版本分别为 `3.4.10` / `3.4.10+codex.*`。
- [ ] AC2：Harness 仅经受支持的 lifecycle 更新，`harness.sources.json` 的 commit/tree/version 与最终 source 完全一致，`verify:sources` 与 doctor 通过。
- [ ] AC3：直接同线程第 4 个 `run-root` 与全局第 7 个 `run-root` 在 adapter/browser 调用前排队或失败；前 3/6 个各只占一个槽。
- [ ] AC4：batch parent 到 child 的 claim handoff 不重复占槽，claim identity 不匹配 fail closed，terminal/pre-click proof 安全释放，`recovery-required` 保留槽。
- [ ] AC5：两份 bridge 的响应写入使用同目录原子替换；故障注入证明目标保持旧完整内容或不存在、临时文件清理、同一响应可重放、不同内容仍拒绝。
- [ ] AC6：PR39 权限条款在 Product Manager spec、同步后的 CCG rule/design 和测试中一致；Provider tool class 本身不再触发 invalid，但 canonical workspace/lifecycle 越权仍 fail closed。
- [ ] AC7：PowerShell/JavaScript/Python parse、focused Pester、focused bridge tests、CCG lint/typecheck/test/build、Harness tests、conflicts、doctor、verify:sources 与 `git diff --check` 全部通过。
- [ ] AC8：当前 PR #38 base/head/diff/checks 与工作树边界已重签；任何 head 漂移都使旧 Provider/M1 evidence 失效。
- [ ] AC9：M1 Product Manager review 使用当前 identity 和完整证据；advice 被完整呈现，并取得后续 fresh Boss 验收后才标记 M1 完成。
- [ ] AC10：PR #38 在 M1 完成前始终保持 Draft；没有未经授权的 push、publish、merge、Ready 或全局安装。

## Out of Scope

- 修复 stop-hook registry 的同用户路径信任、diagnostic `release-slot` 认证或 legacy UIA 清理。
- 新增容量配置项、锁框架、数据库、第三方依赖或自动 fallback。
- 真实 ChatGPT 长任务 E2E；除非 M1 review 后 Boss 另行授权 live browser validation。
- npm 发布、GitHub PR merge/Ready、远端分支 push 或对其他机器安装。

## Open Questions

无。技术实施以最终 3.4.10 source tree 的实际调用链为准；若与上述 confirmed facts 不一致，停止而不是套用旧补丁。

## Notes

- 本文件只记录产品要求、约束和验收；实现顺序见 `implement.md`。
