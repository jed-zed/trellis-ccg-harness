# 产品经理角色规划证据

## 1. 本地仓库事实

| 区域 | 证据 | 规划含义 |
|---|---|---|
| Trellis 权威 | `.harness/adapter.json`、`.harness/project.json` 都把生命周期和任务根指向 `.trellis/tasks` | 不创建 `.ccg/tasks` 或 `.codex/ccg/plans` |
| Canonical context | `scripts/lib/harness-adapter/context.mjs` 解析 active task，并对 `prd.md`、`design.md`、`implement.md` 计算 SHA-256 | 产品经理输入应复用该 resolver 和 artifact digest |
| 冲突门禁 | `scripts/lib/harness-adapter/conflict-static.mjs` 检查 Trellis task authority、禁止跟踪的 CCG runtime state、来源 Git tree 和 package version | 新功能要扩展现有 conflicts，不能另建 doctor |
| 运行时门禁 | `scripts/lib/harness-adapter/conflict-runtime.mjs` 检查安装版 CCG、插件缓存、模型策略和 Hook 重叠 | 产品经理调用前必须验证已安装 CLI/plugin 与来源匹配 |
| 提供者合同 | `.harness/adapter.json` 当前允许只读 Gemini、禁用 Claude、默认禁用 Grok；`.harness/project.json` 规定离线默认与显式手动 Provider | 安装级选择与项目 allow/deny 取交集，不能静默 fallback |
| 证据先例 | `components/ccg-workflow/templates/engine/tools/gptpro/gptpro_bridge.py` 的 `resolve_task_dir()`、`task_evidence_root()` 和路径边界校验已支持 Trellis task-local `.ccg-evidence` | 抽取或复用边界模式，不复制任务，不写 Trellis `task.json` 的 CCG gate 字段 |
| Hook 所有权 | `.codex/hooks.json` 已由 Trellis 占有 `UserPromptSubmit`；`.harness/adapter.json` 固定 `project-local-precedence` 和 yield marker | 不新增 Hook；现有 Hook 最多注入 pending 状态，不能调用产品经理 |
| 来源绑定 | 规划时点的 `harness.sources.json` 记录 CCG `3.3.3` 当前快照、commit `8bdad64...`、Git tree `847efc...`；`scripts/verify-sources.ps1` 验证 clean authoritative checkout、commit、tree 和 snapshot | CCG 源码先行，随后联动同步来源清单、打包快照和安装运行时；这些指纹用于溯源，不是长期锁版 |

> 以上两行保留为规划时点的历史证据。2026-07-28 用户随后明确选择本机已安装并登录的
> Claude Code 作为只读产品经理，并将来源策略修订为“联动打包更新 + 当前快照来源指纹”。
> 新决策由同一 Trellis task 的 `prd.md`、`design.md`、`implement.md` 和当前规格覆盖；
> 精确 commit/tree 继续用于快照溯源和回滚，但不再表示长期锁版。
| 测试面 | `tests/harness-adapter.test.mjs`、`tests/harness-lifecycle.test.mjs`、`tests/harness-init-cli.test.mjs`、`tests/verify-sources.test.mjs` | 在现有测试层增加 provider policy、state projection、concurrency、clean-install 与 provenance 用例 |

## 2. 当前状态风险

- Harness 当前 checkout 是 detached HEAD，但计划任务为 untracked；本轮不创建分支、不提交。
- `I:\ai\ccg-workflow` 当前分支
  `codex/harden-gptpro-review` 落后远端 6 个提交，并有 4 个已跟踪 `CLAUDE.md`
  删除和本 PRD untracked。实施前必须隔离或获得用户指示，不能覆盖这些改动。
- 规划时点全局 `ccg --version` 报 `3.4.0`，而 Harness 来源清单记录的当前快照为 `3.3.3`。
  这是实施前必须由 `conflicts`/`verify:sources` 重新判定的 runtime drift，规划不能假定兼容。

## 3. Grok 外部证据

Grok 的有效聚焦调用建议：

- 使用调用者提供的稳定 ID 和原子记录保证重试幂等；
- 用修订/摘要条件拒绝晚到响应；
- 人工审批必须是可审计硬停；
- Provider 使用最小权限只读沙箱；
- 来源/构建产物必须有可验证 provenance。

Codex 已核验 AWS Builders' Library、MDN、NIST AI RMF、Docker Security、
SLSA v1.2 和 Sigstore 官方页面。原始摘要保存在忽略的
`.ccg-evidence/planning/grok-evidence.md`。

## 4. Gemini 只读审查

Gemini `gemini-3.1-pro-preview` 通过浏览器预览器读取 851 个快照文件，
响应文件为忽略的
`.ccg-evidence/planning/gemini-response.response.txt`。

采纳：

- 固定 Trellis 摘要 + fake provider 的确定性夹具；
- 跨进程 single-flight、崩溃恢复和 stale response 测试；
- provider 写入/终端权限拒绝测试；
- clean-install、provenance、跨平台和完整端到端流。

驳回或修正：

- Gemini 建议 Hook 直接触发产品经理；这违反上游 PRD 第 17.4 节。
  正确做法是 inline Codex 主编排器调用，Hook 仅可上报候选或注入 pending breadcrumb。
- Gemini 建议把 `.ccg/tasks` 写入重定向到 Trellis；正确做法是从入口原生接受
  `.trellis/tasks/<task>`，任何 `.ccg/tasks` 创建尝试都应 fail closed。
- Gemini 建议把 `user_overridden` 写入 Harness lifecycle；实际应使用 Trellis task-local
  规范化产品投影，由 Codex 通过 adapter 更新，不能替换 Trellis task lifecycle。
- `DRIFT_REVIEW` 不授权自动 `git checkout`/`reset`。主编排器只调整同一 Trellis 任务中的
  计划和状态；任何工作区回滚仍走现有、明确授权的安全流程。

## 5. Codex 综合决策

1. CCG 权威源码提供 provider-neutral 的 `ccg product-manager` 命令、合同、校验、
   调用键和只读 Provider adapter；不持有 Trellis 生命周期。
2. Harness 扩展现有 adapter，原生接收 active Trellis task，准备有界输入、调用匹配的
   installed CCG runtime，并把已校验结论投影到 Trellis task-local canonical
   `product-manager.json`。
3. 原始 prompt/response/call journal/lock 只在忽略的
   `.ccg-evidence/product-manager/`；canonical `product-manager.json` 只保留规范化状态、
   摘要、证据引用、用户验收和进度。
4. CCG 命令/Skill/Hook/子代理只能报告事件候选；inline Codex 主编排器是唯一调用者。
5. 六个一级实施阶段直接作为本 Trellis 任务的里程碑，不拆成平行任务或第二份计划。
