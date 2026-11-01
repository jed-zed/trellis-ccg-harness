# 修复 CCG 外部资料通道超时与状态

## Goal

修复 CCG 外部资料辅助通道在长时间 Grok/Web Search 执行中的外层误杀、终态缺失、锁回收不安全、误触发远程研究及无界泛化输入问题，同时保留正常外部资料能力和个人版 CCG 配置。

## Background And Confirmed Evidence

- Boss 要求先只读复现并追踪完整调用链；在报告证据并获确认前不得修改产品源码、配置或安装产物。
- 已从原始 Codex rollout 点验：调用者用 FastCtx 前台 `run(timeout_ms=240000)` 执行 `ccg route`，工具在 240000 ms 杀死整棵进程树；CCG runner 的内部超时仍为 600000 ms。
- 已点验原始 Grok JSONL：OAuth、ACP、模型和 Web Search 已工作，末尾停在最终 JSON 消息块中间，缺少 `response_completed`，排除登录或网络故障作为本次根因。
- 已点验路由状态：`target=null`、`dependencies=[]`、`execution.status=pending`；任务文本中的 `current` 与 `compatibility` 同时命中宽泛正则，触发 `dependency_api_contract`。
- 已点验个人 CCG 3.4.15 源码：缓存锁已有 owner token、PID 存活检查和二次所有权确认；死进程锁可回收，活进程锁不会被误删。该实现优先复用，不重复重写。

## Requirements

### R1. 完整证据链

- 复现或用现有日志/fixture 确认用户描述的同一故障，不以邻近错误替代。
- 追踪从 Harness/CCG 路由判定、外层命令执行、Grok runner、ACP 子进程、状态投影到锁清理的完整调用链。
- 精确定位 240 秒限制的配置位置、默认值、调用者及杀进程机制。
- 在修改前向 Boss 报告调用链、240 秒来源、`dependency_api_contract` 触发条件和计划修改文件。

### R2. 超时契约

- 调用层必须与 Grok runner 的内部超时契约一致，不得靠无限放大所有超时解决。
- 超过前台 240 秒、但低于 CCG 内部超时的长任务必须使用现有后台执行/等待机制，不得被前台包装器误杀。
- 不关闭 Grok/Web Search，也不降低正常外部资料能力。

### R3. 终态与取消语义

- 每次 execution 必须在正常完成、内部超时、外部取消或子进程异常退出后落为 `completed`、`timed_out`、`cancelled` 或 `failed`，不得永久保留 `pending`。
- 保留导致终态的可诊断错误证据，避免清理错误覆盖主要失败。

### R4. 锁生命周期

- 异常退出必须释放或回收本次执行创建的锁。
- 不得按名称、时间戳或仅凭“看似陈旧”误删仍由活跃进程持有的锁；回收必须验证所有权/进程存活契约。

### R5. 远程研究触发与规模边界

- `target=null`、`dependencies=[]` 且不存在真实外部 API/依赖契约的普通本地任务，不得仅因描述中的泛化词语触发 `dependency_api_contract`。
- 确实存在外部依赖或 API 契约时，Grok/Web Search 必须仍可启动。
- 远程研究输入必须绑定实际目标源码、依赖清单或明确外部契约；缺少这些证据时不得生成十万 token 级泛化搜索。
- 输出应沿用现有边界/截断机制，不新增依赖或独立研究框架。

### R6. 来源、数据与变更边界

- 不修改 `G:\CodexData\.codex\plugins\cache` 下安装产物；修改个人 CCG 权威源仓库，并通过项目规定的同步/安装事务更新。
- 保留现有个人版 CCG 配置，不替换为官方原版；同步/安装前后校验并在必要时按现有备份机制恢复配置。
- 不修改 SillyTavern 活动实例、11451 端口或任何用户数据。
- 不做无关重构，不新增依赖，只在共同根因处做最小修改。

## Acceptance Criteria

- [ ] AC1：构造运行时间超过 4 分钟、低于 Grok runner 内部超时的模拟任务，证明不会在 240 秒被前台包装器误杀。
- [ ] AC2：分别构造内部超时、外部取消和子进程异常退出，验证 execution 终态为 `timed_out`、`cancelled`、`failed`，无 `pending` 残留，且本次锁安全清理。
- [ ] AC3：构造 `target=null`、`dependencies=[]` 的普通本地性能优化任务，验证不触发 `dependency_api_contract`。
- [ ] AC4：构造真实外部依赖/API 契约任务，验证 Grok/Web Search 路由仍正常启动。
- [ ] AC5：验证远程研究输入包含真实目标/依赖/API 契约证据，并受现有输入输出规模边界控制。
- [ ] AC6：提交前报告根因、修改文件、最小 diff、测试结果和回滚方法。
- [ ] AC7：未触碰 SillyTavern 活动实例、11451 端口、用户数据、插件缓存安装产物或无关脏工作区文件。

## Out Of Scope

- 关闭外部资料辅助功能或移除 Grok/Web Search。
- 重新设计 CCG 路由体系、锁框架或进程管理框架。
- 修改官方原版 CCG、SillyTavern、用户配置或现有无关工作区变更。
- 在只读诊断与规划阶段调用真实付费 Provider、执行同步/安装或修改产品源码。

## Blocking Open Questions

- 无用户产品决策待澄清；技术未知项由只读源码、测试、现有日志和运行时证据回答。
