# 执行计划

## Phase 1 — 最终来源与预览

- [x] 重新读取 CCG/Harness 云端 `main`，核验 Harness manifest、CCG tree、版本和六资产。
- [x] 将专用 Harness worktree 切到精确最终 Harness `main`，验证 clean、RepoRoot ownership 和无 pending transaction。
- [x] 准备精确 CCG merge checkout；设置真实 `CODEX_HOME`。
- [x] 预览阶段记录 Provider 当前状态并生成仅含 `keep` / `later` 的 action；运行 full 和 PluginOnly PreviewOnly。
- [x] 向 Boss 展示最终 SHA、预览、备份路径、将恢复的唯一 extra chunk 和回滚命令，等待 G5。

## Phase 2 — 备份与 lifecycle 基线

- [x] G5 后创建时间戳备份、`MISSING.txt` 和 `SHA256SUMS.txt`，验证备份可读。
- [x] 记录两个原脏工作区的最终同步前证据。
- [x] 从既有备份恢复旧 `npm-dist`，核验并删除唯一额外 chunk。
- [x] 运行 global-package inspector；必须与 lifecycle ownership 精确一致，否则恢复新鲜备份并停止。

## Phase 3 — 受支持安装

- [x] 以 `CI=true` 运行 `bootstrap.ps1 -LinkCcg`，目标 `3.4.15`、前一 plugin `3.4.14+codex.1`、authoritative checkout 为最终 CCG source。
- [x] 运行 non-interactive `install.ps1 -PluginOnly`，同步 `3.4.15+codex.1` plugin；Codex mode 在显式真实 `CODEX_HOME` 下使用同一受支持 CLI 完成。
- [x] 运行 non-interactive Global Init，Provider 仅 `later` / `skip`（`skip` 仅用于 Claude），catalog 不扩展，并核验 15 个平台 Skill。
- [x] 每次失败均保存日志并检查 transaction；确认失败发生在受保护状态写入前或由受支持事务恢复后才继续。

## Phase 4 — 验证

- [x] 核验 CLI/plugin/package/source tree 和 post-`3.4.14` 关键运行文件。
- [x] 核验 wrapper `5.12.13`、installer expected SHA、installed SHA 和 ownership SHA。
- [x] 用假的 `agy` 捕获 argv，验证 `--model gemini-3.7-flash-high`；不调用 Provider。
- [x] 比较配置原文/结构化 routing、`.claude`、用户文件和环境变量。
- [x] 运行 CCG doctor、Harness doctor、source verification、conflict audit 和 pending transaction 检查。
- [x] 复核两个原脏工作区的所有既存内容未改变。

## Phase 5 — 交付

- [x] 汇总最终 SHA/tree/版本、安装摘要、测试、备份与回滚命令。
- [x] 保留所有备份、日志和隔离 worktree。
- [x] Boss 已统一批准执行到最后；完成子任务并与父任务统一归档。

## Final Evidence

- Harness `main`: `fa503092372a7f33eaaae5398560b2d1a4f77940`
- CCG commit/tree: `02bb7e1958c94c4b2e2dc739d797ea4613042da0` /
  `c4845443e799a1d3b115e740a99c87614684d197`
- CLI / plugin / wrapper: `3.4.15` / `3.4.15+codex.1` / `5.12.13`
- wrapper SHA-256: `f97bfffbe9b55935c11103829c81ab5d0e0520eee1977ed6508a11a6293166cd`
- backup: `G:\CodexData\.codex\ccg\local-backups\harness-ccg-3.4.15-20260819-163342`
- backup checksums: 3,782 entries, all verified
