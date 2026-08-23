# 将 Antigravity 默认模型定制集成并发布到 CCG

## Goal

从执行时重新核验的个人 CCG `main` 创建隔离 worktree，把现有 `ANTIGRAVITY_MODEL` 支持作为最小正式变更集成，发布可由 Harness 精确引用的新版本。

## Requirements

- **R1 — 基线和隔离**：执行前重新读取个人 fork `main`；规划基线为 `3d6c4d6580c5ff1cae8d5de04fa0c0323181e4f5`。远端若前进则停止更新证据。新 worktree/branch 必须 clean，原工作区 `I:\ai\ccg-gptpro-worflow` 不得改动。
- **R2 — 最小语义移植**：只移植旧定制的行为：读取并 trim `ANTIGRAVITY_MODEL`；仅当非空时在 Antigravity 调用加入 `--model <value>`；同时更新对应帮助文本和最小测试。不得复制旧编译摘要或顺手重构。
- **R3 — 行为兼容**：环境变量不存在、为空或只含空白时，生成的命令与当前 `main` 完全一致；非空时只增加一个 `--model` 参数对。
- **R4 — 正式版本身份**：package 目标 `3.4.15`、Codex plugin `3.4.15+codex.1`、wrapper `5.12.13`；更新仓库现有版本和发布契约要求的最小表面，不增加新的配置层。
- **R5 — 六平台可复现摘要**：使用仓库 workflow 相同的 Go `1.21.13`、`CGO_ENABLED=0`、`-buildvcs=false -trimpath -ldflags="-s -w"` 为六个目标生成摘要并更新 `src/utils/installer.ts`。若无法取得精确工具链，停止，不得使用本机 Go `1.26.2` 的哈希冒充发布摘要。
- **R6 — 验证**：运行聚焦 wrapper 测试、`go test ./...`、版本/摘要一致性检查，以及仓库既有 `pnpm` lint、typecheck、test、build。CI 必须独立重建并验证六个平台摘要。
- **R7 — 发布边界**：G0 仅允许本地修改和测试；G1 后才可 commit、push 和创建 Draft PR；G2 后才可合并。不得手工 `gh release upload`，只使用 `main` 既有 `preset` prerelease 流程。
- **R8 — Provider 边界**：不得安装、登录或调用 Antigravity、Gemini、Claude、Grok 或其他 Provider；行为 smoke 必须使用假的 `agy` 捕获 argv。

## Acceptance Criteria

- [ ] **AC1 / R1-R2**：最终 diff 可逐项映射到环境变量读取、参数注入、帮助、测试和必要版本/摘要表面；原脏工作区字节不变。
- [ ] **AC2 / R3**：测试同时证明未设置/空白变量保持原命令，设置为 `gemini-3.7-flash-high` 时精确加入 `--model gemini-3.7-flash-high`。
- [ ] **AC3 / R4-R5**：版本为 `3.4.15` / `3.4.15+codex.1` / `5.12.13`，六个 installer 摘要与 CI 同工具链产物逐项一致。
- [ ] **AC4 / R6**：Go、pnpm 和 CI 要求的检查通过；无通过删减测试、跳过摘要或扩大实现来规避失败。
- [ ] **AC5 / R7**：每个远端写入和合并均有对应门禁批准；最终记录 CCG merge SHA、Git tree、PR 和 `preset` 六资产证据。
- [ ] **AC6 / R8**：没有真实 Provider 调用、登录、安装或凭据读取。

## Out of Scope

- 修改 Provider routing、默认 CCG role 或 `ccg/config.toml`。
- 为其他 Provider 增加通用模型配置抽象、fallback、重试或兼容层。
- 手工发布稳定 tag、npm 包或 release asset。
