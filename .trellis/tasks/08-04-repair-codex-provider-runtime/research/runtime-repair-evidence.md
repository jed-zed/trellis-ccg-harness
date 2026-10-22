# 运行链修复证据摘要

## Agent 使用

- 主代理 Codex：最终计划所有者。
- `plan_wrapper_install`：定位 verified binary、Codex transaction/ownership 和 shim 边界。
- `plan_routing_doctor`：定位 capability matrix、doctor 和 config fail-closed 边界。
- `plan_release_e2e`：定位 Pi、版本/快照同步和 clean-home fake Provider 验收。
- 规划阶段使用 3 个 `default` 只读探子；实施与复核阶段按 Boss 授权调用 Antigravity、Grok 与本机 Claude 产品经理，未使用 workspace-write worker。

## 安装与 wrapper

- `src/utils/installer.ts:65-86`：wrapper 版本和六平台 SHA-256。
- `src/utils/installer.ts:212-263`：候选校验、原子提升和 personal release 下载。
- `src/utils/installer.ts:762-858`：legacy `installDir/bin` binary 安装。
- `src/utils/codex-mode.ts:744-987`：Codex install transaction、ownership 和 recover，但当前 planned files 未包含 wrapper。
- `src/utils/installer-template.ts:185-188`：只有 `liteMode=true` 才注入 `--lite`。
- `codeagent-wrapper/server.go:59-98`、`server_test.go:11-83`：loopback URL 与 browser opener seam。

## Routing 与 doctor

- `src/types/index.ts:5-15`：六 Provider 与四正式角色。
- `src/utils/model-routing.ts:24-40,68-81`：仅做 registered-name 校验，无角色能力矩阵。
- `src/utils/__tests__/modelRouting.test.ts:61-73`：当前明确允许每角色选择每 Provider。
- `src/commands/doctor.ts:341-368`：Codex doctor 只验证 routing parse，只有 PM 做 adapter 检查。
- `src/product-manager/provider-registry.ts:5`：PM 仅实现 codex/gemini/claude。

## Pi、发布和验收

- `.trellis/tasks/08-03-pi-selectable-orchestrator/` 已定义 Pi stdin/CWD/resume/read-only/fail-closed 契约，本任务复用。
- 当前 Harness snapshot 绑定 CCG `3.4.5`、commit `a57cddd...`、tree `c534f316...`。
- 当前全局 `ccg/3.4.5` 包仍缺 Pi，证明相同版本 bytes 已漂移；计划升版 `3.4.6`。
- `tests/clean-install-acceptance.test.mjs:49-83` 当前使用 offline mock runner，可扩展为 isolated fake Provider E2E。
- `scripts/clean-install-acceptance.ps1` 已有 isolated HOME/CODEX_HOME/npm prefix、路径逃逸和 `.claude` 守卫，可复用。

## 已执行只读验证

- `go test ./...`：通过。
- `verify-sources.ps1`：通过。
- `harness-adapter.mjs conflicts`：0 blocking、0 warning。
- `ccg doctor --platform codex`：错误地全绿。
- `ccg doctor`：wrapper/legacy 文件缺失，5 issues；形成 doctor 回归基线。

## 最终交付证据（2026-08-07）

- 权威个人 CCG：commit `f5a3d3b230eaca37655b29c1c23f4cc662d2101d`，Git tree `c8e662ddecec1f176fbdbcc104f39419704c57ed`，版本 `3.4.6`。
- Wrapper 合约：`EXPECTED_BINARY_VERSION` 与 Go `version` 均为 `5.12.5`，发布摘要与该版本一致。
- Harness 同步：commits `c744e20`、`6e5e501`；PR #31 已合并到 `main`，merge commit `543cc10c0713f179784cbe6af5dcfe5a41af9c24`。
- 稀疏路径缺陷已在共享 materializer 根因处修复；源 tree 与 `components/ccg-workflow` 的 686 个 path/blob/mode 全量一致。
- 本机安装：CCG CLI `3.4.6`、Codex plugin `3.4.6+codex.1`；`frontend=antigravity`、`backend=grok`、`search=grok`、`product-manager=claude`；doctor 连续 3 次通过。
- 本地验证：focused `26/26`；Harness 全量 `455`（`452` pass、`0` fail、`3` skip）：`AGENTS permission drift aborts compare-and-swap without changing content or mode` 因 Windows 不支持该 POSIX mode 用例跳过，`npm .bin symlink targets and link text are validated and fingerprinted` 与 `rejects .bin link-target drift before spawn` 均因本机创建 symlink 返回 `EPERM` 跳过；安全扫描 0 findings；conflicts 0 blocking / 0 warning；source verification 通过。
- GitHub：PR #31 CI `10/10` 通过；合并后 `main` Harness CI run `31214448961` 的 8 个作业全部通过。
- 真实 Provider：Antigravity 与 Grok 已按 Boss 授权用于审查；Pi 已由 fake E2E、构建包和已安装 runtime 覆盖，但没有另行执行 live smoke。
