# 适配 Trellis Harness 的产品经理角色

## 目标与用户价值

把已确认的“Codex 主导、产品经理只读评估”产品合同接入
`jed-zed/trellis-ccg-harness`，在不引入第二套任务、计划、验收或完成状态的前提下，
为需求入口、计划审查、里程碑验收、偏航检查和最终完成提供持续的产品判断。

用户得到的结果是：工程实现仍由 Codex 主导，Trellis 仍是唯一生命周期权威；产品经理
只基于规范化证据给出可审计结论、唯一推荐下一步和必要的硬停，不把推断静默升级为需求，
也不凭模型断言宣称项目完成。

## 背景与确认事实

- 上游已确认 PRD：
  `I:\ai\ccg-workflow\docs\superpowers\specs\2026-07-26-product-manager-role-in-codex-led-prd.md`。
  本任务适配其中第 17 至 22 节，不重新 Grill 已确认的产品决策。
- 目标仓库远端为 `https://github.com/jed-zed/trellis-ccg-harness.git`。
- 当前 Harness 规定 Trellis 拥有任务、需求、计划、验收、完成和归档权威；
  CCG 提供模型编排与质量门禁；Codex 是唯一工作区写入者。
- 当前模型合同启用 Codex 和只读 Gemini，禁用 Claude；Grok 默认关闭且只能显式手动使用。
- `harness.sources.json` 固定个人 CCG commit、Git tree 与组件快照；运行时必须使用匹配的
  已安装 CLI/plugin，不得从 `components/ccg-workflow/` 直接执行集成功能。
- 当前工作树为 detached HEAD；本规划只创建 Trellis 工件和忽略的模型证据，不启动实施、
  不提交、不推送。

## 范围内

1. 将上游产品经理合同拆成 CCG 权威源码和 Harness 集成两层交付，并明确同步顺序。
2. 定义五类语义调用点：
   `INTAKE_REVIEW`、`PLAN_REVIEW`、`MILESTONE_REVIEW`、`DRIFT_REVIEW`、`FINAL_REVIEW`。
3. 定义只读产品经理输入、结构化输出、身份与摘要绑定、失效响应拒绝、稳定调用键、
   single-flight 和崩溃恢复合同。
4. 将完整计划一级阶段映射为 Trellis 里程碑；无显式计划的产品任务映射为一个隐式里程碑。
5. 定义产品经理结论、用户验收、逐检查点放行、自动续跑、三维进度和最终完成状态机。
6. 让 Harness adapter 直接读取当前 Trellis task，并将原始产品经理证据隔离在
   `.trellis/tasks/<task>/.ccg-evidence/product-manager/`。
7. 扩展安装级提供者选择与项目合同交集校验；保持安装、登录、联网、凭据读取和付费调用
   分别审批。
8. 复用现有 inline 主编排器、Trellis Hook 优先级、Harness adapter、来源绑定、
   事务/ownership 和冲突审计机制。
9. 建立离线确定性夹具、状态机、并发/重试、权限、来源一致性、跨平台和端到端验收门禁。

## 不在范围内

- 不重新讨论或改写上游 PRD 已确认的产品决策；只有新仓库事实造成重大冲突时才提出
  `reopen_request`。
- 不创建 `.ccg/tasks`、`.codex/ccg/plans` 或其他平行任务/计划权威。
- 不新增常驻监听器、重复 `UserPromptSubmit` Hook、第二个编排器或产品经理自行监听。
- 不让产品经理写工作区、执行终端、调度子代理或直接修改 Trellis 生命周期字段。
- 不启用、安装、探测或调用 Claude；首个兼容版本不得产生 `.claude/` 运行面。
- 不把组件快照当成 Harness 运行时，不在 CI 中调用付费在线模型或读取本机登录状态。
- 本轮只产出规划工件，不实施产品代码、测试、迁移、安装器或发布变更。

## 必须满足的需求

### 权威与编排

- **R-001** Trellis 必须继续拥有任务、需求、设计、实施计划、验收、完成和归档。
- **R-002** inline Codex 主编排器是产品经理调用的唯一发起者和状态变更执行者。
- **R-003** 产品经理和实现子代理只能返回事件候选或只读结论，不能写 Trellis 状态。
- **R-004** CCG 证据必须是 task-local、忽略且非 canonical；全过程不得创建 `.ccg/tasks`。

### 产品评估合同

- **R-005** 五类语义调用点必须使用统一版本化输入/输出合同。
- **R-006** 产品经理输出必须包含 verdict、证据、置信度、验证方式和唯一推荐下一步。
- **R-007** 空、畸形、缺字段、身份不符、输入摘要不符或证据失效的输出必须 fail closed。
- **R-008** 每次调用必须绑定任务、检查点、计划修订、输入摘要和证据摘要，并使用稳定调用键。
- **R-009** 重复事件、并发事件、崩溃恢复和重试必须 single-flight；晚到旧响应只保留审计，
  不得覆盖新状态或解除暂停。

### 里程碑与验收

- **R-010** 每个计划一级阶段成为一个里程碑；无计划产品任务创建一个隐式里程碑。
- **R-011** 里程碑候选完成先收集工程证据，再经产品经理评估和用户验收；用户未响应时无限期硬停。
- **R-012** 用户通过后必须恢复原执行上下文；不通过时回到同一 canonical task 调整。
- **R-013** 用户可逐检查点放行；放行记录为 `user_overridden`，且保留产品经理原 verdict。
- **R-014** 实施推进度、产品验收度和项目健康度必须从规范化里程碑矩阵确定性计算。
- **R-015** 最后里程碑与最终验收条件等价时合并为一张卡，否则分开。
- **R-016** 正常完成要求所有必需里程碑、产品经理评估、用户验收、质量/安全门禁和范围检查通过；
  有放行时只能完成为 `completed_with_overrides`。

### 提供者、来源与安全

- **R-017** 有效产品经理提供者等于安装级选择与项目合同允许集合的交集；失败不得静默换人。
- **R-018** 选择提供者不等于批准安装、登录、联网、凭据读取或付费调用。
- **R-019** 产品经理运行必须没有工作区写入、终端和子代理控制能力；输入必须边界化并脱敏。
- **R-020** 先在个人 CCG 权威源码实现角色合同，再按固定 commit/Git tree 更新 Harness
  来源清单、组件快照和匹配的已安装 CLI/plugin。
- **R-021** Harness schema、ownership 和初始化事务必须向后兼容，保留未知用户资产并在摘要冲突时
  fail closed。
- **R-022** 当前目标 Harness 的首个兼容版本必须保持 Claude 禁用和零 `.claude/` 运行面。

## 验收标准

- [ ] Trellis task 的 `prd.md`、`design.md`、`implement.md` 是本工作的唯一 canonical 需求与计划工件。
- [ ] 实施计划覆盖上游 PRD 的 38 条功能需求、32 条验收标准和第 21 节测试策略，并提供可追踪映射。
- [ ] 计划明确 CCG 权威源码先行、Harness 来源/快照/已安装运行时后同步的机械顺序与回滚点。
- [ ] 计划明确五类调用、稳定调用键、single-flight、旧响应拒绝、用户硬停/续跑和最终状态机。
- [ ] 计划明确 Harness adapter 直接接收 Trellis task，证据只写 task-local
  `.ccg-evidence/product-manager/`，且没有 `.ccg/tasks`。
- [ ] 计划明确安装级提供者选择与项目 allow/deny 交集，且安装、登录、联网、凭据和付费授权分离。
- [ ] 计划不新增重复 Hook、常驻监听器、第二编排器、Claude 运行面或产品经理写权限。
- [ ] 计划包含确定性离线测试、并发/恢复测试、安全权限测试、来源一致性检查、clean-install、
  跨平台 CI 和端到端夹具。
- [ ] 计划的强制本地门禁至少包含：
  `node scripts/harness-adapter.mjs context`、
  `node scripts/harness-adapter.mjs conflicts`、
  `pnpm harness:test`、`pnpm verify:sources`、
  `pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build`、
  `go test -short ./...`、`go build ./...`。
- [ ] 规划证据包含 Grok 的来源支持外部审查、Gemini 的只读仓库审查和 Codex 的最终综合；
  Claude 被明确记录为项目策略禁用。
- [ ] 规划结束后任务仍为 `planning`，等待用户审阅；没有运行 `task.py start` 或实施命令。

## 约束与风险边界

- 规划遵循优先级：用户与上游已确认 PRD > Trellis 工件 > Harness 架构约束 >
  CCG 规划/门禁 > 搜索路由。
- `components/ccg-workflow/` 是固定来源快照；计划可以列出同步动作，但不得把它当成直接运行时。
- 上游 CCG 工作区目前存在用户未提交改动；实施阶段必须先重新核对分支、远端、dirty state 和
  与 `harness.sources.json` 固定提交的差异，不能覆盖或吸收无关改动。
- 当前安装的 `ccg` CLI 版本与 Harness 固定版本可能漂移；实施前必须由 `conflicts` 和
  `verify:sources` 明确判定并恢复匹配，不能凭规划假定兼容。
- 当前无阻塞产品决策；剩余未知均为实施阶段可由仓库研究和测试验证的技术细节。

## 来源追踪

- 上游产品合同：
  `I:\ai\ccg-workflow\docs\superpowers\specs\2026-07-26-product-manager-role-in-codex-led-prd.md:588`
- Harness 适配需求：同文件 `:594` 至 `:667`
- 功能需求：同文件 `:685` 至 `:724`
- 验收标准与测试策略：同文件 `:726` 至 `:825`
- 发布阶段建议：同文件 `:827`

