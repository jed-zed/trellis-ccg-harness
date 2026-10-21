# 技术设计：CCG 外部资料通道超时、终态与路由

## 设计边界

- 权威修改源为个人 CCG 仓库的干净 `main`（当前提交 `02bb7e1958c94c4b2e2dc739d797ea4613042da0`），实施时新建隔离工作树和 `codex/` 分支；不在当前脏工作树、Harness 旧快照或插件缓存中直接改。
- 不修改 600000 ms 的 Grok 内部超时，也不增加无限超时、依赖、重试框架或独立任务系统。
- 不触碰 SillyTavern 活动实例、11451、用户数据和个人 CCG 配置。

## 已确认调用链

```text
CCG optimize Skill 的自动资料门槛
-> Codex 调用 FastCtx 前台 run(timeout_ms=240000)
-> ccg CLI / src/cli-setup.ts
-> src/commands/route.ts: runCodexRoute() / spawnSync
-> templates/.../route.mjs: main() -> runWorkflowRoute()
-> prepareWorkflowRoute() -> classifyWorkflowRoute() -> classifyHardTrigger()
-> collectBindings()
-> invokeRouteRunner() 先写 execution.status=pending
-> defaultInvoke() -> command.mjs: runManualCommand()
-> withCacheLock()
-> runner.mjs: runGrokIntelligence()
-> withCredentialHomeLease()
-> acp-client.mjs: run() -> Grok CLI ACP -> Web Search / 流式输出
-> runner 返回 -> route.mjs 校验证据并写终态
```

外层前台工具在最后一步返回前杀死整棵进程树，因此 route 的完成写入和 JavaScript `finally` 都没有机会运行。240 秒不是 CCG 源码中的超时常量。

## 根因与最小设计

### 1. 调用层超时契约

自动 `ccg route` 是可能超过 4 分钟的工作。控制器必须使用宿主现有的后台任务与等待接口，并在后台任务结束后读取结果；前台 `run` 的 240 秒上限不再作为 CCG runner 超时。CCG 的 600000 ms 内部超时继续负责模型执行上限。

只修改自动路由控制器说明及其覆盖测试，不改 FastCtx、CCG 超时常量或创建第二套后台框架。

### 2. execution 终态

`execution.status` 只使用：

- `pending`：正在执行；
- `completed`：runner 正常返回可接受结果；
- `timed_out`：ACP 内部超时；
- `cancelled`：AbortSignal、SIGINT 或 SIGTERM 的协作式取消；
- `failed`：配置、校验、子进程异常退出或其他异常。

保留原 runner 细分结果到 `execution.provider_status`，保留 `reason`、`provider_exit_code` 和证据路径，避免丢失诊断信息。`decision.status` 的现有 advisory/blocked 语义不变。

`runWorkflowRoute()` 在 pending 写入后统一捕获异常并落 `failed`；runner 对其现有明确 timeout/cancel 错误返回可判别结果。CLI 主入口用 `AbortController` 将可捕获的取消传到 command -> runner -> ACP。

不可捕获的强制进程终止无法在已死亡进程内执行写盘。为避免永久 pending，pending 状态记录 owner token、PID 和开始时间；后台控制器在工作结束后运行无网络的状态收口，只有确认 owner PID 已死亡且 token 未变化时才把该次执行收口为 `cancelled`/`failed`。仍存活的 owner 一律拒绝收口。

### 3. 锁生命周期

直接复用 `lib/cache.mjs` 当前的 owner token + PID 存活检查 + 二次所有权确认：

- 正常/协作取消由 `finally` 释放；
- 强杀后下一次同 key 调用只回收已死亡 owner；
- owner 已替换或 PID 活跃时不删除。

除非回归测试暴露现有实现缺口，不计划修改 `lib/cache.mjs`。新增/扩展验收只覆盖真实子进程异常和现有活锁保护。

### 4. dependency_api_contract

当前条件是任务文本同时命中 `CONTRACT_PATTERN` 与 `CURRENT_PATTERN`。本次任务中的 `compatibility` + `current` 因此误触发；判定发生在 `collectBindings()` 之前，无法利用 `target`/`dependencies` 排除。

最小修改是保留当前分类顺序，但让自动 `dependency_api_contract` 必须同时有当前契约语义和实际 `target` 或至少一个 dependency。没有本地绑定的真实外部契约仍可使用现有显式 `--semantic-mode contract --semantic-reason`，不削弱 Grok/Web Search 能力。incident 路由保持原行为。

### 5. 输入输出规模

`--target` 当前只进入 route state digest，没有传入 `runManualCommand()` 的 `files`，所以目标源码未进入 focused snapshot。修改 route argv/options，将 target 作为现有 `--file`/`files` 传递。

继续使用既有边界：最多 200 文件、单文件 2 MiB、总计 16 MiB、ACP prompt 256 KiB、raw 8 MiB/20000 events、最多 6 turns。没有真实绑定的泛化本地任务在路由层直接跳过，不新增 token 配置项。

## 兼容与回滚

- 保留外部资料开关、Grok ACP、Web Search、手工 intel/verify 和显式 semantic route。
- 保留 advisory route 的非阻塞 exit-code 语义，只规范 `execution.status`。
- 回滚按个人 CCG 修复提交反向提交；若已同步 Harness/安装，则使用同步事务前记录的个人源提交和配置哈希恢复，不直接编辑缓存。

## 计划修改文件

个人 CCG 权威源（模板与插件镜像必须同步）：

- `templates/engine/tools/grok-intelligence/route.mjs`
- `plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/route.mjs`
- `templates/engine/tools/grok-intelligence/command.mjs`
- `plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/command.mjs`
- `templates/engine/tools/grok-intelligence/runner.mjs`
- `plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/runner.mjs`
- `templates/engine/tools/grok-intelligence/workflow-coverage.json` 已列出的自动路由说明 surface，仅机械补充“tool-managed background + wait + terminal reconciliation”契约；不改非自动路由文档。

测试：

- `src/utils/__tests__/grokIntelligenceRouting.test.ts`
- `src/utils/__tests__/grokIntelligenceRunner.test.ts`
- `src/utils/__tests__/grokIntelligenceWorkflowBehavior.test.ts`
- `src/utils/__tests__/grokIntelligenceAcp.test.ts`（仅在现有 fixture 不能表达协作取消/异常退出时最小扩展）
- `src/utils/__tests__/grokIntelligenceArtifacts.test.ts` 不预设修改；优先复用其现有死锁回收和活锁保护用例。

Harness 只在个人源修复通过后通过受支持事务更新：

- `components/ccg-workflow/**`（由 `pnpm harness:update -- --source-checkout <clean-personal-worktree>` 生成，不手改）
- `harness.sources.json`（同一事务生成）

当前阶段不会修改上述 CCG/Harness 文件。
