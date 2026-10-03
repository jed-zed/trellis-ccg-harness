# Harness 快车道与按需流程实施计划

本文件是本任务唯一执行计划；需求与验收见 [prd.md](./prd.md)。复用 `harness-fast-lane-workflow` 身份，在隔离工作树实施，原工作区不写入。

## 依据与范围

- 当前授权：Boss 要求“一直推进直到完成快车道以及解决harness过于重，防御性编程太多的问题”。因此从原来的规划阶段进入实现；原 PRD 的规划期禁止实施和无条件 Grok 前置被这次明确范围取代。需要真实外部证据时仍单独满足联网/付费授权。
- 旧 workflow 的 `no_task` 文本强制询问创建任务；规划、检查与 finish Skills 又强制三份文档、重复审批、全量检查和三段提交。每轮 Hook 读取同一 workflow，因此在原有文本入口修正即可，不新增分类器。
- 防御性实现的整改落在真实诱因：删除工作流/Skill 对无事实产物、兜底、抽象和重复验证的默认要求；不对经过验证的事务、所有权、权限和数据保护代码做无关删改。
- Trellis 0.6.16 的真实 CLI 曾因保留旧 `task_context.py` 而无法导入 `curated_entry_count`。官方模块已包含旧版本两处语法修复；已审阅的官方模块合并在候选事务内完成，添加真实 CLI 回归防止语法检查假绿。

## 执行顺序

1. 通过已有受管文件事务升级到 Trellis 0.6.16：候选 CLI + 全套 Harness 验证，应用后再次 CLI + 全套验证；失败自动恢复。
2. 同步本任务四个原始文件到隔离工作树，保留身份；修订 PRD/本计划，按 inline 合同激活。
3. 在 `.trellis/workflow.md` 和六个相关 Trellis Skills 修改默认分流、单一计划、条件化额外步骤、最小实现与无强制提交收尾。Codex Hook 的 bootstrap 提示也服从分流；两个复制旧流程的 Gemini 命令改为引用同一 workflow，README 同步相同分流和条件化验收规则。
4. 修改 collaboration policy 源，升级 policyVersion，通过 `harness-init apply` 事务投影到 owned snapshot、AGENTS 块和 ownership；不手改投影。
5. 先跑真实 CLI/Hook 的聚焦回归和 initializer 测试，再跑适用完整离线门。查看全部 diff，逐项对照验收。证据写在本文件，完成后用 CLI `archive --no-commit` 收尾。

## 触发事实 -> 必需输出 -> 停止条件

| 门/产物 | 触发事实 | 必需输出 | 停止条件 |
|---|---|---|---|
| 本执行计划 | 升级、工作流源与 owned 投影有顺序依赖 | 一个执行顺序及回退说明 | 各阶段有明确动作与验证 |
| 本地调用链读取 | Hook 与多个 Skill 同时注入旧要求 | 权威入口与消费者清单 | 所有实际入口保持一致 |
| 真实 CLI 回归 | 已复现 ImportError，旧完整门未捕获 | `task.py --help` 启动成功，错误时测试失败 | 实际模块导入可用 |
| Hook 分流回归 | 每轮注入入口改变 | 五类请求获得正确分流规则且不创建任务 | 真实 Hook 输出合同通过 |
| initializer 聚焦门 | owned policy 版本升级 | 支持投影与幂等、所有权保护通过 | `harness-init-cli` 测试通过 |
| 完整 Harness/离线门 | 共享工作流、Trellis 运行时与投影改变 | 现有完整套件、doctor、conflicts、来源校验与适用 CCG/Go 门 | 全部通过；未改部分复用已有通过证据 |
| 安全检查 | 新分流必须保留高风险升级与硬门 | 对照认证、数据、外部调用和 PM 门，运行现有门相关回归 | 没有旁路、伪造成功或新增外部权限 |
| spec 更新 | 共享工作流与实际导入验收契约变化 | 更新已有 tooling/spec 指针与生命周期回归说明 | 契约与可运行检查一致 |

没有设计未知项需要另建 design.md，没有外部知识缺口需要 Provider，没有当前授权的实现/审查子代理。无需额外 journal 或第二份 CCG 计划。

## 回退与保护

- 项目源码升级复用 `replaceManagedFilesTransaction`，保留 preflight、候选检查、应用后检查和自动恢复；全局 Trellis 安装另按 Boss 后续明确授权执行。
- 策略使用 `harness-init apply` 的现有所有权/并发事务。投影失败修根因，不手写 digest，不吞错。
- 原 `I:\ai\trellis-ccg-harness` 的 dirty 修改和任务不变。隔离分支只携带本任务与已核验的升级；撤销时只撤回本次具体 diff，不 reset/clean。
- 不提交、推送、清理其他任务、改 Codex Polish、全局 Skill、Provider 路由或权限。

## 完成记录

实现及本地代码检查已完成；全局 Trellis 升级、最终 Doctor 与 mark-ready 均已通过，项目为 `ready`。当前任务已通过 `archive --no-commit` 归档至 `.trellis/tasks/archive/2026-09/08-20-harness-fast-lane-workflow/`，状态为 `completed`；分支校验保留，退出 0，日志 `.ccg/fast-lane-archive.log`。

- Trellis 0.6.16 事务成功：`2026-09-06T17-28-59-232Z-33f6faa4-f4d2-450c-a732-1b99813d5037`。候选及应用后两轮均为 464 tests / 461 pass / 3 skip / 0 fail，真实 `task.py --help` 均通过。完整记录见 ignored `.ccg/trellis-0.6.16-update-evidence.md`。
- 已复用原任务并激活。FastCtx shell 未导出原生会话身份，首次 start 仅更新状态；随后使用 App 工具核实的当前任务 ID `01a07738-84d2-7161-a6cc-63b187812c77` 作为该次命令的 `CODEX_THREAD_ID`，成功绑定当前会话并通过 adapter context。没有编造身份或复制其他会话状态。
- workflow、六个 Skills、两个 Gemini 入口的流程说明相对基线净减少 1,021 行。新增行为是默认快车道、单一计划、按事实触发额外步骤、拒绝无依据防御性代码与不强制提交流程。
- policyVersion 9 已通过 `harness-init apply` 更新源投影、AGENTS 受管块和 ownership；再次 apply 返回 `unchanged`。完整门通过后已执行 `mark-ready`，项目合同恢复为 `ready`。
- 聚焦套件：68 tests / 67 pass / 1 skip / 0 fail。新增 CLI、五类请求的真实 Hook 文本合同、结构化硬门和 Phase/Step 检查通过。Gemini 入口随后补测 4/4 通过，TOML 实际解析与 `git diff --check` 通过。
- 第一次聚焦运行曾发现版本断言残留 8，以及测试借用开发者活动任务的 single-session fallback。已更新断言为 9，并用独立临时项目验证无任务入口，未修改运行时推断行为。
- `go test -short ./...` 与构建通过，日志 `C:/Users/29933/.fastctx/jobs/j-g9p2re/output.log`。
- adapter conflicts：0 blocking / 0 warning / 19 passed。早期 Doctor 唯一失败为全局 Trellis 0.6.9 未同步；授权安装后的最终 Doctor 已通过，见末节。
- CCG lint 首次因本工作树缺少 `node_modules` 失败；获得安装授权后的完整验证已通过，结果见下节。
- 最终 `pnpm harness:test` 串行完整门成功：468 tests / 465 pass / 3 skip / 0 fail，1906613.5559 ms。进程 `j-znt796` 退出 0，日志 `.ccg/fast-lane-full.log`。README 与最终入口补测 5/5 通过，日志 `.ccg/fast-lane-docs.log`。
- 文件范围审计通过：63 个改动/新增文件全部在已核验的 Trellis 升级及本任务范围内；`git diff --check` 通过。
- 全局 Trellis 0.6.16、Doctor 和 `mark-ready` 已完成。Guard 的会话权限已更新为 `deps=allow`，先前安装阻塞已解除。
- 未提交、推送、改动原工作区或清理其他任务；全局变更仅为已授权的 Trellis 精确版本升级。

### 获得环境授权后的验收

- Boss 明确回复“授权”，允许安装锁定依赖与升级全局 Trellis。`pnpm bootstrap` 在安装前被既有所有权检查拒绝：当前隔离工作树没有全局包 ownership，原工作区的记录不能直接迁移或伪造。本次没有修改这项保护或原工作区记录；日志 `.ccg/fast-lane-bootstrap-authorized.log`。
- 单独执行 `pnpm --dir components/ccg-workflow install --frozen-lockfile` 成功，615 个包全部复用缓存；日志 `.ccg/fast-lane-dependencies-authorized.log`。CCG lint、typecheck、完整测试与构建全部通过：44 test files passed / 1 skipped，643 tests passed / 3 skipped / 0 failed，测试耗时 334.58s。进程 `j-j9dit1` 退出 0，完整日志 `C:/Users/29933/.fastctx/jobs/j-j9dit1/output.log`。
- 已将现有全局 Trellis 0.6.9 包及三个命令入口保存在 ignored `.ccg/trellis-global-0.6.9-before-authorized-upgrade/`。随后精确版本安装命令被自动审批 Guard 拒绝，代码 `S/DEPENDENCY_NOT_AUTHORIZED`，事件 `evt_2d982280-8118-4e40-a150-4e87046d1c98`；Guard 要求显式 `deps=allow`。已向 Boss 展示此机器授权要求，没有改用其他入口绕过拒绝。
- 核对 Guard 的只读解析器后确认：普通“授权”和不带前缀的 `deps=allow` 不更新机器合同，必须由用户提交完整 `$stop-that-shit change deps=allow -- 允许安装 @mindfoldhq/trellis@0.6.16` 指令。已修正确认项，不自行修改 Guard 状态或代码。
- 安装及构建后的 source verification 通过；CCG 源码相对 Git 没有变化，仍匹配已记录的 3.4.15 commit/tree。conflicts 为 0 blocking / 0 warning / 19 passed；63 文件范围审计与 `git diff --check` 通过。进程 `j-4lmpos` 退出 0，日志 `C:/Users/29933/.fastctx/jobs/j-4lmpos/output.log`。

### 安装授权通道的历史诊断（已解除）

- Boss 已提交完整 `deps=allow` 指令，精确版本安装仍被 Guard 拒绝：事件 `evt_a514d5b8-e75d-49fc-ba3e-7aa4dbd7692a`，`S/DEPENDENCY_NOT_AUTHORIZED`。没有改用其他工具绕过该拒绝。
- 对实际用户指令运行插件的纯 `parseContractPrompt` 函数，输出 `parsedDependencyPolicy: allow`、`parsedSource: directive`、`changed: true`；包名中的 Markdown 反斜线不影响授权头的解析。此调用只读取，不写 Guard 状态。
- 当前任务 ID 对应的 Guard session key 为 `858cbefddb395ae6889a4e14`，与拒绝事件相同，排除了读错会话。首次诊断时真实状态为 `dependencyPolicy: ask`、`source: local-auto-default`，修改时间停留在 `2026-09-06T15:11:55.684Z`；当时未证明宿主为何没有更新。
- 已只读核对插件 `UserPromptSubmit` 配置、控制器、状态读取及 Codex 配置中的对应 trust 记录。官方 Hooks 文档确认 `/hooks` 是查看事件启用/信任状态的入口：https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks 。已向 Boss 请求该入口的实际状态；不假定配置中的旧 trust 记录证明当前 Hook 已获准执行，也未修改插件、权限或 trust 数据。
- Boss 确认 Hook“已启用且受信任”后，状态文件修改时间已推进至 `2026-09-07T00:36:39.010Z`，说明状态写入出现变化；该消息不含完整指令，权限仍为 `ask`。随后“使用 `deps=allow`”也缺少解析器必需的 `$stop-that-shit` 前缀。
- 本轮只读检查发现插件的本地默认值已由外部改为 `deps=allow`，但 `readState` 仍以当前会话已保存的 `ask` 覆盖默认值。本任务未修改插件或 Guard 状态。同一安装命令再次被拒绝，事件 `evt_9bb10cb3-ffbb-43c5-8a3b-157a13923bf4`，`S/DEPENDENCY_NOT_AUTHORIZED`；安装未执行。
- Boss 再次提交完整指令后，宿主实际注入 `deps=allow`。随后同一精确版本安装命令获准执行；没有修改 Guard、伪造用户事件或更换工具绕过拒绝。

### 最终环境验收

- `npm install --global @mindfoldhq/trellis@0.6.16` 成功，58 packages changed，退出 0；日志 `.ccg/fast-lane-trellis-global-upgrade.log`。实际 `trellis --version` 输出 `0.6.16`。
- `pnpm doctor` 在本轮 Git Bash 入口返回 0 但日志为空，未据此判定成功。直接运行 package.json 声明的 `pwsh -NoProfile -File ./scripts/doctor.ps1` 后取得完整检查输出：Trellis 0.6.16、CCG 3.4.15、来源、事务无残留、冲突审计全部通过，结尾为 `Harness doctor passed.`，退出 0；日志 `.ccg/fast-lane-final-doctor.log`。
- `node scripts/harness-init.mjs mark-ready --repo-root .` 返回 `status: ready`，退出 0；日志 `.ccg/fast-lane-mark-ready.json`。当前任务没有待确认的 product-manager gate；此前通过且未受影响的完整测试沿用原验证证据。
- 归档后最终 conflicts 为 0 blocking / 0 warning / 3 info / 17 passed，确认当前会话已无活动任务绑定；日志 `.ccg/fast-lane-final-conflicts.json`。最终范围审计为 62 个改动/新增文件（项目合同恢复为基线 `ready` 后不再形成 diff），全部属于 Trellis 升级与快车道任务；`git diff --check` 通过，HEAD 仍为 `2ffd604d7260e6fa17ad52d674413f3b90bd5b0d`。
