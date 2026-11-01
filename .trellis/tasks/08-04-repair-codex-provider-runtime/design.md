# 设计：Codex CCG Provider 运行链闭环

## 1. 权威与边界

Trellis 保存本任务的需求、设计与执行计划。CCG 只负责 Provider runtime、routing 和质量门。实现先进入 `I:\ai\ccg-gptpro-worflow` 的隔离 worktree，再以干净已提交 tree 同步到 Harness；禁止直接把 `components/ccg-workflow` 当运行时或权威源。

本任务不新增并行框架，也不重写 Go wrapper。最小方案是复用现有 verified binary 逻辑，并给 Codex plugin 一个稳定的 CLI shim。

## 2. 运行数据流

```text
ccg codex-mode install/update
  -> 下载 personal preset 候选
  -> SHA-256 + wrapper version 校验
  -> Codex transaction/ownership
  -> <CODEX_HOME>/ccg/bin/codeagent-wrapper[.exe]

Codex Skill
  -> ccg routing get <role>
  -> capability matrix 校验
  -> codex: 主代理直接处理
     gemini: 现有 preview helper
     antigravity/grok/pi: ccg wrapper --backend <provider>
     product-manager: 现有专用 read-only adapter

ccg wrapper
  -> 解析 CODEX_HOME
  -> 校验受管理 wrapper 文件存在、版本/摘要有效
  -> 使用参数数组 + stdin 启动 wrapper
  -> 原样转发退出码、stdout、stderr
```

## 3. 复用现有安装机制

`src/utils/installer.ts` 已有 pinned digest、下载重试、版本读取、原子候选提升和失败保留旧 binary。实现应抽取一个参数化的 `installVerifiedWrapperAt(targetDir)`/等价窄函数，让 legacy installer 和 Codex-mode 共用同一逻辑。

Codex-mode 将 `ccg/bin/codeagent-wrapper[.exe]` 纳入已有 planned files、transaction journal、backup 和 ownership manifest。候选校验完成后才进入事务提交；ownership 最后写入。旧 `.claude/bin` 不参与新事务。

## 4. 稳定 CLI shim

新增 `ccg wrapper` 而不是把 Windows 绝对路径写进每个 Skill：

- 仅接受 wrapper 自身已支持的 backend 与参数；普通 Claude 在入口层被拒绝。
- prompt 继续走 stdin，避免 Windows multiline/flag 注入问题。
- CLI 不实现 Web UI、resume 或 parallel，只把现有 wrapper 能力暴露到稳定路径。
- `--lite` 仅来自明确配置或用户参数；默认不添加。
- binary 缺失、摘要不符或版本不符时 fail closed，并指向 Codex-mode repair。

## 5. 能力与可用性模型

能力判断分两层：

1. **静态兼容性**：角色是否允许该 Provider；由一个共享常量/纯函数拥有，供 config normalization、`routing set`、doctor 和测试复用。
2. **运行可用性**：所需 adapter、managed wrapper、Provider CLI/认证和 enablement 是否满足；由 doctor/执行入口检查，不写回 routing。

| 角色 | 静态允许 Provider | 运行要求 |
|---|---|---|
| frontend/backend | codex, gemini, antigravity, grok, pi | Gemini helper 或 wrapper + 对应 CLI |
| search | codex, grok | Codex web 能力或启用的 Grok ACP/search evidence |
| product-manager | codex, gemini, claude | 现有 snapshot-bound adapter + per-call authorization |

不兼容配置不自动 fallback。读取配置时保留用户 bytes；doctor 报错，用户通过精确 `ccg routing set <role> <provider>` 修复。

## 6. Doctor 行为

Codex doctor 按顺序检查：ownership/transaction -> routing parse -> role compatibility -> adapter mapping -> managed wrapper integrity -> 当前外部 CLI availability -> provider-specific enablement/auth。

- 必需链断开：FAIL，非零退出。
- Provider 显式禁用且不参与普通流程：WARN/INACTIVE，不宣称可运行。
- 未选中的可选 Provider：不探测、不阻塞。
- Codex-mode 的 remediation 只建议 Codex-mode install/repair，不建议 legacy init。

## 7. 测试设计

### 离线自动化

- TypeScript 单元：安装目标、ownership、transaction/recover、capability matrix、config migration、doctor 状态和 CLI shim argv/stdin。
- Go：保留现有 wrapper 全套测试，并补需要的 fake process seam；Web UI 用可注入 browser opener 验证 loopback URL。
- clean-home E2E：创建 isolated HOME/CODEX_HOME/npm prefix，放置 fake `agy`/`grok`/`pi`，禁止网络，验证 install -> route -> wrapper -> output -> doctor -> update -> recover -> uninstall。
- parallel/resume 使用 fake JSONL/文本事件，不依赖真实账号。

### 人工门禁

只有 Boss 单独授权后才做真实 Provider smoke。人工结果不能替代离线回归；失败不得触发 fallback 或默认路由变化。

## 8. 发布、兼容与回滚

- 版本升至 `3.4.6`，避免以相同 `3.4.5` 版本覆盖不同 bytes。
- personal source、package/plugin manifests、Harness snapshot、`harness.sources.json` 和 installed runtime 是耦合发布单元。
- 旧 Codex 配置中的合法当前路由保持不变；不兼容路由 fail closed 并给出修复命令。
- 回滚按相反顺序恢复 installed runtime、Harness manifest/snapshot 和个人源提交；wrapper 事务自身恢复旧 binary。

## 9. 安全检查触发

本任务触及可执行文件下载、摘要验证、进程启动、stdin/argv、路径所有权、localhost 服务和 Provider 权限边界。实施阶段必须运行 CCG security gate，重点检查路径逃逸、命令注入、摘要降级、TOCTOU、symlink/junction、ACL/ownership、非 loopback 监听和 credential 泄漏。

## 10. 本地审查与外部事实分流

`ccg-review` 先判断待审结论是否依赖当前外部事实。纯仓库审查直接进入角色 Provider 的本地只读审查，以 diff、源码、测试和 CI 为证据，不创建 external-intelligence route。

需要核验外部事实时，Codex 根据明确的产品/仓库/包目标或可信元数据，在启动 Grok 前生成 `--official-domain` 参数。`verify` 没有至少一个预声明官方域名时在诊断和 Provider 调用前 fail closed；域名被写入 prompt、缓存指纹和 manifest。Grok 只能返回搜索来源，不能自行提升来源为官方。
