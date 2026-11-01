# 审批简化实施计划 v1

当前状态：**计划可审阅，实施待批准**。本次调查/任务建立已完成，以下实施清单尚未执行。

## 开始条件与权限范围

- 用户审阅 `prd.md`、`design.md`、本文件与 `review-v1.json` 后，明确批准 `v1` 的本地源改动和测试。
- 此批准仅覆盖 design 中列出的路径及必要聚焦回归；不包括全局安装/同步、提交、推送、PR、合并、发布、Provider 调用或 PR #51 修复。
- 当前 source 基线：CCG `87592d37578193bf36c8a074e5224a4803951ce3`；Harness `b45c2ea72141bc0fa7f36232e102e8e5971602ed`。正式开始前复查 Git 状态/安装来源；若基线或相关逻辑实质变化，解释差异并重新核对方案覆盖。

## 有序实施清单

1. [ ] 核对用户批准原文、覆盖版本/范围/动作，写入批准来源；保护原始 dirty 树。在基于上述准确提交的独立本地工作树实施，不将无关用户改动移入任务 diff。
2. [ ] 读取适用 `trellis-before-dev`、tooling/guides 和 CCG 测试要求；保留 inline 生命周期。在同一方案已明确获批时复用批准后执行 `task.py start`，不再询问相同方案。
3. [ ] 在 Trellis 工作流及 start/brainstorm/continue 中加入审批复用的共同判定条件，同步 breadcrumb 与 walkthrough。保留首次最终审阅、复杂三文档、轻量/快车道条件、完成验证和独立操作批准。
4. [ ] 更新权威 collaboration-policy 源和 Harness 指南；只在临时 fixture 验证支持的策略投影，不直接覆盖用户 AGENTS/global Skill。
5. [ ] 更新 CCG 五个原生 Skill 的 Trellis-first canonical 计划入口。无 Trellis 保留原路径；已明确批准计划时跨层承接；缺批准或实质变化时停止。plan 不自动实施。
6. [ ] 增补必要的契约/投影回归，并按下述会话案例检查提示及交接行为。不得以静态文本测试通过冒称模型在真实会话中必然遵守。
7. [ ] 运行受影响包的必要离线验证、审阅任务完整 diff 与审批来源记录。处理本任务引入的问题；遇既有失败如实记录，不修无关事项。
8. [ ] 返回本地源 diff、测试证据和残余风险供检查。当前授权边界内停止，不提交、不安装、不归档，不执行 coupled distribution update。

## 必须覆盖的验收案例

| 案例 | 输入与预期 | 对应 PRD |
|---|---|---|
| 建任务授权 | 已有“在 Codex 创建任务”明确授权 → 直接建立 planning；实施仍未获批。 | A1/A3 |
| 首次无批准 | 文档完整但用户未看完/未批准 → 留在 planning，不 start。 | A3 |
| CCG→Trellis | 同一 task 的 v1 已展示并明确批准 → Trellis 1.4 承接同次批准，不再次问。 | A2 |
| Trellis→CCG | 同一 canonical v1 已获批 → execute/workflow/feat 引用该计划，不新建同内容 CCG plan，不再询问。 | A2 |
| 恢复/continue | 原批准来源可核对且无实质变化 → 继续已覆盖实施，重复 summary 不生成新批准门。 | A2/A4 |
| 变化与撤回 | 范围/方案/风险/验收实质变化、拒绝或撤回 → 停止对应未覆盖实施，展示差异。 | A3/A4/A7 |
| 格式变化 | 仅换行、排版、错字或 checklist 状态 → 核对记录后复用，不以字节哈希不同自动询问。 | A4 |
| 独立 PM/动作门 | 普通实施批准不清除当前 PM 卡片，也不覆盖未授权安装/提交/发布等动作。 | A4/A6 |
| 无 Trellis | 保留 `.codex/ccg/plans/*.md` 与 plan 保存后停止；不凭空创建 Trellis task。 | A2/A5 |
| 原有改动保护 | 原 dirty 文件/索引/HEAD 不因任务实施被覆盖；快车道旧任务状态不变。 | A5/A8 |

静态 Skill/投影检查负责“契约是否正确传到入口”；真实会话重放负责“询问次数与计划复用是否符合要求”。后者未执行时必须标为未验证。

## 验证命令与执行地点

CCG 隔离源码工作树（已装版本的源基线；不从 Harness component 运行新源码）：

```powershell
pnpm exec vitest run src/utils/__tests__/codexHookTrellisDelegation.test.ts src/utils/__tests__/pluginParity.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Harness 隔离工作树：

```powershell
node --test tests/harness-adapter.test.mjs tests/harness-init-cli.test.mjs
node --test tests/product-manager-state.test.mjs
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm verify:sources
```

Harness tooling spec 另列 `pnpm ccg:lint`、`pnpm ccg:typecheck`、`pnpm ccg:test`、`pnpm ccg:build` 为完整离线门。它们验证其当时 bundled component；本轮不修改 component，因此不能用其成功证明新的 CCG 源修改已分发。将来获准 coupled snapshot 更新后，必须对新快照完成全部门。未改 Go wrapper，不增加 Go 构建工作。

本机默认 `python` 是 3.11，task.py 导入出现 nested f-string 语法兼容错误；本次用已安装 `py -3.14` 成功建任务和检查。后续任务命令继续显式使用 `py -3.14`，不顺带修 Python 兼容逻辑。

## 本次已执行与未执行

- 已执行：精确本地来源/版本核对、原 dirty 文件哈希基线、task create `--no-start`、需求与技术设计收敛、CCG 14 项及 Harness 5 项聚焦基线检查。
- 待本次文档收尾检查：task.json/JSONL/引用路径、原文件哈希/索引/HEAD 比对、方案指纹。
- 未执行：以上实施清单、批准复用新行为测试、真实新会话重放、完整离线门、分发/安装或远端 PR 审计。
