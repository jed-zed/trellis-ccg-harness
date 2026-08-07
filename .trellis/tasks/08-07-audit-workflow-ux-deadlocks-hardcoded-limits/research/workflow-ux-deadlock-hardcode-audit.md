# 工作流 UX 死锁与硬编码限制审计

日期：2026-08-07
范围：Trellis 任务生命周期、Harness 上下文/初始化器/产品经理、已安装 CCG 路由、Provider 包装器，以及 ChatGPT Pro 侧栏桥。
边界：只读审计；除本任务文档和忽略的 `.ccg/` 证据外，未改产品代码，未调用外部 Provider，未执行 live UIA 发送、安装、提交或推送。

## 结论

有问题，但不应把它们都叫作传统线程死锁。

- 确认 4 个高影响问题：CCG `--target` 绑定被静默丢弃、所有 frontend/backend 流程被强制绑定 search、`CODEX_TIMEOUT` 单位存在近 1000 倍断崖、GPT Pro `send-uncertain` 缺少受控裁决命令。
- 确认 5 个中等影响流程断链：Python 3.11 无法运行 Trellis 核心命令、无会话标识时 `start` 仍推进状态、planning 阶段无法满足 Harness 的 context 前置要求、GPT Pro watcher 只能被动等到总超时、`completed` breadcrumb 在正常流程中永远不可达。
- 确认 3 个低影响恢复/硬编码问题：archive 在移动后提交失败时不可按原命令重试、中文标题不能自动生成 slug、stale session pointer 不会自清理。
- 没有发现 Go 并发执行器的 WaitGroup/channel 经典死锁；Harness 初始化器活锁、产品经理 CAS、Provider 不回退、UIA 精确选择、exact-once 禁止自动重发等属于应保留的安全或一致性边界。

严重度表示用户影响与可达概率，不表示安全漏洞等级。

| 级别 | ID | 问题 | 当前恢复 |
|---|---|---|---|
| 高 | F1 | CCG route 接受 `--target`，但不把它传入绑定摘要 | 没有正确的 `target` 恢复；只能错误地改用其他绑定或修代码 |
| 高 | F2 | frontend/backend 无条件要求一次 search，和“Grok 缺失不得阻塞普通工作”冲突 | 改路由仍绕不开 search；失败后按规则停止 |
| 高 | F3 | `CODEX_TIMEOUT=10000` 为 10000 秒，`10001` 却约为 10 秒 | 只能知道内部启发式后手选数值 |
| 高 | F4 | GPT Pro 不确定发送永久占用全局幂等 key，却没有安全裁决命令 | 手工证明未发送后删除 hash 文件，风险高且不可审计 |
| 中 | F5 | 文档使用 `python`，但 Trellis 在 Python 3.11 解析即失败 | 显式使用 `py -3.14` |
| 中 | F6 | 无 session identity 时 `task.py start` 返回成功并推进状态，却不保存 active pointer | 预先手设 `TRELLIS_CONTEXT_ID` 后重新绑定 |
| 中 | F7 | planning 阶段没有 active pointer，但 Harness 又要求 model work 前先跑 `context` | 暂时跳过 context，或手工传递任务信息 |
| 中 | F8 | GPT Pro 绑定面丢失会被动等最多 7200 秒，CLI 无 cancel/abort 终态 | 外部终止后人工判定证据 |
| 中 | F9 | `completed` 状态提示块在正常 archive 流程永远不会触发 | 依赖 archive 输出或人工记忆收尾 |
| 低 | F10 | archive 先移动再 auto-commit；提交失败后原路径已不存在 | 手工处理 `git status`，不能幂等重跑 archive |
| 低 | F11 | `_slugify` 只保留 ASCII `[a-z0-9]` | 中文任务每次手填 `--slug` |
| 低 | F12 | stale active pointer 会持续返回失效路径 | 手删 runtime session 或在身份仍可解析时 finish |

## 逐项证据与最小修复

### F1 — `ccg route --target` 被静默忽略（高）

**适用面：** 已安装 CCG 3.4.6 与 tracked 3.4.5 source snapshot 均存在。

**可达路径：** 已安装 `ccg:plan` 明确要求在目标存在时附加 `--target`，并在 target digest 变化后重跑（安装 Skill `skills/ccg-plan/SKILL.md:10-12`）。CLI 解析器接受任意 `--target` 并写到 `args.target`（已安装 `templates/engine/tools/grok-intelligence/route.mjs:744-764`），`collectBindings` 也支持 `input.target`（同文件 `:99-105`），但 `main()` 调用 `runWorkflowRoute` 时只传 `plan`、`diff` 和 dependencies，遗漏 `target`（同文件 `:781-798`；tracked snapshot 同样见 `components/ccg-workflow/templates/engine/tools/grok-intelligence/route.mjs:778-795`）。

**实测：** 本任务以真实 `prd.md` 运行 `ccg route ... --target ...` 后退出 0，但 `.ccg/tasks/audit-workflow-ux-deadlocks-hardcoded-limits/intelligence-route.json:7-15` 仍记录 `"target": null`。

**用户影响：** 目标文件变化不会进入 route input digest；旧 decision/evidence 可能被错误复用，而且命令没有告警。这不是等待型死锁，而是静默失效的工作流绑定。

**最小修复：** 在唯一入口加入 `target: args.target`；增加一个 CLI 回归测试，断言 target 路径、hash 和变更后的 input digest 都发生变化。无需新抽象或新配置。

### F2 — Companion Search Contract 对本地任务过宽（高）

**适用面：** 当前安装的 3.4.6 Codex Skill/rule，是 prompt-enforced runtime 行为。

**可达路径：** 安装规则规定：只要 workflow 使用 frontend 或 backend，就必须解析恰好一次 search；同一 Provider 最多两次，失败后停止，且 `not_applicable` 仅允许 frontend/backend 都未参与（安装 `rules/ccg-role-routing.md:59-76`）。`ccg:analyze` 与 executor 都强制加载这条规则（安装 `skills/ccg-analyze/SKILL.md:20-29`、`skills/ccg-executor/SKILL.md:59-83`）。

**当前冲突：** 根 `AGENTS.md:40-44` 明确规定 Grok 可选、缺失不得阻塞普通工作。本任务的 external-intelligence route 又判定 `enabled=false`、`require_web_search=false`（`.ccg/tasks/.../intelligence-route.json:17-29`），但若进入 backend/frontend CCG phase，Companion Contract 仍会要求 search。当前路由为 frontend=`antigravity`、backend=`grok`、search=`grok`、product-manager=`claude`。

**用户影响：** 纯本地代码分析、离线修复或已有证据足够的任务仍必须启动无关 search；搜索通道缺失或失败会硬停普通工作，并带来额外延迟和调用成本。

**最小修复：** 允许本地-only frontend/backend slice 记录 `searchStatus=not_applicable` 和原因；只有显式 search slice、时效性外部事实、来源要求或 external-intelligence gate 命中时才强制 search。保留同 Provider、两次上限、只读和 no-fallback 约束。

### F3 — `CODEX_TIMEOUT` 单位断崖（高）

**适用面：** 当前安装的 `codeagent-wrapper 5.12.5` 与 tracked source 一致。

**可达路径：** CLI help 声称单位为毫秒、默认 7200000（`components/ccg-workflow/codeagent-wrapper/main.go:624-626`），README 又声称单位为秒、默认 7200（`components/ccg-workflow/README.md:289-292`）。实现对 `>10000` 的值除以 1000，对 `<=10000` 原样当秒（`codeagent-wrapper/utils.go:14-29`）。测试固定了 `10000 -> 10000s`、`10001 -> 10s`（`main_test.go:1782-1807`）。

**用户影响：** 相邻数值产生近 1000 倍变化；按 CLI 文档设置 10000 毫秒会等待约 2.8 小时，看起来像流程挂死，10001 又可能在约 10 秒提前终止。

**最小修复：** 选定一种单位并删除启发式。基于内部 `defaultTimeout` 和 README，最小方案是统一为秒、修正 help，并对明显像旧毫秒值的输入给清晰错误；不要继续猜单位。

### F4 — GPT Pro 不确定发送没有一等裁决路径（高）

**适用面：** 当前 worktree 的项目级 `chatgpt-pro-sidebar` Skill；核心 exact-once 行为在测试中通过。

**可达路径：** 每个 key 都在 `%LOCALAPPDATA%` 下形成永久 SHA-only reservation（`.agents/skills/chatgpt-pro-sidebar/SKILL.md:29`；adapter `:452-460`）。Invoke 返回后只观察 6 秒确认 composer 清空或 generation 开始（adapter `:3244-3275`），普通 follow-up 再用 8 秒捕获 exact URL（`:3278-3308`）；失败即写 `phase=send-uncertain`（`:3144-3158`），禁止自动重发。

**用户影响：** UI/网络稍慢即可进入不确定态。同一个幂等 key 之后永久被挡；Skill 仅要求用户“独立证明未发送后手删 hash 文件”（`SKILL.md:127-135`），没有命令验证 prompt hash、状态、证据和裁决者，也没有“已发送但未完成证据”的终态记录。

**最小修复：** 保留 exact-once 和禁止自动重发。新增一个证据绑定的 `adjudicate` 命令：必须匹配 key hash、prompt hash、evidence directory、当前 phase、明确用户确认和理由；证明未发送时原子释放 reservation，证明已发送时把 reservation 标成 consumed 并保留审计记录。6 秒/8 秒观察窗改为有界参数，默认值仍可保持当前值。

### F5 — Trellis 核心 CLI 与文档中的 Python 兼容性不一致（中）

**适用面：** 当前 Trellis 0.6.9 生成资产；本机默认 `python` 为 3.11.2。

**可达路径与实测：** 文档和 shebang 使用通用 `python`/`python3`，但 `.trellis/scripts/common/task_context.py:240-251` 使用 Python 3.12 才支持的嵌套多行 f-string。`python ./.trellis/scripts/task.py create ...` 在导入阶段报 `SyntaxError: unterminated string literal`；`py -3.14` 成功。

**用户影响：** 最核心的 create/start/current 命令在常见 Python 3.11 环境完全不可用，且错误发生在参数处理前。

**最小修复：** 先构造内部 message，再传给 `colored()`，恢复 3.11 语法；这比把整个 Trellis 契约提升到 3.12+ 更小，也不需要兼容层。

### F6 — `task.py start` 在无法保存 active pointer 时仍返回成功（中）

**可达路径：** 当 `resolve_context_key()` 为空时，`cmd_start` 打印 degraded mode，但仍把 `planning -> in_progress`、运行 after_start hook 并返回 0（`.trellis/scripts/task.py:98-122`）。同一工作流文档却写明无 context key 时 `start` 应失败并提示（`.trellis/workflow.md:74-76`）；`set_active_task` 的契约也要求调用者显示错误（`.trellis/scripts/common/active_task.py:581-607`）。

**实测：** 当前 Codex shell 默认没有可用的 `TRELLIS_CONTEXT_ID`/平台 session 环境变量；不显式设置时可得到 status=`in_progress`，但 `task.py current` 和 Harness context 仍找不到当前任务。本任务通过显式绑定 `TRELLIS_CONTEXT_ID=codex_019fddd8-a6f3-70c0-a60f-af0a1ae8730c` 避开。

**用户影响：** 命令显示成功且状态推进，后续 breadcrumb、context、hook 却失去任务身份；用户容易在错误任务或无任务上下文继续。

**最小修复：** 无 identity 时在任何状态写入前返回非零；另提供显式 `--context-id` 或确保 Codex Desktop 把 thread ID 注入标准环境。不要保留“成功但不持久化”的第二语义。

### F7 — planning 阶段无法满足 Harness context 前置要求（中）

**可达路径与实测：** 根 `AGENTS.md:47-48` 要求 model work 前先运行 `node scripts/harness-adapter.mjs context`。但 planning 任务按阶段契约尚未 active；`context.mjs:20-75,98-115` 只调用 `task.py current`，无 active pointer 就抛 `NO_ACTIVE_TASK`。本任务在 planning 中实测退出 2；只有批准并 start 后才能成功。

**用户影响：** 需要模型协助研究/规划时，操作者无法同时遵守“planning 不得 start”和“model work 前必须 context”两条规则。

**最小修复：** 最小文档修复是把前置条件写成“进入 Phase 2/provider work 前”；若 planning 也必须生成上下文，则给 adapter 增加显式 `context --task <planning-task>`，不要猜最近任务。

### F8 — GPT Pro watcher 缺少可审计取消终态（中）

**可达路径：** watcher 默认总超时 7200 秒（watcher `:13-17`）。绑定窗口/文档/地址/面板消失时会清零普通失败计数、持续 sleep 到总超时（`:511-566`）；Skill 也明确只能恢复或等 timeout（`SKILL.md:110-114,138`）。CLI 只接受 start/worker/status/wait-root/acknowledge 系列，不接受 cancel/stop（watcher `:1503-1551`）。

**用户影响：** 切换 Codex task 后，用户可被动等待两小时；外部杀进程不会留下完整终态，reservation 与证据还需人工判定。

**最小修复：** 增加 `cancel`，原子写入 `cancelled-unverified` 终态，保留 reservation、URL/runtime binding 和所有证据，唤醒 root wait；明确仍禁止 resend。总超时本身已有参数，不需要再建配置系统。

### F9 — `completed` breadcrumb 是正常流程中的死代码（中）

**可达路径：** workflow 自己标明 `completed` block “Currently DEAD”：archive 在同一调用中写 completed 并移动目录，resolver 随即失去 pointer（`.trellis/workflow.md:120-133,259-269`）。实现确实先写状态、清 session、移动目录，再运行 after_archive（`.trellis/scripts/common/task_store.py:551-624`）。

**用户影响：** 设计用于提醒 commit/finish-work 的阶段永远不会作为 per-turn breadcrumb 出现，收尾依赖用户记忆或 archive 输出。

**最小修复：** 二选一：增加显式 `complete` 状态转换，让下一回合可见；若产品不需要独立 completed 阶段，则删除死 block，把必要提醒放到 after_archive。不要继续保留未来占位。

### F10 — archive 的 post-move commit 失败不可幂等重试（低）

**可达路径：** `cmd_archive` 在 auto-commit 前已经写 completed、清 sessions 并移动目录；tracked task 的 `git add`/commit 失败会返回 1（`.trellis/scripts/common/task_store.py:551-617,630-712`）。

**用户影响：** 用户看到失败，但任务已不在 active 路径；重跑原 archive 命令会找不到任务。现有错误要求手工处理 `git status`，所以这是可恢复断链，不是永久死锁。

**最小修复：** 让 archive lifecycle 与 commit lifecycle 分开报告，并提供按 archived task 定位的幂等 `archive --resume-commit`；无需回滚已完成的安全移动。

### F11 — 中文标题不能自动生成 slug（低）

**可达路径：** `_slugify` 明确只保留 `[a-z0-9]`（`.trellis/scripts/common/task_store.py:65-71`）；纯中文标题得到空字符串后 create 直接失败（`:270-274`）。

**用户影响：** 中文用户每次都必须额外提供英文 `--slug`，而 CLI 的 title 参数没有提示该限制。

**最小修复：** 当标准化后为空时使用稳定短 hash，例如 `task-<8hex>`；不要引入拼音库或新依赖。

### F12 — stale session pointer 不会自清理（低）

**可达路径：** `_active_from_ref` 对不存在的目录仍返回 `ActiveTask(..., stale=True)`，`resolve_active_task` 原样返回（`.trellis/scripts/common/active_task.py:476-527`）；`task.py current --source/--json` 仍暴露该路径（`.trellis/scripts/task.py:167-204`）。

**用户影响：** 任务被外部移动/删除或残留 runtime state 时，hook 可持续注入失效路径。正常 archive 会主动清 session，因此主要影响异常/手工变更路径。

**最小修复：** 解析到 stale 时原子隔离或删除对应 session 文件，并返回 `current_task=null` + 一次明确诊断；保留多 session 不猜测原则。

## 应保留的硬门槛

以下限制会让流程停止，但有明确安全、数据保护或一致性原因，不应为了“不卡”而移除：

- GPT Pro exact-once reservation、Invoke 最多一次、URL/RuntimeId 精确绑定、conversation drift fail-closed，以及不确定发送禁止自动重发。缺的是裁决/取消入口，不是更宽松的自动重试。
- 产品经理的 revision CAS、fresh presentation、用户 acceptance gate、同 Provider/no-fallback、绝对可信 executable、`shell:false`、只读和环境变量 allowlist（`components/ccg-workflow/src/product-manager/provider-registry.ts:22-66`）。
- Harness initializer 的 PID + process instance identity + authenticated owner lock、原子 tombstone 恢复和 ownership 校验（`.agents/skills/harness-init/scripts/harness-init-core.mjs:2883-2988`）。短并发立即失败虽不优雅，但可直接重跑，不是死锁。
- Skill/catalog 的深度、文件数、单文件和总字节 cap（harness-init core `:99-109`），以及产品经理 snapshot cap。它们保护压缩炸弹、内存和 Provider payload；当前仓库规模未触发，不应无证据删除。
- Go provider executor 的 context timeout、每个 goroutine 恰好一个 result、panic/cancel 也回传结果（`codeagent-wrapper/executor.go:362-518,999-1003`）。对 Codex/Gemini/Grok/Antigravity/Pi 未发现 WaitGroup/channel 死锁。
- `CODEAGENT_MAX_PARALLEL_WORKERS` 上限 100（`codeagent-wrapper/config.go:411-430`）属于资源保护。可把上限写入用户文档，但不建议直接移除后允许无限进程风暴。
- Provider retry 上限、output cap、loopback bind、secret redaction、路径 canonicalization、UIA exact-name + uniqueness 选择。应改进错误信息和版本诊断，不应放宽信任边界。

## 待验证风险，不升级为确认缺陷

1. **产品经理 lock 的 PID 复用/EPERM 风险。** `acquireProductManagerLock` 的 stale owner 只记录 PID，`process.kill(pid, 0)` 返回成功或 EPERM 就永久视为 live（`scripts/lib/harness-adapter/product-manager.mjs:1790-1861`）。理论上 PID 复用或权限异常会让旧锁持续阻塞；本次没有制造 OS 条件复现。若出现真实案例，复用 Harness initializer 已有的 process instance identity，而不是缩短 stale 时间或盲删锁。
2. **硬编码 Gemini preview model。** `installer-template.ts:131` 默认 `gemini-3.1-pro-preview`，但存在用户配置覆盖；本次未联网验证该模型的当前生命周期，因此只记为维护风险。
3. **固定 snapshot/Skill cap 对超大项目的可用性。** 当前 tracked 规模为 1049 个文件、约 13.97 MB，低于 2000 文件/64 MiB cap；没有现实触发证据。先改善错误中显示实际 count/bytes 与排除建议，遇到真实合法项目后再讨论受控 override。

## 低优先级开发者体验

- Skill 的验证片段直接调用 `Invoke-Pester ... -Output Detailed`（`chatgpt-pro-sidebar/SKILL.md:144-173`）。本机默认 Pester 3.4.0 不支持该契约，而项目已有 `.ccg/tools/Pester/5.7.1`；手工 import 后 208 个测试全部通过。最小改进是验证片段先解析项目自带 Pester 5，缺失时给精确要求，不要安装依赖。
- `ccg route --help` 与 `ccg wrapper --help` 实测都显示顶层通用 help，route 的 `--target` 等真实参数无法从子命令 help 发现。建议只补齐现有子命令 option 定义；不需要再造帮助系统。

## Ponytail 最小化机会

这些不是阻塞性缺陷，可在以后碰到相关代码时顺手收敛，当前不值得单独扩大改动：

- `installer.ts:123-129` 的 `BINARY_SOURCES` 只有一个可信源，却仍建数组和 fallback loop。若信任策略明确永远单源，可改成一个常量和一次调用；保留 digest/version 校验。
- frontend/backend/search 默认路由同时定义于 `installer.ts:1081-1086` 与 `installer-template.ts:81-99`。下次修改路由时再合并为一个现有配置输入，避免双源漂移。
- 不删除 executor 的 command/process wrappers；它们虽只有一个 production 实现，但承担大量可运行测试替身，删除会增加而不是减少总代码风险。

## 验证结果

- Trellis task artifacts：`task.py validate` 通过；任务已用显式 Codex context ID 进入 `in_progress`。
- Product-manager：`node --test tests/product-manager-state.test.mjs tests/product-manager-concurrency.test.mjs`，17 passed / 0 failed。
- GPT Pro：导入项目自带 Pester 5.7.1 后运行项目级 Skill 三个测试文件，208 passed / 0 failed / 0 skipped；未启动 live UIA 或 watcher。
- Go wrapper：`go test -run 'TestRunResolveTimeout|TestResolveMaxParallelWorkers' ./...` 通过。
- `ccg route --target`：真实命令退出 0，但 state 中 `bindings.target=null`，确认 F1。
- 外部智能：route 返回 disabled/skipped，未调用 Provider。
- Harness conflicts：交付前重新运行，0 blocking / 0 warning / 2 info / 19 ok；两条 info 分别为 Grok runtime 在 adapter contract 中不可用、nested CCG workflows 仅作 source provenance。
- 初始审计阶段未运行全仓 `pnpm` 门禁，因为当时没有产品代码变更；
  获批的 F1/F3 实施阶段随后补跑了全量测试与构建门禁。

## 建议修复顺序

1. **第一批：** F1 `target` 透传、F3 timeout 单位、F5 Python 3.11 语法。都是单根因、小 diff、可直接补回归。
2. **第二批：** F6/F7 统一 Trellis active/context 契约，随后处理 F9 completion lifecycle；先定唯一状态语义，再改提示。
3. **第三批：** F4/F8 增加 GPT Pro adjudicate/cancel，保持 exact-once 不变；这是安全敏感变更，应单独任务和专项测试。
4. **第四批：** F2 收窄 Companion Search 触发条件，并同步安装 rules、Skills、模板与 Harness conflict 检查。
5. **按需：** F10-F12 和低优先级开发者体验；不单独引入依赖、框架或兼容层。

## 2026-08-07 已批准修复进展

- F1 已在权威个人源仓 `I:/ai/ccg-gptpro-worflow` 修复：CLI 将
  `args.target` 传入 `runWorkflowRoute`，CLI 子进程回归验证路径、SHA-256
  和字节数均写入 `bindings.target`。
- F3 已在同一源仓修复：`CODEX_TIMEOUT` 的正整数只按秒解释，帮助文本、
  维护文档和测试统一为 7200 秒默认值；`10000` 与 `10001` 分别解析为
  10000 秒和 10001 秒。
- 验证通过：TypeScript 全量 43 个测试文件，586 通过、1 跳过；lint、
  typecheck、build、Go 聚焦测试、`go test -short ./...` 与 `go build ./...`
  均通过。
- 本批没有提交、安装或手改 Harness 快照；当前已安装 CCG 3.4.6 仍未包含
  这些修复。源提交、快照导入与安装更新需要 Boss 另行批准。

本任务的初始审计阶段只给出证据与最小修复边界；后续仅按 Boss 明确批准
实施 F1/F3。其他产品修改仍需另行修订 Trellis 范围并再次获得批准。
