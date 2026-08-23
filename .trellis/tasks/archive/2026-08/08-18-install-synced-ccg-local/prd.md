# 安装并验证同步后的本机 CCG

## Goal

从最终 Harness `main` 和它钉住的 clean CCG checkout 更新本机全局 CLI、Codex plugin 与 Codex mode，同时保留用户配置和 `ANTIGRAVITY_MODEL=gemini-3.7-flash-high` 行为，并提供可操作回滚。

## Requirements

- **R1 — 前置身份**：仅在 CCG 和 Harness 子任务均已合并、Harness 云端 `main` 精确钉住 CCG merge SHA/tree、`3.4.15`、`3.4.15+codex.1` 和 wrapper `5.12.13` 后开始。
- **R2 — 安装来源**：复用绑定 lifecycle ownership 的 `I:\ai\trellis-ccg-harness-ccg-3.4.14-sync`，将其切到最终 Harness `main`；传入最终 CCG merge commit 的 clean checkout。真实 `CODEX_HOME` 必须是 `G:\CodexData\.codex`。
- **R3 — 新鲜备份**：任何全局写入前，创建新的时间戳备份，覆盖全局 `ccg-workflow` 包、Harness lifecycle ownership、Codex plugin/ownership、codeagent wrapper、`ccg/config.toml` 和受管文件；记录 `MISSING.txt`、`SHA256SUMS.txt`、ACL/路径及恢复命令，不复制或输出凭据。
- **R4 — Ownership 基线恢复**：当前 lifecycle ownership 记录全局包 tree `1473096f...` / 3808 entries，而 live tree 为 `b5b9a51d...` / 3809 entries，源于 2026-08-14 的受控本地 rebuild。新鲜备份后，只从 `G:\CodexData\.codex\ccg\local-backups\antigravity-model-20260814-1530\npm-dist` 原位恢复旧 dist，并删除已核验且已备份的唯一额外 chunk `dist\shared\ccg-workflow.Bg2c-ocR.mjs`；重新检查必须精确回到 ownership 记录。不得手改 ownership。任何不一致立即恢复新鲜备份并停止。
- **R5 — 受支持安装序列**：先运行完整 setup 和 PluginOnly 的 `-PreviewOnly`；G5 后以 `CI=true` 运行 Harness `bootstrap.ps1 -LinkCcg` 安装新 CLI，再运行 `install.ps1 -PluginOnly` 同步 plugin/Codex mode，最后运行完整 non-interactive Global Setup 做幂等验证和 15 个平台 Skill 核验。
- **R6 — Provider 和配置保护**：Provider action 根据执行时状态选择：已安装用 `keep`，未安装用 `later`；禁止 `install`、`login`、`check` 和 Provider 请求。安装前后逐项比较 routing、行为配置、`.claude` 和用户所有文件；只允许受管 plugin 注册的必要变化。
- **R7 — 定制验证**：用户级 `ANTIGRAVITY_MODEL` 保持 `gemini-3.7-flash-high`；wrapper version/digest 与 `5.12.13` installer 和 ownership 一致。用假的 `agy` 捕获 argv，离线证明精确加入 `--model gemini-3.7-flash-high`，不得调用真实 Provider。
- **R8 — 完成验证**：核验 `ccg --version`、plugin manifest/cache、关键 post-`3.4.14` 运行文件、双重 wrapper integrity、`ccg doctor --platform codex`、Harness doctor、source verification、conflict audit、无 pending transaction，以及两个原脏工作区不变。
- **R9 — 回滚**：bootstrap/Codex-mode 自带事务优先；人工回滚只恢复新鲜备份中的精确 owned paths，并仅删除本次安装新建且已核验的版本目录。回滚后重新运行版本、ownership、doctor 和配置核验；未经批准不删除备份。

## Acceptance Criteria

- [x] **AC1 / R1-R2**：安装使用最终 Harness `main` 和其精确钉住的 clean CCG merge checkout，真实 `CODEX_HOME` 无歧义。
- [x] **AC2 / R3-R4**：新鲜备份和 SHA-256 清单完整；旧 lifecycle 基线恢复精确匹配后才开始 bootstrap，ownership 未被手改。
- [x] **AC3 / R5-R6**：CLI `3.4.15`、plugin `3.4.15+codex.1`、Codex mode 和 15 个平台 Skill 通过支持路径安装/核验；routing、配置、`.claude` 和用户文件满足保护边界。
- [x] **AC4 / R7**：wrapper `5.12.13` 的 installer expected SHA、installed SHA 和 ownership SHA 一致；离线 argv 捕获证明定制生效。
- [x] **AC5 / R8**：所有 doctor、source、conflict、关键内容和 pending transaction 检查通过；两个原脏工作区同步前证据逐项不变。
- [x] **AC6 / R6**：没有 Provider 安装、登录、健康检查、网络调用或凭据输出。
- [x] **AC7 / R9**：回滚材料和命令经只读预检；失败可恢复到同步前受管定制状态，备份保留待 Boss 明确批准清理。

## Completion Note

本机 `CODEX_HOME` 位于 G 盘，而 Harness `install.ps1` 会把它重算为
`<HomeDir>\.codex`。因此 PluginOnly 完成插件登记后，Codex mode 通过同一
受支持的 `ccg codex-mode install` 命令在显式真实 `CODEX_HOME` 环境中完成；
Global Init 也通过仓库入口单独执行，Provider 全部选择 `later` / `skip`。
15 个平台 Skill 均存在且通过所有权审计；其中 13 个与 3.4.15 源完全一致，
`chatgpt-pro-sidebar` 和 `harness-init` 仍是旧 owned bytes，因为现有迁移入口把
已完成迁移状态视为 `unchanged`。未手改所有权清单；此投影缺口不影响本任务
要求的 Harness `main`、CCG CLI、Codex plugin 或 plugin 内 Skills 版本。

## Out of Scope

- 清理旧 plugin cache、worktree、备份或 npm 缓存。
- 修改 Provider routing、登录状态、API key、OAuth、Slack hook 或通知设置。
- 更新 Trellis 或安装第三方项目 Skill。
