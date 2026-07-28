# 产品经理角色 Harness 适配设计

## 1. 设计目标

在 `jed-zed/trellis-ccg-harness` 中引入提供者中立、只读的产品经理评估能力，
同时保持：

- Trellis 是任务、需求、计划、验收、完成和归档的唯一权威；
- CCG 负责产品经理合同、Provider 调用、输出校验和工程门禁；
- Codex 是唯一工作区写入者、inline 主编排器和状态应用者；
- Claude、Gemini、Grok、Codex 等产品经理 Provider 均运行在独立只读能力边界；
- Harness adapter 是 Trellis 与已安装 CCG runtime 的内部桥，不成为第三套框架。

## 2. 设计决策

| ID | 决策 | 原因 |
|---|---|---|
| D-001 | 本任务使用一个 Trellis task 和一个 `implement.md`，六个一级阶段作为里程碑 | 避免平行任务或计划权威 |
| D-002 | 产品经理能力先在个人 CCG 权威源码实现为已安装 CLI/plugin 能力 | 符合 `harness.sources.json` 来源和运行时合同 |
| D-003 | Harness adapter 原生接收 active Trellis task；任何创建 `.ccg/tasks` 的路径都 fail closed | 不采用“先写后重定向” |
| D-004 | Canonical 产品投影为 task-local、tracked 的 `product-manager.json` | 里程碑、用户验收和完成门禁不能只存在于 ignored evidence |
| D-005 | 原始请求、响应、日志、锁和摘要位于 ignored 的 `.ccg-evidence/product-manager/` | 隔离模型证据，不污染任务生命周期 |
| D-006 | Hook 不调用产品经理，只注入当前 pending gate；inline Codex 根据 Skill/命令结果显式调用 adapter | 满足 PRD 第 17.4 节和单编排器约束 |
| D-007 | 产品经理作为 CCG 统一 routing 的第四个正式 role；该 routing 是唯一 Provider 选择权威，Harness 只声明允许集合和能力约束 | 不建立 `[product_manager]`、项目级或任务级第二个 Provider 选择 |
| D-008 | 调用键严格使用 PRD 第 15.3 节字段的 canonical JSON + SHA-256 | 幂等、single-flight 和 stale 检查共用同一身份 |
| D-009 | `DRIFT_REVIEW` 只调整 canonical task 的计划/状态，不自动执行 Git reset/checkout | 避免把产品评估扩大为破坏性工作区回滚 |
| D-010 | 首次读取旧 `[product_manager].provider` 时迁入统一 routing 并删除旧字段；已有统一 route 优先 | 一次性迁移，不双写，不形成第三套路由 |

## 3. 分层架构

```text
用户与 Codex task
  ↓ 用户需求、验收响应
inline Codex 主编排器
  ↓ 识别五类事件，收集工程证据
Harness adapter: product-manager
  ↓ 解析 active Trellis task、校验项目 Provider policy、准备有界输入
已安装 CCG CLI/plugin: ccg product-manager
  ↓ 只读 Provider adapter + schema validation + task-local raw evidence
Harness adapter
  ↓ 重新核对 task/checkpoint/plan/input/evidence digest
Trellis task/product-manager.json
  ↓ Codex 生成验收卡、硬停、应用用户决定、恢复原 implement.md
Trellis finish-work / archive
```

### 3.1 CCG 权威源码层

在个人 CCG 权威仓库中新增：

- `src/commands/product-manager.ts`：`status`、`review` 和静态 capability 检查；
- `src/product-manager/contracts.ts`：输入、输出、verdict、状态与版本化 schema；
- `src/product-manager/canonical-json.ts`：固定字段、顺序、Unicode 和空值规则；
- `src/product-manager/invocation.ts`：调用键、输出绑定、timeout、大小限制和 stale 校验；
- `src/utils/model-routing.ts` 与 `src/commands/config-routing.ts`：统一维护
  frontend/backend/search/product-manager 四个正式 role；
- `src/product-manager/provider-registry.ts`：能力检查和 Provider adapter 注册，不保存选择；
- `src/product-manager/providers/`：Codex/Gemini/Claude 的只读启动器；Claude 使用本机已登录
  CLI，但工具、MCP、会话持久化、工作区写入和 Provider fallback 均关闭；Grok 只有项目明确
  允许且另行批准联网时才可用；
- `src/product-manager/evidence-store.ts`：只写调用方显式传入的 task-local ignored evidence root；
- `src/product-manager/progress.ts`：纯函数计算三维进度和最终完成条件；
- `templates/prompts/product-manager/`：版本化 provider-neutral 输入/输出提示；
- Codex plugin Skills/commands：只上报事件候选并指示主编排器调用 Harness adapter，
  不自行变更 Trellis 状态。

CCG CLI 不读取或写入 `product-manager.json`。它只接受已准备的有界输入和 evidence root，
执行 Provider，并返回通过 schema 与 binding 校验的结果。

### 3.2 Harness adapter 层

在现有 `scripts/lib/harness-adapter/` 内增加产品经理模块，并由
`scripts/harness-adapter.mjs` 暴露：

```text
node scripts/harness-adapter.mjs pm status [--json]
node scripts/harness-adapter.mjs pm sync-plan --task <active> --plan implement.md
node scripts/harness-adapter.mjs pm review --trigger <type> --checkpoint <id>
node scripts/harness-adapter.mjs pm present --state-revision <integer>
node scripts/harness-adapter.mjs pm respond --checkpoint <id> --decision <accept|reject|override>
node scripts/harness-adapter.mjs pm final-eligibility
```

职责边界：

- `status`：只读展示有效 Provider、pending gate、里程碑和证据有效性；
- `present`：把当前 tracked `latestAdvice` 标记为已向用户展示，返回本次原话、findings、
  risks、process adjustments、推荐下一步和展示后的 state revision；不调用 Provider；
- `sync-plan`：由 Codex 在用户批准计划后调用，把 `implement.md` 一级阶段同步为 canonical
  milestone projection；不修改 `implement.md`；
- `review`：解析 active task，收集最小输入，调用匹配的已安装 CCG CLI，重新验证结果，
  再由 Codex-owned adapter 更新 canonical projection；
- `respond`：应用用户在当前 Codex task 中给出的验收决定，保留 PM 原 verdict；
- `final-eligibility`：只计算是否允许请求 Trellis finish/archive，不直接完成任务。

所有写操作使用临时文件 + fsync/close + 原子 replace，并在写前比较当前
`stateRevision`，不接受陈旧写入。

### 3.3 Trellis task 层

现有 `task.json` 继续只保存 Trellis 核心生命周期，不增加 CCG gate 字段。
新增 task-local `product-manager.json` 作为 Trellis task 的规范化产品投影：

```json
{
  "schemaVersion": 1,
  "taskId": "task-id",
  "stateRevision": 1,
  "plan": {
    "artifact": "implement.md",
    "digest": "sha256",
    "approvedDigest": "sha256"
  },
  "milestones": [
    {
      "id": "M1",
      "title": "阶段标题",
      "weight": 15,
      "status": "not_started",
      "sourceRef": "implement.md#M1",
      "pm": null,
      "userAcceptance": null,
      "evidenceRefs": []
    }
  ],
  "currentGate": null,
  "latestAdvice": null,
  "progress": {
    "implementation": 0,
    "productAcceptance": 0,
    "health": "green",
    "basisDigest": "sha256"
  },
  "overrides": [],
  "recommendedNextAction": null
}
```

约束：

- `taskId` 必须与 active task 的 `task.json.id` 相同；
- milestone ID 来自已批准 `implement.md` 的显式 `M1` 至 `M6` 标识；
- `plan.digest` 变化会使相关 PM 结论和 pending gate stale，必须 `sync-plan` 后重新评估；
- `product-manager.json` 不改变 Trellis `task.json.status`；
- 只有 Codex 通过 Harness adapter 可以更新该文件；
- 缺失 raw evidence 或 digest 不匹配时，canonical verdict 标记失效并 fail closed。
- 每次有效 response 都把 `user_acceptance_summary` 作为 `productManagerStatement` 连同
  findings、risks、process adjustments、推荐下一步、Provider 身份和 evidence refs 写入
  milestone/final review 与顶层 `latestAdvice`；用户响应清除 `currentGate` 时不清除
  `latestAdvice`，计划修订变化只把它标为 stale。

### 3.4 原始证据层

目录：

```text
.trellis/tasks/<task>/.ccg-evidence/product-manager/
  calls/<invocation-key>/
    input.json
    provider-request.json
    response.raw
    result.json
    status.json
  locks/<invocation-key>.lock
  projection-locks/<invocation-key>.lock
```

`locks/` 由 CCG 持有，只保护 Provider single-flight；`projection-locks/` 由
Harness adapter 持有，只保护调用准备、CAS 应用和 tracked projection。Harness 调用 CCG
时不得占用 CCG 的锁命名空间，避免父进程持锁、子进程等待的自死锁。

`status.json` 至少记录：

- `pending`、`completed`、`failed` 或 `stale`；
- task/checkpoint/plan/input/evidence digest；
- Provider、模型、CLI 版本和合同版本；
- 创建、心跳、完成时间；
- 结果摘要与 canonical projection revision。

不保存隐藏推理、凭据、Bearer header、完整无关源码或用户直接联系方式。

## 4. 产品经理调用合同

### 4.1 输入

输入仅含 PRD 第 15.1 节字段及 task artifact 引用：

- `task_id`、`trigger_type`、`checkpoint_id`；
- `plan_revision`（使用已批准 `implement.md` digest）；
- 原始需求、Product Brief、可选 `GRILL_HANDOFF`；
- 当前 milestone、仓库约束和前一结论；
- 测试/审查/门禁的摘要与相对引用；
- 当前风险、用户反馈和历史 override；
- `input_digest`、`evidence_digest`。

adapter 必须先执行脱敏、路径边界、字符数和引用存在性检查。

### 4.2 调用键

```text
sha256(canonical_json({
  contract_version,
  task_id,
  trigger_type,
  checkpoint_id,
  plan_revision,
  input_digest,
  evidence_digest
}))
```

canonical JSON 固定 UTF-8、NFC Unicode、字段顺序和 null 规则，不接受运行时对象迭代顺序。

### 4.3 输出

输出严格包含 PRD 第 15.2 节字段：

`trigger_type`、`task_id`、`checkpoint_id`、`plan_revision`、
`invocation_key`、`input_digest`、`evidence_digest`、`verdict`、
`facts`、`hypotheses`、`findings`、`evidence_refs`、`progress`、
`risks`、`recommended_next_action`、`process_adjustments`、
`material_change_proposal`、`reopen_request`、`user_acceptance_summary`、
`provider_identity`、`contract_version`、`generated_at`。

未知字段默认拒绝；未来扩展通过合同版本升级，不静默忽略。

### 4.4 输出应用

Harness adapter 在应用前重新读取：

- active task identity；
- 当前 `product-manager.json.stateRevision`；
- 当前 plan digest；
- 当前 input/evidence digest；
- 当前 checkpoint 与 pending invocation key。

任一不匹配：

- raw result 标记 `stale`；
- 不更新 milestone、currentGate 或 progress；
- 不解除用户硬停；
- 主编排器以最新输入创建新调用或请求用户逐检查点放行。

## 5. Provider 策略

### 5.1 统一第四角色

产品经理复用现有 CCG Provider Routing：

```toml
[routing.product-manager]
models = ["claude"]
primary = "claude"
strategy = "fallback"

[product_manager]
enabled = false
contract_version = "1"
max_retries = 1
timeout_ms = 180000
max_output_bytes = 1048576
```

选择命令与其他 role 完全一致：

```text
ccg routing get product-manager --json
ccg routing set product-manager claude
```

路由选择只写统一 routing，不安装 CLI、不登录、不打开网络、不读取凭据、不产生付费调用。
`[product_manager]` 只保存 enabled、contract/version、timeout、retry 和输出上限等行为参数。

兼容迁移规则：

- 首次读取旧 `[product_manager].provider` 时，若统一 route 尚不存在，则把旧选择迁入
  `routing.product-manager`；
- 若两者同时存在，统一 route 胜出；
- 无论哪种情况都删除旧 provider 字段，此后不再双写；
- route 切换不修改 Trellis task、说明文档、Harness snapshot 或来源 manifest。

### 5.2 Harness 有效集合

有效 Provider：

```text
CCG unified routing selection for product-manager
∩ CCG implemented capabilities
∩ .harness/project.json allowed providers
∩ .harness/adapter.json model/provider policy
```

目标 Harness 首版：

- `claude`、`gemini`、`codex`：已实现、可直接路由、始终只读；
- `grok`、`antigravity` 或未来 Provider：若产品经理 adapter 未实现或 Harness 未允许，
  返回 `unavailable`；
- 不满足交集：返回 `unavailable` 并硬停，不 fallback。

### 5.3 只读 Provider 启动

每个 adapter 必须：

- 在 disposable snapshot 或等价只读 sandbox 中运行；
- 禁止工作区写入、终端和子代理控制；
- 使用绝对可信 executable/Node entrypoint、`shell:false` 和最小环境；
- 设定 timeout、最大输出、单次调用和取消策略；
- 记录真实 Provider/模型/CLI 版本；
- 在最小子进程环境中禁用 support notice、进度条和颜色等非协议输出；
- 成功 stdout 必须且只能包含一个 JSON 文档，并只把该结构化结果交给 validator；
- 同 Provider 的每次失败尝试都记录 attempt/max attempts、Provider 和有界错误摘要，经统一
  redaction 后进入 append-only audit；不得因诊断失败引入 fallback。

CCG 自身 i18n 初始化也必须禁用 support notice。Harness 继续严格解析完整 stdout；不通过
提取最后一行或搜索 JSON 子串掩盖协议污染。

## 6. 五类事件与 Hook 边界

| 事件 | 候选来源 | 主编排器调用时机 |
|---|---|---|
| `INTAKE_REVIEW` | 新产品任务、完成 `GRILL_HANDOFF` | 仓库事实与需求收敛后、设计前 |
| `PLAN_REVIEW` | `prd.md`/`design.md`/`implement.md` 草案完成 | 向用户展示最终计划前 |
| `DRIFT_REVIEW` | 新证据推翻假设、范围/风险/计划显著变化 | 普通实现暂停后，由 Codex 判断事件成立 |
| `MILESTONE_REVIEW` | 实现者提交候选完成 + 工程门禁完成 | 生成用户验收卡前 |
| `FINAL_REVIEW` | 所有必需 milestone 候选闭环 | Trellis finish/archive 请求前 |

命令、Skill、Hook 和子代理只返回事件候选。`.codex/hooks/inject-workflow-state.py`
可读取 `product-manager.json.currentGate` 并注入：

- 当前待验收 checkpoint；
- 允许的三种用户响应；
- 通过后应恢复的 `implement.md` 下一项。

它不得启动 Provider、获取锁、写 evidence 或更改 canonical state。

Codex 收到有效 review 后必须先读取 `pm status` 并面向用户复述产品经理的
`productManagerStatement` 原话，再列出 findings、risks、process adjustments 和唯一推荐
下一步。硬门禁必须先执行 `pm present`，然后展示三种允许响应并结束当前回合；只有用户在该
展示之后的新消息可以进入 `pm respond`。之前对其他里程碑的批准、批量批准或展示前消息都不能
自动满足本门禁。

## 7. 里程碑、验收和进度

### 7.1 状态

milestone：

- `not_started`
- `in_progress`
- `blocked`
- `awaiting_user_acceptance`
- `completed`
- `user_overridden`

PM verdict 独立保存：

- `accepted`
- `rejected`
- `needs_user_decision`
- `reopen_request`
- `unavailable`

### 7.2 用户响应

- `accept`：milestone → `completed`，保留 `pm.verdict`，恢复原计划；
- `reject`：milestone → `in_progress`，记录原因，由 Codex组织整改；
- `override`：milestone → `user_overridden`，保留原 verdict 和风险，恢复原计划。

没有用户响应时 `currentGate` 一直存在；不设 timeout、不自动放行。`pm respond` 必须验证
当前 gate 已由 `pm present` 生成 presentation digest、时间和对应 state revision，否则
fail closed。

### 7.3 三维进度

- 实施推进度：权重分子只包含 `awaiting_user_acceptance`、`completed`、
  `user_overridden`；
- 产品验收度：当前有效 `pm.verdict=accepted` 且 milestone 不是
  `user_overridden`；
- 健康度：从 blocker、drift、override、证据缺口和重大风险按固定规则派生。

计算函数必须是纯函数；每次写 canonical state 时重算并记录 `basisDigest`。

### 7.4 最终完成

正常 `completed` 请求条件：

- 所有必需 milestone 为 `completed`；
- FINAL PM verdict 为 `accepted`；
- 最终用户验收通过；
- 全部门禁通过；
- 无 blocker、无未批准 drift、证据完整。

存在任何 override 时只允许 `completed_with_overrides` 产品结论。
该结论只授权 Codex请求 Trellis finish/archive；真正关闭仍由 Trellis 执行。

## 8. 并发、恢复与幂等

- CCG Provider lock 与 Harness projection lock 使用不同命名空间，均通过跨进程原子
  create-if-absent 获取；
- lock 写入 invocation key、进程身份、lease/heartbeat 和创建时间；
- Provider 调用 single-flight 由最内层 CCG lock 负责；Harness projection lock 只负责
  adapter 的准备和 CAS 应用，不成为第二个 Provider 权威；
- 同键 `completed` 结果且 bindings 有效时直接复用；
- 同键 `pending` 且 lease 有效时等待/返回进行中，不创建第二调用；
- lease 失效时先记录 abandoned，再由同键恢复；不得创建新的逻辑结论；
- 每次同 Provider 重试失败先写有界、脱敏 `attempt_failed` 审计，再决定是否进行下一次同键尝试；
- 不同 plan/input/evidence digest 必然产生新键；
- 旧调用结束时只能写 raw `stale` 审计，不能 CAS 成功到 canonical state；
- Windows、Linux、macOS 使用同一原子文件/CAS 语义测试。

## 9. 来源、安装与迁移

只有 Provider 实现或打包内容本身变化时执行以下联动顺序：

1. 在安全、干净、来源明确的个人 CCG checkout 实现并通过 CCG gates；
2. 在一次联动打包事务中解析干净 checkout 的当前 HEAD，记录 commit、Git tree、包版本和内容摘要；
3. 同一事务更新 Harness `harness.sources.json`、`components/ccg-workflow/` 和匹配的运行时；
4. 更新 Harness 初始化器拥有的 schema、policy source、ownership 和测试；
5. 安装与当前快照来源指纹匹配的 CCG CLI/plugin；
6. 运行 source、runtime、conflict、clean-install 和跨平台门禁。

单纯切换 `routing.product-manager` 属于已安装运行时的用户配置变更，不触发上述事务，
不修改 snapshot、manifest 或 Trellis 工件。来源指纹描述当次联动包来源，不是长期锁版。

禁止：

- 从当前 dirty CCG checkout 直接吸收无关删除；
- 直接编辑 Harness 组件快照而不先改权威源码；
- 使用 `main`、`latest` 或 `@latest` 作为来源选择器；
- 手工编辑 Harness 投影出来的 policy/AGENTS managed block；
- 将 Provider 选择解释成登录、联网或付费许可。

## 10. 向后兼容与回滚

### 10.1 兼容

- 新 schema 字段均为向后兼容；
- 老项目没有 `product-manager.json` 时表示未启用，不是损坏；
- 老 CCG 配置首次读取时迁移 `[product_manager].provider` 到统一 routing，并删除旧字段；
- 老配置没有产品经理行为段时保持 `product_manager.enabled=false`；
- initializer 保留未知用户文件和字段；
- project policy 禁止已选 Provider 时返回 `unavailable`，不改统一 routing 选择。

### 10.2 回滚

- CCG 源码：回滚到上一组已验证的联动打包快照指纹；
- Harness：使用现有事务/ownership rollback 恢复 sources、snapshot、schema 和 policy；
- task：保留 `product-manager.json` 与 raw evidence 供审计，标记 feature disabled；
- 不删除用户任务、PRD、计划、验收记录或未知资产；
- 不自动执行工作区 Git reset/checkout。

## 11. 多模型综合

### Grok

采纳稳定请求 ID、陈旧响应条件检查、人工审批硬停、最小权限沙箱和可验证 provenance。
外部来源已由 Codex打开核验。

### Gemini

采纳确定性 fake-provider、并发/恢复、权限、clean-install、provenance、
跨平台和端到端测试建议。

驳回其 Hook 直接调用 Provider 和 `.ccg/tasks` 写入重定向方案；二者违反已确认 PRD。

### Claude

使用本机已安装并登录的 Claude Code 作为产品经理。调用只接受规范化输入，在 disposable
目录中以 `shell:false`、禁用工具/MCP/会话持久化的方式执行；Claude 只返回结构化评审，
不读取真实工作区、不写 Trellis 状态，也不成为第二编排器。适配器始终显式传入
`--model`：`CCG_PRODUCT_MANAGER_CLAUDE_MODEL` 未设置时使用原生 `opus` alias，
设置时采用该精确覆盖；不继承本机默认，也不回落到 `sonnet`。

### Codex

最终选择“CCG provider-neutral runtime + Harness Trellis adapter + tracked canonical projection +
ignored raw evidence + inline 主编排器显式调用”，并把六个交付阶段作为本任务唯一计划中的里程碑。

## 12. 开放项

无阻塞产品决策。以下细节由实施测试决定，不改变产品范围：

- 跨平台原子 replace/lease 的最小实现；
- Claude/Codex read-only Provider adapter 的平台解析和 CLI flags；
- `product-manager.json` schema 的最终字段命名；
- 现有 Hook breadcrumb 的最小兼容扩展。
