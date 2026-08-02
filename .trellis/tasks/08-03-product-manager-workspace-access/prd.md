# Product-manager 工作区只读访问

## 目标

让 Harness 的 `product-manager` Provider 能基于当前工作区的真实内容进行评审，同时保持 Codex 为唯一工作区写入者和 Trellis 为唯一任务生命周期权威。

用户价值：Claude 不再只能看到结构化摘要；它可以读取、列目录并检索与评审有关的代码和文档，从而给出可核验的产品建议，但不能执行命令或改变任何项目状态。

## 背景与已确认事实

- 当前 `product-manager` Provider 在空的一次性目录运行，只能读取 prompt 中的有界 JSON，不能读取仓库文件。
- CCG 的 `frontend`、`backend` 是 Provider 路由角色，不自行授予权限。PM 的普通工作区可见性继承前端 Provider 的隔离快照思路；PM 保持单独的只读边界，不继承后端 Codex 的写入和 Bash 权限。
- 用户已确认：Claude 只能读取、列目录、Glob 和 Grep；禁止终端、写入、子代理及自动回退。
- 用户已确认：默认使用本机安装并登录的原生 Claude Code；SSH 是项目显式可选传输。
- 用户已确认：SSH 连接详情只来自环境变量，不进入 Git；SSH 失败不得切回本地 Claude。
- 用户已确认：每次 SSH 评审使用新的远端临时快照，结束后清理。
- `fix-ccg-plan-snapshot` 已随 `34e14f4` 进入本任务基线；共享快照实现必须继续保留其 plan-only allowlist 语义。

## 需求

### R1 — 工作区可见性

每次 PM 评审必须为选中的 Provider 准备一次性、只读、内容有界的工作区快照。候选内容包含 Git 已跟踪文件、当前未提交修改，以及未被 Git 忽略的新文件。

快照必须应用现有严格快照语义：拒绝秘密文件、Provider 指令文件、插件/凭据目录、VCS/缓存/依赖/构建目录、路径穿越、符号链接、junction/reparse point、hard link、读取竞态及 `.ccgignore` 排除项。

### R2 — 只读工具合同

PM Provider 只允许各 CLI 严格等价的 `Read`、`Glob`、`Grep` 和目录查看能力。必须明确拒绝 `Write`、`Edit`、`Bash`、Shell、MCP、hooks、skills/plugins、浏览器、会话持久化和子代理。

只读工具只作用于一次性快照，不能访问快照之外的真实项目路径。

### R3 — 本地 Claude 默认

未配置传输方式时必须选择 `local`，解析并调用本机原生 Claude Code。Harness 不安装、不登录、不复制 Claude 登录态。

本地 Claude 不可用时，评审记录 `unavailable`；不得尝试 SSH。

### R4 — 项目级 SSH 选择

Harness 项目合同可记录非敏感枚举 `productManager.claudeTransport = local | ssh`，默认 `local`。该字段只选择 Claude 的传输方式，不改变 CCG unified routing 的 Provider 选择权威。

选择 `ssh` 时必须使用受信的绝对 SSH bridge executable。SSH host、user、port、identity file、known-hosts 和远端 Claude 路径只从显式 allowlist 环境变量读取，不得写入 project/adapter/task/evidence/audit 文件。

### R5 — SSH 临时快照生命周期

每次 SSH invocation 必须创建独立随机远端目录、传输与本地相同的安全快照、在该目录运行远端 Claude，并在成功、Provider 错误、schema 错误、超时、断连和 retry 后执行清理。

SSH 连接、传输、远端版本或清理失败必须失败关闭；不得切换为本地传输或其他 Provider。

### R6 — 快照身份与审计

每次评审必须记录非敏感快照摘要：policy version、SHA-256、文件数、总字节数和 Git 基线/dirty 标记。该身份必须绑定到 PM input digest、invocation key 和输出 schema 常量，避免工作区改变后复用旧建议。

原始工作区内容不得写入 tracked task state；一次性文件留在 task-local ignored evidence 范围并在调用后清理。

### R7 — 兼容与迁移

- 旧项目没有 `claudeTransport` 时按 `local` 处理。
- 新 initializer template 明确写入 `local`。
- 旧的 `CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE` 只作为本地原生 Claude override；SSH bridge 使用独立变量，避免主机级旧绑定把默认本地模式悄悄改成 SSH。
- 迁移不得自动修改用户级环境变量、安装 bridge 或进行登录。

### R8 — 权威与授权不变

- Codex 仍是唯一工作区 writer 和最终验证者。
- Trellis 仍拥有任务、PRD、计划、状态、gate 和完成权威。
- PM live provider call 仍需当前 Codex task 显式 `--allow-provider-call`；配置 transport 不等于授权联网或付费调用。
- Provider retry 只允许相同 Provider、相同 transport、相同 invocation key；Provider fallback 和 transport fallback 都禁止。

## 验收标准

- [ ] **AC1 / R1-R2**：本地 fake Claude 能在快照中读取已跟踪文件、未提交修改和未忽略新文件，并能 Glob/Grep；真实工作区在调用前后字节不变。
- [ ] **AC2 / R1**：`.env`、凭据、私钥、Provider 指令、`.git`、依赖/构建目录、`.ccgignore` 命中、traversal、symlink/junction/reparse point、hard link 和竞态文件均被拒绝，且错误不泄露内容。
- [ ] **AC3 / R3-R4**：字段缺失或为 `local` 时不会启动任何 SSH 程序；本地 Claude 缺失时返回 `unavailable`，无 SSH 回退。
- [ ] **AC4 / R4**：project schema 只接受 `local|ssh`，tracked 配置中不存在 SSH 连接详情；非法值触发 initializer/conflict blocking。
- [ ] **AC5 / R5**：fake SSH bridge 证明每次调用使用不同远端目录，并在成功、失败、超时、断连和 retry 路径清理；SSH 失败不启动本地 Claude。
- [ ] **AC6 / R2**：Claude、Codex、Gemini PM adapters 都证明只读工具可用，写入/终端/MCP/hooks/plugins/subagents 失败关闭。
- [ ] **AC7 / R6**：快照内容或 transport 改变会改变 input digest/invocation key；旧响应被 stale/binding 校验拒绝。
- [ ] **AC8 / R7-R8**：旧项目缺字段仍解析为 local；initializer/source/owned schema 保持一致；PM state、CAS、hard gate 和 latestAdvice 行为无回归。
- [ ] **AC9**：focused tests、Harness offline gates、CCG lint/typecheck/test/build、质量扫描和安全扫描全部通过；Critical/High 发现为零。
- [ ] **AC10**：真实 SSH 验收只有在兼容 bridge 可用并获得单次 live-call 授权后执行；未执行时必须明确标记为未验证，不能用 fake bridge 结果代替。

## 不在范围内

- 让 PM Provider 写代码、执行 Bash 或控制子代理。
- 给普通 Claude delegation、legacy Claude mode 或其他 CCG role 启用 SSH。
- 自动安装/升级/登录 Claude、SSH 客户端或 bridge。
- 保存密码、token、私钥内容或 SSH 连接字符串。
- 在 Provider 失败时自动改用另一个 Provider 或 transport。
- 将一次性快照内容提交到 Git。
- 改变 Trellis lifecycle、PM hard gate 或用户最终验收权威。

## 约束

- 复用现有 Node 严格快照安全语义；不得直接把 Python Gemini preview copier 当作 PM library，也不得再造第三套过滤规则。
- 默认快照上限为 2000 文件、单文件 2 MiB、总计 64 MiB；超限明确失败，不静默截断。项目可通过既有 `.ccgignore` 缩小范围，本任务不新增可调参数。
- Provider 与 bridge 进程必须使用受信绝对 executable、`shell:false`、最小环境、超时、stdout/stderr 上限和进程树清理。
- 用户已明确批准实施及 CCG/Harness commit；任务保持 `in_progress`，推送、安装、登录和 live Provider 调用仍需各自独立授权。

## 风险与延期项

- `fix-ccg-plan-snapshot` 与 CCG `3.4.5` source/runtime 基线已对齐；权威 CCG 实现已提交为 `6c85839744ac7d91776929a207f45fdeab132179`，Harness staged snapshot 已通过 committed-source 门禁。
- 当前机器只有编译后的 `claude-ssh-bridge.exe`，仓库内没有其源码。Harness/CCG 将定义并校验 bridge v2 协议，但 bridge 的升级、安装和真实远端验收仍是显式运维步骤。
- 强制终止或远端主机失联可能留下远端临时目录；正常结果、错误、timeout 和 retry 必须清理，异常残留由 bridge 的下次启动清理/运维检查处理，不由 Harness 自动连接远端扫描。

## 阻塞问题

外部 bridge v2 binary/source 不在本仓库内，因此真实 SSH 传输与远端 cleanup 尚未验收；不得把 controller/unit test 当作 live 成功。
