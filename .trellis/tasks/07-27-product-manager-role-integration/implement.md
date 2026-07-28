# 产品经理角色 Trellis-first 实施计划

**计划权威**：本文件是
`.trellis/tasks/07-27-product-manager-role-integration` 的唯一实施计划  
**来源 PRD**：
`I:\ai\ccg-workflow\docs\superpowers\specs\2026-07-26-product-manager-role-in-codex-led-prd.md`  
**目标仓库**：`https://github.com/jed-zed/trellis-ccg-harness`  
**状态**：`planning`；等待用户审阅，不得执行  
**执行入口**：
`/ccg:execute .trellis/tasks/07-27-product-manager-role-integration/implement.md`

## 规划证据

- **Codex**：完成仓库、Harness adapter、Trellis lifecycle、CCG snapshot、Provider policy、
  provenance 和测试面的最终综合。
- **Grok**：`grok-4.5-build` 聚焦调用以 `EndTurn` 完成；建议使用稳定请求 ID、stale 条件检查、
  人工硬停、只读沙箱和可验证 provenance。来源经 Codex 打开核验。
- **Gemini**：`gemini-3.1-pro-preview` 预览浏览器已打开；
  预览 URL 为 `http://127.0.0.1:60226/`，响应文件为
  `.trellis/tasks/07-27-product-manager-role-integration/.ccg-evidence/planning/gemini-response.response.txt`。
- **Claude**：目标 Harness 策略禁用；未调用，不需要 `.claude/` 运行面。
- **综合记录**：`research/planning-evidence.md`。

## 执行前硬条件

- [ ] 用户在本计划展示后的后续消息中明确批准；批准前不得运行 `task.py start`。
- [ ] 为本 Codex worktree 创建/切换明确的 `codex/` 分支；当前 detached HEAD 不直接实施。
- [ ] 重新检查 Harness 的 remote、HEAD、worktree、dirty state 和开放 PR，不覆盖其他会话改动。
- [ ] 处理个人 CCG 权威源码 checkout：
  `I:\ai\ccg-workflow` 当前存在用户改动和分支落后；不得 reset、checkout 或吸收无关删除。
  使用用户批准的安全 checkout/分支后再改 CCG 源码。
- [ ] 确认上游 PRD 已进入可固定的个人 CCG commit；不能只依赖 untracked 本地文件。
- [ ] 运行 `node scripts/harness-adapter.mjs context`，确认 active task 为本任务。
- [ ] 运行 `node scripts/harness-adapter.mjs conflicts` 和 `pnpm verify:sources`，记录当前
  installed CCG `3.4.0` 与 Harness 固定 `3.3.3` 的实际 drift；先恢复匹配再做 runtime smoke。
- [ ] 不启用 Claude；不把本次 Grok/Gemini 规划授权延伸为实施阶段的安装、登录、联网或付费授权。

## 里程碑总览

| ID | 一级阶段 | 权重 | 主要交付 |
|---|---|---:|---|
| M1 | CCG 角色合同与安装级 Provider 选择 | 15 | 合同、CLI、只读 adapter、调用键、配置迁移 |
| M2 | Harness 与 Trellis canonical bridge | 20 | active task 输入、`product-manager.json`、evidence、policy/conflicts |
| M3 | 需求、计划与偏航事件接入 | 15 | INTAKE/PLAN/DRIFT、Grill handoff、命令映射、Hook 边界 |
| M4 | 里程碑、用户验收与三维进度 | 20 | MILESTONE、state machine、single-flight、验收卡、自动续跑 |
| M5 | 最终完成闭环 | 15 | FINAL、合并验收、override、完成矩阵、Trellis finish gate |
| M6 | 来源同步、离线门禁与发布 | 15 | pinned commit/tree、snapshot/runtime、clean install、CI、回滚 |

权重总计 100。实现推进度与产品验收度只从这些一级阶段派生。

## M1：CCG 角色合同与安装级 Provider 选择（15）

### 目标

在个人 CCG 权威源码中建立 provider-neutral、可版本化、只读、可校验的产品经理 runtime，
但不持有 Trellis 生命周期。

### 预期文件

**个人 CCG 权威源码：**

- 新建 `src/commands/product-manager.ts`
- 新建 `src/product-manager/contracts.ts`
- 新建 `src/product-manager/canonical-json.ts`
- 新建 `src/product-manager/invocation.ts`
- 新建 `src/product-manager/evidence-store.ts`
- 新建 `src/product-manager/progress.ts`
- 新建 `src/product-manager/provider-registry.ts`
- 新建 `src/product-manager/providers/codex.ts`
- 新建 `src/product-manager/providers/gemini.ts`
- 新建 `templates/prompts/product-manager/`
- 修改 `src/cli-setup.ts`、`src/index.ts`、`src/types/index.ts`
- 修改 `src/utils/config.ts`、`src/commands/init.ts` 和相应 installer 模块
- 新建 `src/product-manager/__tests__/` 或现有 Vitest 约定下的对应测试
- 修改 `src/utils/__tests__/pluginParity.test.ts`、installer/config/doctor 测试

### 任务

- [ ] **M1.1 合同与纯函数**
  - 定义五类 trigger、全部输入/输出字段、verdict、milestone/PM 状态和合同版本。
  - 实现 canonical JSON：固定字段、顺序、UTF-8/NFC、null 和数组规则。
  - 实现 PRD 第 15.3 节精确调用键公式。
  - 实现三维进度、最终 eligibility 和最后里程碑/FINAL 合并条件纯函数。

- [ ] **M1.2 安装级选择**
  - CCG 配置新增 `[product_manager]`，现有安装迁移默认 `enabled=false`。
  - 安装器只展示“已实现且当前托管策略允许”的 Provider。
  - 选择 Provider 不执行安装、登录、联网、凭据读取或付费调用。
  - 不增加任务级或项目级 Provider 绑定。

- [ ] **M1.3 只读 Provider adapter**
  - Codex/Gemini 使用 disposable snapshot 或等价只读 sandbox。
  - 禁止 workspace write、terminal 和 subagent control。
  - 使用绝对可信 executable/Node entrypoint、`shell:false`、最小环境、timeout 和输出上限。
  - 当前版本无 Claude 调用、探测或 `.claude/` 写入路径。
  - Grok 仅保留 capability 扩展点；项目合同未允许时不可运行。

- [ ] **M1.4 输出校验与失败**
  - 拒绝空、畸形、未知/缺失字段、身份/摘要不匹配和过期响应。
  - 有界同 Provider 重试复用同一 invocation key。
  - 失败返回 `unavailable`；禁止 Provider fallback 和伪造 verdict。
  - 保存 Provider/模型/CLI/合同版本与 digest，不保存隐藏推理和秘密。

- [ ] **M1.5 CCG CLI**
  - 实现 `ccg product-manager status --json` 和 `review`。
  - `review` 只接受显式 input file 与 task-local evidence root。
  - 拒绝 `.ccg/tasks`、仓库根 `.ccg` 或 snapshot 内 runtime path。
  - CLI 不写 `task.json`、`prd.md`、`design.md`、`implement.md` 或 `product-manager.json`。

### 聚焦验证

```text
pnpm --dir <ccg-source> vitest run src/product-manager
pnpm --dir <ccg-source> vitest run src/utils/__tests__/config.test.ts
pnpm --dir <ccg-source> vitest run src/utils/__tests__/installer.test.ts
pnpm --dir <ccg-source> vitest run src/utils/__tests__/pluginParity.test.ts
pnpm --dir <ccg-source> lint
pnpm --dir <ccg-source> typecheck
pnpm --dir <ccg-source> test
pnpm --dir <ccg-source> build
```

### 回滚点

在同步 Harness 前保持一个完整、通过门禁的 personal CCG commit；M1 失败时只回滚该安全
CCG 分支，不改 Harness snapshot、sources 或用户任务。

## M2：Harness 与 Trellis canonical bridge（20）

### 目标

扩展现有 internal adapter，直接接受 active Trellis task，把规范化产品状态附着在同一任务，
原始模型证据写 task-local ignored evidence。

### 预期文件

- 新建 `scripts/lib/harness-adapter/product-manager.mjs`
- 新建 `.harness/product-manager.schema.json` 的 initializer-owned 源与生成路径
- 修改 `scripts/lib/harness-adapter.mjs`
- 修改 `scripts/harness-adapter.mjs`
- 修改 `scripts/lib/harness-adapter/context.mjs`
- 修改 `scripts/lib/harness-adapter/conflict-static.mjs`
- 修改 `scripts/lib/harness-adapter/conflict-runtime.mjs`
- 修改 `.agents/skills/harness-init/scripts/harness-init-core.mjs`
- 修改 `.agents/skills/harness-init/scripts/provider-actions.mjs` 或抽取共用可信命令 resolver
- 修改 `.agents/skills/harness-init/assets/collaboration-policy.md`
- 由 initializer 更新 `.harness/project.schema.json`、`.harness/adapter.json`、
  `.harness/project.json`、`.harness/ownership.json` 和 managed policy projection
- 修改 `tests/harness-adapter.test.mjs`
- 修改 `tests/harness-init-cli.test.mjs`、`tests/harness-provider-actions.test.mjs`
- 新建产品经理 adapter/state schema 测试与 fixture

### 任务

- [ ] **M2.1 Canonical state**
  - 定义 task-local tracked `product-manager.json` schema。
  - 保持 Trellis `task.json.status` 不变，不写 CCG gate 字段。
  - 使用 `stateRevision` CAS、原子 replace 和 digest 校验。
  - `buildCanonicalContext()` 增加 `product-manager.json` 的存在性、摘要和 pending gate 摘要。

- [ ] **M2.2 Task 与 evidence 边界**
  - 复用现有 active task resolver 和 `assertInside` 路径边界。
  - 复用 `gptpro_bridge.py` 的 Trellis task/evidence 设计原则，必要时抽取共用 helper，
    不复制任务。
  - raw evidence 固定到
    `.trellis/tasks/<task>/.ccg-evidence/product-manager/`。
  - 任何 `.ccg/tasks` 创建、tracked runtime 或 task identity mismatch 直接阻断。

- [ ] **M2.3 Adapter 命令**
  - 实现 `pm status`、`pm sync-plan`、`pm review`、`pm respond`、
    `pm final-eligibility`。
  - adapter 准备最小输入并调用匹配的 installed CCG runtime。
  - 结果应用前重新核对 task/checkpoint/plan/input/evidence digest。
  - `final-eligibility` 只返回授权判定，不调用 Trellis finish/archive。

- [ ] **M2.4 Provider policy 交集**
  - Harness project/adapter schema 只声明 allow/deny、只读、网络、付费和安全约束。
  - 有效 Provider 为安装级选择与实现能力、project policy 的交集。
  - Claude 始终禁止；Grok 默认禁止；Gemini 只读；Codex 需独立只读能力检查。
  - 禁止在 project/task 中写另一个 selected Provider。

- [ ] **M2.5 Conflict 与 ownership**
  - 增加 PM schema/state digest、evidence path、Provider intersection、
    installed runtime identity、重复 Hook 和 `.claude` 零运行面的 blocking checks。
  - initializer transaction/ownership 支持向后兼容生成、更新、回滚和未知资产保留。
  - managed policy 只从 Harness-owned source 投影，不手工修改 pinned/managed block。

### 聚焦验证

```text
node --test tests/harness-adapter.test.mjs
node --test tests/harness-init-cli.test.mjs
node --test tests/harness-provider-actions.test.mjs
node scripts/harness-adapter.mjs context
node scripts/harness-adapter.mjs conflicts
```

### 回滚点

M2 生成文件全部进入现有 Harness transaction/ownership；失败时回滚 adapter/schema/policy
投影，保留 Trellis task 和用户资产。不得删除 `product-manager.json` 的审计内容。

## M3：需求、计划与偏航事件接入（15）

### 目标

让 inline Codex 主编排器在正确语义点调用 INTAKE/PLAN/DRIFT；命令、Skill、Hook 和子代理
只上报候选。

### 预期文件

**CCG 权威源码：**

- 修改 `plugins/ccg/commands/` 与 `templates/commands/` 中受影响命令说明
- 修改 `plugins/ccg/skills/` 中 plan/execute/go/workflow/feat/review 等入口
- 修改 `templates/engine/phase-guide.md` 和必要的 strategy/event mapping
- 修改 plugin parity、command mapping 和 Hook delegation 测试

**Harness：**

- 修改 `.agents/skills/harness-init/assets/collaboration-policy.md`
- 修改 `.codex/hooks/inject-workflow-state.py` 的 initializer-owned 上游源，再投影到项目
- 修改 Hook/upgrade 边界和 adapter 测试

### 任务

- [ ] **M3.1 统一事件映射**
  - 把 PRD 第 12 节 44 个命令映射为候选类型。
  - 普通同阶段执行不调用产品经理。
  - 辅助分析/研究默认只提供证据；只有用户交付形成隐式 milestone。

- [ ] **M3.2 INTAKE 与 Grill**
  - 仓库事实收集后调用 `INTAKE_REVIEW`。
  - 使用 `grill-me` 时必须先写/引用 `GRILL_HANDOFF`。
  - 已确认决定只有带新证据、影响、置信度和推荐答案的 `reopen_request` 才能重开。
  - 痛点推断严格区分 facts、hypotheses、confidence 和 validation method。

- [ ] **M3.3 PLAN**
  - 主编排器先产生 Trellis `prd.md`/`design.md`/`implement.md` 草案。
  - `PLAN_REVIEW` 只能挑战缺口，不能改写或替换计划。
  - material change 必须先请求用户批准，再原位更新 Trellis 工件并生成新 digest。

- [ ] **M3.4 DRIFT**
  - 用明确阈值识别新事实冲突、范围/风险/计划/证据的重大变化。
  - 流程内调整由 Codex 自动应用；产品范围变化请求用户决定。
  - 不自动执行 Git reset/checkout，不创建第二计划。

- [ ] **M3.5 Hook 边界**
  - 现有 `UserPromptSubmit` 只注入 pending gate 和恢复 breadcrumb。
  - 不启动 Provider、不获取 single-flight lock、不写状态。
  - 不新增 Hook、daemon、listener 或第二 orchestrator，保持 yield marker。

### 聚焦验证

```text
pnpm --dir <ccg-source> vitest run src/utils/__tests__/codexHookTrellisDelegation.test.ts
pnpm --dir <ccg-source> vitest run src/utils/__tests__/pluginParity.test.ts
node --test tests/harness-adapter.test.mjs
node --test tests/trellis-upgrade.test.mjs
```

### 回滚点

保留事件 mapping 的前一合同版本；新 mapping 失败时关闭 PM feature，恢复原 Hook body，
不改变 Trellis 任务、计划或用户已确认决定。

## M4：里程碑、用户验收与三维进度（20）

### 目标

实现 `MILESTONE_REVIEW`、双重验收、无限期硬停、自动续跑、override、三维进度和
single-flight/recovery。

### 预期文件

- 修改 CCG `src/product-manager/progress.ts`、`invocation.ts`
- 修改 Harness `scripts/lib/harness-adapter/product-manager.mjs`
- 修改 `.codex/hooks/inject-workflow-state.py` 的 pending breadcrumb
- 新建/修改 adapter state-machine、concurrency、recovery 和 fixture 测试
- 修改 CCG plan/execute/finish 相关 Skill/command 模板及 parity 测试

### 任务

- [ ] **M4.1 Plan → milestone projection**
  - `pm sync-plan` 把已批准 `implement.md` 的 `M1` 至 `M6` 映射为 milestone。
  - 支持显式权重；无权重才等权。
  - 无多阶段计划的产品任务创建一个隐式 milestone。
  - 候选完成事件不新增状态，也不增加进度。

- [ ] **M4.2 MILESTONE_REVIEW**
  - 主编排器先收集测试、review、quality/security gate 证据。
  - PM accepted 后 milestone → `awaiting_user_acceptance`。
  - rejected/needs decision/reopen/unavailable 按合同整改或硬停。

- [ ] **M4.3 用户验收卡**
  - 展示目标、交付、用户变化、最短验收、预期结果、工程证据、风险、PM 结论、
    三维进度和唯一下一步。
  - 只允许 `验收通过`、`验收不通过：原因`、`忽略风险并继续` 三类语义响应。
  - 用户未回复时无限期保留 `currentGate`，无 timeout。

- [ ] **M4.4 响应与恢复**
  - accept → `completed`；reject → `in_progress`；override → `user_overridden`。
  - override 永不改写 PM verdict，也不进入正常产品验收分子。
  - 用户响应后由当前 Codex task 自动恢复 `implement.md` 下一未完成项，无需重输
    `/ccg:execute`。

- [ ] **M4.5 Single-flight/CAS**
  - 原子 lock + lease/heartbeat；相同调用键只允许一个 Provider 调用。
  - 相同有效 completed 结果直接复用。
  - 崩溃恢复、超时、取消、stale lock 和晚到结果均保留审计。
  - canonical state 更新使用 `stateRevision` CAS，旧响应不能解除暂停。

- [ ] **M4.6 三维进度**
  - 实施推进分子只含 `awaiting_user_acceptance`、`completed`、`user_overridden`。
  - 产品验收分子要求有效 `accepted` 且非 `user_overridden`。
  - 健康色从 blocker、drift、override、证据缺口和重大风险确定性派生。

### 聚焦验证

```text
pnpm --dir <ccg-source> vitest run src/product-manager
node --test tests/product-manager-state.test.mjs
node --test tests/product-manager-concurrency.test.mjs
node --test tests/harness-adapter.test.mjs
```

并行测试必须覆盖重复事件、并发完成信号、崩溃恢复、同键重试、输入变化、旧响应晚到和
Windows/Linux/macOS 路径/锁语义。

### 回滚点

feature flag 关闭后不再发起新 review；保留 canonical milestone、用户验收和 raw evidence，
Trellis task 继续按原流程运行。不得把 pending gate 静默标记为通过。

## M5：最终完成闭环（15）

### 目标

实现 `FINAL_REVIEW`、最后 milestone/FINAL 合并验收、完成矩阵和 Trellis finish/archive
授权，不让 PM 直接完成任务。

### 预期文件

- 修改 CCG product-manager completion/progress 合同与 finish 相关 Skills
- 修改 Harness adapter `final-eligibility` 和 `pm respond`
- 修改 Trellis finish-work 集成策略源，不直接改 Trellis 核心归档语义
- 新建 final review、merged gate、override 和完整 E2E fixture/tests

### 任务

- [ ] **M5.1 完成矩阵**
  - 汇总全部 milestone、用户验收/override、requirements/deliverables/tests/gates、
    blocker、drift、风险和最终交付物。
  - 所有完成声明必须有直接 evidence ref。

- [ ] **M5.2 FINAL_REVIEW**
  - 最后一级阶段仍执行独立 `MILESTONE_REVIEW`。
  - FINAL 输入绑定最新 plan/evidence digest。
  - invalid/unavailable/rejected 默认硬停，不 fallback。

- [ ] **M5.3 合并验收**
  - 仅当 PRD 四个等价条件全部满足时合并最后 milestone 与 FINAL。
  - 一次用户响应原子更新两个 checkpoint。
  - 状态/证据/用户决定变化使旧 FINAL stale，并回退为两次独立验收。

- [ ] **M5.4 Override 与完成结论**
  - 无 override 且全部条件通过才允许正常 `completed`。
  - 任何 override 只允许 `completed_with_overrides`，列出每个放行点和风险。
  - PM verdict 永远保留，不伪装为 accepted。

- [ ] **M5.5 Trellis finish gate**
  - `final-eligibility` 只返回是否允许 Codex 请求 Trellis完成。
  - 只有 Codex调用 Trellis `finish-work` 和 archive。
  - PM、CCG CLI、Hook 和子代理都不能改变 `task.json.status` 或移动 task 目录。

- [ ] **M5.6 E2E**
  - 覆盖安装选择 → Trellis task → Grill handoff → INTAKE → PLAN →
    MILESTONE → 用户硬停/续跑 → DRIFT → FINAL → 合并/分离验收 →
    Trellis finish/archive。
  - CI 使用 fake Provider，不联网、不付费、不读本机登录。

### 聚焦验证

```text
node --test tests/product-manager-e2e.test.mjs
node --test tests/harness-lifecycle.test.mjs
node --test tests/harness-adapter.test.mjs
pnpm --dir <ccg-source> vitest run src/product-manager
```

### 回滚点

final gate 失败时任务保持 `in_progress` 或 pending，不执行 archive；修复同一 canonical
task 后重试。绝不通过删除 evidence、缩小 gate 或自动 override 来“修绿”。

## M6：来源同步、离线门禁与发布（15）

### 目标

把已验证 CCG 源码固定到 Harness snapshot/manifest/installed runtime，完成离线、
安全、跨平台和 provenance 门禁。

### 预期文件

- 修改个人 CCG `package.json`/version/changelog/构建产物元数据
- 修改 Harness `harness.sources.json`
- 事务式刷新 `components/ccg-workflow/`
- 修改 `scripts/verify-sources.ps1`
- 修改 `tests/verify-sources.test.mjs`
- 修改 clean-install、doctor、CI、readme/provenance 和 Harness gate 测试
- 修改 initializer ownership/schema version 与 migration fixture

### 任务

- [ ] **M6.1 固定 CCG 来源**
  - 个人 CCG 源码全部 gates 通过后提交 immutable commit。
  - 记录 commit、Git tree、package version 和 plugin runtime identity。
  - 不使用 `main`、`latest`、`@latest` 或未提交源码。

- [ ] **M6.2 事务式同步 Harness**
  - 从明确 personal commit 复制完整 tracked tree 到 snapshot。
  - 同一事务更新 `harness.sources.json`、initializer/schema/ownership。
  - 安装匹配的 CCG CLI/plugin；禁止从 snapshot 直接运行。

- [ ] **M6.3 Source/runtime/conflict**
  - 验证 source checkout clean、remote、HEAD、tree、snapshot、package、plugin cache 和 CLI。
  - `context` 可读取 canonical PM 摘要。
  - `conflicts` 对 runtime drift、Provider policy、重复 Hook、tracked evidence、
    `.claude` 运行面和来源 drift 无 Blocking。

- [ ] **M6.4 Clean install 与升级/回滚**
  - 老项目迁移默认 PM disabled，未知资产保留。
  - Provider 选择不安装、不登录、不联网、不付费。
  - clean install/re-init/update/rollback/uninstall 都满足 ownership 和 digest fail-closed。
  - 零 `.claude/` 创建、修改、探测或调用。

- [ ] **M6.5 全部门禁**
  - 执行 Harness + CCG + Go +安全/质量门禁。
  - 更新文档和 Spec，仅写 Harness-owned source，再投影 managed files。
  - 检查 git diff、untracked、ignored evidence 和秘密泄漏。
  - 未经单独授权不 commit Harness、不 push、不建 PR、不发布。

### 强制本地验证

```text
node --test tests/harness-init-cli.test.mjs
pnpm doctor
node scripts/harness-adapter.mjs context
node scripts/harness-adapter.mjs conflicts
pnpm harness:test
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
go test -short ./...
go build ./...
```

### CCG 质量与安全门禁

```text
/ccg:verify-change
/ccg:verify-quality <changed-path>
/ccg:verify-security <changed-path>
/ccg:verify-module <product-manager-module>
```

安全门禁必须覆盖命令执行、Provider 权限、输入校验、路径边界、秘密处理、网络边界、
原子锁/CAS 和来源验证。Critical/High 发现必须先修复。

### CI 验证

- Harness Node 20/22：Ubuntu + Windows；
- Harness Go：Ubuntu + Windows + macOS；
- bootstrap/doctor/clean-install：Ubuntu + Windows + macOS；
- fake Provider E2E：全平台离线；
- 真实 Provider smoke：仅显式手动 workflow，独立审批与秘密范围。

### 回滚点

使用现有 Harness lifecycle transaction/ownership 回滚到上一组固定 commit/tree/snapshot/runtime。
保留 task canonical state 与审计 evidence；不删除用户资产、不改全局 Claude、不 reset 用户工作区。

## 需求与验收追踪

| 里程碑 | 上游功能需求 | 上游验收标准 |
|---|---|---|
| M1 | FR-002、FR-016、FR-018、FR-019、FR-023、FR-024、FR-025、FR-026、FR-030、FR-033、FR-037、FR-038 | AC-17、AC-18、AC-24、AC-27、AC-30 |
| M2 | FR-020、FR-021、FR-023、FR-025、FR-026、FR-030、FR-031、FR-032、FR-033、FR-035、FR-037、FR-038 | AC-16、AC-17、AC-18、AC-24、AC-25、AC-26、AC-27、AC-29、AC-30 |
| M3 | FR-001、FR-003、FR-004、FR-005、FR-016、FR-017、FR-022、FR-024、FR-034 | AC-01、AC-02、AC-03、AC-04、AC-05、AC-06、AC-28 |
| M4 | FR-003、FR-006、FR-007、FR-008、FR-009、FR-010、FR-011、FR-012、FR-013、FR-014、FR-015、FR-025、FR-026、FR-027、FR-028 | AC-07、AC-08、AC-09、AC-10、AC-11、AC-12、AC-13、AC-14、AC-19、AC-20、AC-21、AC-22 |
| M5 | FR-003、FR-008、FR-009、FR-011、FR-012、FR-019、FR-026、FR-027、FR-029、FR-030、FR-031 | AC-15、AC-20、AC-21、AC-23、AC-24、AC-32 |
| M6 | FR-035、FR-036、FR-037、FR-038 | AC-29、AC-30、AC-31 |

`AC-01` 至 `AC-32` 指上游 PRD 第 20 节按顺序编号的 32 条验收标准。
全部 `FR-001` 至 `FR-038` 至少映射到一个里程碑。

## 测试矩阵

| 层级 | 范围 | 必测失败面 |
|---|---|---|
| 单元 | canonical JSON、schema、调用键、progress、merge eligibility | null/Unicode/顺序、未知字段、权重、override、digest drift |
| 契约 | fake Codex/Gemini Provider、CLI 输入输出 | 空/畸形/超时/非零/身份不符/过大输出/秘密 |
| Adapter | active task、state CAS、evidence path、Provider intersection | `.ccg/tasks`、越界路径、stale revision、禁用 Provider |
| 并发 | lock、lease、heartbeat、恢复、late result | 重复/并发/崩溃/旧结果解除暂停 |
| Hook | pending breadcrumb、yield marker、单 Hook ownership | Hook 调 Provider、重复 Hook、subagent 越权 |
| Lifecycle | milestone、用户响应、FINAL、finish eligibility | accepted 与 completed 混淆、override 伪通过 |
| Provenance | commit/tree/snapshot/plugin/CLI/ownership | mutable selector、dirty source、runtime drift、unknown asset overwrite |
| E2E | Grill 到 Trellis archive | 未验收推进、静默 fallback、付费 CI、`.claude` 运行面 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| dirty CCG checkout 污染来源 | 实施前单独确认安全 checkout；禁止 reset/覆盖 |
| installed CLI 与 pinned source 漂移 | runtime/source conflicts 为 Blocking；匹配后才 smoke |
| Hook 变成第二编排器 | Hook 只注入 breadcrumb；测试禁止 Provider/写入 |
| ignored evidence 变成唯一状态 | tracked `product-manager.json` 保存规范化投影和用户决定 |
| canonical projection 变成第二 task lifecycle | 不改 `task.json.status`；只授权 Codex请求 Trellis转换 |
| single-flight stale lock | 原子锁 + lease/heartbeat + 同键恢复 + CAS |
| Provider 越权 | disposable snapshot、最小工具、绝对命令、`shell:false`、写入探针 |
| Provider 不可用造成永久阻塞 | 同 Provider 有界重试、用户修复/改安装配置/逐检查点放行；不 fallback |
| final 与最后 milestone 重复验收 | 四条件判定 + 原子双 checkpoint 响应 + stale 回退 |
| 计划/证据变化后旧结论仍生效 | plan/input/evidence digest 绑定，应用前再次核对 |
| 迁移修改老项目未知资产 | schema 兼容、ownership-aware transaction、fail closed |

## 计划完成判定

本计划只有在以下条件全部满足后才能标记“已规划”：

- [ ] `prd.md`、`design.md`、`implement.md` 均存在并通过 Trellis validate；
- [ ] 六个一级阶段、权重、依赖、验证和回滚点明确；
- [ ] Grok、Gemini、Codex 证据已记录，冲突已由 Codex裁决；
- [ ] 无阻塞产品决策或重复 Grill；
- [ ] `node scripts/harness-adapter.mjs context` 读取到本任务三份工件；
- [ ] `node scripts/harness-adapter.mjs conflicts` 的现状结果已记录，未把既有 runtime drift
  误报为本计划完成；
- [ ] 向用户展示最终规划摘要，并等待后续明确批准。

