# 本地审批调查与验证

调查日期：2026-09-30。只使用本次本地文件和命令作为当前行为证据；历史 memory 仅帮助定位，不替代授权。

## 结论

**未证明当前 Codex 原生流程始终两次实施审批。** 已装 CCG 明确禁止计划结束时再问 Y/N；Trellis 明确需要首次最终方案批准。真实缺口是同一方案批准的复用说明不完整，以及 CCG 固定计划路径与 Trellis 单一权威之间的衔接。legacy 的强制 Y/逐阶段确认确实存在，但属于可选旧命令，不能套在当前插件上。

## 实际路径、分支和提交

| 用途 | 路径 | 分支 | HEAD / 版本 |
|---|---|---|---|
| 本次任务与用户原始 Harness 工作区 | `I:\ai\trellis-ccg-harness` | `codex/harness-recommended-project-skills` | `683ac2e62f038fddb6883f5a2724e17d492efb97`；Harness 0.2.0；manifest CCG 3.4.5/Trellis assets 0.6.9 |
| 原始个人 CCG 工作区 | `I:\ai\ccg-gptpro-worflow` | `codex/auto-search-product-manager` | `d512c4a12f48666e10b8c94562d5b229044ad4b0`；package 3.4.5 |
| 实际 CCG 安装的源码基线 | `G:\CodexWorktrees\ccg-simplify-mcp-research` | `codex/simplify-mcp-research` | `87592d37578193bf36c8a074e5224a4803951ce3`；package 3.4.15；clean |
| 实际 Harness 安装源 | `G:\CodexWorktrees\harness-simplify-mcp-research` | `codex/simplify-mcp-research-sync` | `b45c2ea72141bc0fa7f36232e102e8e5971602ed`；manifest CCG 3.4.15，源 commit 87592d3，Trellis assets 0.6.9；clean |
| 已核对 Harness 本地 main | `I:\ai\trellis-ccg-harness-ccg-3.4.15-final` | `main` | `ab9c2597054fbafb0353024a1593fea3798a7e8d`；manifest CCG 3.4.15 的源为 `02bb7e1958c94c4b2e2dc739d797ea4613042da0`；1 个既有 dirty 文件 |
| 已装 CCG 插件 | `C:\Users\29933\.codex\plugins\cache\ccg-gptpro-worflow\ccg\3.4.15+codex.1` | 非 Git 工作树 | plugin 3.4.15+codex.1 |
| 已装 CCG CLI | `C:\Users\29933\AppData\Roaming\npm\ccg.ps1` → `node_modules\ccg-workflow\bin\ccg.mjs` | 非 Git 工作树 | package 3.4.15 |

原始两个仓库的 remote 分别为 `jed-zed/trellis-ccg-harness` 与 `jed-zed/ccg-gptpro-worflow`，均由本地 `git remote -v` 确认。没有把公开远端 main 当作本地当前版本；没有 fetch/pull。候选 `I:\ai\ccg-codex-workflow` 未在该路径发现，未声称整机不存在；其 PR16 与 PR51 已由独立委托审计，本任务不重复承担。

安装来源以 `C:\Users\29933\.agents\harness\codex-plugin.json:6,12` 为准，指向 G: 的安装源；`harness.sources.json:23,27` 指 CCG 3.4.15/87592d3。被审阅的五份 CCG Skill 与 PM rule 在源码、component、插件缓存中换行规范化后全文一致；未称原始字节一致。

全局 Trellis Skill 投影另有来源：`C:\Users\29933\.agents\harness\global-skills.json:8,48` 仍记 catalog commit `1296f5e3737063b22dda1503042ff51f44d5fcd7`、`I:\ai\trellis-ccg-harness-ccg-3.4.12-sync`。本次相关 brainstorm 与 root/G 版本 SHA256 相同，不能把所有全局 Skill 的来源混称为 G:。

## 审批机制和重复风险

下文 P 指插件缓存，S 指 CCG 实际安装源码，R 指原始 Harness 工作区；均为上表绝对路径。

| 证据 | 确认的当前行为 | 本任务判断 |
|---|---|---|
| P `skills/ccg-plan/SKILL.md:46,136,245` | 不自动调用 execute，不问 Y/N；保存后停止。 | 保留，不能称其必然再问一次。 |
| P `skills/ccg-plan/SKILL.md:38,132` | 仅写 `.codex/ccg/plans/*.md`；新请求默认新文件。 | 与 Trellis canonical plan 不协调，拟加 Trellis-first 分支。 |
| P `skills/ccg-executor/SKILL.md:106-115` | 输入识别 CCG plan 路径或任务描述，无明确计划时要求路径。 | 未见通用第二次实施批准；拟直接承接 Trellis canonical 计划。 |
| R `.trellis/workflow.md:156,301,444-463` | 建任务许可不等于实施许可；artifact review 后 start，用户确认是必需条件。 | 保留首次计划批准及文档门。 |
| R `.agents/skills/trellis-brainstorm/SKILL.md:60-61,82,138,198` | 最终摘要后停止，之后的消息明确批准最新摘要才可实施。 | 补充同一已展示/已批准版本可以复用；不能把重述摘要变成全新批准门。 |
| R `.agents/skills/trellis-continue/SKILL.md:30,35` | continue 本身不批准；planning 文档完整时 ask for start review。 | 可能重复询问，当前无已有批准复用说明；不是强制两道运行时审批的证明。 |
| R `AGENTS.md:94-98`、`.trellis/workflow.md:276` | Trellis 单一 task/plan authority；复用已有 artifact；once 输出已存在时跳过。 | 已有原则，可补具体批准承接规则。 |
| R `.trellis/scripts/task.py:73-143` | start 检查目录并更新 session/status/hooks；不验证批准或三文档。 | 门是工作流契约，不能声称脚本已经机械实施第二次审批。 |
| S `templates/codex/hooks/ccg-workflow.py:34-50,72-78,315-317` | Trellis-first 检测并委托，缺项目 Hook 时仍不建立平行 CCG lifecycle。 | 保留，已有回归测试。 |
| S `templates/commands-legacy/execute.md:17,129`、`workflow.md:105` | 旧命令强制 Y/二次确认、每阶段确认。 | 确实存在，`src/utils/installer-data.ts:69-85` 列为 optional legacy；当前不改。 |

实际 Hook 配置 `C:\Users\29933\.codex\hooks.json:17` 指向 `G:\CodexData\.codex\hooks\ccg-workflow.py`，与 S 的相关 Hook 内容换行规范化后一致。

未在本次被检索的 root/main/G snapshot/插件范围检出 `recordApproval` 或 `requireApproval` 符号；没有依据把这两个名称或统一 approval binding 称为现有运行机制。本方案只复用既有任务元数据与协调者工作流，不引入假定接口。

## 应保留的独立关卡

- R `scripts/lib/harness-adapter/product-manager.mjs:1016-1044`：一般 accepted INTAKE/PLAN/DRIFT 不建 gate，只有具体 decision/reopen/unavailable/material-change 才触发。
- 同文件 `:1054-1064,1615-1637`：PM 卡片有 revision/presentation 绑定；展示后才能接收新的用户答复。R `AGENTS.md:221-226` 禁止用旧 blanket 批准代答。无需把它拆成另一套通用计划批准。
- `tests/product-manager-state.test.mjs:380-419,625,711,793-809` 已覆盖 fresh presentation、普通 intake 继续、最后未变里程碑与最终验收合成单门；本次仅阅读，未运行该完整套件。
- 快车道任务 `08-20-harness-fast-lane-workflow/task.json:6` 仍 planning。PRD 仅是提案，不是已生效能力；本任务不改旧 task。

## 本次实测与未验证项

| 检查 | 结果/限制 |
|---|---|
| 既有状态基线 | root 原有 47 个简短 status 条目；展开所有文件为 138 个 dirty 文件，CCG 原始工作区 8 个，Harness main 1 个，两个 G: 安装源 clean。已逐文件保存 SHA256 与 staged diff hash。 |
| task create | 使用已安装 `py -3.14`，带 `--no-start` 成功；状态 planning，不变更原 session pointer。 |
| CCG 基线聚焦测试 | 在 S 执行 `pnpm exec vitest run src/utils/__tests__/codexHookTrellisDelegation.test.ts src/utils/__tests__/pluginParity.test.ts`：2 suites、14 tests passed。 |
| Harness 基线聚焦测试 | 在 G: Harness 执行 `node --test --test-name-pattern 'canonical context\|duplicate Trellis\|global Trellis\|idle repository' tests/harness-adapter.test.mjs`：5 tests passed。 |
| 测试含义 | 验证既有 Trellis 委托、插件契约、canonical context 和重复 Hook 优先级；不证明尚未实施的跨层批准复用。 |
| 原生方案复用覆盖 | 已读的专门测试未覆盖普通实施批准复用或 Trellis 计划路径承接；应按 implement.md 增补契约检查与会话验收。 |
| Python | 默认 python=Hermes venv 3.11.2，task.py import 因 nested f-string SyntaxError；py -3.14 可用并完成任务创建。未修代码，不构成本次阻塞。 |
| 完整/实时验证 | 未跑全仓完整离线门、Provider、真实新会话重放或远端 PR 审计；未安装/同步源码变更。 |

命令完整日志与初始 Git/文件基线保存在 `C:\Users\29933\Documents\Codex\2026-09-30\task`，收尾检查见 `verification.json`。本次仅本地调查和任务文档，没有实施修改。实施唯一尚缺的输入是用户对本次具体 `v1` 方案的批准。

## 另行工程活动 PR50 的关联（不承担完整 PR 审计）

用户另行提供新搜索简化 PR50 head `456bca28e2b536f7f46547e4298a38a0d8d9b2d0`、run `36747258211` 的 Ubuntu Node22 `smol-toml 1.7.0` 审计失败和 Windows Node22 invocation-lock `EPERM`。这些 CI 状态是用户提供，本任务没有联网核实、复现、修复或重跑。

本地只读 `git show` 能读取该 head：它合并了 `87592d3` 与 `9d29419`；相对本次安装源 `87592d3`，差异只有 `codeagent-wrapper/main_integration_test.go`（9 additions/7 deletions）。因此属于同一搜索简化源码历史；原始 CCG dirty 树中的 route/tests 修改也与搜索运行链有关，但未把这些未提交字节认定为该 PR 的内容。此 PR head 与审批 Skill 的拟改路径无直接差异，不改变 v1 的审批结论。未来实施前仍复查来源，未来分发不以本次 19 项聚焦通过替代其完整 CI 状态。

收尾快照中，原始 147 个 dirty 文件有 143 个哈希不变；搜索简化 task 的 `prd.md`、`implement.md`、`execution.md`、`task.json` 4 个文件由并行活动更新。该 task 的当前内容记录其另行获准的 GitHub 发布与 PR50；本任务工具写入只涉及新的审批简化目录，未修改或回退这 4 个文件。所有被记录仓库的 HEAD、分支与 staged diff hash 不变，两个安装来源仍 clean。完整“所有原文件字节不变”断言因此为 false，不能声称 147 个文件全部不变；计划文档校验独立通过，并发差异保留在 `verification.json`。
