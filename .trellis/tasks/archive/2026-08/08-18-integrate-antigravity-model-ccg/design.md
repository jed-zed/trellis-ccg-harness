# 技术设计

## Change Seam

沿用现有 Antigravity 命令构造函数，在它最终组装 argv 的同一位置读取 `ANTIGRAVITY_MODEL`。trim 后非空才追加 `--model` 和值；不改变 Provider 选择、请求格式或输出解析。

预期业务文件仅包括：

- `codeagent-wrapper/backend.go`
- `codeagent-wrapper/backend_test.go`
- `codeagent-wrapper/main.go`

`src/utils/installer.ts` 同时承载 wrapper 版本和六平台 SHA-256。其余变更仅限仓库既有版本发布表面；执行时先用精确检索确认清单。

## Version and Artifact Contract

- package `3.4.14 -> 3.4.15`
- plugin `3.4.14+codex.1 -> 3.4.15+codex.1`
- wrapper `5.12.12 -> 5.12.13`

六平台二进制必须来自相同 commit、相同 Go `1.21.13` 和 workflow flags。installer 摘要、CI 重建摘要和 `preset` release asset 摘要形成三方一致证据。

## Safety

- 旧 worktree 的四文件 diff 只作为语义参考，不作为可直接 cherry-pick 的发布来源。
- 不使用旧 Windows 自定义哈希 `f7d93e...`，也不把官方 `3.4.14` 哈希带到 `5.12.13`。
- 若精确工具链或任一平台产物不可验证，停在发布前，不降低 gate。

## Rollback

本地未提交阶段直接保留隔离 worktree；发布阶段通过关闭 Draft PR 或对 merge commit 做新的 revert PR。不得 force-push 已审查的远端历史。
