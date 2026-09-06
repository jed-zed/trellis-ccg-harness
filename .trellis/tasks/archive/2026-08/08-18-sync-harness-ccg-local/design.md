# 总体设计

## Authority and Dependency Chain

```text
CCG child 1: latest personal main + minimal ANTIGRAVITY_MODEL integration
  -> reviewed merge commit + six preset wrapper artifacts
Harness child 2: supported harness:update against that clean merge commit
  -> reviewed Harness merge commit with regenerated snapshot/manifest
Local child 3: exact Harness main + exact clean CCG checkout
  -> backed-up, owned, verified local CLI/plugin/Codex mode
```

Trellis 父任务只维护总体依赖和验收；三个子任务分别拥有源码发布、Harness provenance 和本机安装。CCG 不创建第二套任务或计划权威。

## Protected State

- `I:\ai\trellis-ccg-harness` 与 `I:\ai\ccg-gptpro-worflow` 是受保护的原脏工作区，只读取证据。
- 新增源码修改只发生在专用 clean worktree；共享 manifest/snapshot 只由 Harness lifecycle 生成。
- 全局安装先保存文件清单和 SHA-256，再恢复可验证的 lifecycle 基线，最后运行受支持的安装事务。

## Release Identity

- CCG package: `3.4.15`
- Codex plugin: `3.4.15+codex.1`
- codeagent-wrapper: `5.12.13`
- CCG authority: 最终个人 fork merge commit 与 Git tree
- Harness authority: 最终 `harness.sources.json`、snapshot tree 和 merge commit

若执行时已有同版本发布或远端 `main` 前进，停止并更新身份设计，不覆盖已有版本。

## Approval Gates

1. **G0 规划批准**：只启动子任务 1 的隔离本地修改和测试；不 commit、不 push。
2. **G1 CCG 发布候选批准**：展示完整 diff 与测试后，才可 commit、push 并创建 Draft PR。
3. **G2 CCG 合并批准**：CI 和精确 head 复核后，才可合并；随后只观察既有 `preset` 发布。
4. **G3 Harness 发布候选批准**：展示 lifecycle 生成 diff 与验证后，才可 commit、push 并创建 Draft PR。
5. **G4 Harness 合并批准**：CI 和精确 head 复核后，才可合并。
6. **G5 本机安装批准**：展示最终 SHA、备份位置、预览和回滚命令后，才可改变全局安装。

任何门禁批准仅对该门有效。

## Failure Semantics

- 远端 SHA、版本、tree、六平台摘要、ownership 或配置证据不匹配即停止。
- 不自动 rebase、fallback、重试 Provider 或手工修 manifest/ownership。
- CCG/Harness 发布使用 PR 回滚；本机安装使用 bootstrap/Codex-mode 事务与独立人工备份回滚。
