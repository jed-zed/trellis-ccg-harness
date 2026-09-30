# 执行记录：MCP 调研简化

日期：2026-09-30。源码、个人配置和安装同步已完成；后续新接口的临时真实搜索通过，最新系列默认模型已保存，但常驻接口尚未切换，任务保持 `in_progress`。Boss 已追加授权推送本任务并创建 PR，发布记录见末节；前文“未推送”等表述保留为当时状态。

## 已实现

- 隔离源码：`G:/CodexWorktrees/ccg-simplify-mcp-research`，分支 `codex/simplify-mcp-research`，基线 `433081945d40ccd79720309e0ed7a101ac20fc0b`。Boss 已授权本地提交并继续安装；91 个文件已提交为 `30f57ed5a1e11d0d038634450880f9e86566c2e5`，未推送，未修改旧的脏源码工作树。
- 91 个源码文件变更：89 个 Markdown 规则、命令、策略、模板和说明，以及 2 个现有测试文件。覆盖原清单的 32 个工作流、83 个入口；旧自动 route/ACP、搜索门禁和 GPT Pro 外部情报 flags 保存在停用注释中。
- 普通流程使用现有独立调研代理与 grok-search MCP，只做必要来源核验。更新 README 中英文说明及 deep-research 指引，不再强制固定双模型调研报告。
- 保留旧 route、ACP runner、validator、manifest/hash 实现和显式旧命令；未改 Python bridge 校验实现、Provider 类型、MCP 实现或其他模型的工作契约。
- 个人 `AGENTS.md` 非受管段和 `agents/web_search.toml` 已改。仍是 `gpt-6-luna / high`、只读、无子代理；除提示外模型/权限字段解析比较完全相同。
- 使用现有 CLI 设置 `search=codex`，定点关闭 `intelligence.auto_route`。解析比较确认只有搜索角色和这一自动开关变化，其他角色及旧手动参数未变。
- 配置备份：`G:/CodexData/.codex/backups/simplify-mcp-research-20260930-execute-01`。回退时只恢复本次字段/规则，不能覆盖后续无关改动。

## MCP 诊断与未完成项

原 MCP 子进程未获得用户已有 `GROK_API_URL` 和 `GROK_API_KEY`。最终持久修改仅在已有服务加入 `env_vars = ["GROK_API_URL", "GROK_API_KEY"]`，采用 Codex 原生环境转发；未保留新增的凭据字面量，原 Tavily/Firecrawl 配置未变。这是 [Codex MCP 文档](https://developers.openai.com/codex/mcp) 支持的既有机制。

当前会话的原 MCP 进程没有热重载，仍报告 URL 缺失。另启动本机已运行版本的同一 MCP 可执行文件，使用保存的环境转发配置，得到“配置完整”，但连接测试返回 `All connection attempts failed`。已有用户环境的地址是 `http://127.0.0.1:8317/v1`；检查确认本机 8317 端口无监听服务。用户层与当前进程的这两个变量一致。已询问可用接口配置位置/服务名称，不要求在聊天里提供密钥。

测试启动器曾加 `UV_OFFLINE` 防止 uv 更新；该方式因分支引用无法离线解析而关闭，不是 MCP 搜索故障的证据。随后直接使用已运行进程对应的缓存可执行文件验证环境与连通性，未更新安装依赖或更改实际启动命令。临时探针仅位于忽略的运行目录，不属于产品实现。

因此：环境传递已验证，真实搜索仍未成功；现有 `web_search` 的端到端搜索验收待接口恢复及会话重新加载配置后进行。没有调用旧 ACP 作为补证或回退，没有改 MCP 服务端模型，也没有制造成功结果。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 六个相关测试文件 | 195 项通过，含旧手动严格校验、路由关闭、安装保持和插件分发 |
| 全量测试 | 首次 643 项断言通过但发生 Vitest `onTaskUpdate` 通信超时，整体失败；以 `pnpm test --reporter=dot --maxWorkers=2` 重跑，44 文件通过、1 文件跳过，643 项通过、3 项跳过，无未处理错误 |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | 全部通过；未更新依赖处理已有 pnpm/Browserslist 提示 |
| 构建后 CLI | `node bin/ccg.mjs --version` 返回 `ccg/3.4.15` |
| CCG 变更检查 | 通过，文档同步无问题 |
| 两个变更测试文件的质量检查 | 通过，0 error；既有长文件/复杂度等共 7 warning，未扩大范围重构 |
| 同两文件安全扫描 | 通过，0 finding；人工核对最终 MCP 配置只转发已有环境，不新增密钥副本 |
| 源码 `git diff --check` | 通过 |
| Harness conflicts | 19 passed、0 blocking、0 warning、2 info；这是当前未更新安装的状态检查 |

完整差异及原始检查日志位于忽略目录 `I:/ai/trellis-ccg-harness/.codex/ccg/simplify-mcp-research/`；`source.patch` 为本任务源码差异。此记录是本次改动交付记录，不是日常搜索的新门禁。

## 安装交接

源码、活动 CLI/plugin 和受管 AGENTS 投影现已同步；具体完成证据见下方“CLI / plugin 安装已完成”。以下保留同步过程中的交接记录。

受支持入口：`pnpm harness:update -- --ccg-commit <本任务提交> --source-checkout G:/CodexWorktrees/ccg-simplify-mcp-research`。它要求源码和目标 Harness 工作树干净；主 Harness 有既有修改，需用干净隔离工作树准备更新，不能清理或提交其他任务的改动。具体来源同步规则见 `.trellis/spec/guides/personal-source-provenance.md`。

Boss 已明确回复“授权本次本地提交，继续同步安装”，提交范围为上述独立工作树的 91 个已检查文件，不包含个人配置、密钥、缓存或其他任务，不推送。

同步工作树为 `G:/CodexWorktrees/harness-simplify-mcp-research`，分支 `codex/simplify-mcp-research-sync`，从当前活动 3.4.15 安装对应的 Harness 提交 `ab9c2597054fbafb0353024a1593fea3798a7e8d` 建立；原活动目录 `I:/ai/trellis-ccg-harness-ccg-3.4.15-final` 保留为回退来源。主工作区既有修改不纳入同步。

首次安装预检发现全局 Trellis 0.6.16 被项目资产 0.6.9 的硬版本要求阻断，同时 Git 2.56.0 在校验器隔离环境读取 `NUL` 时失败。已复现 Codex 自带 Git 2.53.0 同一调用正常，后续仅在安装子进程优先使用它；不修改全局 Git，也不改来源校验器。曾下载 npm 临时缓存中的 Trellis 0.6.9 排查，未修改全局安装；Boss 随后明确取消版本门禁，因此实际更新继续使用本机 0.6.16。

### 新增：取消 Trellis CLI 精确版本门禁

Boss 原话：“还有这个强制要求版本的门禁也要去掉”。已修改主仓的 doctor、bootstrap、installer：CLI 可用即可，不因不同于项目资产版本阻断或重装；启动提示中的旧版本不冒充实际 CLI 版本。版本仍如实展示，源码/项目资产来源记录保持真实。

两份现有测试文件 29 项通过，三个 PowerShell 文件语法通过，bootstrap 安全扫描通过。规范已同步。主仓本任务限定 6 文件提交 `683ac2e62f038fddb6883f5a2724e17d492efb97`，安装隔离分支同步提交 `afca7d7`；其他任务的修改未进入提交。

当前受支持的 `harness-lifecycle.mjs update` 正在执行来源与快照同步。完成后继续 CLI/plugin 安装及计划第 5 节验收；接口可用后完成真实独立代理调研，再决定任务完成/归档。未推送、发布或归档。

分发后的第一次全量检查有 642 项通过、1 项失败：`evidence-store.test.ts` 的 `finally` 清理临时目录报 `ENOTEMPTY`，更新器已回退到干净的原快照。该文件原样单独复跑 5 项全部通过，随后重试原更新入口，未修改测试或削弱检查。

重试又在 `command.test.ts` 的测试目录清理报同类错误；两文件单独复跑 22 项通过。尝试改变临时目录后仍复现，已撤回临时环境改动。G 盘工作树内临时目录还引入了仓库发现及非规范 ACL 的测试条件问题，因此未采用该尝试。代码核查未发现未等待的写入；具体 Windows 文件系统竞争者未确认。

最终按仓库 `codexModeSafety.test.ts` 已有做法，为上述两个文件中同类 fixture 的 11 处 `rm` 添加 Node 原生 `maxRetries: 5, retryDelay: 100`，只处理测试临时目录清理，不重试业务断言或改运行时。相关 30 项测试（含 Windows ACL）和两文件 lint 通过。此最小安装阻塞修复为本地后续提交 `ee44c00ed278115e2c7ebf343657973968301a2f`；最终同步以该提交为准，包含原功能提交 `30f57ed5`，未推送。

后续全量检查在 `grokIntelligenceRouting.test.ts` 的 `beforeEach` 重置目录再次复现 `ENOTEMPTY`；将同一测试根目录的重置/最终清理也改为相同的 Node 有限重试，所有路由断言和运行时保持不变。三个相关文件 49 项测试、lint 和差异检查通过。后续本地提交 `87592d37578193bf36c8a074e5224a4803951ce3` 是当前最终同步目标，包含前两个源码提交。未使用临时目录或线程池环境覆盖运行最终更新。

本机 `C:/Users/29933/.codex` 为指向 `G:/CodexData/.codex` 的 Junction；直接使用前者的 CCG doctor 会拒绝根目录，使用物理路径的 `CODEX_HOME` 后全部通过。插件安装脚本本身没有独立 Codex 目录参数，因此本次安装会话只为原始 `ccg.cmd` 传入正确的物理 `CODEX_HOME`，继续使用原安装器；`HomeDir` 和 Harness ownership 仍在原用户目录。预览已通过，不新增产品参数或绕过目录安全验证。

### 来源同步已完成

最终 `harness-lifecycle.mjs update` 退出码为 0，来源提交 `87592d37578193bf36c8a074e5224a4803951ce3`，树 `99621b4a0ad1ce940dd9751013e861b278711b6a`。源码及分发快照各 643 项测试通过、3 项跳过；各自 lint、typecheck、build、Go 检查通过。Harness 集成检查 458 项通过、0 失败、1 项跳过。事务为 `2026-09-30T15-14-01-357Z-db13ab14-caee-47b6-bf25-111bc6e65377`，日志为 `harness-update-stable-cleanup.log`。

104 个生成的快照/清单文件已逐项与来源提交的 Git blob 核对，差异限定于 `components/ccg-workflow/` 和 `harness.sources.json`，提交为安装分支的 `b45c2ea72141bc0fa7f36232e102e8e5971602ed`。首次用工作树字节比较时发现 CRLF/LF 差异，随后以提交中的实际 blob 比较全部通过，未改写内容以掩盖差异。

首次 bootstrap 被用户中断；继续时确认没有安装进程、pending 事务或 ownership 记录，日志停在 Python 探测。随后重新运行原受支持 bootstrap，日志另存 `bootstrap-resumed.log`。本阶段尚未据此宣称 CLI/plugin 全部完成。

### CLI / plugin 安装已完成

继续执行后，bootstrap 与插件安装均退出 0；bootstrap 明确输出 `PASS Trellis CLI 0.6.16 (project assets: 0.6.9)`，未安装或降级 Trellis。全局 CCG 3.4.15 已通过 npm 的既有打包安装流程更新。插件安装器完成原生 marketplace/plugin 同步及 `ccg codex-mode install`，输出 `.claude state: unchanged`，未新增第三方插件或执行全局初始化。

插件 ownership 已指向 `G:/CodexWorktrees/harness-simplify-mcp-research/components/ccg-workflow`。安装后 `ccg doctor --platform codex` 全部通过，无中断事务；19 个变更 CLI 模板和 68 个变更插件文件与已验证快照字节一致。个人配置解析比较确认：`web_search` 的模型/effort/权限字段与备份相同，仅开发者提示改变；CCG 配置仅搜索角色与 `auto_route` 改变；MCP 配置仅增加 Grok 既有环境变量转发，其他服务器/参数/凭据值未变。

安装日志为 `bootstrap-resumed.log`、`plugin-installed.log`。MCP 真实搜索仍未验收，最近一次端口检查仍不可连接；待 Boss 提供有效接口配置位置或恢复服务后，用新加载配置的会话完成代表性调研。旧运行文件及配置备份保留，未推送、发布或归档。

最终安装后 Harness doctor（含明确来源 checkout 校验）退出 0，日志 `doctor-after-install.log`；主项目 conflicts 为 19 passed、0 blocking、0 warning、2 info，任务 context 校验通过。个人源码与安装隔离工作树均干净。任务不调用完成/归档，因为真实搜索尚未跑通；不再重复已通过的完整测试。

### 后续：用户提供接口的临时实测通过

Boss 提供新接口并要求“先用这个测一下”。仅在新启动的同一已安装 MCP 进程中使用用户提供的局域网 API 地址（`/v1`）与本次提供的密钥；密钥经标准输入传入后用于子进程环境，没有写入配置、脚本或任务文档。全局 MCP 配置与用户环境没有切换。

`get_config_info` 的模型列表请求返回 HTTP 200。现有默认 `grok-4.20-beta` 不在返回列表中，本次临时选用列表中的 `grok-4.20-non-reasoning`；没有调用持久化模型切换工具。经该 MCP 的 `web_search` 查询 ReAct 原始论文及作者实现，返回非空正文和 3 个来源，`get_sources` 返回 arXiv、作者 GitHub 仓库与 OpenReview 链接。`web_fetch` 成功读取论文页面和仓库 README；仓库原文确认对应 ICLR 2023 论文及 HotpotQA、FEVER、ALFWorld、WebShop 实验入口。此次仅作资料发现，没有复用代码或采用论文结论。

脱敏结果位于忽略目录的 `mcp-lan-endpoint-smoke.jsonl`，临时探针为同名 `.py`。早先探针曾因控制台编码和 SDK 属性名失败，修正探针后整轮退出 0；这些失败不属于接口失败。实测没有启动旧 CLI/ACP 或生成其证据包。

状态：新接口下的临时 MCP 搜索与原文读取已成功；当前会话的常驻 MCP 仍使用原配置。尚未持久接入新地址、密钥或测试模型，也没有完成独立子代理使用新配置的验收，因此任务仍为 `in_progress`，不据临时测试宣称全局切换完成。

### 后续：按用户要求保存最新系列的默认模型

Boss 随后要求“默认使用最新的模型”。核对 xAI 当前官方模型目录列出的 Grok 4.7 与新接口模型列表：`grok-latest` 的一次直接请求返回 HTTP 502（`Upstream service temporarily unavailable`），没有据此断言它永久不可用。另以新接口和 `grok-4.7-latest` 通过已安装 MCP 完成查询，获得非空正文及原文链接，原文抓取成功；本轮结构化 `sources_count` 为 0，故不沿用上次 3 个结构化来源的结论，也不把正文链接数量冒充该字段。

通过 MCP 现有 `switch_model` 工具，将 `C:/Users/29933/.config/grok-search/config.json` 中的默认模型保存为 `grok-4.7-latest`。当前 MCP 返回切换成功，新进程在没有临时 `GROK_MODEL` 覆盖时也读到同一默认值。该请求名属于 4.7 系列，未保证未来自动跨到 4.8；第三方接口内部映射没有额外审计。独立 `web_search` 子代理仍为 `gpt-6-luna / high`。

仅模型默认值已持久化；用户上轮提供的接口地址与密钥仍只用于临时测试，未写入全局配置或用户环境。最新实测日志为忽略目录的 `mcp-latest-model-smoke.jsonl`。未修改原 MCP 实现、启用旧 CLI/ACP、提交或推送。

## GitHub 发布

Boss 原话：“那就把这次修改提交到github并且创建pr”。本次授权包含本任务提交、推送和创建 PR，不包含合并、软件发布或再次切换本机安装。

为保留原安装来源与主工作区其他任务的修改，建立独立发布工作树：CCG 为 `G:/CodexWorktrees/ccg-simplify-mcp-research-pr`，Harness 为 `G:/CodexWorktrees/harness-simplify-mcp-research-pr`。CCG 合入当前个人仓库 main 的 PID 测试修复；Harness 从最新 main `2ffd604` 建立，移植本任务 Trellis CLI 版本门禁修复为 `1d7f95f`，再使用受支持更新入口生成快照。没有手工覆盖 main 的进程识别或其他修复。

首轮发布验证因误给测试子进程设置真实 `CODEX_HOME`，使隔离 fixture 读写了个人配置，导致 3 项测试失败。已去掉该环境覆盖，并用既有 CLI 恢复 `search=codex` 与 `intelligence.auto_route=false`；解析核对其余配置字段未改变。随后同一源码全量测试 643 项通过、3 项跳过。安装路径所需的物理 `CODEX_HOME` 不再注入测试环境。

CCG PR 初次 CI 的 Ubuntu 22 依赖审计报告 `smol-toml 1.7.0` 高危拒绝服务漏洞（GHSA-7w5x-hrqm-74c2）；只更新该包及锁文件到 `1.7.1`，未扩大依赖升级或取消审计。补丁提交为 `012eb767bf9bf3e095b34c37b76b7c259f831322`。生产依赖审计通过；正常 TOML 与公告畸形输入的原生断言通过，3 个相关配置测试文件共 41 项通过。

初次 Windows 22 CI 另有 1 项锁文件打开 `EPERM`；后续运行没有再出现该错误，未据单次失败扩大锁实现改动。安全补丁后的 Ubuntu 20/22、Windows 20 和两平台 Go 检查通过；Windows 22 的 643 项断言全部通过，但 Vitest `onTaskUpdate` 通信超时使整体失败。将 Windows CI 的覆盖率测试参数对齐到 Harness 已验证的 `--testTimeout 60000 --no-file-parallelism --pool threads`，保留全部测试、断言与覆盖率，提交为 `0db56ce075d3fae951252a294382dfd86b586ed8`。

补丁前的快照验证已主动中止并由原更新器回退，确认目标工作树干净、事务锁与 journal 无残留后，以最终提交重新同步。第二轮在源码验证阶段中止以纳入 CI 参数变更，尚未修改快照。未把这两次主动取消记录为测试通过，也未跳过最终来源同步流程。

后续本机同步在 `installerMcpOwnership.test.ts` 的统一 `afterEach` 清理再次复现 `ENOTEMPTY`。只将该 fixture 的 `rm` 对齐到现有 `maxRetries: 5, retryDelay: 100`，15 项相关测试及 lint 通过；提交为 `3b3457c37e7af8bb86a6f506db67363e397d2693`。业务断言及 MCP 安装运行时未改。

CCG 最终提交 `3b3457c` 的 GitHub CI run `36749712966` 全部 6 项通过，包括 Ubuntu/Windows × Node 20/22、生产依赖审计、安装验收与两平台 Go 检查。本地同一源码 643 项通过、3 项跳过，lint/typecheck/build 通过。

最终快照更新成功，更新器退出 0，来源为 `3b3457c37e7af8bb86a6f506db67363e397d2693`、Git tree 为 `835d4df1d02d4806ba2a68883b0fe129ac73be61`。源码与快照各 643 项通过、3 项跳过，各自 lint/typecheck/build、Go test/build 通过；Harness 集成测试 464 项通过、0 失败、1 项跳过。事务 `2026-09-30T17-20-34-972Z-5b61a98f-db9d-4124-8f5d-7f82f743722e` 完成，无 pending journal 或锁残留。完整日志为忽略目录中的 `pr-final-source-update-v3.log`。

CCG PR：https://github.com/jed-zed/ccg-gptpro-worflow/pull/50 。Harness PR：https://github.com/jed-zed/trellis-ccg-harness/pull/52 。发布快照与本任务文档进入后者；后续 GitHub CI 以 PR 当前提交的检查状态为准。个人模型配置、接口、密钥和忽略目录中的运行日志均不进入 PR。8 个任务文档已通过凭据及私有端点模式检查；最终 CCG 提交范围检查未发现无关文件。两个 PR 未合并，本机安装仍保持先前已验证版本，任务未完成或归档。
