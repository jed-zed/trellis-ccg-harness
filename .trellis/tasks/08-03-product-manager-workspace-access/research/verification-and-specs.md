# Product-manager workspace-access：适用规格与验证矩阵

## 1. 任务基线与适用规格

- 当前任务尚未给出可执行产品需求：`prd.md:1-20` 的 Goal、Requirements、Acceptance 仍为 `TBD`；`task.json:1-26` 仅声明 planning 阶段。因此下面以现有 PM 合约/分层 Harness 规格作为验证基线，不推断新的行为目标。
- 直接适用：
  - `.trellis/spec/tooling/product-manager-review.md:3-11`（provider/reviewer runtime、Harness adapter、Trellis projection、evidence/gate 变更；PM 仅提供 evidence，Codex 是唯一编排器/写入者）。
  - `.trellis/spec/guides/layered-harness-adapter.md:14-22,75-118`（Trellis 任务权威、CCG 模型编排、Harness policy/context/conflicts；Codex sole writer；Claude 明确只读/无工具；blocking conflict 退出码 2；必跑 context/conflicts/adapter test/doctor）。
  - `.trellis/spec/tooling/harness-initializer.md:3-14,58-97,175-210`（initializer 是唯一实现入口；canonical JSON/LF、ownership/digest、用户资产保留；`harness-init-cli` 与 `harness:test`）。
  - `.trellis/spec/tooling/index.md:3-11,20-46`（根脚本负责生命周期/来源验证；离线完整质量门）。
- 相关旧任务的可复用门禁（只作为已实现 PM 合约的回归参考，不改变本任务 TBD）：`.trellis/tasks/07-27-product-manager-role-integration/implement.md:510-537`；其中包含 Harness、source、CCG、Go 及 `verify-quality`/`verify-security`/`verify-module` 的组合门禁。

## 2. 最小验证（针对 PM workspace-access 改动）

在仓库根目录 `I:\ai\trellis-ccg-harness-pm-workspace-access` 执行。先确认工作树与改动边界：

```text
git status --short
git diff --check
```

若改动触及 provider-runner、provider adapters、PM state/adapter 或 Harness schema，最低应执行：

```text
node --test tests/product-manager-state.test.mjs
node --test tests/product-manager-concurrency.test.mjs
node --test tests/product-manager-e2e.test.mjs
node --test tests/harness-adapter.test.mjs
node --test tests/harness-init-skill.test.mjs
node --test tests/harness-init-cli.test.mjs
pnpm harness:test
node scripts/harness-adapter.mjs context
node scripts/harness-adapter.mjs conflicts
pnpm harness:conflicts
pnpm doctor
pnpm verify:sources
```

这些测试/脚本的规格出处：PM Review 要求 state/concurrency/e2e/adapter/initializer 五组测试与 `harness:test`, `doctor`, `harness:conflicts`, `verify:sources`（`.trellis/spec/tooling/product-manager-review.md:225-261`）；分层 adapter 要求 context/conflicts、adapter test、doctor（`.trellis/spec/guides/layered-harness-adapter.md:111-118`）；initializer 要求 `harness-init-cli` 与 `harness:test`（`.trellis/spec/tooling/harness-initializer.md:175-210`）。

如只改一个模块，可先跑对应测试并保留上述门禁作为提交前最低集；PM 的 acceptance 不应以 `ccg product-manager review` 结果替代 Trellis 状态/完成状态（`.trellis/spec/tooling/product-manager-review.md:163-182`）。

## 3. Provider runner 与只读进程边界

核验文件：`components/ccg-workflow/src/product-manager/provider-runner.ts:8-35,66-82,83-103,117-170`。

- 环境变量只允许基础运行时键（`PATH/Path/SystemRoot/WINDIR/TEMP/TMP/HOME/USERPROFILE/LOCALAPPDATA/APPDATA`）及 execution 配置声明的键；强制 `CCG_PRODUCT_MANAGER_READ_ONLY=1`、`I18NEXT_NO_SUPPORT_NOTICE=1`、`NO_COLOR=1`（8-35）。不得把完整父进程环境或凭据传入 Provider。
- 必须 `spawn(execution.executable, execution.args, { cwd, env, shell:false, stdio:['pipe','pipe','pipe'], windowsHide:true })`（66-82）；Windows 超时要杀进程树（37-64、117-130）。
- stdout/stderr 有界，stderr 仅用于有限诊断（83-103、131-163），stdout 必须单一 JSON；进程异常/超时/非零退出应失败关闭。对应测试：`components/ccg-workflow/src/product-manager/__tests__/provider-runner.test.ts:44-140`（notice 抑制、严格 JSON、stderr 截断、子进程树超时）。

Provider registry/adapters 还必须验证绝对受信 executable、`shell:false`、read-only capability、禁用工具/网络/持久会话和隔离 env：`components/ccg-workflow/src/product-manager/__tests__/provider-registry.test.ts:17-105`。

## 4. Claude 参数合约

- 适配器的完整只读参数在 `components/ccg-workflow/src/product-manager/providers/claude.ts:1-47`：`--safe-mode`、`--disable-slash-commands`、空 `--tools`、空 MCP 配置、空 settings/setting-sources、`--no-session-persistence`、`--no-chrome`、`--permission-mode plan`、text/json 输入输出、`--json-schema`、显式 `--model`、`--print`；`environmentKeys: []`、`readOnly:true`、`shell:false`（42-45）。
- PM Review 的规则是始终带 `--model`；未设置模型时默认 `--model opus`，只允许模型覆盖，不得退回 sonnet（`.trellis/spec/tooling/product-manager-review.md:146-149`）。验证项已写入 registry 测试（`provider-registry.test.ts:47-87`）。
- PM status/review 默认离线，只有显式 `--allow-provider-call` 可 live call（`.trellis/spec/tooling/product-manager-review.md:47-49`）；Provider 是 evidence-only，不能写 task/plan/completion/workspace（同文件 `:3-11`）。

## 5. Snapshot / workspace 输入排除

当前 Grok/隔离 runner snapshot 的实现是 `components/ccg-workflow/templates/engine/tools/grok-intelligence/lib/snapshot.mjs`：

- 文件/总量上限：最多 200 文件、单文件 2 MiB、总计 16 MiB（6-10）。
- 禁止目录段（12-17）：`.git .hg .svn .claude .codex .grok .cursor .github .claude-plugin .codex-plugin .ssh .aws .azure .gnupg .kube node_modules vendor .cache .next .nuxt .turbo dist build coverage skills hooks plugins`。
- 禁止 basename/敏感后缀及命名（19-23、35-53）：`agents.md`/`claude.md`/`gemini.md`、`auth.json`/`credentials.json`、`.env/.env.*`、密钥/证书扩展、`id_rsa`/service-account、credential/secret/token/auth、plugin/mcp JSON/YAML/TOML。
- 路径归一化拒绝绝对路径、NUL、traversal/空路径（25-33）；`.ccgignore` 必须是非 symlink regular file 且不超过 64 KiB（78-90）；symlink/path-chain、hardlink、TOCTOU identity 都拒绝（98-110、126-151、190-216）。输出文件权限为 `0400`（218-235），目标目录必须独立且为空（172-189）。
- 变更 diff 仅从已选择文件读取，要求文本且不能含 NUL（154-169）。
- 覆盖测试在 `components/ccg-workflow/src/utils/__tests__/grokIntelligenceRunner.test.ts:69-165`（敏感路径、VCS/cache、AGENTS/CLAUDE、`.ccgignore`、traversal/symlink/hardlink/caps），以及 `:168-296`（private roots、环境诊断脱敏、不污染 CLI）；隔离生命周期/清理测试从 `:299` 起。

若 workspace-access 变更会生成 snapshot，必须保留这些排除项，不能用“只读 Provider”替代“输入快照不含秘密”。

## 6. Harness schema / distribution 一致性

- canonical 与 installed schema 当前字节一致：
  - `.agents/skills/harness-init/assets/product-manager.schema.json`
  - `.harness/product-manager.schema.json`
  - 当前 SHA-256 均为 `5ee7d491645d37e17d6fe99ded51f849c3482e2409b1286c8ebd50e9ea2c5008`，`cmp` 返回 0（只读核验）。
- initializer parity 测试在 `tests/harness-init-skill.test.mjs:230-299`：比较 distribution/install schema canonical JSON 文本（258-287），并校验 ownership digest（292-294）、project schema/contract/manifest；`tests/harness-init-cli.test.mjs:338-344,456+` 校验 managed path 和 canonical line endings。
- `.harness/ownership.json:1-35` 声明 `schemaVersion:3`、`contractSha256`、`schemaSha256`、`productManagerSchemaSha256`（4-6），且把 `.harness/product-manager.schema.json` 列为 managed path（14-21）。
- `.harness/project.schema.json:309-364,397-429` 与 `.harness/project.json:235-271` 要求 PM authority/state/evidence 及 provider capabilities；允许的 `codex/gemini/claude` 必须 read-only、workspaceWrite/terminal/subagents false，network/paid 为 explicit-per-call。
- 任何 canonical/installed/ownership drift 都应由 `pnpm verify:sources`、`pnpm harness:conflicts` 或 initializer tests 阻断；不要手工修 installed 文件而跳过 canonical source。

## 7. Conflicts / doctor / source verifier

- 静态 conflict 检查（`scripts/lib/harness-adapter/conflict-static.mjs:130-268,270-339,341-460`）覆盖 tracked runtime、task authority、Codex sole writer、Claude/GPT Pro 只读、credential namespace、command namespace、PM allowed providers/capabilities、managed schema/ownership digests。错误状态必须 blocking，`blockingExitCode:2`（`.harness/adapter.json:156-163`）。
- runtime conflict 检查（`scripts/lib/harness-adapter/conflict-runtime.mjs:65-183,185-245,247-326,337-415`）覆盖实际 CCG 解析、plugin cache、重复 hooks、项目 `.claude` Harness 资产；Harness 专用 `.claude` 资产阻断，普通用户内容仅 informational。测试见 `tests/harness-adapter.test.mjs:708-861,951-1057`。
- doctor (`scripts/doctor.ps1:104-197,199-305,307-360`) 检查 Node/Python/pnpm/Go/Trellis/CCG、事务 journal/lock/residue、`verify-sources`、adapter conflicts、git origin/visibility；任何 blocking conflict 或失败返回非零。入口为 `pnpm doctor`（`package.json:11-29`）或 `pwsh -NoProfile -File .\\scripts\\doctor.ps1`。
- source verifier (`scripts/verify-sources.ps1:17-25,294-347,640-836`) 校验 manifest/validator/resolver SHA、trusted command identity/shell false/empty env、authoritative checkout/commit/tree、exact snapshot required files、dirty state 及禁止提交 runtime paths。入口 `pnpm verify:sources`；候选 staged 验证可用 `pwsh -NoProfile -File .\\scripts\\verify-sources.ps1 -Index`。

## 8. 完整回归与分发一致性

根 `package.json:11-29` 提供 `harness:test`, `harness:conflicts`, `doctor`, `verify:sources`, `ccg:lint`, `ccg:typecheck`, `ccg:test`, `ccg:build`；`scripts/run-tests.mjs:1-33` 表明 `pnpm harness:test` 会运行全部 `tests/*.test.mjs`。提交前完整离线集：

```text
pnpm harness:test
pnpm harness:conflicts
pnpm doctor
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
go test -short ./...
go build ./...
```

CCG 组件自身的 package scripts 在 `components/ccg-workflow/package.json:67-79`（lint/typecheck/test/build、`audit:prod`）。CI 还要求 Node 20/22 Ubuntu/Windows 矩阵、clean install、`conflicts --ci`、source verify、CCG gates、Windows Grok offline/security、plugin doctor，以及 Ubuntu/Windows/macOS Go 和 platform-doctor 矩阵（`.github/workflows/ci.yml:14-179`）。在本地至少复现对应 Node/OS 可执行门；跨平台/clean-install 是分发候选的 full regression，不是单模块最小门。

## 9. 代码质量与安全扫描

仓库内 snapshot skill 的直接、可审计调用（先针对实际改动路径）是：

```text
node components/ccg-workflow/templates/skills/tools/verify-quality/scripts/quality_checker.js components/ccg-workflow/src/product-manager -v
node components/ccg-workflow/templates/skills/tools/verify-quality/scripts/quality_checker.js scripts/lib/harness-adapter -v
node components/ccg-workflow/templates/skills/tools/verify-security/scripts/security_scanner.js components/ccg-workflow/src/product-manager --json
node components/ccg-workflow/templates/skills/tools/verify-security/scripts/security_scanner.js scripts/lib/harness-adapter --json
```

Quality 规则/阈值/退出语义见 `components/ccg-workflow/templates/skills/tools/verify-quality/SKILL.md:23-110` 与脚本 `.../quality_checker.js:8-18,244-335`（复杂度、函数/文件长度、参数/嵌套等）；security 分类、Critical/High 失败语义见 `verify-security/SKILL.md:23-60,100-108` 与 `.../security_scanner.js:10-163,221-281`。安全扫描应覆盖命令执行、Provider 权限、输入/路径、秘密/凭据、网络边界、锁/CAS 和 source provenance；发现 Critical/High 必须先修复（旧 PM 实施门禁：`.trellis/tasks/07-27-product-manager-role-integration/implement.md:527-537`）。

若使用已安装 Skill CLI（`node ~/.claude/skills/ccg/run_skill.js ...`，模板索引 `components/ccg-workflow/templates/skills/SKILL.md:62-69`），先通过 `pnpm verify:sources` 确认安装快照与 canonical source 一致；否则优先使用上面的仓库内脚本，避免拿未验证的全局版本作为证据。

## 10. 最小集与完整集边界

- **最小必跑**：受影响的 PM 单测（state/concurrency/e2e/adapter）、initializer parity（schema 变更时）、`harness:test`、`harness:conflicts`、`doctor`、`verify:sources`；任何 provider-runner/Claude 变更还要跑 runner/registry tests；任何 snapshot 变更还要跑 snapshot/runner focused tests。
- **完整回归**：再加 `ccg:lint/typecheck/test/build`、Go short test/build、quality/security 两类扫描、clean-install/跨平台 CI 等。完整回归用于分发/合约基线变化；不能把静态 `verify:sources` 或 schema parity 当作 live Provider 成功证据。
