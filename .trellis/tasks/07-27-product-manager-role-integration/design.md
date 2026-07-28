# 产品经理角色 Harness 适配设计

## 1. 设计目标

在 `jed-zed/trellis-ccg-harness` 中引入提供者中立、只读的产品经理评估能力，
同时保持：

- Trellis 是任务、需求、计划、验收、完成和归档的唯一权威；
- CCG 负责产品经理合同、Provider 调用、输出校验和工程门禁；
- Codex 是唯一工作区写入者、inline 主编排器和状态应用者；
- Gemini、Grok、Codex 等产品经理 Provider 均运行在独立只读能力边界；
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
| D-007 | 安装级 Provider 选择存于 CCG 配置；Harness 只声明允许集合和能力约束 | 不建立项目级或任务级第二个 Provider 选择 |
| D-008 | 调用键严格使用 PRD 第 15.3 节字段的 canonical JSON + SHA-256 | 幂等、single-flight 和 stale 检查共用同一身份 |
| D-009 | `DRIFT_REVIEW` 只调整 canonical task 的计划/状态，不自动执行 Git reset/checkout | 避免把产品评估扩大为破坏性工作区回滚 |
| D-010 | 首次兼容迁移默认关闭产品经理，保留现有项目行为 | 安装选择、联网和付费授权必须显式分离 |

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
- `src/product-manager/provider-registry.ts`：安装级选择、能力检查和 Provider adapter 注册；
- `src/product-manager/providers/`：Codex/Gemini 的只读启动器；Claude 在当前策略下不实现调用路径，
  Grok 只有项目明确允许且另行批准联网时才可用；
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
node scripts/harness-adapter.mjs pm respond --checkpoint <id> --decision <accept|reject|override>
node scripts/harness-adapter.mjs pm final-eligibility
```

职责边界：

- `status`：只读展示有效 Provider、pending gate、里程碑和证据有效性；
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
```

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

### 5.1 安装级选择

CCG 配置新增：

```toml
[product_manager]
enabled = false
provider = ""
contract_version = "1"
```

安装/更新只选择角色 Provider，不自动：

- 安装 CLI；
- 发起登录；
- 打开网络；
- 读取凭据；
- 产生付费调用。

现有安装迁移为 `enabled=false`，要求用户后续显式选择。

### 5.2 Harness 有效集合

有效 Provider：

```text
installed CCG selection
∩ CCG implemented capabilities
∩ .harness/project.json allowed providers
∩ .harness/adapter.json model/provider policy
```

目标 Harness 首版：

- `claude`：禁止，不探测、不调用、不创建 `.claude/`；
- `gemini`：可选、只读；
- `codex`：只有独立只读 sandbox adapter 通过能力测试后可选；
- `grok`：默认禁止；只有项目合同显式启用且用户另行批准联网/付费后可选；
- 不满足交集：返回 `unavailable` 并硬停，不 fallback。

### 5.3 只读 Provider 启动

每个 adapter 必须：

- 在 disposable snapshot 或等价只读 sandbox 中运行；
- 禁止工作区写入、终端和子代理控制；
- 使用绝对可信 executable/Node entrypoint、`shell:false` 和最小环境；
- 设定 timeout、最大输出、单次调用和取消策略；
- 记录真实 Provider/模型/CLI 版本；
- 只把 stdout 的结构化最终结果交给 validator。

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

没有用户响应时 `currentGate` 一直存在；不设 timeout、不自动放行。

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

- lock 通过跨进程原子 create-if-absent 获取；
- lock 写入 invocation key、进程身份、lease/heartbeat 和创建时间；
- 同键 `completed` 结果且 bindings 有效时直接复用；
- 同键 `pending` 且 lease 有效时等待/返回进行中，不创建第二调用；
- lease 失效时先记录 abandoned，再由同键恢复；不得创建新的逻辑结论；
- 不同 plan/input/evidence digest 必然产生新键；
- 旧调用结束时只能写 raw `stale` 审计，不能 CAS 成功到 canonical state；
- Windows、Linux、macOS 使用同一原子文件/CAS 语义测试。

## 9. 来源、安装与迁移

实施顺序：

1. 在安全、干净、来源明确的个人 CCG checkout 实现并通过 CCG gates；
2. 提交个人 CCG commit，记录 Git tree；
3. 事务式更新 Harness `harness.sources.json` 和 `components/ccg-workflow/`；
4. 更新 Harness 初始化器拥有的 schema、policy source、ownership 和测试；
5. 安装与固定 commit 匹配的 CCG CLI/plugin；
6. 运行 source、runtime、conflict、clean-install 和跨平台门禁。

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
- 老 CCG 配置迁移为 `product_manager.enabled=false`；
- initializer 保留未知用户文件和字段；
- project policy 禁止已选 Provider 时返回 `unavailable`，不改安装级选择。

### 10.2 回滚

- CCG 源码：回滚到上一固定 personal commit；
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

### Codex

最终选择“CCG provider-neutral runtime + Harness Trellis adapter + tracked canonical projection +
ignored raw evidence + inline 主编排器显式调用”，并把六个交付阶段作为本任务唯一计划中的里程碑。

## 12. 开放项

无阻塞产品决策。以下细节由实施测试决定，不改变产品范围：

- 跨平台原子 replace/lease 的最小实现；
- Codex read-only Provider adapter 的具体 CLI flags；
- `product-manager.json` schema 的最终字段命名；
- 现有 Hook breadcrumb 的最小兼容扩展。

