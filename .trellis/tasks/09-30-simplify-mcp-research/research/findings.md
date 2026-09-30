# 调研依据与规划验证

日期：2026-09-30。此记录服务于本任务规划，不是普通调研必须生成的新证据格式。此前只读记录在忽略目录 `.codex/ccg/intelligence/mcp-research-plan-20260930/findings.md`；该记录写于建任务前，本目录是随后获准建立的唯一正式任务。

## 已核实的本机状态

| 项目 | 观测 |
| --- | --- |
| CLI / 插件 | 个人版 CCG 3.4.15 / 3.4.15+codex.1 |
| 路由 | backend=codex，search=grok，product-manager=claude；前端此前读到 antigravity，本任务不涉及 |
| 搜索子代理 | `C:/Users/29933/.codex/agents/web_search.toml:3-16`：gpt-6-luna / high / read-only / approval never；旧说明要求主代理另编排 Grok 通道 |
| 全局要求 | `G:/CodexData/.codex/AGENTS.md:104` 有 web_search 与 Grok CLI ACP 同跑要求；不是 Harness 的本地代码检索规则 |
| 路径别名 | `C:/Users/29933/.codex` 是到 `G:/CodexData/.codex` 的 Junction |
| 正确源码参考 | `I:/ai/ccg-gptpro-worflow` 的本地 gptpro/main = 433081945d40ccd79720309e0ed7a101ac20fc0b，package 3.4.15；本轮未 fetch，不宣称远端最新 |
| 不能直接使用的旧工作树 | 同仓 HEAD d512c4a12f48666e10b8c94562d5b229044ad4b0，3.4.5，有修改；`C:/Users/29933/ccg-workflow` 是无 Git 元数据的 3.1.0 |
| Harness 源记录 | `harness.sources.json` 仍记录 3.4.5，提交 efef535e976e7d508650e0a575075689fdfd6237；需后续受支持的联动更新 |

Harness adapter 的 Grok 默认关闭与用户全局 CCG intelligence 配置不是同一作用域，不能据前者声称全局旧自动链路已关闭。

## 本地调用证据

以下个人源码引用均来自上述 3.4.15 Git ref，未把脏工作树当基线。

- `templates/engine/tools/grok-intelligence/workflow-coverage.json`：32 个工作流、83 个唯一入口路径，含命令、策略和 Skills。共享说明还需独立核对，不能只改一个文件。
- `src/cli-setup.ts:259` → `src/commands/route.ts:5-19` → `templates/engine/tools/grok-intelligence/route.mjs`。`classifyWorkflowRoute` 的 `auto_route !== true` 分支可跳过自动执行，但无法消除指令文本中的调用要求。
- `src/utils/config.ts` 的 `normalizeIntelligenceConfig` 与 `templates/codex/ccg-config.toml:30` 已有 `auto_route`；未发现独立配置 CLI 子命令。不要以重跑初始化代替定点修改。
- `plugins/ccg/rules/ccg-role-routing.md`：search 允许 codex/grok；当前 3.4.15 的搜索为 advisory，不能套用旧 3.4.5 的强制失败行为描述。
- `templates/commands/gptpro-{plan,review,exc}.md`、同名插件命令及 Skills、`plugins/ccg/skills/ccg-gptpro-bridge/SKILL.md:81-93` 仍要求默认外部情报前提/参数。
- `templates/engine/tools/gptpro/gptpro_bridge.py:3051-3065` 仅在 `args.require_external_intelligence` 为真时调用 `validate_required_external_intelligence`；`:1592-1593` 也只在该开关为真时要求已验证结果。`:600-624` 的旧 task pointer 检查位于该显式校验器内部。
- `gptpro_bridge.py:1548-1550` 可在 follow-up 继承旧情报内容，不等同于无条件重新要求搜索。默认参数停用后无需清理历史证据或削弱校验器。
- `src/utils/__tests__/gptproBridge.test.ts:1275-1299` 含强制外部情报 flags 的说明断言；相关安装器、自动路由关闭和模板分发检查可复用。
- `/ccg:execute` 命令接受计划路径，但 Skill 默认写 `.codex/ccg/plans/`；本项目 Trellis 指令明确拥有计划权威。交接直接指定本任务文件，不声称通用 Skill 已增加 Trellis 路径说明。

独立探子 `plan_current_search_surfaces` 与 `plan_bridge_gate_detachment` 只读完成；主代理点验共享角色规则、执行 Skill 和 Python 的 flag/继承/校验调用处。未运行任何外部模型或旧 ACP 作为本轮定稿前提。

## MCP 实测与限制

前序同会话 `web_search` 子代理的 MCP 规划工具调用成功，但搜索返回 `Grok API URL 未配置`，session_id 为 `ddf6c0de23e2`、sources_count=0；`get_sources` 为空。`web_fetch` 成功读取官方分支 README，仅证明该次抓取成功。没有成功搜索、没有模型效果或耗时 A/B 数据，也没有修改端点、凭据或模型。

第一方项目来源：[GrokSearch README](https://github.com/GuDaStudio/GrokSearch/blob/grok-with-tavily/README.md)、[server.py](https://raw.githubusercontent.com/GuDaStudio/GrokSearch/grok-with-tavily/src/grok_search/server.py)。MCP 的搜索/抓取结果并不直接满足个人旧 ACP 原生事件证据契约；本方案让普通工作不再依赖该契约，不制造格式转换来假装满足。

## 上游与模型结论的边界

此前查阅官方 [deep-research.md](https://github.com/fengshao1227/ccg-workflow/blob/main/templates/engine/strategies/deep-research.md)、legacy plan/review 与 Grok prompts，观察到并行分析、综合和常规审查要求；在这些文件中未见个人 fork 的 ACP 原生来源、manifest/hash 与 GPT Pro 搜索门禁。这不是“全仓绝无”的证明。

模型能力说明见 [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) 和 [reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)。没有直接证明本地搜索子代理升级 Sol/max 更好的实测；用户已选择保持 Luna/high，本任务不再升级或建立模型路由系统。

## 规划检查

- `py -3.14 .trellis/scripts/task.py validate .trellis/tasks/09-30-simplify-mcp-research` 通过；该命令只校验上下文清单，inline 模式下两份 JSONL 均为 0 条，不能据此声称实现测试通过。
- `node scripts/harness-adapter.mjs context` 识别本任务及三份规划文件，状态为 `planning`，productManager 为 null。
- `node scripts/harness-adapter.mjs conflicts`：19 passed、0 blocking、0 warning、2 info；未报告阻断。该结果不证明活动安装与拟改源码已同步。
- 主代理完整复读四份 Markdown，核对用户范围、旧路径保留、配置依赖和后续验收；源码、全局配置和安装未修改。实现测试及成功 MCP 搜索验收均留待后续执行，不把本轮规划检查视为功能验收。
