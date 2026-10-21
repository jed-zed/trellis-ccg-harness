# 审批简化设计 v1

状态：供用户审阅，未批准实施。需求与边界以 `prd.md` 为准，当前事实见 `research/findings.md`。

## 设计决定

本方案修改现有工作流、Skill 与权威策略的审批衔接说明，复用 Trellis 任务元数据记录批准来源。不新增通用审批状态机、服务、ledger 或新的生命周期权威；不把工作流提示描述为机械权限控制。

| 关注点 | v1 方案 |
|---|---|
| 建立任务 | 已有明确创建请求/授权时直接建立 `planning` 记录；只在确实缺少建任务授权时询问。创建授权不覆盖实施。 |
| 计划权威 | 有 `.trellis/` 时，当前 task 的 PRD/design/implement 是唯一需求与实施方案；CCG 的证据只引用该 task。无 Trellis 时继续使用 `.codex/ccg/plans/*.md`。 |
| 首次实施批准 | 用户必须已经看见完整、明确版本的最终方案，然后显式批准其实施范围。`/ccg:plan` 本身只规划并停止。 |
| 跨层交接 | CCG→Trellis、Trellis→CCG、恢复或 continue，核对已有批准的任务、版本、范围、风险和动作。完全覆盖时直接承接到 1.4/start，不再要求第二份相同批准。 |
| 实质变化 | 新需求、范围扩大、架构/实施方案改变、风险上升或验收结果改变时，先说明差异，更新方案版本，再请求变化后方案的批准。可分离且已覆盖的部分继续使用原批准。 |
| 非实质变化 | 修正排版、错字、换行、路径展示、完成勾选或等价摘要不自动使批准失效；留下核对依据，不因为又展示了一遍 summary 而强制重新批准。 |
| 独立关卡 | 当前 PM 卡片需要的具体用户决定、Provider/联网付费、安装、提交、推送、PR、合并、发布、破坏性操作仍按各自真实来源与授权处理。不得用普通计划批准清除 PM presentation-bound gate。 |

## 当前应消除的三个衔接缺口

1. Trellis 的 no-task/start 分类说明默认要求询问建任务；补充“当前会话已明确授权创建时不再询问”。这只承认已有授权，不自动把任何编码请求当成建任务许可。
2. `trellis-brainstorm` 的“最新 summary 之后必须新批准”和 `trellis-continue` 的“ask for start review”补充同一具体方案的已有批准可复用。第一次尚未展示方案仍需最终审阅；重述已批准方案不人为制造新的第一次。
3. 当前 CCG plan 仅允许 `.codex/ccg/plans`，executor 只按此路径接受计划。补充 Trellis-first 分支：读取明确 task 的 canonical artifacts，承接其版本与批准；缺少活动任务/明确 task 路径时不猜测，从既有任务目录解析或询问最小必要 task 身份。不得静默选择别的活动任务或重新生成第二份方案。

## 批准来源记录

使用既有 `task.json.meta` 扩展能力，规划的字段为 `planApproval`，由当前 Codex 协调者在收到真实用户批准后记录。字段建议包含：状态、task ID、方案版本、已审阅文档引用与当时 SHA256、覆盖范围/动作、用户原文或消息引用、来源会话与记录时间。`task.py set-meta` 的 CLI 值是字符串；需要结构化内容时按现有 task JSON 写入方式记录，不扩张 CLI 或添加审批引擎。

本任务当前只有创建授权，`implementation_approval=pending`。`approval-source.md` 与 `review-v1.json` 是待审阅证据，不是批准。后续不得凭一个无用户来源的 `approved` 字段、初始“创建任务”或本轮“继续”把任务启动。

SHA256 用于定位用户审阅的具体字节，不独立决定是否重请批准。发现文档变化时由协调者依据批准来源及可检查的差异判断是否实质变化；无法还原原方案或判断覆盖关系时保持规划并说明缺口。撤回/拒绝会阻止对应实施，不把旧批准复制成有效批准。

## 具体拟改路径

实施在基于已核实安装源的隔离工作树中进行。原始 dirty 工作区仅保留本任务记录。

| 仓库 | 拟修改/验证的源路径 | 目的 |
|---|---|---|
| Harness | `.trellis/workflow.md` | 统一建任务许可、planning breadcrumb、1.4 和 walkthrough 的已有批准复用规则，保留复杂文档与首次计划批准。 |
| Harness | `.agents/skills/trellis-start/SKILL.md`、`trellis-brainstorm/SKILL.md`、`trellis-continue/SKILL.md` | 三入口引用同一工作流契约，避免 continue/重述 summary 触发重复询问。 |
| Harness | `.agents/skills/harness-init/assets/collaboration-policy.md` | 在受管策略的上游源声明单一方案与批准复用；不直接手改根 AGENTS 受管块或用户的 owned snapshot。 |
| Harness | `.trellis/spec/guides/layered-harness-adapter.md` | 衔接单一计划、审批来源记录与独立 PM/后果性关卡。 |
| Harness | `tests/harness-adapter.test.mjs`、`tests/harness-init-cli.test.mjs`（仅必要覆盖） | 验证 canonical context 和临时 fixture 中的策略投影，保护既有生命周期和独立关卡。 |
| CCG | `plugins/ccg/skills/{ccg-plan,ccg-executor,ccg-execute,ccg-workflow,ccg-feat}/SKILL.md` | Trellis-first 计划定位与同一已批准方案承接；保留 standalone 路径与 plan 的只规划边界。 |
| CCG | `src/utils/__tests__/pluginParity.test.ts`、`codexHookTrellisDelegation.test.ts`（仅必要覆盖） | 保证原生 Skill 契约、入口承接与既有 Trellis 委托一致；不添加第二套 CCG task 状态。 |

不修改 `task.py start`、PM gate 实现、模型权限或安全设置。可选 `templates/commands-legacy` 并非当前原生插件路径，本次只记录其冲突，暂不纳入修改。

## 兼容、风险与回退

- 规则是工作流/Skill 契约。`task.py start` 本身未验证批准；本方案不声称产生新的机械安全保证。
- 全局 Trellis Skill、CCG CLI/plugin 与源码快照有独立来源。当前批准范围只包含本地源改动与离线验证；不会自动同步快照、安装或更新全局投影。
- 修改源与后续生成/同步目标的精确路径见 `deployment-targets.md`。列出目标用于审阅，不表示当前获准执行这些操作。
- 后续分发必须按现有 coupled update/provenance 规则，以批准的准确源码提交同步 component/manifest，再完成适用门；提交和安装须另有明确授权。此项是部署阶段，当前 v1 不授权。
- 快车道旧任务仍是规划。保留其边界和现有轻量条件，不趁本任务落实其更大提案。
- 原 dirty 文件先验哈希已保存；隔离实施失败可放弃本任务新增 diff，不能 reset/clean 用户工作区。源改动与安装生效必须分别报告。
