# Disposable snapshot 复用研究

范围：只读核验现有 frontend/Gemini snapshot、已有严格 Node snapshot，以及 product-manager 当前 Provider 调用边界。以下“事实”均带当前 checkout 的行号；“推断/建议”单独标注。

## 已确认事实

### 1. Frontend/Gemini helper：`invoke_gemini_preview.py`

入口和生命周期：

- `prepare_gemini_workdir(args)` 在非 `--direct-workdir` 时创建 `tempfile.TemporaryDirectory(prefix="ccg-gemini-snapshot-")`，目标为临时目录下的 `<source.name>`，调用 `copy_snapshot_tree` 后把该目录作为 Gemini `cwd`；`--direct-workdir` 直接返回真实工作区并跳过 snapshot（`components/ccg-workflow/plugins/ccg/skills/ccg-executor/scripts/invoke_gemini_preview.py:1033-1067`）。
- `main()` 在 `try/finally` 中执行 snapshot、Provider、响应文件写入，最后 `server.shutdown()` 和 `temp_dir.cleanup()`；因此正常/异常退出都会清理临时 snapshot（同文件 `:1159-1184`）。detach 只是启动同一 helper 的子进程，仍由子进程走该 finally（同文件 `:407-471`）。
- Gemini 命令通过 `--include-directories <snapshot>` 限定可包含目录，并使用 `--approval-mode`（默认 `plan`）、`--skip-trust`、`stream-json`（同文件 `:711-724`）。

过滤与 cap：

- 固定名称黑名单包括 VCS/IDE/cache/dependency/build 目录（`.git`, `.hg`, `.svn`, `.idea`, `.vscode`, `node_modules`, `vendor`, `dist`, `build`, `target`, `coverage`, `.venv`, `.aws`, `.gcp`, `.azure`, `.ssh` 等）；后缀黑名单为 `.pyc`, `.pyo`, `.log`, `.tmp`, `.pem`, `.key`, `.p12`, `.pfx`, `.crt`；前缀为 `.env.`, `credentials`, `service-account`（同文件 `:205-250`）。`.env` 本身和 `service-account*.json` 额外拒绝（同文件 `:841-851`）。
- `--max-snapshot-bytes` / `--max-snapshot-files` 默认均为 `0`（无限制），仅在调用者显式设置时限流（同文件 `:275-285`；`copy_snapshot_tree` 在 `:948-1009` 检查，超限按文件跳过并累加 `skipped_cap`，不是 fail-closed）。
- `.ccgignore` 总是读取；只有 `--respect-gitignore` 才读取工作区根 `.gitignore`（同文件 `:874-890`）。匹配是单文件、轻量 `fnmatch`：根文件规则、`/` 去除、目录尾 `/`、相对路径/ basename 匹配（同文件 `:893-913`）；不支持 Git ignore 的否定/嵌套规则语义。
- `--files-from` 是可选的换行列表；绝对路径必须能相对到 source，否则跳过；include 只影响 source 内递归条目（同文件 `:916-945`）。

symlink/reparse 和复制：

- `is_snapshot_link` 拒绝 symlink、Python `Path.is_junction()`（可用时）以及 Windows `FILE_ATTRIBUTE_REPARSE_POINT`；任何 `OSError` 也按链接处理（同文件 `:854-868`）。
- `copy_snapshot_tree` 按名称排序递归；每项先检查固定黑名单/链接、files-from、ignore，再复制普通文件。使用 `shutil.copy2`，保留 metadata，但没有把目标文件 chmod 成只读，也没有 hard-link 检查、源 root 身份校验或读取期间变更检测（同文件 `:969-1021`）。
- `snapshot_ignore()`（同文件 `:1024-1030`）只生成名称集合，当前没有其它调用；实际复制走 `copy_snapshot_tree` 的逻辑。

可观察统计：snapshot-ready 时输出路径、排除摘要、复制 files/bytes，以及 `secret_or_link`, `user_ignore`, `include_filter`, `cap`, `error` 五类跳过计数（同文件 `:1043-1066`）。文档明确说明这是 workspace disposable snapshot，建议用 `.ccgignore`/gitignore/files-from/caps 缩小范围，不要削弱秘密排除（`components/ccg-workflow/plugins/ccg/skills/ccg-executor/SKILL.md:129-152`）。

测试现状：`src/utils/__tests__/geminiPreviewTemplate.test.ts` 只验证 Python helper 的 HTML 渲染、UTF-8、无 `__pycache__`、SSE 状态和日志约定（`.../geminiPreviewTemplate.test.ts:107-192`，尤其 `:135-140`）；没有覆盖 `copy_snapshot_tree` 的黑名单、caps、ignore、链接或 cleanup。故 Python snapshot 的上述行为来自实现/文档，不能宣称已有回归保护。

### 2. 现有严格 Node helper：Grok `createFocusedSnapshot`

这是仓库内唯一已有 Node/ESM 的“聚焦、数据最小化” snapshot；`templates/engine/.../snapshot.mjs` 与 plugin 镜像 `plugins/ccg/.../snapshot.mjs` 当前 sha256 相同（两份均 `467e26e755c7e6dfcab325c017904a7d6f062301ee16db9d312f96519b220bc8`）。

- 默认 cap：最多 200 个文件、单文件 2 MiB、总计 16 MiB（`components/ccg-workflow/templates/engine/tools/grok-intelligence/lib/snapshot.mjs:6-10`）；`normalizeLimits` 只接受非负整数（`:117-124`）。
- 必须传入非空 `selectedPaths`；只复制显式选择的文件/目录，按路径排序；在任何写入前完成 file-count、per-file、total-byte 三个 cap 检查（`:126-151`, `:190-216`）。
- 过滤更严格：拒绝 `.git/.github/.claude/.codex/.grok` 等 VCS/隐藏运行面、`node_modules/vendor/dist/build/coverage/skills/hooks/plugins` 等依赖/扩展目录；拒绝 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `auth.json`, `credentials.json`, `.ccgignore`, `.envrc`, `.mcp.json`, `.npmrc`, `.netrc`, 证书/私钥、`service-account*`、credential/secret/token/auth 命名文件（`:12-23`, `:35-53`）。
- `.ccgignore` 仅接受根目录、非 symlink、regular file、≤64 KiB；只编译非否定规则，规则支持 `*`, `**`, `?` 和目录尾 `/`（`:60-90`）。
- 路径约束：输入必须是非空相对路径，拒绝绝对路径、`.`/`..`/空 segment（`:25-33`）；repoRoot、snapshotRoot 必须是绝对且无链接目录，源/目标不可互相包含，目标必须为空（`:172-190`）。路径链逐段 `lstat`，拒绝 symbolic link/junction/reparse，随后 `realpath` 与 root containment/identity 再核对（`:98-115`；`path-safety.mjs:17-43`）。
- 输入必须是 regular file；拒绝 `metadata.nlink > 1` 的 hard-link；读后重新 `stat` 比较 inode/device/size/mtime，检测读取期间替换（`snapshot.mjs:126-151`, `:198-208`）。
- 目标目录按 `mkdir(..., mode: 0o700)` 创建，文件和 `changes.diff` 用 `flag: 'wx'`, `mode: 0o400` 并再次 `chmod(0o400)`；dirty diff 只保留 selected path 且计入 cap（`:211-237`）。

其 temp/cleanup 也有独立实现：`createPrivateRunRoots` 建立 owner-only `runRoot/neutral-home/snapshot/raw`，Windows 走 ACL，最终返回 `cleanup`（`private-temp.mjs:128-143`, `:172-227`）；`removePrivateRunRoot` 只接受 canonical parent 下形如 `ccg-grok-run-*` 的目录，先递归拒绝 reparse，再 `rm(...,{recursive:true,force:true})`（`:146-170`）。

测试覆盖明确存在：

- 只拷贝 selected files、dirty diff 按路径过滤、目标文件无写位：`src/utils/__tests__/grokIntelligenceRunner.test.ts:69-85`。
- secrets/dependencies/VCS/instruction/extension surface（含 `.env`, `credentials.json`, `.git/config`, `node_modules`, `AGENTS.md`, `CLAUDE.md`, `.codex`, `skills`, `hooks`, `plugin.json`, `.mcp.json`, `service-account.json`）：`:87-119`。
- `.ccgignore` 拒绝显式选中路径且不把 ignore 文件复制到目标：`:121-132`。
- traversal、junction/symlink escape、hard-link：`:134-152`；file-count/per-file/total-byte cap 在复制前拒绝：`:154-165`。
- owner-only temp roots、无 symlink、cleanup 删除 runRoot、越界 cleanup 拒绝：`:208-233`；完整 runner 结束后 `result.runRoot` 不存在：`:389-394`。

### 3. product-manager 当前执行 seam

- `invokeProvider` 目前只 `mkdtemp(join(tmpdir(), 'ccg-product-manager-'))` 建立空目录（`components/ccg-workflow/src/commands/product-manager.ts:253-260`），在该目录生成 Codex `output.schema.json`（`:290-295`）或 Gemini `deny-all-tools.toml`（`:340-356`），最后无条件 `rm(workspace,{recursive:true,force:true})`（`:370-372`）。真实仓库内容从未进入 Provider cwd。
- 三个 Provider 都将 `cwd` 设为该空目录（Codex `:296-307`、Claude `:319-329`、Gemini `:357-368`）。Codex 用 `--sandbox read-only`, `--ephemeral`, 多个 `--disable`（含 `shell_tool`, `multi_agent`, `workspace_dependencies`）和 `--cd <workspace>`（`providers/codex.ts:9-49`）；Gemini adapter 只传 `--approval-mode plan`, deny-all policy, `--skip-trust`, JSON output 和 stdin prompt，没有 `--include-directories`（`providers/gemini.ts:4-28`）；Claude 传 `--tools ''`, 空 MCP/settings sources、`--no-session-persistence`, `--permission-mode plan`（`providers/claude.ts:4-45`）。
- 通用 Provider prompt 明确要求“Do not use tools, execute commands, modify files, or control subagents”并只给 JSON contract/input（`product-manager.ts:135-155`）。因此仅把空 cwd 换成 snapshot，并不会自动让 Claude/Gemini 获得读取能力；还必须有明确的只读读取机制（允许的 read-only provider capability，或由 Codex 在 prompt 中注入经过约束的文件内容）。这是当前代码事实，不是已实现能力。
- PM 的 Harness adapter 当前只把 `prd.md/design.md/implement.md` 的相对路径+sha256 放入 `repository_facts`，不把内容或可读文件列表放入输入（`scripts/lib/harness-adapter/product-manager.mjs:697-717`, `:762-767`）。

## 推断与复用边界（供主代理决策）

1. **不要直接复用 Python `invoke_gemini_preview.py` 作为 PM library。** 它是 CLI/浏览器预览 helper，不是可导入的 Node API；默认 snapshot 无 cap、允许复制大量非秘密内容、`copy2` 不设只读、没有 hard-link/源身份/读取竞态检查，且目前没有 snapshot regression tests。把它包成子进程会引入跨语言协议和 preview/server/日志副作用，超过 Ponytail 的最小边界。

2. **最小安全语义应复用现有 Node `createFocusedSnapshot`，而不是复制 Python 全树逻辑。** PM 应由 Codex/Harness 先给出显式 `selectedPaths`（至少是需要评审的 task artifacts；是否扩展到源码由上层决定），使用默认 `200/2 MiB/16 MiB` 或更紧的 PM cap，生成独立空 temp root，Provider cwd 只指向该 root；保留 `.ccgignore`、secret/instruction/plugin 过滤、link/reparse/hard-link/竞态检查、0400 文件和 finally cleanup。若只改 PM，最小可行方式是写一个很薄的 PM adapter 调已有聚焦 helper；不要复制一份 Python `copy_snapshot_tree`。

3. **“抽取共享模块”只有在 PM 与 Grok 都要长期调用时才值得。** 当前 Grok helper 位于 `templates/engine`，且在 `templates/` 与 plugin 中已有镜像；把其核心移到 `src/utils` 会牵涉 ESM/TS 构建、模板打包和两份 source parity，改动面明显大于一次 PM 接入。若采取抽取，必须同时更新两份运行时镜像并保留 `grokIntelligenceRunner.test.ts` 的现有安全测试；否则先通过稳定的 package-relative runtime import/薄 wrapper 复用，不要引入第三套 copy 逻辑。（这里的 package-path 可行性需主代理在 build/dist 中验证。）

4. **snapshot 不等于 Provider 读权限。** 当前 PM 的 prompt/flags 是 deny-all/no-tools；要让 Provider 实际读取 snapshot，必须在产品契约中明确“只读文件读取”能力和路径范围，再对 Codex/Gemini/Claude 分别验证 argv 与真实 fake-provider 读取；不能把切换 `cwd` 或把路径放进 prompt 当作已验证的 end-to-end 读取。

## 建议验证命令

在 `I:\ai\trellis-ccg-harness-pm-workspace-access\components\ccg-workflow`：

```powershell
pnpm vitest run src/utils/__tests__/grokIntelligenceRunner.test.ts src/utils/__tests__/geminiPreviewTemplate.test.ts src/product-manager/__tests__/provider-registry.test.ts src/product-manager/__tests__/provider-runner.test.ts src/product-manager/__tests__/command.test.ts
pnpm typecheck
```

复用/抽取后再补一个 PM snapshot 回归测试（应是新增测试，不是当前已有证据）：fake Provider 只能在 snapshot cwd 读取选定普通文件；assert secret/instruction/`.ccgignore`/symlink/junction/hard-link/traversal、file-count/per-file/total-byte cap fail closed；assert目标文件无写位、Provider 超时/异常后 temp root 不存在。最后检查模板/plugin 镜像仍一致：

```powershell
Get-FileHash templates/engine/tools/grok-intelligence/lib/snapshot.mjs,plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/lib/snapshot.mjs -Algorithm SHA256
```

如果仍考虑 Python helper，只做隔离的 `copy_snapshot_tree` 单元 probe（含 `.env`, `.git`, `node_modules`, symlink、`.ccgignore`、cap），不能把该 probe 当作 PM 安全边界验收。
