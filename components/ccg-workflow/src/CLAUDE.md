# src (CCG TypeScript CLI)

> [根目录](../CLAUDE.md) > **src**

**Last Updated**: 2026-07-24 (v3.3.0)

---

## 变更记录

### 2026-07-22 (v3.3.0)
- 新增 `commands/grok.ts`、Grok doctor 分层和 `external_intelligence` opt-in 配置迁移。
- 安装器分发独立的 Grok ACP runtime、fixtures、commands 与 skills；generic Grok backend 由 codeagent-wrapper v5.12.2 处理。
- Grok 情报登录默认走浏览器 OAuth；无头 CI 可显式提供 `XAI_API_KEY`，live smoke 仅手动触发。

### 2026-07-24（v3.3.0 安全复审加固）
- Wrapper 仅接受个人仓库 Release，并在首次执行前校验固定 SHA-256；所有可执行 npm/Git 来源写入 `third-party-sources.json`。
- Codex 模式改为托管区块、结构化 Hook 合并和摘要绑定所有权清单；安装/卸载不再覆盖无关全局文件。
- MCP 密钥改由 owner-only spec + 本地 launcher 注入；损坏配置关闭式失败，禁止跨运行时复制密钥。
- `diagnose-mcp --smoke` 新增显式、有界、脱敏的 stdio 初始化握手和进程树清理。
- 内置公开 npm 自更新已禁用；个人发行版只能由 Harness 使用完整 commit 执行事务式更新。

---

## 模块职责

`src/` 是 CCG Workflow CLI 工具的全部 TypeScript 实现。负责：一键安装/更新 CCG 工作流到用户环境 (`~/.claude/`)，从 `templates/` 读取素材并经过模板变量替换后写入目标位置，管理 MCP 服务配置（Claude/Codex/Gemini 三端同步），提供中英双语交互界面，通过 Skill Registry 从 SKILL.md frontmatter 自动生成 slash commands，以及管理 Grok 外部情报层的用户同意、隔离登录、doctor 和 runtime 分发。

打包产物由 `unbuild` 输出到 `dist/`，由 `bin/ccg.mjs` 加载，通过 `npx ccg-workflow` 或 `npx ccg-workflow menu` 调用。

---

## 入口与启动

| 文件 | 角色 |
|------|------|
| `src/cli.ts` | CLI 主入口，创建 `cac('ccg')` 实例，调用 `setupCommands()` 注册命令，然后 `cli.parse()` |
| `src/cli-setup.ts` | 命令注册层，读取 `~/.claude/.ccg/config.toml` 初始化语言，为每个命令绑定 action |
| `src/index.ts` | 库导出入口，聚合所有公开 API 供外部程序调用 |
| `dist/` | `unbuild` 产物，`cli.mjs` + `index.mjs` 各一份 |
| `bin/ccg.mjs` | npm bin 脚本，加载 `dist/cli.mjs` |

**启动链**：`npx ccg-workflow` → `bin/ccg.mjs` → `dist/cli.mjs` → `cli.ts:main()` → `setupCommands()` → `cli.parse()`

---

## 对外接口

### CLI 命令（`src/cli-setup.ts`）

| 命令 | 别名 | 说明 | 实现文件 |
|------|------|------|----------|
| `ccg` (默认) | — | 显示交互式菜单 | `commands/menu.ts:showMainMenu()` |
| `ccg init` | `ccg i` | 4 步交互安装向导 | `commands/init.ts:init()` |
| `ccg diagnose-mcp [--smoke]` | — | 静态诊断 MCP；显式 `--smoke` 执行有界 stdio 初始化握手 | `commands/diagnose-mcp.ts:diagnoseMcp()` |
| `ccg fix-mcp` | — | 修复 Windows MCP 配置 | `commands/diagnose-mcp.ts:fixMcp()` |
| `ccg config mcp` | — | 配置 MCP Token | `commands/config-mcp.ts:configMcp()` |
| `ccg doctor` | — | 安装健康检查；`--grok` 本地诊断，`--grok-live` 显式付费 Web/X smoke | `commands/doctor.ts:doctor()` |
| `ccg status` | — | 安装、路由和任务概况 | `commands/doctor.ts:status()` |
| `ccg grok login\|status\|logout` | — | 管理隔离 Grok 情报配置的浏览器登录 | `commands/grok.ts:grokAccount()` |

**全局选项**：`--lang/-l`（覆盖语言）、`--force/-f`（强制覆盖）、`--skip-prompt/-s`（非交互模式）、`--frontend/-F`、`--backend/-B`、`--mode/-m`、`--install-dir/-d`

### 库导出 API（`src/index.ts`）

```typescript
// 类型
export * from './types'

// 命令
export { init } from './commands/init'
export { showMainMenu } from './commands/menu'
export { update } from './commands/update'

// 国际化
export { i18n, initI18n, changeLanguage } from './i18n'

// 配置管理
export { readCcgConfig, writeCcgConfig, createDefaultConfig, ... } from './utils/config'

// 安装器
export { getWorkflowConfigs, installWorkflows, installAceTool, ... } from './utils/installer'

// 迁移 + 版本
export { migrateToV1_4_0, needsMigration } from './utils/migration'
export { getCurrentVersion, checkForUpdates, compareVersions } from './utils/version'
```

---

## 源码结构

### commands/（7 文件）

| 文件 | 核心函数 | 职责 |
|------|----------|------|
| `init.ts` | `init(options)` | 4 步安装向导（API 提供方→模型路由→MCP 工具→性能模式），orchestrate installWorkflows |
| `menu.ts` | `showMainMenu()` | ASCII Art 主菜单，CJK 宽度感知对齐，6 功能选项循环 |
| `update.ts` | `update()` | 拒绝公开 npm 自更新，要求由 Harness 使用个人仓库完整 commit 事务式更新 |
| `config-mcp.ts` | `configMcp()` | 独立 MCP Token 配置交互 |
| `diagnose-mcp.ts` | `diagnoseMcp()`, `fixMcp()` | 诊断 `~/.claude.json` MCP 配置；可选有界 stdio smoke；Windows 修复 |
| `doctor.ts` | `doctor()`, `status()` | 安装健康检查、本地 Grok ACP 检查、显式 live smoke 和证据保留诊断 |
| `grok.ts` | `grokAccount()` | 调用分发的 Grok manager 管理隔离登录，不复用项目或全局 MCP 配置 |

**`init.ts` 安装流程**（`src/commands/init.ts:152`）：

```
Step 0: 语言选择（首次/已保存跳过）
Step 1/4: API 提供方（官方 / 第三方 / 302.AI）
Step 2/4: 模型路由（Frontend: Gemini|Codex, Backend: Codex|Gemini, Gemini 型号）
Step 3/4: MCP 工具多选（ace-tool ✓, context7 ✓, fast-context, grok-search, contextweaver）
Step 4/4: 性能模式（standard|lite）+ Impeccable 可选安装
→ 安装摘要确认 → installWorkflows() → MCP 安装 → permissions.allow → context7 → MCP 三端同步
```

**`menu.ts` CJK 对齐**（`src/commands/menu.ts:29`）：`visWidth()` 函数对 CJK 字符计宽 2，emoji 和全角符号同理，`pad()` 基于此对齐菜单列。

### Grok 外部情报 runtime（v3.3.0）

- `templates/engine/tools/grok-intelligence/` 是唯一 runtime 源，安装时复制到 `~/.claude/.ccg/engine/tools/grok-intelligence/`，并与 `plugins/ccg/skills/ccg-grok-intel/scripts/` 保持内容一致。
- `ccg grok login` 使用专用本地根目录启动官方 Grok CLI 浏览器 OAuth；凭据不写入仓库或 evidence bundle。
- `ccg doctor --grok` 只做本地版本、ACP、模型、登录与保留检查；只有 `--grok-live` 才允许实际 Web/X 模型调用。
- CI 的 live workflow 只能手动触发，并把 `XAI_API_KEY` 限定在 live 步骤；常规 CI 不需要 Grok 凭据。
- 情报层固定空 MCP、取消权限请求、禁用 terminal 命令并禁止 provider fallback；这些约束与 generic `--backend grok` 路由相互独立。

---

### utils/installer.* 重构后架构（v1.7.83）

v1.7.83 将原 1878 行单文件拆分为 5 个聚焦模块，各自边界清晰：

| 文件 | 职责 | 核心导出 |
|------|------|----------|
| `installer.ts` | 主入口 + binary 管理，re-export 子模块所有公共 API | `installWorkflows()`, `uninstallWorkflows()`, `verifyBinary()`, `EXPECTED_BINARY_VERSION` |
| `installer-data.ts` | 命令注册表（唯一真相源），`cmd()` builder | `getAllCommandIds()`, `getWorkflowById()`, `WORKFLOW_CONFIGS` |
| `installer-template.ts` | 模板变量替换，PACKAGE_ROOT 解析，MCP provider 注册表 | `injectConfigVariables()`, `replaceHomePathsInTemplate()`, `PACKAGE_ROOT` |
| `installer-mcp.ts` | MCP 服务安装（ace-tool / fast-context / contextweaver / 通用） | `installAceTool()`, `installFastContext()`, `syncMcpToCodex()`, `syncMcpToGemini()` |
| `installer-prompt.ts` | fast-context 搜索引导 Prompt 管理 | `writeFastContextPrompt()`, `removeFastContextPrompt()` |

复审后新增的安全边界模块：

| 文件 | 职责 |
|------|------|
| `codex-mode.ts` | 托管区块、Hook 结构化合并、碰撞备份、所有权摘要和安全卸载 |
| `mcp-secrets.ts` | owner-only MCP secret spec 和无密钥 argv 的 launcher 配置 |
| `mcp-smoke.ts` | 显式、有界、脱敏的 MCP stdio `initialize` 握手及进程树清理 |
| `python-resolver.ts` | 跨平台解析 Python 3.9+，支持 `python3` / `python` / `py -3` |
| `third-party-sources.ts` | 校验 `third-party-sources.json` 的精确版本、commit 和 integrity |

**`installWorkflows()` 执行链**（`src/utils/installer.ts:659`）：

```
验证 templateDir 存在
→ ensureDir (commands/ccg, .ccg, .ccg/prompts)
→ installCommandFiles()      # templates/commands/*.md → ~/.claude/commands/ccg/
→ installAgentFiles()        # templates/commands/agents/*.md → ~/.claude/agents/ccg/
→ installPromptFiles()       # templates/prompts/{codex,gemini,claude}/ → ~/.claude/.ccg/prompts/
→ installSkillFiles()        # templates/skills/ → ~/.claude/skills/ccg/（递归拷贝 + 路径替换）
→ installSkillGeneratedCommands()  # Skill Registry → 生成额外 slash commands
→ installRuleFiles()         # templates/rules/*.md → ~/.claude/rules/
→ installBinaryFile()        # 下载 codeagent-wrapper（双源）
→ 后置校验: installedCommands.length > 0
```

#### Binary 管理（`src/utils/installer.ts:61`）

```typescript
const EXPECTED_BINARY_VERSION = '5.12.2'  // 必须与 codeagent-wrapper/main.go 中 version 常量保持一致

// 唯一可执行来源：个人仓库 preset Release
const BINARY_SOURCES = [
  { name: 'Personal GitHub Release', url: 'https://github.com/jed-zed/.../releases/download/preset', timeoutMs: 120_000 },
]
```

- 已安装二进制必须先匹配当前平台的固定 SHA-256，之后才允许执行 `--version`。
- 下载候选保持不可执行权限；SHA-256 匹配后才 `chmod`、执行版本检查并原子替换。
- 使用 `curl`（自动读取系统代理）下载，缺失时降级 Node.js `fetch`；不启用镜像或 provider fallback。
- 下载、摘要或版本失败都会进入安装错误集合并使最终安装结果失败。

⚠️ **版本同步铁律**：修改 Go 代码时必须同步更新 `EXPECTED_BINARY_VERSION` 和 `codeagent-wrapper/main.go` 中的 `version`，两值必须一致，否则 `update` 不会触发 binary 重新下载。

---

### utils/skill-registry.ts（v2.0.0 核心创新）

**设计理念**：新增技能 = 只写一个 SKILL.md，零代码改动，自动生成 slash command。

**工作流程**（`src/utils/skill-registry.ts`）：

```
1. parseFrontmatter(content)          # 解析 SKILL.md 中 ---...--- YAML 块
      ↓ name, description, user-invocable, allowed-tools, argument-hint, aliases
2. collectSkills(skillsDir)           # 递归扫描 templates/skills/，每 SKILL.md → SkillMeta
3. collectInvocableSkills()           # 过滤 userInvocable=true
4. generateCommandContent(skill)      # 生成 ~/.claude/commands/ccg/{name}.md
5. installSkillCommands()             # 跳过 installer-data.ts 已有的命令名，避免冲突
```

**SkillMeta 关键字段**（`src/utils/skill-registry.ts:21`）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `name` | `string` | kebab-case slug，即 slash command 名 |
| `userInvocable` | `boolean` | 是否自动生成 slash command（默认 false）|
| `category` | `SkillCategory` | `tool` / `domain` / `orchestration` / `impeccable` / `root` |
| `runtimeType` | `SkillRuntimeType` | `scripted`（有 scripts/*.js）或 `knowledge`（纯 Markdown）|
| `relPath` | `string` | 相对 skills 根目录的路径，决定 category 推断 |

**生成规则**：
- `knowledge` 技能 → 生成 "读取 SKILL.md 按指导完成任务" 的命令内容
- `scripted` 技能 → 生成 `node run_skill.js {name} $ARGUMENTS` 的命令内容
- 每个生成的 command 文件**必须含 YAML frontmatter**，缺失会导致 CC 命令索引级联失败（v2.1.1 修复）
- `skipCategories` 参数支持跳过 `impeccable` 分类（用户可选不安装）

---

### utils/mcp.ts 三端同步

MCP 配置需要在三个工具链同步：

| 工具 | 配置文件 | 同步函数 |
|------|----------|----------|
| Claude Code | `~/.claude.json` | `writeClaudeCodeConfig()` / `mergeMcpServers()` |
| Codex | `~/.codex/config.toml` | `syncMcpToCodex()`（`installer-mcp.ts`）|
| Gemini | `~/.gemini/settings.json` | `syncMcpToGemini()`（`installer-mcp.ts`）|

带密钥的 MCP 不再把密钥放进 `args` 或镜像到其他运行时。安装器将真实子进程配置写入
`~/.claude/.ccg/secrets/<server>.json`（owner-only），公开 MCP 配置只调用
`mcp-secret-launcher.mjs`。遇到无法安全迁移的旧式 argv token 配置时关闭式失败。

**`installer-mcp.ts:configureMcpInClaude()` 管线**（`src/utils/installer-mcp.ts:21`）：
```
readClaudeCodeConfig() → backupClaudeCodeConfig() → mergeMcpServers() → fixWindowsMcpConfig() → writeClaudeCodeConfig()
```

**Windows 兼容层**（`src/utils/mcp.ts:87`）：`applyPlatformCommand()` 将 `npx`/`uvx` 命令包装为 `cmd /c npx/uvx`；`repairCorruptedMcpArgs()` 检测并修复 `cmd` 重复、`npx npx` 重复等损坏格式（幂等操作）。

---

### utils/version.ts binary 管理

| 函数 | 说明 |
|------|------|
| `getCurrentVersion()` | 读取 `../../package.json`（相对 dist/src 路径），fallback PACKAGE_ROOT 和 `npm_package_version` |
| `getLatestVersion(pkg)` | 执行 `npm view ccg-workflow version` 获取 npm 最新版 |
| `compareVersions(v1, v2)` | semver 比较，返回 1/-1/0 |
| `checkForUpdates()` | 组合上两者，返回 `{ hasUpdate, currentVersion, latestVersion }` |

---

### i18n/（`src/i18n/index.ts`）

基于 `i18next`，支持 `zh-CN`（默认）和 `en` 双语。

```typescript
export const i18n = i18next

export async function initI18n(lang: SupportedLang): Promise<void>  // 初始化/切换语言
export async function changeLanguage(lang: SupportedLang): Promise<void>
```

**运行时语言选择**：`cli-setup.ts` 在命令注册前先读 `config.toml` 中的 `general.language`，首次安装无配置时 `init.ts` 通过 `inquirer` 让用户选择，之后持久化到 `~/.claude/.ccg/config.toml`。

---

### types/（`src/types/index.ts`）

| 类型 | 用途 |
|------|------|
| `SupportedLang` | `'zh-CN' \| 'en'` |
| `ModelType` | `'codex' \| 'gemini' \| 'claude'` |
| `CollaborationMode` | `'parallel' \| 'smart' \| 'sequential'` |
| `RoutingStrategy` | `'parallel' \| 'fallback' \| 'round-robin'` |
| `ModelRouting` | 前端/后端/review 的模型列表 + 策略 + Gemini 型号 |
| `CcgConfig` | 完整配置结构（general + routing + workflows + paths + mcp + performance）|
| `WorkflowConfig` | 单个工作流定义（id, name, commands[], category, order）|
| `InitOptions` | `init()` 函数参数（lang, skipPrompt, skipMcp, force, frontend, backend, ...）|
| `InstallResult` | 安装结果（installedCommands[], installedPrompts[], installedSkills, errors[]）|
| `AceToolConfig` | `{ baseUrl, token }` |
| `FastContextConfig` | `{ apiKey?, includeSnippets? }` |

---

### utils/installer-template.ts — 模板变量系统

`injectConfigVariables()` 在安装时将模板占位符替换为用户配置值（`src/utils/installer-template.ts:64`）：

| 占位符 | 替换为 | 说明 |
|--------|--------|------|
| `{{FRONTEND_PRIMARY}}` | `gemini` / `codex` | 前端主模型 |
| `{{BACKEND_PRIMARY}}` | `codex` / `gemini` | 后端主模型 |
| `{{FRONTEND_MODELS}}` | JSON 数组 | 前端模型列表 |
| `{{BACKEND_MODELS}}` | JSON 数组 | 后端模型列表 |
| `{{REVIEW_MODELS}}` | JSON 数组 | 审查模型列表 |
| `{{GEMINI_MODEL_FLAG}}` | `--gemini-model xxx ` 或 `""` | v2.1.14 修复：安装时替换，不留到运行时 |
| `{{LITE_MODE_FLAG}}` | `--lite ` 或 `""` | 轻量模式标志 |
| `{{MCP_SEARCH_TOOL}}` | `mcp__ace-tool__search_context` 等 | MCP provider 注册表驱动 |

**PACKAGE_ROOT 解析**（`src/utils/installer-template.ts:17`）：从 `__dirname` 向上最多遍历 10 层，找到包含 `package.json` **且** `templates/` 目录的路径。深度从 5 扩展到 10 是为了兼容 Windows npm 缓存深层路径（`AppData\Local\npm-cache\_npx\<hash>\node_modules\...`）。

---

## 构建管线

```bash
# 类型检查（发版必过，tsc --noEmit）
pnpm typecheck

# 构建（unbuild → dist/cli.mjs + dist/index.mjs，inline 所有依赖）
pnpm build

# 测试（130+ 用例）
pnpm test

# 发布
npm publish
```

**build.config.ts**：
```typescript
defineBuildConfig({
  entries: ['src/cli', 'src/index'],  // 双入口：CLI + 库
  declaration: true,                   // 生成 .d.mts 类型文件
  clean: true,
  rollup: {
    emitCJS: false,          // 纯 ESM 输出（package.json "type": "module"）
    inlineDependencies: true, // 打包所有依赖为单文件，无需 node_modules 即可运行
  },
})
```

**为什么选 unbuild**：零配置，自动处理 ESM 输出；`inlineDependencies: true` 使 `bin/ccg.mjs` 在 `npx` 调用时无需额外安装依赖，减少 npx 首次运行等待时间，也避免 Windows 上 node_modules 路径过长问题。

**package.json `files` 白名单**：精确列出所有 `templates/commands/*.md`、`templates/prompts/`、`templates/skills/`、`dist/`、`bin/ccg.mjs`，npm 包从 16.3MB 压缩到 161KB（binary 单独通过 GitHub Release 下载，不打入 npm 包）。

---

## 依赖关系

| 包 | 版本 | 用途 |
|----|------|------|
| `cac` | `^6.7.14` | CLI 框架，`cli-setup.ts` 命令注册 |
| `inquirer` | `^12.9.6` | 交互式提示（list/checkbox/password/confirm） |
| `ora` | `^9.0.0` | 终端 spinner，安装过程进度展示 |
| `ansis` | `^4.1.0` | 终端颜色，零依赖替代 chalk |
| `fs-extra` | `^11.3.2` | `ensureDir`, `pathExists`, `copy` 等便捷 fs 操作 |
| `smol-toml` | `^1.4.2` | 解析 `~/.codex/config.toml`（Codex MCP 同步） |
| `i18next` | — | 国际化框架 |
| `pathe` | — | 跨平台路径操作（统一用 `/` 分隔符，避免 Windows `\` 问题）|

---

## 测试覆盖

`src/utils/__tests__/` 下 6 个测试文件，130+ 用例：

| 测试文件 | 覆盖内容 |
|----------|----------|
| `version.test.ts` | `getCurrentVersion`, `compareVersions`, `checkForUpdates` |
| `config.test.ts` | `readCcgConfig`, `writeCcgConfig`, `createDefaultConfig` |
| `platform.test.ts` | `isWindows`, `getMcpCommand` 跨平台行为 |
| `installer.test.ts` | `installWorkflows` 主流程，template 变量完整性检查 |
| `installWorkflows.test.ts` | 安装结果验证，error 处理路径 |
| `injectConfigVariables.test.ts` | 所有模板占位符替换正确性 |

---

## 关键设计决策

1. **installer 拆 5 模块**（v1.7.83）：单文件 1878 行超出可维护阈值。拆分边界按职责：数据（命令表）/ 模板（变量替换）/ MCP（网络操作）/ prompt（规则文件）/ 主入口（binary + 组合调用）。所有公共 API 统一从 `installer.ts` re-export，调用方无需感知拆分。

2. **Skill Registry frontmatter 驱动**（v2.0.0）：新增技能不需要改 TypeScript 代码，只需写 SKILL.md 并设 `user-invocable: true`。降低贡献门槛，保持命令生成逻辑集中在一处。

3. **binary 不打入 npm 包**（v1.7.77）：npm 包从 16.3MB 降至 161KB，CI 交叉编译后上传 GitHub Release，安装时按需下载。双源（Cloudflare CDN 优先）解决中国用户网络问题。

4. **permissions.allow 替代 Hook**（v1.7.89+）：早期用 PreToolUse Hook + jq 实现 codeagent-wrapper 自动授权，依赖 jq 可用性。改为 `permissions.allow: ["Bash(*codeagent-wrapper*)"]` 后跨平台统一，无外部依赖，且可幂等写入。

5. **`pathe` 替代 Node `path`**：统一路径分隔符为 `/`，避免 Windows `\` 导致的路径字符串比较/替换 bug，对模板路径注入尤为重要。
