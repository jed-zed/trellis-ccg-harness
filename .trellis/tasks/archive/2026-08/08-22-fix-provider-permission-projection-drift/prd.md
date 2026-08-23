# 修复 Harness Provider 权限旧投影与冲突假绿

## Goal

确认最新 `main` 是否仍存在 Provider 权限旧投影或冲突检测假绿；若权威资产、受管投影和现有检查均一致，则以无代码变更结案，避免把旧工作树漂移重复移植到主线。

## Requirements

- 以 `origin/main` 的干净隔离工作树为审查基线，不读取根工作树的未提交内容作为主线事实。
- 比较 collaboration policy 与 product-manager schema 的权威资产和受管投影。
- 运行 Harness 初始化契约测试与 adapter conflicts 检查。
- 当前主线已经满足要求时，不新增迁移、兼容层或重复检测。

## Acceptance Criteria

- [x] 隔离工作树的 `HEAD` 与 `origin/main` 同为 `73602402f5c0d603b7cc0c3442f0e519c1eae59d`。
- [x] 两组权威资产与受管投影分别具有相同 SHA-256。
- [x] `node --test tests/harness-init-skill.test.mjs` 通过（8/8）。
- [x] `node scripts/harness-adapter.mjs conflicts` 通过（19 passed，0 blocking，0 warning）。
- [x] 未修改产品代码；根工作树的本地漂移保持原样。

## Notes

- 结论与命令证据见 `research/current-main-verification.md`。
