# Fix CCG plan snapshot exclusion

## Goal

让 CCG 自动外部情报路由能够把自身生成的
`.codex/ccg/plans/*.md` 作为显式 `--plan` 只读绑定加入 Grok 聚焦快照，
同时保持其他凭据、指令、缓存、插件、Hook、Skill、VCS 与依赖目录的
默认拒绝策略不变。

## Background

- 已复现命令在绑定
  `.codex/ccg/plans/codex-authorized-worker-agent.md` 时返回退出码 3：
  `Snapshot path is excluded: ... (dependency, VCS, cache, instruction, hook, skill, or plugin directory)`。
- `command.mjs` 将 `--plan` 绑定与普通 `--file` 选择合并为 `selectedPaths`；
  `snapshot.mjs` 随后因为路径含 `.codex` 而统一拒绝，绑定类型在该层已经丢失。
- 同一快照实现同时存在于个人 CCG 的运行时模板和插件源中，两份必须保持同步。

## Requirements

- R1：仅显式 `--plan` 绑定可以申请例外；普通 `--file` 不得因此读取
  `.codex`。
- R2：例外路径必须严格匹配 `.codex/ccg/plans/<单个文件>.md`，不得接受
  目录、子目录、其他扩展名或路径穿越。
- R3：即使路径形状匹配，`AGENTS.md`、`CLAUDE.md` 等已有禁止文件名及
  `.ccgignore` 仍须优先拒绝。
- R4：`.git`、`.env*`、凭据、证书、`node_modules`、缓存、插件、Hook、
  Skill 和其他 `.codex` 内容的行为不得放宽。
- R5：修复必须同时更新模板与插件源副本，不直接编辑安装缓存作为源码。
- R6：同步到当前安装的个人 CCG 后，重新运行最初失败的 Grok 门禁；
  系统 PATH 与 Provider 登录态不得修改。

## Acceptance Criteria

- [ ] 新回归测试证明显式计划绑定能快照
  `.codex/ccg/plans/example.md`。
- [ ] 新回归测试证明同一路径通过普通 `--file` 仍被拒绝。
- [ ] 新回归测试证明非 Markdown、嵌套子目录及禁止基名仍被拒绝。
- [ ] 现有秘密文件、指令文件、链接、大小限制和 `.ccgignore` 测试继续通过。
- [ ] 模板与插件中的快照实现保持一致，个人来源验证通过。
- [ ] 当前安装插件包含修复，原 CCG 路由命令不再因计划目录返回退出码 3。
- [ ] Grok 门禁产生有效结果，或如实报告与本路径修复无关的新外部阻塞。

## Out of Scope

- 不改变 CCG 的角色路由、Grok 登录、模型选择或全局情报启用状态。
- 不修改用户级 Codex 代理配置及现有代理计划内容。
- 不清理或提交仓库中与本任务无关的既有未提交文件。
- 不为一般 `.codex` 内容建立通用白名单。

## Open Questions

无。用户已授权修复并重新运行检查；安全边界由现有失败和仓库策略确定。
