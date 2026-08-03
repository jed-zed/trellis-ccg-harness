# 技术设计：Product-manager 工作区只读访问

## 1. 设计目标

在不授予 Provider 真实工作区权限的前提下，把“工作区内容”变成一个有界、可哈希、可清理的评审输入。Transport 只决定 Claude 在本机还是 SSH 远端消费同一快照，不改变 Provider 路由、Trellis 权威或用户 gate。

## 2. 权威边界

| 决策 | 唯一权威 | 说明 |
|---|---|---|
| PM Provider | CCG unified routing `product-manager` | project/task 不选择或回退 Provider |
| Claude transport | `.harness/project.json.productManager.claudeTransport` | 非敏感 `local|ssh`，缺失为 local |
| Provider capabilities | `.harness/adapter.json.productManager.providerCapabilities` | 保持 read-only/no-write/no-terminal/no-subagents |
| 任务与验收 | Trellis task artifacts / `product-manager.json` | Provider 只提供 evidence |
| 实际写入与最终验证 | Codex | Provider 永不写 canonical workspace |

`adapter.json` 不重复保存 transport。`runInstalledProductManagerReview()` 同时读取 user-owned adapter capability contract 和 Harness-owned project contract；static conflicts 分别验证二者，不增加双写漂移面。

## 3. 项目合同

在 initializer canonical source 中为 `productManager` 增加：

```json
{
  "claudeTransport": "local"
}
```

- schema enum：`local | ssh`；template 默认 `local`。
- 兼容读取：字段缺失等价于 `local`；未知值 blocking。
- `assertProductManager()` 接受缺失或合法枚举，并在生成新 project contract 时写入显式默认。
- 同步 `.harness/project.schema.json`、`.harness/project.json` 与 ownership digest；`.harness/product-manager.schema.json` 是 task-state schema，不增加该字段。
- SSH 详情禁止进入 schema/template/project/adapter/ownership/task state。

## 4. 两阶段快照协议

### 4.1 为什么需要两阶段

快照 SHA 必须在 Provider invocation key 生成前确定，否则同一 invocation 可能在不同工作区内容上重试或复用旧响应。Harness 不能仅把 repo path 交给 Provider 后再补摘要。

### 4.2 阶段 A：离线准备

Harness 使用已验证 installed CCG binding 调用纯离线入口：

```text
ccg product-manager snapshot --workdir <repo-root> --task-dir <task-dir> --json
```

该入口不解析 Provider、不联网、不进行付费调用，只做：

1. 使用 `git ls-files --cached --others --exclude-standard -z` 建立候选清单；
2. 调用共享的严格 Node focused-snapshot 核心；
3. 应用 `.ccgignore`、秘密/指令/插件/缓存/依赖/构建排除及 link/TOCTOU 防护；
4. 在 task-local ignored evidence 下创建随机 snapshot root；
5. 生成 manifest：`policy_version`、`sha256`、`file_count`、`total_bytes`、`git_head`、`dirty`；
6. 返回单一 JSON，所有路径必须位于 task-local evidence root。

PM 调用参数覆盖现有 helper 的 cap 为：2000 files、2 MiB/file、64 MiB total。超限或任一候选文件不安全时整体失败，不静默截断。

### 4.3 阶段 B：绑定并评审

Harness 将以下非敏感字段加入 PM canonical input，再计算 `input_digest` 和 `invocation_key`：

```text
workspace_snapshot.policy_version
workspace_snapshot.sha256
workspace_snapshot.file_count
workspace_snapshot.total_bytes
workspace_snapshot.git_head
workspace_snapshot.dirty
claude_transport
```

随后调用：

```text
ccg product-manager review ...
  --workspace-snapshot <snapshot-root>
  --workspace-manifest <manifest-path>
  --claude-transport <local|ssh>
```

CCG 必须重新验证路径 containment、manifest SHA、input 常量和只读文件状态，然后才构建 Provider execution。Harness 在 `finally` 删除本地 snapshot 内容，只保留 task-local ignored 的摘要/调用日志；tracked `product-manager.json` 只保存现有 advice/evidence refs。

## 5. 快照安全核心复用

基线是现有 Node `createFocusedSnapshot`，不是 Python `invoke_gemini_preview.py`：

- 保留路径归一化、`.ccgignore`、secret/instruction/plugin deny、symlink/junction/reparse/hardlink/TOCTOU、防 NUL、空目标目录和 `0400` 输出。
- 先合并 `fix-ccg-plan-snapshot`，保留 `allowedCcgPlanPaths` 仅对显式 plan binding 生效的语义。
- PM 与 Grok 将长期共用该安全核心，因此实施时抽取最小纯 Node module；Grok plugin/template 继续通过薄 wrapper 保持 byte-identical，PM 入口只传 manifest/caps，不复制过滤表。
- 如果 build/package 证明跨运行时 import 不可用，则保留生成镜像并增加 byte-parity test；不得手工维护第三套独立策略。

## 6. Provider 工具合同

所有 PM Provider 的 cwd 都是 snapshot root：

| Provider | 允许 | 明确禁止 |
|---|---|---|
| Claude | `Read,Glob,Grep` | Write/Edit/Bash/Shell/MCP/hooks/skills/plugins/subagents/session/browser |
| Codex | sandbox read-only 下的文件读取/搜索等价能力 | shell、workspace-write、MCP、multi-agent、network |
| Gemini | plan/deny policy 中仅文件读取/搜索等价能力 | shell、write、MCP、plugins/subagents |

不能用 prompt 文案或 `cwd` 代替工具校验。Provider factory、registry 和 fake-provider E2E 都必须证明 allowlist 与 denylist。

## 7. Local transport

- `local` 是字段缺失和 template 的默认值。
- 解析顺序：验证后的 `CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE` 本地原生 override → 本机原生 Claude Code executable。
- local resolver 必须拒绝 SSH bridge、非 regular file、symlink/越界路径或无法验证的 native identity。
- Provider cwd 指向本地 snapshot；真实 repo root 不传给 Provider。
- local 不可用时返回 `unavailable`，不尝试 SSH。

## 8. SSH transport

### 8.1 环境合同

项目只保存 `ssh` 枚举。CCG 仅向 SSH controller allowlist 以下环境变量：

```text
CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST
CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER
CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT
CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE
```

`SSH_EXECUTABLE`、identity/known-hosts 文件和 remote executable 必须为符合各平台规则的绝对路径；host/user/port 使用白名单格式。禁止 password/token 环境变量，禁止关闭 host-key checking。

### 8.2 Bridge v2 合同

SSH 模式只调用 `CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE` 指定的受信绝对 bridge，不读取 local Claude override。Bridge 必须：

1. 通过版本探针声明支持 snapshot protocol v2；
2. 从受控输入读取本地 snapshot root 和 manifest SHA；
3. 在远端创建随机 temp directory，传输快照并复核摘要；
4. 在该目录运行明确 remote Claude executable，并只开放 Read/Glob/Grep；
5. stdin/stdout 保持 Claude 单一 JSON 协议，不向 stdout 注入 banner；
6. 在 success、non-zero、schema failure、timeout、disconnect 和 retry 后 cleanup；
7. 对诊断脱敏并限制 stderr；绝不在失败时调用本地 Claude。

Harness/initializer 不自动安装或登录 bridge。当前主机的旧 `CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE=claude-ssh-bridge.exe` 必须在实施验收阶段显式迁移到新 SSH 变量；代码不静默改用户环境。

## 9. 失败与重试

- Snapshot prepare 失败：不调用 Provider，记录 `unavailable`/明确诊断。
- Local 或 SSH transport 失败：只允许相同 Provider、相同 transport、相同 snapshot SHA 的既有 retry 次数。
- 每次 retry 使用新的远端 temp directory，但绑定同一 snapshot SHA。
- 任何 snapshot、transport、provider/model/CLI/schema/digest 漂移都在 projection 前拒绝。
- stdout 仍必须是单一 JSON；不做 substring recovery。

## 10. 兼容、部署与回滚

### 兼容

- 旧 project 缺字段 → local。
- recorded response 也必须对当前 snapshot identity 做 binding/stale 校验。
- 非 Claude PM Provider 使用本地 snapshot，忽略 `claudeTransport` 的执行分支，但 input identity保持确定。
- PM 状态 schema、hard gate、latestAdvice 和 Trellis lifecycle 不变。

### 部署顺序

1. 已在 `34e14f4` 基线上交付 shared snapshot、offline prepare 与 local transport。
2. 已接入 bridge v2 controller、环境合同和协议探针；外部 bridge binary 仍由运维单独交付。
3. 单独批准 commit 后更新 exact committed source snapshot，并重跑 source verify/doctor。
4. bridge v2 可用后补齐 fake/live cleanup 矩阵；真实调用仍需单次授权。

### 回滚

- 配置回滚：将项目 transport 设为 `local`；不会触发 Provider fallback。
- 代码回滚：撤销 transport/snapshot 接入，恢复 PM 空 disposable cwd；不回滚 Trellis task state。
- Bridge 故障：保持 `ssh` 时 fail closed；由用户显式改回 local，系统不自动切换。

## 11. 关键取舍

| 主题 | 选择 | 放弃项 |
|---|---|---|
| 工作区暴露 | disposable safe snapshot | 直接把真实 repo 作为 Claude cwd |
| Snapshot owner | installed CCG offline prepare + Harness identity binding | Harness/CCG 各复制一套过滤规则 |
| Transport authority | project contract enum | 环境变量静默决定 local/ssh |
| SSH 集成 | 明确 bridge v2、env-only details、fail closed | PATH fallback、自动本地回退 |
| Caps | 2000 / 2 MiB / 64 MiB 固定安全上限 | 新增可调配置面 |
| Provider 能力 | 明确 Read/Glob/Grep allowlist | 仅靠 prompt 或 plan mode 推断只读 |
