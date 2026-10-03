# 等待 Trellis 候选测试门并传播失败

## Goal

修复 prepareTrellisWorktree 遗漏 await 导致候选测试门错误未纳入更新调用链；仅最小修复与候选失败清理回归。

## Requirements

- 批次 `HARNESS-AWAIT-CANDIDATE-001`：仅修复 `scripts/harness-lifecycle.mjs` 中 `prepareTrellisWorktree` 未等待 `runHarnessTests(worktree, run)` 的缺陷。
- 候选测试门失败必须经 `prepareTrellisWorktree`、`createTrellisCandidate` 传播；候选 worktree 和临时根目录被已有 catch 清理，调用方不能获得可应用的候选。
- 回归仅修改 `tests/harness-lifecycle.test.mjs`，调用已有导出并在独立进程中拦截标准库外部命令边界。所有 npm/pnpm/git/test 命令均为 fixture，不执行真实升级、安装或网络调用。
- 不增加生产 API、通用注入框架、兜底或配置；不修改其他审计项、原 I 主树、全局环境或 CCG 源码，不提交或推送。

## Acceptance Criteria

- [x] 定向红测试在当前源码上可复现：候选测试失败未正常传播、清理未发生，调用方错误获得候选。
- [x] 统筹审核红测试及精确差异后单独批准生产修复；此前保持 planning，不执行 `task.py start`。
- [x] 获批后仅补缺失的 `await`；同一回归通过并证明失败被捕获、候选被清理、应用分支不可达。
- [x] 相关现有测试、完整 Harness 门及适用来源/冲突/安全检查通过；未改变的 CCG 验证沿用已有证据。

## Notes

- 本任务是已定位单一调用点的轻量结构化修复，需求、设计决定与唯一短计划保存在本文件。
- 初始阶段统筹授权原话：“先交可复现的定向红测试证据与精确待改测试路径，下一步我会据证据批准实施”。该阶段仅执行建任务、备份及红测试，后续实施使用下文记录的新批准。

## 唯一执行计划

1. 读取实际调用链和生命周期规范，确认其余四个测试门调用已正确等待或返回 Promise。
2. 保存源码、实际待改测试、task/session/project 基线与 70 项 dirty 清单，逐字节核验；建立本 planning 任务。
3. 添加一个隔离回归，拦截外部命令，输出失败传播、清理和调用方是否进入应用分支的证据。运行定向红测试并交统筹审核。
4. 获得新实施批准后激活任务、补 `await`，运行同一回归、相关测试和现有完整 Harness 门。
5. 复核变更边界，记录验证并按支持路径本地完成，归档使用 `--no-commit`。

## 验证触发与回退

- 共享升级边界存在遗漏的异步等待 -> 可运行失败传播回归及完整 Harness 门 -> 红测试准确暴露根因，修复后全套通过。
- 生产文件不提供 runner 参数 -> 使用已有 `createTrellisCandidate` 导出与独立 Node 进程的标准库命令替身 -> 无生产测试专用接口、无真实升级命令。
- 检查点：`J:/CodexBackups/overnight-20260908-1415/checkpoints/harness/2026-09-08T18-17-12.192Z-HARNESS-AWAIT-CANDIDATE-001-red`。5 个源/测试/readiness 文件逐字节核验，原 session 目录为空，保存 70 项 dirty 清单。
- 回退只还原本批次测试/源码并恢复原会话状态；本批新任务和其他新增文件先移入另存恢复点，不永久删除。保留之前快车道和六项恢复以及其他用户 dirty 修改。

## 定向红测试证据

- 测试路径：`tests/harness-lifecycle.test.mjs:212`，新增一个独立进程回归；`tests/harness-gates.test.mjs` 和生产源码保持检查点原字节。
- 命令：`node --test --test-name-pattern='Trellis candidate gate failure' tests/harness-lifecycle.test.mjs`，退出码 1，1 项失败、0 通过，约 267 ms。日志：`.ccg/await-candidate-red.log`。
- 实际证据：`applicationReached=true`、`worktreeRemoved=false`、`temporaryRootRemoved=false`、`caughtFailure=null`；`unhandled` 收到候选 Node 测试命令的 `exited with 1` 错误。断言失败为 `failed candidate reached application branch`。
- `applicationReached` 是候选 Promise 成功后测试调用方的应用分支标记；没有执行真实替换事务。生产 `updateTrellisHarness` 在相同边界先 await `createTrellisCandidate`，再进入替换事务。
- 红态证据采集后由测试 finally 调用已有候选 cleanup，删除 fixture；独立进程的命令替身没有改变主测试进程、全局工具或用户项目。
- 红测试阶段结束后，统筹完整审阅计划、86 行回归及生产调用链，明确批准：“仅在 scripts/harness-lifecycle.mjs 原 973 行补 await”。按此批准进入实施。
- 实施前检查点：`J:/CodexBackups/overnight-20260908-1415/checkpoints/harness/2026-09-08T18-24-10.657Z-HARNESS-AWAIT-CANDIDATE-001-implement`，10 个源码、测试、任务、会话及 readiness 文件逐字节核验；新增输出路径和无永久删除的回退约束已记录。

## 完成验证

- 生产差异严格为原第 973 行新增 `await`；原 CRLF 保留。补丁工具在该行产生的换行差异已修复并与原备份全文比对，没有其他生产内容变化。
- 同一回归红转绿：1/1 通过；换行修正后的最终复核再次 1/1 通过。相关 `harness-lifecycle`、`harness-gates` 文件 28/28 通过，退出码 0，日志 `.ccg/await-candidate-green.log`、`.ccg/await-candidate-focused.log`。
- 完整 Harness 验证：471 tests、468 pass、3 skip、0 fail、0 cancelled，退出码 0，约 29.4 分钟；日志 `.ccg/await-candidate-native-final.stdout.log`、`.ccg/await-candidate-native-final.exit.json`，stderr 为空。独立 Node PID 177460、创建时间 `2026-09-08T18:25:29.3352968Z`，完成时间 `2026-09-08T18:54:55.4622784Z`。
- Doctor、来源校验、冲突检查、语法及 `git diff --check` 通过。活动任务阶段冲突检查为 0 blocking、0 warning、19 passed。日志 `.ccg/await-candidate-{doctor,sources,conflicts}.log`。
- 安全与影响核对：已有五个 Harness 测试门调用中仅这一处遗漏等待；修复复用现有 catch 清理，不扩大任何安装、来源、路径、所有权或 Provider 权限。错误不再绕过候选 Promise；回归命令替身仅存在于独立进程，无真实升级或应用事务。
- 原有 70 项 dirty 记录全部保留，本批新增 6 项均属于单个生产文件、单个测试文件及本任务。测试与 readiness 文件按实施检查点逐字节比对，原 I 主树、CCG 源码、全局环境、其他审计项均未修改；没有 commit/push。
- 未改变的 CCG lint/typecheck/build 与 643 pass、3 skip 全套验证沿用六项恢复任务的已通过证据；既有 Go 检查同样未受影响。
- 收尾检查点：`J:/CodexBackups/overnight-20260908-1415/checkpoints/harness/2026-09-08T18-56-44.937Z-HARNESS-AWAIT-CANDIDATE-001-closeout`，10 个代码、测试、任务、会话和 readiness 文件均逐字节核验。
- 已通过支持的 `mark-ready` 与 `task.py archive --no-commit` 完成本地收尾，两个命令均退出 0；本任务于 2026-09-08 归档，状态 completed、项目 ready，会话指针已清除。最终 conflicts 为 0 blocking、0 warning、3 info、17 passed，日志 `.ccg/await-candidate-final-conflicts.log`。
- 归档后保护状态复核通过：HEAD 仍为 `2ffd604d7260e6fa17ad52d674413f3b90bd5b0d`，暂存区内容不变；70 项原有 dirty 记录保留，额外 6 项均在本批两个代码/测试文件及归档任务范围内。`git diff --check` 通过。
