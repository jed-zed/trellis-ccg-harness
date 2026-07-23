# Hook、配置与升级边界

## 所有权矩阵

| 对象 | 所有者 | Harness 行为 |
|---|---|---|
| `.trellis/workflow.md`、任务、规范、workspace | Trellis | 读取并通过项目本地扩展适配；不复制到 CCG 用户目录 |
| `.agents/skills/trellis-*`、平台生成文件 | Trellis 模板 | 由 template hash 管理；升级前检测本地改动 |
| 项目 `.codex/config.toml`、`.codex/hooks.json` | Trellis + Harness 项目层 | 用可验证合并规则扩展，不覆盖用户级配置 |
| `~/.codex/config.toml`、`~/.codex/hooks.json` | 用户 + CCG 用户层 | 只做最小差异安装；修改前备份并记录所有权 |
| `~/.codex/plugins/cache/.../ccg/<version>` | CCG 插件缓存 | 校验 manifest/version；不提交、不直接手工拼接 |
| `~/.claude/commands/ccg`、`skills/ccg`、`hooks/ccg` | CCG 安装器 | 通过 CCG CLI 安装/升级/卸载 |
| `.codex/ccg/intelligence`、`.ccg/tasks` | CCG 本地证据 | 默认忽略；只允许脱敏导出 |
| `.harness/`、`harness.lock.json`、组合脚本 | Harness | 本仓库源文件，必须有 schema 和回归测试 |

## Hook 合并原则

1. 不把 Trellis hook 和 CCG hook 合并成一个不可追踪的大脚本。
2. 保留各自入口，通过 Harness 生成明确顺序的 dispatcher。
3. 同一事件的失败策略必须显式：
   - 上下文注入失败：阻止进入执行并给修复提示。
   - 通知失败：记录但不阻断代码任务。
   - 外部情报 required gate 失败：保持 CCG fail-closed。
4. 每个受管理文件写入前保存原始 SHA-256、备份路径、目标版本和 Harness 所有权标记。
5. 卸载只删除 Harness 明确拥有且哈希仍匹配的片段/文件。

## 配置分层

优先级建议：

```text
用户级 Codex/Claude/Gemini 配置
  → CCG 用户级模型与插件配置
    → 项目级 Trellis 配置
      → Harness 项目级适配与版本 contract
```

禁止：

- 将 API key、OAuth cookie、Grok profile 写入项目配置。
- 用 Harness 覆盖整个 `~/.codex/config.toml` 或 `~/.claude/settings.json`。
- 将绝对机器路径写入可提交 manifest。
- 将 live/paid smoke 放进普通 PR CI。

## 升级事务

建议阶段：

1. `preflight`：检查 dirty state、CLI 兼容范围、Trellis template hash、CCG plugin manifest/cache 和路径安全。
2. `snapshot`：只备份将修改的用户/项目配置，记录哈希和所有权，不复制秘密到项目目录。
3. `upgrade`：Trellis 与 CCG 分别用官方入口升级，不手工复制上游源码。
4. `reconcile`：重建 Harness adapter 和 dispatcher，校验生成文件与 lock。
5. `verify`：offline doctor、schema、representative dry-run；live smoke 只在用户显式授权时运行。
6. `commit-or-rollback`：验证通过后清理快照，失败则恢复原文件并报告未恢复项。

## 许可证边界

- Trellis 官方仓库声明 AGPL-3.0。
- 自定义 CCG 仓库声明 MIT。
- 推荐仓库先设为 private，完成以下工作后再决定公开：
  - 明确 Trellis `init` 生成资产的再分发条款；
  - 保留必要版权与许可证文本；
  - 为 Harness 自写适配层选择许可证；
  - 确认没有错误复制 CCG/Trellis 上游受管理文件。

## 需要测试的冲突场景

- 用户已经有自定义 `.codex/config.toml` 和 hooks。
- Trellis 升级检测到本地修改。
- CCG 版本更新但插件缓存仍是旧版本。
- CCG 更新失败并回滚。
- Harness 安装中途中断。
- Grok 未登录、未同意、required route 失败。
- clean clone 中不存在任何用户级 CCG/Trellis 状态。
- Windows 路径含空格、非 ASCII、junction/reparse point。
- 卸载时目标文件已被用户再次修改。

## 结论

Harness 的价值不是再复制一份 Trellis 或 CCG，而是提供可审计的组合事务：锁版本、合并、诊断、升级、验证和可逆卸载。
