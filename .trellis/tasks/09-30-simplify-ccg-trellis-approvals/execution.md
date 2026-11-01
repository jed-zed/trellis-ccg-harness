# v1 本地实施记录

用户在具体 v1 方案展示后明确回复「批准」。来源与原审阅文档指纹见
`approval-v1.json`，任务已进入 `in_progress`。`prd.md`、`design.md`、
`implement.md` 和 `deployment-targets.md` 保留审阅时原文；其中待批准/未执行
字样是历史快照，本文件记录批准后的实际进展。

## 修改位置与边界

| 内容 | 隔离工作树 | 分支 | 未提交基线 |
|---|---|---|---|
| CCG 五份原生 Skill 及必要回归 | `G:\CodexWorktrees\ccg-approval-reuse-v1` | `codex/approval-reuse-v1` | `87592d37578193bf36c8a074e5224a4803951ce3` |
| Trellis 工作流/Skill、策略源、指南及必要回归 | `G:\CodexWorktrees\harness-approval-reuse-v1` | `codex/approval-reuse-v1` | `b45c2ea72141bc0fa7f36232e102e8e5971602ed` |

原始 dirty checkout 仅写入本任务证据及本会话 task pointer。既有用户修改、
共享安装来源、component/manifest、实际 CLI/plugin、全局 Skill 和受管 AGENTS
不由本轮更新。复用已有依赖 junction，不安装依赖。

已按仓库要求读取 trellis-before-dev、Ponytail 与适用 tooling/guides。源规则由
分离 OWNED_PATHS 的两个 worker 修改；协调者负责策略/指南、集成验证和最终证据。

## 已核实的限制与后续整合前置条件

- 本次是工作流/Skill 契约，未向 `task.py start` 加入机械审批校验器。首次具体
  方案批准、复杂规划文档、轻量/快车道边界、适用验证和独立 PM/动作批准保留。
- 已有项目策略更新需要提高 initializer 的 policy revision。当前源码常量为
  `PROJECT_POLICY_VERSION = 8`；同版本内容变化被明确拒绝。本 v1 路径范围未纳入
  initializer runtime，所以保留该保护。后续授权整合/部署需串行处理 revision
  与投影升级回归，不能直接覆盖已有 owned policy 或 AGENTS block。
- 另一独立 PR51/PR16 审查/合并/同步任务目前按父任务安排只读。本轮不修改其
  工作树、共享源或安装目标；最终交付基线补丁后由父任务协调串行整合。
- PR50 的 smol-toml 审计和 invocation-lock EPERM 是另一工程活动；本轮不修复
  或重跑远端任务。必要本地离线门若出现同类既有失败，将单独记录。
- 默认 Python 3.11 的既有 task import 兼容问题未修改；任务命令使用 `py -3.14`。

## 验证进展

待规则修改和必要离线门完成后写入实际结果。静态规则/投影回归只能证明契约
进入分发入口；真实新会话中的询问次数与安装后的行为仍需单独验收。
