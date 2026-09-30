# 设计：独立调研代理使用 MCP

## 决策

普通流程为：主代理拆分问题 → 现有 `web_search` 用 grok-search MCP 搜索和读取资料 → 返回有用发现、原始链接及未核实项 → 主代理结合项目作决定。检索范围可以积极扩展；核验只围绕实际采用的关键结论展开。

CCG 的 `search` 路由改用已注册的 `codex`，表示由 Codex 编排调研，不是把搜索子代理改成主模型。子代理仍为 Luna/high；MCP 的服务端模型与这两层独立。Boss 后续要求默认使用最新模型，现经新接口实测后将 MCP 默认值保存为 `grok-4.7-latest`，不改变子代理模型。该系列别名不等同于未来跨系列自动升级；通用 `grok-latest` 的单次测试返回 502，暂未选用。MCP 是取资料工具，不注册成新的 CCG Provider。

## 最小变更边界

| 位置 | 变更 |
| --- | --- |
| 个人源码 `plugins/ccg/rules/ccg-role-routing.md` | 集中说明 MCP 调研、独立问题分工和必要核验；普通 MCP 调研不套用旧 Provider 重试、证据身份或门禁流程 |
| `templates/commands/`、`templates/engine/strategies/`、`plugins/ccg/commands/`、`plugins/ccg/skills/` 的实际搜索调用段 | 根据现有 `workflow-coverage.json` 清点并注释旧自动 route、最终搜索核验、失败等待和豁免指令；活动文本引用共同的轻量规则 |
| GPT Pro 的 plan/review/exc 命令、Skill 和共享 bridge Skill | 注释默认 Grok 前置步骤和 `--require-external-intelligence` 等参数注入；已有普通角色分析和其他非搜索契约保持原语义 |
| `templates/codex/AGENTS.md` 及相关说明 | 更新生成规则，避免后续安装又写回旧自动搜索说明 |
| `G:/CodexData/.codex/AGENTS.md` 非受管的“CCG 联网”段 | 旧双通道规则注释保留，活动规则改为 MCP 主检索与用户确认的三项轻量要求 |
| `G:/CodexData/.codex/agents/web_search.toml` | 移除“主代理必另跑 Grok 独立证据通道”的活动要求，明确可用已配置 MCP；保留原模型、推理级别、只读、无子代理边界 |
| `G:/CodexData/.codex/ccg/config.toml` | 用现有路由命令设置 `search=codex`；保留旧手动设置，仅将已有 `auto_route` 设为 `false`，不新增开关 |
| 现有 MCP 有效配置 | 查明 API URL 未配置的真实来源，修复必要字段或进程配置生效问题；不安装第二份 MCP、不猜测端点、不输出密钥 |

自动入口清点以现有覆盖清单的 32 个工作流、83 个唯一文件为起点，补查共享规则和 GPT Pro 指引。该数量是检查范围，不要求无差别改动所有文件。每处只处理搜索自动编排段，不能把整份 Skill 注释掉。

## 保留旧链路的方法

Markdown 旧指令用 HTML 注释保留，并在活动文本中明确标记“归档内容不属于执行指令”。不重复建立归档文件或新控制框架。配置注释保留原值；JSON 等不支持注释的底层契约保持原文件，不强行写入非法注释。

保留 `route.mjs`、ACP runner、`validator.mjs`、manifest/hash 实现及显式旧命令。普通工作不调用这些入口；以后明确选择旧模式时仍执行其真实校验，不将其改成无条件成功。恢复需要明确撤销对应停用说明并恢复原设置，不提供自动回退。

已点验 `gptpro_bridge.py:3051-3065`：只有显式传入 `--require-external-intelligence` 才调用旧校验器；`:1592-1593` 同样受此布尔值控制。当前方案无需修改 Python 校验器，也无需删除旧任务中的 evidence pointer。旧会话可能继承已有情报作为内容，这本身不要求重新运行搜索；回归应确认它不会恢复普通调用门禁。

## 配置与来源边界

使用 `ccg routing set search codex` 修改单一角色。未发现专门修改 `auto_route` 的 CLI 子命令，后续执行时仅定点更新已存在的 TOML 字段并解析检查，不能杜撰 `ccg config` 命令，也不重新初始化全部配置。

`C:/Users/29933/.codex` 指向 `G:/CodexData/.codex`，只修改真实文件一次。受管 AGENTS 段、插件缓存和 `components/ccg-workflow` 只能由其来源及受支持的更新流程生成，不手工修补。全局个人段与 native agent 配置不冒充 Harness 模板所有权。

MCP 搜索实测曾返回“Grok API URL 未配置”；一次 `web_fetch` 成功不等于搜索可用。执行时只检查相关有效配置并隐藏敏感值。若本机没有已授权的端点或凭据，明确等待该项配置，不猜测、不复用旧电脑登录态，也不影响其他独立的源码工作。无需为每次查询设置新的准备检查。

## 源码与发布

实现基线是个人仓库 `I:/ai/ccg-gptpro-worflow` 的本地 `gptpro/main`，提交 `433081945d40ccd79720309e0ed7a101ac20fc0b`，版本 3.4.15；未宣称它是远端最新。活动 CLI 为 3.4.15，插件为 3.4.15+codex.1。现有工作树仍为旧 3.4.5 且有修改，必须在隔离的 `codex/` 分支/工作树实现，先核对与安装版的相关文件差异。

Harness 当前快照仍记录 3.4.5。实现完成后的源码、Harness 快照和 CLI/plugin 同步按 `personal-source-provenance.md` 执行；不能以旧脏工作树覆盖当前安装。受支持的快照更新入口是 `pnpm harness:update -- --source-checkout <clean-checkout>`。源码提交、发布和安装不由本轮规划自动授权，亦不为满足清洁源码要求而丢弃既有修改。

## 取舍与风险

- 只关闭配置无法消除 Skill 中的主动调用要求，所以同时处理规则来源和现有配置；不改底层搜索引擎。
- 注释对模型仍然可见，因此活动规则必须明确归档内容不可执行；验证时检查去掉注释后的活动内容。
- 去掉旧证据门禁不等于来源可靠性已自动得到保证：保留用户要求的原文、复用条件和不确定说明，不新增审计系统。
- 按问题分工优先于升级模型。本任务没有 Luna/Sol 或 high/max 的实际效果基准，不声称性能提升。
