# 同步云端 Harness 和 CCG 到本地

## Goal

在不覆盖任何现有未提交改动的前提下，把本机 `ANTIGRAVITY_MODEL=gemini-3.7-flash-high` 定制正式集成到最新个人 CCG，经 Harness 受支持的 lifecycle 重新钉住后安装到本机，并留下可验证、可回滚的同步结果。

## Background and Confirmed Facts

- 2026-08-18 重新通过 `git ls-remote` 核验：Harness 云端 `main` 为 `e4d3319cac90d29d6faf2c9ef1fb1ff5d7b0a96c`。
- 2026-08-18 重新通过 `git ls-remote` 核验：个人 CCG 云端 `main` 为 `3d6c4d6580c5ff1cae8d5de04fa0c0323181e4f5`。
- Harness 云端 `main` 的 `harness.sources.json` 已钉住该 CCG 提交、Git tree `f798141cfd8c9035854417abc065290109437010`、CLI `3.4.14` 和插件 `3.4.14+codex.1`；云端两个 `main` 彼此一致。
- 当前 Harness 主工作区 `I:\ai\trellis-ccg-harness` 在分支 `codex/harness-recommended-project-skills`，原核验时有 24 个已修改和 14 个未跟踪路径，不能直接更新。
- 当前权威 CCG 工作区 `I:\ai\ccg-gptpro-worflow` 在分支 `codex/auto-search-product-manager`，有 8 个已修改文件，不能作为同步事务的 clean source。
- 已有 clean detached CCG worktree `G:\CodexWorktrees\ccg-merged-3d6c4d65`，HEAD 恰为云端 CCG `main`。
- 本机 CCG CLI/插件版本号已是 `3.4.14` / `3.4.14+codex.1`，但关键运行文件仍对应较早的 `9d94210` 发布基线，并非当前云端内容。
- 当前安装不是未经解释的漂移：2026-08-14 曾有意加入 `ANTIGRAVITY_MODEL=gemini-3.7-flash-high` 支持，修改 `codeagent-wrapper/backend.go`、`backend_test.go`、`main.go` 和 `src/utils/installer.ts`，并同步自定义 wrapper 与 ownership 哈希；回滚材料位于 `G:\CodexData\.codex\ccg\local-backups\antigravity-model-20260814-1530`。
- 云端 CCG `main` `3d6c4d65...` 不包含 `ANTIGRAVITY_MODEL` 注入，仍钉住官方 wrapper 哈希 `b05ec322...`；直接精确同步会移除该本地默认模型功能。
- Boss 已选择隔离方案 A：两个原脏工作区保持不动；同步使用专用 clean Harness worktree，并更新本机安装。
- 已存在专用 clean Harness worktree `I:\ai\trellis-ccg-harness-ccg-3.4.14-sync`。它绑定当前全局 CCG 的 lifecycle ownership，可复用并切到精确 Harness `main`，避免创建第二套 ownership。
- 项目契约要求个人 CCG clean checkout 为权威源；Harness snapshot、manifest、全局 CLI 和插件必须作为耦合身份核验，不能手工编辑 snapshot。

## Requirements

- **R1 — 现有改动保护**：同步前记录两个原工作区的 HEAD、分支、状态、tracked/staged binary diff，以及未跟踪文件的路径、大小和 SHA-256；同步全过程不得 reset、clean、stash、覆盖、移动或删除这些内容。
- **R2 — 精确云端锚点**：每一阶段执行前重新读取相关远端 `main`；CCG 集成以已核验的 `3d6c4d65...` 为规划基线，Harness 集成以 `e4d3319...` 为规划基线。若远端前进，停止并更新规划证据，不自动追随未知提交。
- **R3 — 干净源与隔离目标**：CCG 定制只在从当时最新个人 CCG `main` 创建的新 clean worktree/branch 中实现；Harness 更新只在专用 clean worktree `I:\ai\trellis-ccg-harness-ccg-3.4.14-sync` 中进行。不得在两个原脏工作区执行合并、发布、lifecycle 或安装。
- **R4 — 正式保留定制**：仅移植现有四文件定制的语义：从环境变量读取非空 `ANTIGRAVITY_MODEL` 并向 Antigravity 命令加入 `--model`，补齐最小测试和帮助文本。不得沿用旧二进制摘要；源码版本目标为 CCG `3.4.15`、插件 `3.4.15+codex.1`、wrapper `5.12.13`，六平台摘要必须由同一受控工具链产物生成并经 CI 复核。
- **R5 — Harness 受管同步与本机安装**：CCG 合并且六平台 `preset` 产物核验后，使用 `pnpm harness:update -- --ccg-commit <40-sha> --source-checkout <clean-checkout>` 更新 Harness；Harness 合并后，从精确 Harness `main` 使用受支持的 bootstrap、PluginOnly 和完整 Global Setup 路径更新本机，显式传入 clean CCG provenance checkout 和真实 `CODEX_HOME=G:\CodexData\.codex`。Provider 只保留或延后，不安装、不登录、不调用。
- **R6 — 配置与运行时保护**：安装前备份并哈希全局 CCG 包、Codex 插件/ownership、`ccg/config.toml` 和受管理文件；安装后保持用户配置、routing 和非 Harness 所有文件不变。失败时使用现有 bootstrap/Codex-mode 事务恢复，并保留人工回滚副本。
- **R7 — 验证**：验证 Harness source manifest、组件 Git tree、CLI/插件精确内容、wrapper digest/version、doctor、conflict audit 和必要离线测试；不以相同版本号代替内容一致性证据。
- **R8 — 外部状态门禁**：规划批准只允许启动子任务 1 的隔离本地实现与验证。CCG 的提交/推送、CCG 合并、Harness 的提交/推送、Harness 合并和本机安装分别需要新的明确批准；任何批准不得跨门复用。
- **R9 — 定制保护**：Boss 已明确选择“保留定制”。最终安装必须证明 `ANTIGRAVITY_MODEL=gemini-3.7-flash-high` 通过受管源码、版本、wrapper 摘要和 ownership 生效；禁止安装后临时 patch 或静默回退到 Provider 默认模型。

## Acceptance Criteria

- [x] **AC1 / R1**：两个原工作区的同步前证据和回滚材料完整；同步后逐项复核，所有同步前已存在的脏内容保持不变。
- [x] **AC2 / R2-R4**：CCG 定制从核验后的最新个人 `main` 派生，只有已批准的最小语义变更；版本为 `3.4.15` / `3.4.15+codex.1` / wrapper `5.12.13`，六平台摘要和测试通过。
- [x] **AC3 / R5-R6**：本机全局 CLI、Codex plugin 和 Codex-mode ownership 安装成功；`ccg/config.toml`、routing 和用户所有文件保持同步前语义与字节边界要求。
- [x] **AC4 / R5-R7**：Harness `main` manifest/snapshot 精确钉住 CCG merge commit、tree、`3.4.15` 和 `3.4.15+codex.1`；`ccg --version`、插件 manifest、关键运行文件、`ccg doctor --platform codex`、Harness doctor、source verification 与 conflict audit 均通过且无 blocking/warning。
- [x] **AC5 / R6**：回滚副本、SHA-256 清单和恢复命令已记录；失败路径不留下 pending transaction。
- [x] **AC6 / R8**：每次 commit、push、PR、merge 和本机安装都有对应的当次批准；没有 Provider 安装/登录/调用或现有 worktree 清理。
- [x] **AC7 / R9**：使用假的 `agy` 捕获 argv，离线证明 `--model gemini-3.7-flash-high` 生效；定制已进入 CCG merge commit、Harness provenance 和 Codex-mode ownership。

## Out of Scope

- 把当前 Harness 脏分支合并、rebase 或重置到云端 `main`，除非 Boss 明确选择该范围。
- 把当前权威 CCG 脏分支合并、rebase 或重置到云端 `main`，除非 Boss 明确选择该范围。
- 更新 Trellis 版本；云端 manifest 仍是 `0.6.9`，没有已确认的版本差异。
- 发布稳定 tag 或手工上传 release asset；CCG 只使用仓库既有的 `main` CI/`preset` 发布路径。
- 未经对应门禁批准的提交、推送、PR、合并或本机安装。
- Provider 配置变更、Provider 安装、Provider 登录、实时调用或付费请求。
- 删除旧 worktree、备份、缓存或本次任务之外的文件。

## Confirmed Decision

- Boss 选择保留定制。同步目标不是把本机降回当前官方 `3.4.14` 内容，而是先把定制正式集成并发布为新的个人 CCG 版本，再让 Harness 和本机安装对齐该受管版本。
