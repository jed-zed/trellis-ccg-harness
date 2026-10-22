# 实施计划：CCG 外部资料通道修复

## 前置门槛

- [x] Boss 审阅本任务的调用链、240 秒来源、触发条件和计划文件，并明确确认实施。
- [x] 保持 Trellis task 为 `planning`；确认后才执行 `py -3.14 ./.trellis/scripts/task.py start ...`。
- [x] 从个人 CCG `main@02bb7e1958c94c4b2e2dc739d797ea4613042da0` 创建新的隔离工作树和 `codex/` 分支；确认原工作树脏改动不被触碰。

## Red：先补回归

- [x] 在 routing tests 复现：`target=null`、`dependencies=[]`、包含 `current behavior` / `compatibility logic` 的本地性能任务不调用 runner。
- [x] 保留正例：绑定 dependency/target 的当前外部 SDK/API 契约仍调用 runner；显式 semantic contract 无本地绑定时仍可调用。
- [x] 断言 target 被转为现有 `--file`/`files` 并进入 snapshot 选择。
- [x] 断言 success、ACP timeout、AbortSignal cancel、子进程异常/runner throw 分别落 `completed`、`timed_out`、`cancelled`、`failed`，且没有 pending 残留。
- [x] 断言死 owner 的 pending 可收口，活 owner/token 替换时拒绝收口。
- [x] 让 workflow coverage 中每个自动 route surface 都声明 tool-managed background、wait 和异常后的状态收口。

## Green：最小实现

- [x] 在 route runtime 先收集绑定再分类；仅收紧 `dependency_api_contract`，不改 incident、final verify 和显式 semantic route。
- [x] 将 `target` 传给现有 `--file`/`files`，不新建 snapshot 机制。
- [x] 规范 `execution.status`，保留 provider_status/reason/exit code；pending 后的所有可捕获错误统一落盘。
- [x] 把 CLI 取消信号沿 route -> command -> runner -> ACP 现有 signal 通道传递。
- [x] 为不可捕获终止增加 owner-token/PID 的安全收口；严格复用缓存锁的存活/所有权思路，不按年龄删除。
- [x] 机械同步模板与插件 runtime；只给自动路由 surface 补后台调用契约。
- [x] 不修改 600000 ms runner timeout、FastCtx、锁实现、Grok/Web Search 能力或任何用户配置。

## 验证

- [x] 先跑受影响 Vitest：routing、runner、ACP、artifacts、workflow behavior、plugin parity。
- [x] 启动一个真实后台模拟任务运行至少 245 秒、内部上限 600 秒；用后台 job wait 证明越过 240 秒仍在运行并正常完成。该模拟不调用真实 Provider。
- [x] 分别运行缩时 fake ACP timeout、cancel、异常退出；检查 route state 终态和锁目录。
- [x] 运行负/正路由 fixtures，检查 runner 调用次数、argv、snapshot 文件清单和既有大小上限。
- [x] 在个人 CCG 源执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- [x] 检查最小 diff，删除不能对应 R1-R6/AC1-AC7 的修改。

## 同步与安装（独立回滚点）

- [x] 记录个人配置文件路径、内容哈希、个人源提交、安装版本与 Harness manifest；不打印密钥。
- [x] 仅从通过验证的干净个人 CCG 工作树运行 `pnpm harness:update --source-checkout <path>`。
- [x] 由 Harness 更新事务运行个人源与同步快照的 lint、typecheck、643 项测试、build、Harness 455 项门禁，并在提交后运行 `pnpm doctor`。
- [x] 按源仓库支持的 `sync-local-plugin-cache.ps1` 更新个人 CCG；未手工编辑插件缓存。
- [x] 安装前后比较两处个人配置哈希，均保持 `1d670425581a877ee38743fa56fe9229afbf7387a985aaeec493a68740385387`。
- [x] 四项验收 fixture、245 秒后台模拟和安装缓存三份 runtime 哈希一致性均通过。

## 回滚

- [x] 源码：反向提交修复 commit，或将隔离工作树切回记录的个人源提交。
- [x] Harness：用同步前 manifest 所记录的个人源提交重新运行同一 `harness:update` 事务。
- [x] 安装：用同步前个人版本走支持的安装流程恢复；配置仅从本次备份恢复，不替换为官方默认。
- [x] 删除的仅限本次隔离临时工作树/模拟产物；不删除活动锁、SillyTavern 数据或插件缓存目录。

## 完成记录

- 个人 CCG 提交：`1572b7ae8111fb15272c5b3f60a59bb5ce1bf510`。
- Harness 同步提交：`5cbcc06eedc9c313e276536f63c8f4ec380a94b9`。
- 245 秒模拟：`elapsedMs=245030`，后台等待完成，未受 240 秒限制；模拟 Provider 异常最终写为 `failed/invocation_failed`。
- 安装前插件备份：`C:\Users\29933\AppData\Local\CCG\plugin-backups\ccg-3.4.15+codex.1-before-1572b7a`。
