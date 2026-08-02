# Product-manager project contract propagation

本笔记只记录当前 checkout 的传播链、事实和带证据的推断；不把 SSH 传输实现当作现状。

## 已确认事实

### 1. Canonical contract / schema / template

- 分发源是 `.agents/skills/harness-init/assets/project-contract.schema.json`；`productManager` 目前 required 仅为 `stateAuthority`, `stateFile`, `evidenceRoot`, `selectedProviderAuthority`, `allowedProviders`, `providerCapabilities`（schema:309-364），且 `additionalProperties:false`（364）。`providerCapabilities` 只要求 codex/gemini/claude，三者均引用 read-only provider 定义（343-362）；read-only 定义禁止 workspaceWrite/terminal/subagents，并将 network/paid 固定为 `explicit-per-call`（schema:398-427）。
- 分发默认实例是 `.agents/skills/harness-init/assets/project-contract.template.json:110-146`；项目级 PM policy 目前没有 transport 字段。当前生成副本 `.harness/project.schema.json` 应与该 schema 字节（规范化 LF）一致，`.harness/project.json:235-271` 是其已批准实例。
- `.harness/product-manager.schema.json` 是 task-local `product-manager.json` 状态 schema，不是 project contract schema；不要把 project-level `claudeTransport` 加到它。当前 ownership 同时记录 project schema 与 PM 状态 schema 的 digest（`.harness/ownership.json:1-34`; core `buildProjectOwnership()` at `.agents/skills/harness-init/scripts/harness-init-core.mjs:3988-4034`).

### 2. Initializer validation and transaction

- `assertProductManager()` 在 `.agents/skills/harness-init/scripts/harness-init-core.mjs:2038-2117` 对 `productManager` 使用 exact key set，并校验 authority、allowed provider 子集及每个 capability；仅修改 JSON/schema 而不改此函数会在 `validateProjectContract()`（2381-2409）失败。
- `validateProjectContract()` 先调用 `assertNoCredentials()`（core:1980-2003）；secret-looking key/value 在 mutation 前拒绝。Harness 初始化规范明确 `apply` 只接受 approved、secret-free contract，并将 canonical JSON 写入 `.harness/project.json`；`.harness/adapter.json` 等已有无关条目保持 user-owned/byte-preserved（`.trellis/spec/tooling/harness-initializer.md:58-80,94-98`）。
- `PROJECT_TRANSACTION_TARGETS` 明列 `AGENTS.md`, policy snapshot, `.harness/project.json`, `.harness/project.schema.json`, `.harness/product-manager.schema.json`, ownership 等，但不含 `.harness/adapter.json`（core:139-149）。`applyProjectContract()` 读取 source skill 的 project schema 和 PM 状态 schema、规范化 schema bytes、计算三类 digest（core:4197-4270），然后 transactionally stages the owned project/schema/PM-schema/ownership targets。由此可确认：initializer 的 canonical project propagation 不会自动写 adapter.json。
- ownership 的 managed paths 明列 `.harness/project.json`, `.harness/project.schema.json`, `.harness/product-manager.schema.json`（core:3988-4034）。PM schema 缺失、digest mismatch 或 managed-path drift 会被 `validateExistingProjectOwnership()` 阻断（core:4037-4109）。Transport 增加到 project contract 后，`contractSha256`/`schemaSha256` 会自然改变；ownership 不应保存 SSH 连接字段。

### 3. Runtime adapter and conflict checks consume two surfaces

- Installed PM runtime `runInstalledProductManagerReview()` 读取 `.harness/adapter.json` 和 `harness.sources.json`（`scripts/lib/harness-adapter/product-manager.mjs:1080-1098`），不是 `.harness/project.json`。`allowedProvidersFromContract()`（1058-1078）从 adapter contract 读取 allowed providers/capabilities，并仅保留独立 read-only 的 codex/gemini/claude。
- Static conflict `checkProductManagerManagedAssets()` 读取 `.harness/project.json`, both schemas, and ownership, verifies all three digests/managed paths, then compares project PM authority/state paths/selected authority/allowed providers with `.harness/adapter.json` ( `scripts/lib/harness-adapter/conflict-static.mjs:386-448` ). A new transport field will not be checked by this function unless the check is extended; otherwise project/adapter transport drift is invisible.
- Current adapter fixture contains a PM runtime policy with relative state paths and an extra `grok` capability (`tests/harness-adapter.test.mjs:134-194`); its fixture project copies adapter PM policy and rewrites state/evidence paths to `<task>` form (`tests/harness-adapter.test.mjs:286-323`). This fixture therefore needs a transport field in both project and adapter surfaces if those remain duplicated.
- Conflict runtime rejects Harness/Trellis/CCG assets under project `.claude` (`scripts/lib/harness-adapter/conflict-runtime.mjs:337-414`), while unknown user `.claude` content is informational. There is no current source showing SSH details belong in project `.claude`.

### 4. Task state is a separate authority

- Adapter task authority resolves `.trellis/tasks/<task>/product-manager.json` and ignored `.ccg-evidence/product-manager` (`scripts/lib/harness-adapter/product-manager.mjs:108-123,559-665`; conflict static state routing uses `contract.productManager.stateFile/evidenceRoot`, `conflict-static.mjs:173-260`). This is why the project contract's state paths are policy metadata, not transport credentials.
- Historical PM design says unified CCG routing is the sole provider-selection authority; project/Harness only allow/deny capabilities, and credentials/network/paid remain separate (`.trellis/tasks/07-27-product-manager-role-integration/prd.md:96-123`; `design.md:244-298`). A transport selector therefore must not become a provider selector.

## Propagation inventory (fact + scoped implication)

If a project-level `productManager.claudeTransport` enum is introduced, the following are the current propagation points:

1. **Canonical source (fact):** add the field and default to `project-contract.template.json`; constrain it in `project-contract.schema.json` (`productManager.additionalProperties:false`). Because `assertProductManager()` has exact keys, mirror the field and its `local|ssh` validation there. This is the only initializer-owned canonical project contract path.
2. **Generated/owned copies (fact):** regenerate `.harness/project.schema.json` and `.harness/project.json` through `applyProjectContract()`; ownership digests change automatically. `.harness/ownership.json` changes only in digest values, not by storing transport or SSH data. `.harness/product-manager.schema.json` remains unchanged unless task state itself gains an unrelated field.
3. **Runtime projection (fact + gap):** adapter runtime currently reads `.harness/adapter.json`, and conflict checks compare overlapping PM policy against project JSON. Either (a) add a deliberately synchronized, non-secret transport projection to adapter.json and extend `checkProductManagerManagedAssets()`/fixtures, or (b) change runtime to read the owned project contract. Current initializer deliberately preserves adapter.json, so option (a) cannot be achieved by `applyProjectContract()` alone without changing its ownership boundary. The existing spec's statement that adapter.json is user-owned is authoritative for current code.
4. **Migration helper (fact):** `migrateProjectProductManager()` (core:4853-4975) builds a candidate by spreading `template.productManager` and selecting providers, then calls `applyProjectContract()`; it is exported but not wired as a CLI command (`parseCliArgs`, core:6324-6347, has no migrate-product-manager branch). A template field therefore propagates through this API path, but callers/tests must exercise it explicitly.
5. **Fixtures/tests (fact):** update contract fixture construction from template and expected PM fields in `tests/harness-init-cli.test.mjs` (source/template and apply/ownership assertions), source/generated equality and digest checks in `tests/harness-init-skill.test.mjs:91-161,238-298`, adapter/project duplicate fixture in `tests/harness-adapter.test.mjs:134-323`, and installed-runtime PM fixture in `tests/product-manager-e2e.test.mjs:116-140`. Add a conflict test proving project-vs-adapter transport drift is blocking if duplication remains.
6. **Not source snapshots (fact):** `harness.sources.json`/`components/ccg-workflow` source snapshot tracks CCG/Trellis provenance; prior PM design says routing changes do not update source snapshot (`.trellis/tasks/07-27-product-manager-role-integration/design.md:411-423`). A project transport enum alone should not alter source provenance.

## SSH detail boundary (facts, then inference)

- **Facts:** no current `claudeTransport` field or project SSH connection schema was found in this checkout; `assertNoCredentials()` rejects credential-looking keys/values (core:1980-2003), the initializer spec forbids provider credentials in the contract (tooling spec:94-98), and runtime policy forbids Harness/CCG Claude assets under project `.claude` (conflict-runtime:337-414).
- **Inference for implementation:** tracked project files (`project-contract.template.json`, project schema/JSON, adapter policy projection, ownership, task input/evidence/audit, fixtures) should contain only `local|ssh` (and, if needed, a non-secret transport identity/capability). They must not contain SSH host, user, port, private key, password/token, known-hosts path, arbitrary command/path, raw env values, or connection strings. Those details have no canonical project source in the current repo and should remain user/global runtime configuration behind the CCG Claude SSH boundary; this is an implementation boundary to verify, not an existing repository fact.
- **Security invariant:** default absent field must resolve to `local`; selecting `ssh` must be explicit and must not affect unified provider selection, task-state authority, ownership digests beyond normal contract/schema hashes, or permit local fallback on SSH failure. These are recommended invariants, not current behavior.

## Minimal verification commands

From `I:\ai\trellis-ccg-harness-pm-workspace-access`:

```powershell
node --test tests/harness-init-cli.test.mjs
node --test tests/harness-init-skill.test.mjs
node --test tests/harness-adapter.test.mjs
node --test tests/product-manager-e2e.test.mjs
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
pnpm harness:test
```
