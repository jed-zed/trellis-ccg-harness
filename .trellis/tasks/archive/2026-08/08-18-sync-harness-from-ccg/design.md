# 技术设计

## Source Identity

Harness 只信任个人 CCG merge commit 的 clean checkout。输入身份是：

```text
CCG 40-char merge SHA
+ Git tree
+ package/plugin/wrapper versions
+ clean checkout path
+ six preset artifact digests
```

Harness lifecycle 输出 `components/ccg-workflow` 和 `harness.sources.json`，并重新计算 snapshot tree。两者是一个事务，不允许拆开手改。

## Worktree Strategy

复用 `I:\ai\trellis-ccg-harness-ccg-3.4.14-sync`，因为其忽略目录中的 lifecycle ownership 绑定该 RepoRoot。先验证 worktree clean 和 ownership RepoRoot，再从重新核验的 Harness `main` 创建新分支；不 reset、不覆盖现有分支。

## Update Transaction

```text
preflight: clean + no pending transaction + exact sources + current installed baseline
  -> pnpm harness:update -- --ccg-commit <sha> --source-checkout <path>
  -> generated snapshot/manifest
  -> built-in source, JS/TS, Go, snapshot-local CLI checks
  -> independent tree/doctor/conflict verification
```

Snapshot 更新不安装尚未发布的目标全局 CLI/plugin。更新前 doctor 核验当前
manifest 对应的已安装基线；更新后的全局精确一致性由 Harness 合并后的 G5
bootstrap/Codex mode 安装负责。G5 前 doctor 只接受这组已知目标版本差异，
其他 blocking/warning 仍失败关闭。

错误时优先 `harness:recover` 处理 pending transaction；需要回到事务前才用 `harness:rollback`。不得人工编辑 recovery state。

## Publication

G3 只批准一个审查过的 Harness 候选分支和 Draft PR。G4 必须再次核验 PR head、CI、merge base 和生成身份；合并后重新读取远端 `main`，作为本机安装的唯一 Harness 输入。
