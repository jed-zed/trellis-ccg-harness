# 安装设计

## Why Baseline Restoration Is Required

专用 Harness worktree 的 lifecycle ownership 仍绑定正确 RepoRoot 和全局包目录身份，但 2026-08-14 定制在原目录内重建了 `dist`，使 content tree 从记录的 `1473096f...` / 3808 entries 漂移为 `b5b9a51d...` / 3809 entries。bootstrap 应验证真实旧基线，不能通过修改 ownership 绕过。

因此在 G5 后执行一个最窄恢复：

1. 完整备份当前正式定制状态。
2. 从既有 2026-08-14 备份恢复原 `npm-dist` 文件。
3. 核验绝对路径和备份后，删除唯一多出的 `ccg-workflow.Bg2c-ocR.mjs`。
4. 运行现有 global-package inspector，必须精确匹配 lifecycle ownership。

此短暂恢复只影响全局 CCG package dist；用户环境变量、Codex-mode wrapper/ownership 和配置在新 CLI 安装前保持不动。

## Supported Upgrade Sequence

```text
PreviewOnly(full + PluginOnly)
  -> fresh backup + baseline restoration
  -> bootstrap.ps1 -LinkCcg
       -CcgSetupTargetVersion 3.4.15
       -CcgSetupPreviousPluginVersion 3.4.14+codex.1
       -AuthoritativeCcgCheckout <clean CCG>
  -> install.ps1 -PluginOnly
       (register 3.4.15+codex.1 + ccg codex-mode install)
  -> install.ps1 full non-interactive
       (idempotent bootstrap/doctor + Global Init)
  -> independent verification
```

拆分 bootstrap 和 PluginOnly 避免完整 setup 在新 CLI 已安装、旧 Codex-mode ownership 尚未更新的中间点只运行 doctor 而失败；所有步骤仍使用仓库已有受支持入口。

实际执行时，第一次 bootstrap 误传 base version `3.4.14`，新包写入后 doctor
拒绝该不完整 plugin identity。随后使用完整 identity `3.4.14+codex.1` 重新
运行同一 doctor，并通过 `harness-lifecycle.mjs bootstrap-complete` 完成原事务，
没有修改 ownership。PluginOnly 还暴露出 `install.ps1` 会覆盖外部
`CODEX_HOME` 的 Junction 限制；插件登记成功后，Codex mode 与 Global Init
分别使用安装器原本调用的受支持命令、显式真实 G 盘根目录完成。

## Configuration Boundary

- 在命令环境中显式设置 `CODEX_HOME=G:\CodexData\.codex`，不依赖 Junction 推断。
- 保存配置原文和结构化 routing 快照；最终仅接受 installer-owned plugin 注册的必要差异。
- 预览阶段的 Provider action 只取 `keep` 或 `later`；单独执行的 Global Init 阶段只取 `later` 或 `skip`（仅 Claude），不触发探测。
- `.claude` 前后 tree fingerprint 必须一致。

## Rollback

- bootstrap pending transaction：使用其 abort/recover 机制。
- Codex-mode 失败：使用该命令生成的 backup 和 ownership 恢复。
- 跨阶段失败：恢复新鲜备份的全局 package、plugin/ownership、wrapper 和配置；仅在绝对路径与清单匹配时移除本次新建版本目录。
- 回滚后再次证明同步前版本、SHA、routing 和 doctor；不自动删除失败日志或备份。
