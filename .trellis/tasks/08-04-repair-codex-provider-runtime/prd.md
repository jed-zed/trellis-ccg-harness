# 修复 Codex CCG Provider 运行链

## 目标

恢复个人 CCG 在 Codex-native 模式下对外部 Provider 的完整可执行链：受管理地安装并调用 `codeagent-wrapper`，使 Antigravity 默认自动打开 Web UI，并让 routing、doctor、Provider 能力声明、Pi 发布包和真实验收保持一致。

## 背景与确认事实

- 原版与个人版的 `codeagent-wrapper` 均包含 Web UI、SSE、session resume 和 `--parallel`；个人源码中的 Go 测试通过。
- 当前 Codex Skill 要求 `antigravity` / `grok` 使用 wrapper，但 `installCodexModeAt` 没有为 `CODEX_HOME` 安装 wrapper。
- 当前 `ccg doctor --platform codex` 只验证路由配置可解析；`frontend=antigravity` 时即使 wrapper 不存在仍会报告全绿。
- 当前个人源码注册 `codex/gemini/claude/antigravity/grok/pi`，但运行适配器和项目政策不允许所有 Provider 承担所有角色。
- Pi backend 已由任务 `08-03-pi-selectable-orchestrator` 实现；本任务不重复实现，只完成能力约束、发布同步和端到端闭环。
- `I:\ai\ccg-gptpro-worflow` 是权威个人源仓库；`components/ccg-workflow` 是 `harness.sources.json` 绑定的验证快照，不是直接运行时。

## 范围内需求

### R1. Codex-owned wrapper 安装

- 复用现有 pinned release、SHA-256、版本检查、候选文件原子提升和失败保留旧版本的实现，不创建第二套下载器。
- 将 wrapper 作为 Codex-mode 事务和 ownership 的受管理文件，目标为 `<CODEX_HOME>/ccg/bin/codeagent-wrapper[.exe]`。
- install、update、uninstall、recover 均覆盖该文件；只删除 ownership digest 匹配的未修改文件。
- 保留 legacy `~/.claude/bin/codeagent-wrapper`，不得迁移、覆盖或删除。

### R2. 稳定调用入口与 Web UI 默认行为

- 新增窄范围 CLI 入口 `ccg wrapper`，只负责解析 Codex-owned wrapper 并以参数数组/标准输入安全转发现有 wrapper 调用。
- Codex Skills 对 wrapper-backed Provider 使用 `ccg wrapper --backend <provider>`，不猜测 HOME、扩展名或 shell 路径。
- wrapper 默认保持非 `--lite`，因此 Antigravity 自动启动 loopback Web UI 并打开浏览器；显式 lite/headless 配置仍可关闭页面。
- 不改写现有 Go Web UI、SSE、resume 或 parallel 实现。

### R3. Provider-role 能力矩阵

- 将“已注册 Provider”“角色允许 Provider”“本机 adapter 可用”分成三个明确概念。
- 静态允许矩阵：
  - `frontend` / `backend`：`codex`、`gemini`、`antigravity`、`grok`、`pi`；
  - `search`：`codex`、`grok`；
  - `product-manager`：`codex`、`gemini`、`claude`。
- ordinary Claude delegation 继续禁止；不得通过 frontend/backend/search 绕过 product-manager 边界。
- `ccg routing set` 对不兼容组合 fail closed，并返回角色及允许 Provider；不得静默 fallback。
- 现有不兼容配置不得被自动改写，doctor 应报告明确修复命令。

### R4. Route-aware doctor

- Codex doctor 同时检查静态角色兼容性、所需 adapter、Codex-owned wrapper 完整性/版本，以及当前选中外部 CLI 的可发现性。
- 选中且启用的 Provider 不可运行时必须非零退出，不得显示 `All Codex checks passed`。
- 可选但被显式禁用的 Grok intelligence 显示为 inactive/warning，不冒充可运行，也不阻塞普通 Codex 工作。
- Codex-mode 检测到 wrapper 缺失时，修复建议必须指向 `ccg codex-mode install`/repair 路径，不得建议 legacy `ccg init --force`。

### R5. Pi 与发布包同步

- 以当前 Harness 记录的个人源 commit/tree 为功能基线，在个人源仓库的隔离分支/worktree 中开发，保留现有 Pi backend。
- 发布新 patch 版本 `3.4.6`，同步 npm 包、Codex plugin/marketplace、CHANGELOG、wrapper digest/version契约。
- 只有在个人源提交完成并获批后，才把干净 tracked tree 导入 Harness 快照并刷新 `harness.sources.json`。
- 个人源、Harness 快照、manifest、构建包和已安装 CLI/plugin 必须作为耦合事务验证；发布、推送和本机安装仍需各自的显式授权门禁。

### R6. 端到端验收

- 默认 CI 使用 isolated HOME/CODEX_HOME 和 fake `agy`/`grok`/`pi` CLI，不调用网络、登录或付费模型。
- E2E 覆盖：Codex-mode install/update/uninstall/recover、wrapper 路径与 ownership、routing set/get、doctor、Antigravity Web UI URL/browser opener、Pi/Grok 调用、resume、parallel、错误退出和 clean-home `.claude` 零依赖。
- 真实 Antigravity/Grok/Pi smoke 保留为显式人工门禁；没有授权不得安装 Provider、登录或发模型请求。

### R7. Grok 证据模式分流

- 纯本地代码审查只使用绑定的 diff、源码、测试、CI 和本地只读 Provider 证据，不调用 Grok external-intelligence，也不启用官方域名门禁。
- 只有结论依赖当前外部 API、版本、公告、事故或其他外部事实时，才进入 Grok external-intelligence。
- 外部事实 `verify` 必须由 CCG/Codex 在 Provider 调用前根据明确核验对象或可信包/仓库元数据声明至少一个官方域名；Grok 返回的域名不得反向成为自己的白名单。
- 缺少可信官方域名时必须在付费搜索前明确失败；已声明域名同时进入搜索提示、缓存指纹和证据清单。

## 约束

- Trellis 是唯一任务、需求、设计和计划权威；CCG `.ccg/` / `.codex/ccg/` 只存运行证据。
- Codex 是唯一真实工作区写入者；外部 Provider 只读。
- wrapper 只绑定 `127.0.0.1`，不得扩大监听范围。
- 不修改用户现有 routing 默认值，不自动启用 Grok，不复制任何凭据。
- 权威个人 CCG 源先改、先测、先提交；Harness 只导入干净的已提交 tracked tree。

## 验收标准

- [x] 新的 clean Codex-mode 安装在 `<CODEX_HOME>/ccg/bin/` 产生 digest/version 正确的 wrapper，并由 ownership/transaction 管理。
- [x] 重复安装幂等；失败升级保留旧 binary；uninstall/recover 只恢复或删除任务拥有的 bytes。
- [x] `ccg wrapper --backend antigravity` 使用安全 argv/stdin 调用受管理 binary，默认不注入 `--lite`。
- [x] fake Antigravity E2E 捕获 `http://127.0.0.1:<port>` 并确认 browser opener 被调用。
- [x] `frontend=antigravity` 且 wrapper 缺失/损坏时，`ccg doctor --platform codex` 非零退出并给出 Codex-mode 修复命令。
- [x] 每个角色只接受 R3 矩阵中的 Provider；不兼容的已有配置被明确拒绝且不被重写。
- [x] product-manager 仍只允许 `codex/gemini/claude`；ordinary Claude 不能通过其他角色执行。
- [x] Pi 已进入 `3.4.6` 构建包和已安装 runtime；不改变当前四角色默认值，也不自动调用 Pi。
- [x] fake Grok/Pi E2E 验证 stdin、cwd、session resume、失败状态和 parallel；不发生网络请求。
- [x] clean-home 测试证明 Codex 路径不创建或依赖 `.claude/`。
- [x] focused tests、CCG lint/typecheck/test/build、Go test/build、Harness tests、source verification、doctor、conflicts 和安全检查全部通过。
- [x] 纯本地 `/ccg:review` 不运行 external-intelligence；外部事实 `verify` 缺少预声明官方域名时在 Grok 调用前失败，提供域名时会定向搜索并记录该策略。

## 不在范围内

- 重写 wrapper Web UI、SSE、parser 或并发调度器。
- 给 product-manager 新增 Antigravity/Grok/Pi adapter。
- 安装或登录 Antigravity、Grok、Pi，改变默认 Provider，或执行付费模型调用。
- 恢复 legacy Claude Lead、普通 Claude delegation 或 `.claude` runtime 依赖。
- 自动 commit、push、PR、npm publish 或更新全局安装；这些动作保留独立授权门禁。
