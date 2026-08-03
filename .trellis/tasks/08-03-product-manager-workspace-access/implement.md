# 实施计划：Product-manager 工作区只读访问

> 当前状态：实施中。用户已明确批准修改、CCG/Harness commit、push 与 PR 合并；安装、登录和 live Provider 调用仍未授权。

## 0. 合并前置与基线确认

- [x] `fix-ccg-plan-snapshot` 已随 `34e14f4` 进入本 worktree，并重新检查：
  - 两份 Grok `snapshot.mjs`、`command.mjs`、`runner.mjs`；
  - `allowedCcgPlanPaths` 的显式 plan-only 语义；
  - Grok distribution byte-parity tests；
  - project schema、ownership digest 与 `globalEssential` 15 项。
- [x] CCG source/runtime 已对齐 `3.4.5`；权威源已提交为 `e1e5986cd3fd10545f7d7451e6a6d1e1ba735715`（tree `e5363687ae992546c654e626871c5474f13af79d`），Harness snapshot 已通过事务式门禁与 staged `verify-sources -Index`。`runInstalledProductManagerReview()` 的 exact-version 门禁保持不变。
- [x] 本 worktree 的本机检出限制已隔离：Windows 防护会立即移除 `components/ccg-workflow/templates/skills/domains/security/{pentest,red-team}.md`，当前通过 worktree-local sparse-checkout 排除；提交清单不含这两个文件的删除，并由可完整检出的权威 CCG checkout 完成 staged source verify。
- [x] 已运行 `git status --short`、`git diff --check`；无 whitespace error，变更均属于本任务。
- [ ] 重新运行：

```text
ccg route --workflow plan --phase intake \
  --task-file .ccg/tasks/08-03-product-manager-workspace-access/intelligence-request.md \
  --state-file .ccg/tasks/08-03-product-manager-workspace-access/intelligence-route.json \
  --plan .trellis/tasks/08-03-product-manager-workspace-access/implement.md
```

## 1. Harness 项目合同（3 点）

**目标文件**：initializer canonical schema/template/core、生成的 `.harness/project*.json`、ownership、initializer/conflict tests。

- [x] 在 canonical project contract 中增加可选 `productManager.claudeTransport` enum，template 默认 `local`。
- [x] 更新 `assertProductManager()`：缺失按 legacy local，未知值拒绝；禁止 SSH detail keys/values。
- [x] 通过 initializer 事务更新 `.harness/project.json`、`.harness/project.schema.json` 和 ownership digest；不改 `.harness/product-manager.schema.json`。
- [x] `runInstalledProductManagerReview()` 从 owned project contract 读取 transport；`adapter.json` 继续只提供 Provider capability/allowedProviders，不复制 transport。
- [x] 扩展 static conflicts：schema/ownership/transport 非法值 blocking；不存在 project-vs-adapter 双写比较。

**先写失败测试**：initializer schema/template/default/legacy/invalid/credential-key；conflicts 非法 transport。

## 2. 共享安全快照核心与 offline prepare（5 点）

**目标文件**：现有 Node focused snapshot helper、Grok plugin/template wrappers、PM command/新 snapshot tests。

- [x] 在合并后的 Grok helper 上抽取最小纯 Node snapshot core；保留两份 runtime wrapper byte-identical 和现有 plan allow-set 语义。
- [x] 新增 `ccg product-manager snapshot` 纯离线入口：
  - `git ls-files --cached --others --exclude-standard -z` 候选；
  - PM caps `2000 / 2 MiB / 64 MiB`；
  - task-local ignored 随机 snapshot root；
  - 单一 JSON manifest/摘要；
  - 无 Provider 解析、网络或付费调用。
- [x] 对 workdir/task-dir/manifest/snapshot path 做 realpath containment、regular file、link/reparse/hardlink/TOCTOU 校验。
- [x] snapshot 内容权限设为只读；normal/error/timeout 清理 snapshot 内容并保留有界摘要。
- [x] 保持 `.ccgignore`、secret/instruction/plugin/cache/dependency/build deny；超限整体失败且诊断脱敏。

**先写失败测试**：tracked/dirty/untracked 可见；ignored/secret/link/race/caps 拒绝；Grok plan 例外无回归；distribution parity。

## 3. Harness→CCG 快照身份绑定（4 点）

**目标文件**：`scripts/lib/harness-adapter/product-manager.mjs`、PM contracts/canonical JSON/invocation、Harness PM state/concurrency/e2e tests。

- [x] 在 live/recorded review 需要 Provider context 时，先通过 trusted installed CCG binding 调用 offline snapshot。
- [x] 校验返回 JSON、版本、task-local containment 与 manifest SHA；将非敏感摘要和 `claude_transport` 加入 canonical input。
- [x] 更新 input schema、canonical digest、invocation key、bound output schema 和 stale/CAS 校验；ephemeral path 与 SSH details 不入 digest/state。
- [x] `review` 显式接收 snapshot path/manifest；CCG 在 Provider 启动前复核绑定。
- [x] Harness `finally` 删除整个本地随机 snapshot 目录；tracked projection 只保留 advice/evidence refs。

**先写失败测试**：snapshot/transport 改变使 invocation key 变化；旧 response stale；malformed snapshot output/越界 path/摘要漂移不调用 Provider。

## 4. Provider 只读工具矩阵与 local 默认（4 点）

**目标文件**：Claude/Codex/Gemini PM provider adapters、registry、runner、command tests。

- [x] 将三种 PM Provider cwd 绑定到已验证 snapshot，而不是空目录或真实 repo。
- [x] Claude 明确 allow `Read,Glob,Grep`，保留 safe-mode/无 MCP/hooks/plugins/session/browser/subagents，并明确拒绝写/终端。
- [x] Codex/Gemini 使用各自 CLI 的严格只读等价配置；不能只靠 prompt。
- [x] local resolver 只接受受信原生 Claude，保留 `shell:false`、最小 env、显式 `--model opus`、timeout/output/process-tree kill。
- [x] local 缺失/失败记录 `unavailable`，且 transport 分支不启动 SSH executable。

**先写失败测试**：fake Provider 能 Read/Glob/Grep；Write/Edit/Bash/MCP/subagent 均失败；真实 repo bytes 不变；旧 SSH bridge 不能被 local override 接受。

## 5. SSH bridge v2（5 点）

**目标文件**：PM SSH transport/controller、provider runner/registry、bridge contract docs、fake bridge fixtures/tests。

- [x] 增加 `CCG_PRODUCT_MANAGER_CLAUDE_SSH_*` 明确 allowlist；禁止 password/token、任意 env 继承和 tracked SSH details。
- [x] 验证 bridge absolute executable、bridge protocol v2、host/user/port/path/known-hosts；禁止关闭 host-key checking。
- [x] controller 把本地 snapshot/manifest 与每次唯一 attempt ID 交给 bridge；远端随机目录和摘要复核由 bridge v2 实现。
- [ ] 远端 Claude 只允许 Read/Glob/Grep；stdout 保持单一 JSON，stderr 有界脱敏。
- [ ] success、non-zero、schema error、timeout、disconnect、retry 都执行远端 cleanup；任何失败不得启动 local Claude 或别的 Provider。
- [x] 增加 current-host migration/doctor 诊断：旧 bridge 仍绑定在 `CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE` 时给出明确 fail-closed 提示，不自动改用户环境。

**先写失败测试**：缺 env/非法字段/bridge version mismatch；每次远端目录唯一；全失败路径清理；secrets 不出现在 CCG argv/log/evidence；no transport fallback。

## 6. 文档、模板与分发同步（3 点）

- [x] 更新 canonical Harness collaboration policy、initializer docs、`.trellis/spec/tooling/product-manager-review.md`、layered adapter guide、`scripts/DESIGN.md`。
- [x] 更新 CCG PM README/DESIGN/CHANGELOG、plugin/marketplace description、provider command/Skill 文档；明确 local 默认、SSH opt-in、env-only、no install/login/no fallback。
- [x] 同步所有 generated/owned/template/plugin runtime copies，通过 source/tree/digest/byte-parity tests；不修改全局 plugin cache 或用户登录态。

## 7. 最小验证门禁（5 点）

### Focused

```text
cd components/ccg-workflow
pnpm vitest run \
  src/product-manager/__tests__/contracts.test.ts \
  src/product-manager/__tests__/provider-registry.test.ts \
  src/product-manager/__tests__/provider-runner.test.ts \
  src/product-manager/__tests__/command.test.ts \
  src/utils/__tests__/grokIntelligenceRunner.test.ts \
  src/utils/__tests__/grokIntelligenceDistribution.test.ts
```

```text
node --test tests/product-manager-state.test.mjs
node --test tests/product-manager-concurrency.test.mjs
node --test tests/product-manager-e2e.test.mjs
node --test tests/harness-adapter.test.mjs
node --test tests/harness-init-skill.test.mjs
node --test tests/harness-init-cli.test.mjs
```

### Harness + CCG offline gates

```text
pnpm harness:test
pnpm harness:conflicts
pnpm doctor
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
```

### 质量与安全

```text
node components/ccg-workflow/templates/skills/tools/verify-quality/scripts/quality_checker.js components/ccg-workflow/src/product-manager -v
node components/ccg-workflow/templates/skills/tools/verify-quality/scripts/quality_checker.js scripts/lib/harness-adapter -v
node components/ccg-workflow/templates/skills/tools/verify-security/scripts/security_scanner.js components/ccg-workflow/src/product-manager --json
node components/ccg-workflow/templates/skills/tools/verify-security/scripts/security_scanner.js scripts/lib/harness-adapter --json
```

- [x] 独立审查与 CCG PM 安全扫描未发现 Critical/High；Harness `.mjs` 不被该扫描器识别，未把 0-file 结果计作有效覆盖。
- [x] `node scripts/harness-adapter.mjs context` 与 `conflicts` 无 blocking。
- [x] `git diff --check` 通过；任务外 dirty 文件为零。

## 8. Live 验收与回滚点（3 点）

- [ ] **Local live**：单独获得付费/联网 Provider call 授权后，验证本机原生 Claude 在 snapshot 中读取一个已知文件；不得把 `/v1/models`、`--version` 或 fake Provider 当成功证据。
- [ ] **SSH live**：bridge v2、远端 `claude --version`、host key 和 env binding 均验证后，重新取得单次授权；验证远端读取、摘要一致、远端清理和本地无回退。
- [ ] 若 bridge 不支持 v2 或 live SSH 未执行，交付状态必须标记 SSH runtime 未验证；local 实现可独立验收，但不能声称 SSH 完成。
- [ ] 回滚测试：项目显式改回 `local` 后只走 local；代码回滚恢复旧 PM 空临时目录，不改 Trellis state/history。

## 9. 完成前检查

- [ ] PRD 的 AC1–AC10 全部有测试或明确的 live evidence。
- [x] 更新/复核相关 Trellis spec，记录 bridge v2、snapshot identity、transport authority 的长期约束。
- [x] 已运行最终 full-scope check；本 PR 的 commit、push 与 merge 已获授权，Trellis finish/archive 仍需在 live 验收完成后按独立生命周期处理。
