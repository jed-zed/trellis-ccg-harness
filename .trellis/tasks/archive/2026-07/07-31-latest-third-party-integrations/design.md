# Technical Design

## Architecture Boundary

保留现有分层：Trellis 管任务，CCG 管其 MCP/add-on 配置，Harness 管用户审批、
第三方 acquisition、ownership 和事务。核心 source provenance 不变；仅把可选
add-on 从“仓库固定 artifact”改成“批准 apply 时解析 latest channel”。

## Source Manifest

升级第三方 manifest schema。source 只保存：

- credential-free HTTPS repository 或官方 service URL；
- `channel: latest`；
- npm package name、Git default branch/release strategy、license 与效果说明；
- candidate path/entrypoint/platform mapping 等稳定结构。

删除 commit、gitTree、release、packageIntegrity、packageLock、candidate
`sourceGitTree`、预计算 Skill tree hash、固定 asset name/hash 和数字版本路径。
`.agents/.../third-party-sources.json` 仍是分发 authority，`.harness/...` 保持
规范化字节投影。

## Resolution Flow

1. `--status` 只读取 manifest 与本机 ownership，显示 channel 和当前已安装
   identity；不访问网络，也不声称 current equals latest。
2. 用户选择候选并批准第三方网络后，apply resolver：
   - npm：查询 `package@latest` 的实际 version、integrity 与 tarball；
   - Git：解析 credential-free repository 默认分支 HEAD，取得 commit/tree；
   - Ponytail：同时解析 plugin、hooks、config 所需子树；
   - ripgrep：解析官方 latest release 与当前平台 asset，下载到私有 stage 并
     计算 SHA-256。
3. `planSha256` 绑定稳定 manifest、选择、策略与 trusted command roots；resolver
   把实际 identity、内容摘要和 stage 证据写入 authenticated journal/ownership。
4. apply 只在网络批准后解析一次远端 latest，并在私有 stage 验证后安装；
   缺失、身份不符或摘要不符则零写入失败。
5. ownership 保存实际 installed version/commit/tree/content hash。后续新计划
   解析到新 identity 时把完整旧安装标为 `upgrade-available`；内容不匹配仍为
   drifted。

## Npm and MCP Runtime

CodeGraph 与 fast-context 继续安装到 Harness-owned stable `latest` tool root。
MCP launcher 从 ownership/approved action 读取实际
package selector、integrity、tree 与 entrypoint，不再从仓库 lockfile验证。

Context7、Playwright、Exa 由 CCG 管理。CCG source manifest 只对本任务 allowlist
接受 `channel: latest`，生成 `package@latest` 命令；其余 npm/Git executable
继续走精确 selector/integrity 校验。DeepWiki 是固定官方 service endpoint，
没有本地 package version。

## Git Skills and Ponytail

Matt Skills、Caveman 和 project Skill 在 apply 阶段 materialize 已解析 commit，
按 candidate path 计算实际 tree inventory；apply 复制该 cache snapshot并把
实际摘要写入 ownership。Ponytail marketplace 注册不传固定 `--ref`；plugin
install 后记录 host 报告版本。hooks/default 仍依赖同一已解析 plugin identity。

## Compatibility and Migration

- 旧 ownership 若内容与记录完全一致，可被识别为 `installed-old`；只有新明确
  审批才能升级。
- 旧记录缺少新 schema 字段时只读展示，不自动迁移；升级事务成功后写新记录。
- user-owned、drifted、部分安装和同名 MCP 保持 blocked。
- status 与未选择 plan 不联网；离线环境可检查本机状态，但不能新装 latest。

## Rollback

继续使用现有 authenticated journal、compare-and-swap、backup 和 ownership
commit point。动态 resolver 只写私有 stage/cache；失败可直接清理。apply 失败
恢复旧安装与 ownership。CCG snapshot 只经正式 `pnpm harness:update` 更新。

## Trade-offs

- 每次新计划需要网络，换取不维护仓库版本 pin。
- 单次 apply 的 authenticated journal/ownership 记录实际 artifact；这不等于仓库长期锁版本。
- npm transitive tree 以下载后的实际内容摘要绑定，不把生成 lockfile提交到仓库。
