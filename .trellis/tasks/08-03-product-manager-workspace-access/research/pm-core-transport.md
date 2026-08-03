# Product-manager workspace transport research

## 1. 已确认事实：Harness → installed CCG → Provider 的调用流

1. **Harness CLI 入口**：`scripts/harness-adapter.mjs:132-229` 的 `handleProductManager()` 先以 `resolveCurrentTask(repoRoot)` 定位当前 canonical Trellis task；`review` 解析 `--trigger`、`--checkpoint`、重复 `--evidence`、task-local `--grill-handoff`，最后调用 `runInstalledProductManagerReview(repoRoot, task.directory, {...})`（`scripts/harness-adapter.mjs:180-227`）。Handoff 必须位于 active task 内（`scripts/harness-adapter.mjs:193-215`）。

2. **Harness adapter 准备/调用**：`scripts/lib/harness-adapter/product-manager.mjs:1080-1252` 的 `runInstalledProductManagerReview()`：
   - 读取 `.harness/adapter.json` 与 `harness.sources.json`（1096-1098），用 `allowedProvidersFromContract()` 只保留 `readOnly=true`、`workspaceWrite=false`、`terminal=false`、`subagents=false`、`network/paid=explicit-per-call` 的 `codex|gemini|claude`（1058-1077）。
   - `discoverTrustedCommandRoots(["ccg"], {env})` + `resolveTrustedCommand("ccg", ...)` 绑定 installed CCG 的绝对可信 command（1104-1110）；用 `ccg --version` 验证版本等于 `harness.sources.json.ccg.version`（1119-1134）。
   - `prepareProductManagerReview()` 从 task 的 `prd.md/design.md/implement.md` 生成完整输入、artifact SHA-256、`input_digest/evidence_digest` 与 invocation key（667-795）；调用前获取 Harness 的 `projection-locks`（1141-1147），而非 CCG 的 Provider lock。
   - 在 task-local ignored `.ccg-evidence/product-manager/calls/<invocationKey>/` 写入 `input.json`、`provider-request.json`、`status.json`（1152-1181）。命令参数为 `product-manager review --input <call/input.json> --task-dir <task> --allowed-providers <csv> --json`，仅在 `responseFile` 或明确 `allowProviderCall` 时追加对应参数（1182-1198）。
   - `runCommand()` 返回后要求完整 stdout 直接 `JSON.parse`，不做 substring/最后一行提取（1204-1217）；写 `response.raw/result.json`，再调用 `applyProductManagerReview()` 复核当前 task/plan/digest/CAS 后投影（1218-1237）。异常写 bounded/redacted status，最后释放 Harness lock（1238-1252）。

3. **Harness 子进程边界**：`scripts/lib/harness-adapter/process.mjs:138-153` 的 `runCommand()` 固定 `cwd=repoRoot`、`shell:false`，并把 `env` 先过 `createSafeSubprocessEnv()`；后者过滤 secret-key 名称及 `CLAUDE_*`（`scripts/lib/harness-adapter/redaction.mjs:68-79`）。这只保护 Harness→CCG 这一跳，不等于 Provider executable 已可信。

4. **Installed CCG 命令注册**：`components/ccg-workflow/src/cli-setup.ts:260-271` 注册 `ccg product-manager <action>`，把 action/options 交给 `productManagerCommand()`；包的 installed bin 是 `bin/ccg.mjs`（`components/ccg-workflow/package.json:32-35`）。

5. **CCG review 入口与状态**：`components/ccg-workflow/src/commands/product-manager.ts:444-615` 的 `reviewProductManager()`：读取 `--input/--task-dir` 并 `validateProductManagerInput()`（444-450），从 `~/.codex/ccg/config.toml` 读取 `[routing.product-manager]` 和 `[product_manager]` 行为（45-70、451-460），把统一 routing 选择与 `--allowed-providers` 求交，不满足则抛 `product-manager unavailable`，没有 fallback（453-460）。同 invocation key 由 CCG `withInvocationLock()` single-flight，已有 result 仅在 provider identity 一致时复用（462-480）。

6. **CCG evidence/retry**：首次调用写 CCG 自己的 `input/provider-request/status/audit`（482-514）；无 saved `--response` 时必须 `--allow-provider-call`（515-528）。`invokeValidatedProductManagerProvider()` 以同一 provider、同一 invocation key 重试 `max_retries+1` 次；每次失败回调 `attempt/max_attempts/provider/error`，全部失败返回唯一 `unavailable`（`components/ccg-workflow/src/commands/product-manager.ts:218-251`）。review 层将每次 `attempt_failed` append 到 task-local audit（538-550），不创建第二 verdict、不切 provider。

7. **当前 Provider workspace**：`invokeProvider()` 每次以 `mkdtemp(join(tmpdir(), 'ccg-product-manager-'))` 创建临时目录（`components/ccg-workflow/src/commands/product-manager.ts:253-258`）；只在该目录写 Codex schema 或 Gemini deny policy，然后把该空目录同时作为 `cwd` 传给 `executeReadOnlyProvider()`（279-307、319-329、340-368），finally 删除（370-372）。因此当前 provider 只能读 stdin 中的已准备输入，无法读真实 workspace；这是“空 disposable cwd”根因。

## 2. 当前 Provider/runner 合同

### Claude no-tool contract（事实）

`components/ccg-workflow/src/product-manager/providers/claude.ts:4-45` 当前构造：

- `--safe-mode --disable-slash-commands --tools ''`（空 tools）；
- `--strict-mcp-config --mcp-config {"mcpServers":{}}`；
- `--setting-sources '' --settings {}`、`--no-session-persistence`、`--no-chrome`；
- `--permission-mode plan --input-format text --output-format json --json-schema <bound schema>`；
- 始终 `--model <model>`（33-34），system prompt 明确禁止 tools/files/commands/MCP/hooks/skills/plugins/subagents（35-39），最后 `--print`。

`resolveClaudeProductManagerModel()` 未设置或空的 `CCG_PRODUCT_MANAGER_CLAUDE_MODEL` 时返回 `opus`，显式 env 值只替换 model（`components/ccg-workflow/src/commands/product-manager.ts:54-61`）。现状完全 no-tool；与本任务已确认的“仅 Read/Glob/Grep、禁写/Bash/子代理”要求不一致，需在 Claude adapter/提示和测试上明确改为精确 allowlist，不能继续使用空 tools 作为等价物。

### 其他 Provider 与 runner（事实）

- Codex execution 禁用 `shell_tool`、`multi_agent*`、MCP/apps/plugins 等一组 feature，使用 `--sandbox read-only --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check`，并 `--cd <workspace>`（`providers/codex.ts:9-52`）。
- Gemini execution 使用 `--approval-mode plan`、task-local `deny-all-tools.toml`（tool/MCP `*` deny）、`--skip-trust --output-format json --model ...`（`providers/gemini.ts:4-29`）。
- `validateProviderExecution()` 要求 absolute executable、`readOnly=true`、`shell=false`、参数无控制字符，environment keys 仅 `CODEX_HOME|GEMINI_CLI_HOME`（`provider-registry.ts:30-49`）。
- `executeReadOnlyProvider()` 用 `spawn(..., {cwd, env, shell:false, stdio pipe})`，超时/输出超限会杀整个 process tree，stdout 上限取 `maxOutputBytes`，stderr 诊断最多 4096 bytes（`provider-runner.ts:66-169`）。
- Provider 子进程 env 不是继承全部环境：固定 `CCG_PRODUCT_MANAGER_READ_ONLY=1`、`I18NEXT_NO_SUPPORT_NOTICE=1`、`NO_COLOR=1`，再加入 `PATH/Path/SystemRoot/WINDIR/TEMP/TMP/HOME/USERPROFILE/LOCALAPPDATA/APPDATA` 和 execution 允许的 provider home（`provider-runner.ts:8-35`）。

## 3. 本地 executable 解析与潜在边界（事实）

CCG 内部 executable 解析没有复用 Harness trusted resolver：

- 通用 `findExecutable()` 直接遍历 `PATH/Path`，命中 `existsSync()` 即返回（`commands/product-manager.ts:82-92`）。
- Codex 使用 `CCG_PRODUCT_MANAGER_CODEX_EXECUTABLE || findExecutable(codex[.exe])`，随后仅由 `validateProviderExecution()` 检查 absolute/readOnly/shell false；没有 regular-file、realpath、签名/来源树校验（`commands/product-manager.ts:279-289`）。
- Gemini 显式 entrypoint 仅要求 absolute+exists；否则从 PATH 的 `gemini` shim 推导相邻 `node_modules/@google/gemini-cli/dist/index.js`（94-103）。
- Claude 显式 executable 仅要求 absolute+exists，Windows 还要求 `.exe`；否则 PATH 直接 binary，再尝试 Windows shim 相邻 `@anthropic-ai/claude-code/bin/claude.exe`（105-119）。
- CLI 版本读取使用 `execFileSync(executable,['--version'],{shell:false,timeout:10_000})`，但未额外缩减环境（121-132）。

Harness 对 installed **CCG** 本身的 resolver 更严格：只接受 approved package/command roots，校验 Node/package/binary identity/tree，且 `boundCommandSet.run()` 每次执行前重新 `assertTrustedCommandUnchanged()` 并以 `minimalCommandEnvironment()` 运行（`.agents/skills/harness-init/scripts/trusted-command-resolver.mjs:659-700,709-835`）。该保护目前没有覆盖 CCG 启动的 Codex/Gemini/Claude executable。

另一个需确认的配置事实：product-manager command 使用 `~/.codex/ccg/config.toml`（`commands/product-manager.ts:45-46`），而通用 CCG config utility 的 `CCG_DIR/CONFIG_FILE` 已迁移为 `~/.claude/.ccg/config.toml`（`utils/config.ts:13-15`）。新增 workspace transport 时不得因此形成第二份可冲突的 transport/provider 权威。

## 4. 已确认需求映射下的最小代码边界（推断，非现状）

1. **Harness contract/config（项目选择 transport）**：在现有 `.harness` project/adapter policy 的严格 schema、initializer `assertProductManager()`、模板和 ownership fingerprint 同步增加可选 workspace transport：默认 `local`，项目显式才可 `ssh`。Transport 不是 Provider 选择权威；只允许非敏感枚举/能力字段，SSH host/user/port/key/known-hosts 等细节只引用 env 名称，禁止把值写入 `.harness/*.json`、task input、argv、audit 或 projection。当前 `assertProductManager()` 对 productManager 使用 exact keys（`.agents/skills/harness-init/scripts/harness-init-core.mjs:2038-2117`），因此只改 `.harness/adapter.json` 不够。

2. **Harness→CCG 传递**：`runInstalledProductManagerReview()` 是唯一注入点（`product-manager.mjs:1080-1203`）。它应把已校验的 `local|ssh` 和不含秘密的 snapshot/transport identity 作为显式 option/input 传给 installed CCG；不要让 CCG 重新读取 project contract，也不要把 raw SSH env 值放入 input digest/evidence。若 transport 参与审查语义，应进入 canonical input 后重新计算 `input_digest/invocation_key`；否则仅作为命令执行选项并纳入 call status，避免未绑定身份。

3. **CCG workspace materializer（新单一模块边界）**：在 `src/product-manager/` 新增最小 `workspace`/`transport` 模块，由 `invokeProvider()` 唯一调用，替换现有 `mkdtemp` 空目录（`commands/product-manager.ts:253-373`）。
   - `local`：提供 active local workspace 的只读视图/快照给 Provider（不得让 provider 写回 canonical task）；默认不依赖 SSH。
   - `ssh`：每 invocation 建立一次远端临时 snapshot，完成后强制清理；连接/快照失败返回 `unavailable`，**不得回退 local**。SSH 详情只从显式 allowlisted env 读取，不能来自 tracked config、prompt 或命令日志。
   - 两种 transport 都向 runner 返回受控 `cwd`/workspace identity 和 cleanup；不改变 CCG task-local evidence 与 Harness projection authority。

4. **Provider tool policy**：Claude/Gemini 当前分别用 `--tools ''` 和 deny-all policy；Codex 关闭 shell/MCP/multi-agent 等执行能力，但没有显式列出 `Read/Glob/Grep` allowlist。按已确认需求，应在 provider-specific execution/prompt 中只允许 `Read/Glob/Grep`（或各 CLI 的严格等价 read-only primitives），显式拒绝 Write/Edit/Bash/Shell/MCP/Hook/skills/plugins/subagents；不能通过 general `--tools` 空值或 plan mode 推断出完整安全性。Claude 的 `--tools ''`、system prompt（`providers/claude.ts:11-39`）是必改边界；Codex/Gemini 也必须分别证明只读工具名映射，不能仅靠统一 prompt。

5. **Executable resolver/runner**：保留 `shell:false`、absolute path、timeout/output/process-tree kill；将 CCG 内部 `findExecutable()`（`commands/product-manager.ts:82-119`）收敛为 approved absolute regular executable/realpath（或由 Harness 预绑定并传递 opaque binding）。SSH client/remote command 同样走固定 executable、无 shell fallback、最小 env；连接失败不得换 local provider/transport。

6. **Schema/digest boundary**：现有 `validateProductManagerInput/Output()`、`createBoundProductManagerOutputJsonSchema()` 已用 exact fields、`additionalProperties:false`、invocation/task/trigger/checkpoint/plan/input/evidence digest 与 provider/model/CLI `const` 绑定（`contracts.ts:109-238,297-406`）。若把 transport/snapshot identity 纳入 Provider 可见输入，必须更新 `INPUT_FIELDS`、canonical digest、bound schema、Harness stale recheck 和 tests；SSH secrets/ephemeral paths 不能进 schema。输出仍要求单一 JSON，Transport 失败只能形成同一 invocation 的 `unavailable` 或 attempt failure。

## 5. 安全不变量（实施时必须保留）

- 默认 transport 必须是 local；未明确配置 ssh 时不尝试网络/SSH。
- Project 只能选择 transport/capability，不得选择 Provider；Provider 仍由 installed unified `routing.product-manager` 与 allowed intersection 决定。
- SSH 所有连接细节为 env-only；不落盘、不入 prompt/input digest、argv、stdout/stderr、raw evidence、audit、projection；日志只保留 redacted bounded reason。
- 每次远端调用都是独立临时 snapshot；snapshot 与 canonical workspace/task 隔离，成功/失败/超时都 finally 清理；不存在 transfer failure→local fallback。
- Provider 只可执行 Read/Glob/Grep 等明确定义的只读能力；Write/Edit/Bash/Shell/MCP/Hook/skills/plugins/subagents 均 fail closed。
- Provider process 和 SSH helper 均 `shell:false`、absolute trusted executable、最小环境、超时、stdout/stderr 上限；不得继承任意 `process.env` 或机器默认 Claude model。
- 同 provider、同 invocation key 才可 retry；retry 次数受 `max_retries` 限制；每次失败写 1-based attempt/max attempts/provider 的脱敏诊断；禁止 provider fallback、第二 verdict 或跨 transport fallback。
- CCG stdout 只能是一个 JSON 文档；任何 banner/progress/前后缀均为 protocol error，不做 substring parse。
- 任何 transport/snapshot/tool policy/schema/digest/CLI identity 不一致都在 projection 前拒绝；Harness 只更新 task-local `product-manager.json`，绝不由 CCG/Provider 写 Trellis lifecycle。

## 6. 现有测试证据与新增测试点

### 已有可复用测试

- Harness installed flow、版本探针、call evidence、projection revision：`tests/product-manager-e2e.test.mjs:385-440`；晚到 artifact drift 只保留 raw stale：442-491；malformed stdout 严格解析且先 redaction：493-546。
- Provider selection no-fallback、absolute/readOnly/shell false、Codex/Gemini/Claude 工具参数和 provider-home env allowlist：`components/ccg-workflow/src/product-manager/__tests__/provider-registry.test.ts:17-105`。
- Claude `opus` default/explicit model override、统一 routing、provider failure 两次 retry 后 unavailable、invalid output retry：`components/ccg-workflow/src/product-manager/__tests__/command.test.ts:97-168,214-308`。
- Strict output schema、bound identity constants、input digest、unknown/missing/stale field rejection：`components/ccg-workflow/src/product-manager/__tests__/contracts.test.ts:53-181`。
- Support notice suppression、bounded stderr、process-tree timeout kill：`components/ccg-workflow/src/product-manager/__tests__/provider-runner.test.ts:44-138`。

### 本任务至少应新增/补充

1. local 默认 transport：无 SSH env、无 network/SSH spawn，Provider 获得非空且只读 workspace；写入尝试被拒绝，task 与 canonical projection 字节不变。
2. SSH opt-in：项目 schema 只接受 `local|ssh`；SSH 详情仅从指定 env 读取；缺 env/非法 host/未知 key/非绝对 ssh executable fail closed；env 值不出现在 argv、stdout、stderr、raw/audit/result。
3. 每 invocation 远端临时 snapshot：成功、schema failure、timeout、连接断开和 retry 后均验证 snapshot 清理；第二次 invocation 不复用旧目录；禁止 remote failure→local fallback。
4. Claude/Codex/Gemini 工具矩阵：Read/Glob/Grep 可用，其余 Write/Edit/Bash/Shell/MCP/Hook/skills/plugins/subagents 均拒绝；Claude 不再以 `--tools ''` 静默代表该合同。
5. CCG 内部 local executable resolver：PATH 命中 symlink/非 regular/越过 approved root/版本漂移均拒绝；`shell:false`、最小 env 和 `--model opus` 仍断言。
6. Transport/snapshot identity 参与输入时，断言 digest/schema const/stale response 全链路绑定；transport 改变不得复用旧 result 或跨 transport retry。
