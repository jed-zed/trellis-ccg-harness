# CCG 实施计划：修复 Codex CCG Provider 运行链

**生成者**：Codex CCG Planner  
**任务类型**：工具链 / 后端 / 安全边界  
**计划路径**：`.trellis/tasks/08-04-repair-codex-provider-runtime/implement.md`  
**职责 Providers**：`backend=codex`  
**外部证据**：`backend=inline-codex + 3 个 default 只读探子`  
**Claude 产品经理**：M1 `PLAN_REVIEW` 与 `MILESTONE_REVIEW` 已由本机 Claude Code `opus` 接受，Boss 已验收通过；`FINAL_REVIEW` 待执行

## 1. 计划决策摘要

- Trellis 覆盖 `ccg:plan` 默认 `.codex/ccg/plans` 路径，避免双计划权威。
- 复用 verified binary installer；不重写下载或 Web UI。
- wrapper 放入 `<CODEX_HOME>/ccg/bin`，通过 `ccg wrapper` 稳定调用。
- routing 使用共享静态 capability matrix；doctor 单独检查运行可用性。
- Pi backend 复用现有任务成果，只做发布/安装同步。
- 发布版本使用 `3.4.6`；commit、push、publish、全局安装均保留独立授权门禁。

## 2. WBS 实施步骤

### 模块 A：个人源基线与失败回归（3 点）

- [x] **A.1** 从经验证包含批准基线的个人 CCG 隔离 worktree 开始；确认 clean、remote 和 wrapper `5.12.5` digest。
- [x] **A.2** 先添加失败测试：Codex-mode 未安装 wrapper、Antigravity route doctor 假绿、unsupported role/provider 被接受、installed package 缺 Pi、clean-home 无真实 provider seam。
- [x] **A.3** 记录旧 `3.4.5` package/plugin/manifest bytes，建立安装和发布回滚点。

### 模块 B：Codex-owned wrapper 与 CLI shim（8 点）

**主要文件**：`src/utils/installer.ts`、`src/utils/codex-mode.ts`、`src/cli-setup.ts`、`src/commands/wrapper.ts`、`plugins/ccg/skills/ccg-executor/SKILL.md`

- [x] **B.1** 抽取并复用 verified wrapper 安装函数，参数化目标目录；保持 legacy installer 行为不变。
- [x] **B.2** 将 `ccg/bin/codeagent-wrapper[.exe]` 纳入 Codex-mode planned files、ownership、transaction、update、uninstall 和 recover。
- [x] **B.3** 新增 `ccg wrapper` shim：解析 `CODEX_HOME`、复核 binary、使用 argv/stdin 安全 spawn、转发流与退出码。
- [x] **B.4** 更新 Codex Skills，使 `antigravity/grok/pi` 统一走 shim；ordinary Claude 继续拒绝，Gemini 继续使用 preview helper。
- [x] **B.5** 保持默认非-lite，并验证 Web UI 仍只绑定 `127.0.0.1`。

### 模块 C：routing capability 与 doctor（5 点）

**主要文件**：`src/types/index.ts`、`src/utils/model-routing.ts`、`src/commands/config-routing.ts`、`src/commands/doctor.ts`

- [x] **C.1** 建立共享 role-provider capability matrix 和纯校验函数，替换“每个角色允许所有 Provider”的断言。
- [x] **C.2** `routing set` 对不兼容组合 fail closed；合法现有配置和四个默认 Provider 保持不变。
- [x] **C.3** doctor 增加 adapter mapping、managed wrapper integrity、选中 CLI availability 和 enablement/auth 状态。
- [x] **C.4** 修正 Codex-mode remediation；禁止推荐 legacy `.claude` 安装。
- [x] **C.5** 增加 persisted invalid config、missing/corrupt wrapper、disabled Grok、missing agy/grok/pi、PM 边界回归。

### 模块 D：版本、快照与离线 E2E（8 点）

**主要文件**：`package.json`、plugin/marketplace manifests、`CHANGELOG.md`、`tests/clean-install-acceptance.test.mjs`、`scripts/clean-install-acceptance.ps1`

- [x] **D.1** 升版 `3.4.6` 并同步 package、plugin、marketplace 和 wrapper digest/version 声明。
- [x] **D.2** 扩展 isolated clean-home fixture，安装 fake `agy/grok/pi`，禁止网络和真实凭据。
- [x] **D.3** E2E 跑通 install -> route -> wrapper -> Web UI opener/output -> resume/parallel -> doctor -> update/recover -> uninstall。
- [x] **D.4** 验证 Codex clean-home 不创建或读取 `.claude`，legacy wrapper 保留不变。
- [x] **D.5** 个人源 focused/full gates 通过后，经 Boss 独立批准提交并推送。
- [x] **D.6** 仅从获批的 clean committed tree 刷新 `components/ccg-workflow` 与 `harness.sources.json`，source equality 通过。
- [x] **D.7** 经 Boss 独立批准提交、推送并合并 Harness PR #31。

### 模块 E：质量、安全与交付门禁（5 点）

- [x] **E.1** 运行 focused TypeScript、Go、clean-home E2E。
- [x] **E.2** 运行 CCG lint/typecheck/test/build、Harness tests、source verification、doctor、conflicts、Go test/build。
- [x] **E.3** 运行变更、质量和安全关卡；Critical/High 为零。
- [x] **E.4** 经 Boss 独立批准安装 `3.4.6` runtime/plugin；安装后版本、ownership、routing 和 doctor 验证通过。

#### 显式人工门禁（不计入本任务完成条件）

- [ ] **E.5** 已有真实 Antigravity/Grok 审核调用证据；未单独执行 Pi live smoke，按计划作为剩余显式授权项报告。

### 模块 F：Grok 证据模式分流（3 点）

- [x] **F.1** 修改 `ccg-review` 编排契约：纯本地代码审查不运行 external-intelligence；只有明确外部事实依赖才进入该路径。
- [x] **F.2** 外部事实 `verify` 在 Provider 调用前要求至少一个由 CCG/Codex 预声明的官方域名，并把域名传入定向搜索提示和证据 provenance。
- [x] **F.3** 增加最小回归：本地 review surface 不启用域名门禁、缺少白名单零 Provider 调用、提供白名单时 prompt 与 manifest 一致。

## 3. 关键文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/utils/installer.ts` | 修改 | 复用 verified binary 安装核心 |
| `src/utils/codex-mode.ts` | 修改 | Codex wrapper ownership/transaction |
| `src/commands/wrapper.ts` | 新建 | 稳定、安全的 wrapper shim |
| `src/cli-setup.ts` | 修改 | 注册 shim 命令 |
| `src/utils/model-routing.ts` | 修改 | capability matrix 入口 |
| `src/commands/config-routing.ts` | 修改 | routing fail-closed |
| `src/commands/doctor.ts` | 修改 | route-aware runtime 检查 |
| `plugins/ccg/skills/ccg-executor/SKILL.md` | 修改 | 使用稳定 shim，补 Pi |
| `src/utils/__tests__/*.test.ts` | 修改/新建 | installer/routing/doctor/CLI 回归 |
| `codeagent-wrapper/*_test.go` | 按需修改 | 仅补真实 seam 缺口，不重写实现 |
| `tests/clean-install-acceptance.test.mjs` | 修改 | isolated fake Provider E2E |
| `scripts/clean-install-acceptance.ps1` | 修改 | clean-home provider phases |
| `package.json`、plugin manifests、`CHANGELOG.md` | 修改 | `3.4.6` 发布一致性 |
| `components/ccg-workflow/**`、`harness.sources.json` | 同步 | 只导入个人源干净提交 tree |

## 4. 验证命令

在个人 CCG 源 worktree 先运行 focused tests，再运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
Push-Location codeagent-wrapper
go test -short ./...
go build ./...
Pop-Location
```

同步 Harness 后运行：

```powershell
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
Push-Location components/ccg-workflow/codeagent-wrapper
go test -short ./...
go build ./...
Pop-Location
```

再运行 CCG 变更、质量和安全关卡。真实 Provider smoke 不属于默认命令集。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 下载/替换可执行文件造成供应链风险 | 仅 personal release；固定摘要和版本；候选先验证再原子提升 |
| Codex update 与 binary ownership 漂移 | 纳入同一 transaction/ownership；故障注入测试 recover |
| capability 收紧破坏旧配置 | 不静默改写；doctor 给精确 `routing set` 修复命令 |
| shim 引入命令注入 | 参数数组 + stdin；禁止 shell 拼接；路径和 reparse 防护 |
| Web UI 暴露局域网 | 保持 `127.0.0.1:0` 测试和安全门 |
| 同版本不同 bytes 继续漂移 | 升版 `3.4.6`，耦合验证 source/package/plugin/manifest |
| Pi 任务重复或冲突 | 复用 `08-03-pi-selectable-orchestrator`，不重写 backend |
| 误触付费/登录 | CI fake CLI；live smoke 独立显式授权 |

## 6. 回滚点

1. 个人源提交前：只恢复隔离 worktree 的任务文件。
2. Harness 同步前：保留旧 component tree 和 `harness.sources.json`。
3. runtime 安装前：备份全局 CLI/plugin/Codex ownership；失败恢复旧 `3.4.5`。
4. wrapper 更新失败：事务恢复旧 binary，保留 legacy `.claude` binary 不动。

## 7. Codex 原生交接

本仓库不创建平行 `.codex/ccg/plans`。审阅本任务的 `prd.md`、`design.md`、`implement.md` 后，后续显式批准将通过 Trellis `task.py start` 进入实施；不得直接运行 `/ccg:execute` 绕过 Trellis 状态门。
