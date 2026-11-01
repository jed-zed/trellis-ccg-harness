# 架构、重复与死代码只读重审

日期：2026-08-18  
基线：`d6fa26d6b7e8454d7cb985c06c48bd3e5b277305` + 当前未提交工作树  
范围：Harness、Trellis、CCG 快照、项目脚本、测试与受管投影  
限制：只读审查；未修改产品代码、未安装依赖、未调用 Provider、未联网、未提交或同步

## 结论摘要

本轮确认 2 个高风险问题、3 个明确死代码/死配置候选，以及若干重复与耦合问题。
最重要的新发现是：Provider 权限机制已经在权威资产和运行时中切换为“继承上游权限”，
但当前 Harness 受管投影仍保留并执行旧的独立只读能力策略；现有冲突检查只验证旧投影与旧
ownership digest 自洽，因此错误地给出全绿。

删除测试后的分类：

- 明确可删除的生产死代码：`.trellis/scripts/common/task_queue.py`、
  `components/ccg-workflow/plugins/ccg/lib/shared.js`。
- 明确不可达的死配置：`.trellis/workflow.md` 的
  `[workflow-state:completed]`。
- 已被替代但不能手删的旧机制：当前 `.harness/project.json`、旧 Project Schema、
  owned collaboration policy 和根 `AGENTS.md` 管理块；必须通过 Harness 初始化迁移统一更新。
- 不能判死：Product Manager legacy advice 恢复、CCG Codex hook 模板、GPT Pro Stop Hook
  transport、Trellis `init-context` 删除提示、`safe_git_add.used_force` 兼容返回位、平台投影。

## 高风险发现

### H1. Provider 权限旧机制仍残留在生效中的受管投影

状态：**Confirmed / 新发现 / High**  
类型：superseded mechanism、stale managed projection、验证 Seam 缺口  
推荐强度：**Strong**

新权威与新 Implementation：

- `CONTEXT.md:19-21,39-45` 定义 Provider 权限继承，不允许按入口另设权限。
- `docs/adr/0001-inherit-upstream-provider-permissions.md:3-8` 明确用上游权限替代独立
  no-tool overlays。
- `.agents/skills/harness-init/assets/collaboration-policy.md:125-153` 已改为继承上游
  Provider permission mode。
- `.agents/skills/harness-init/assets/project-contract.template.json:110-120` 和
  `project-contract.schema.json:319-359` 已删除 `providerCapabilities`。
- `scripts/lib/harness-adapter/product-manager.mjs:1291-1307` 现在只校验 allowlist；
  `conflict-static.mjs:341-368` 也已删除 capability overlay 校验。

仍在生效的旧投影：

- `AGENTS.md:179-205` 仍要求 Provider 独立只读、禁 terminal/subagents，并给 Claude
  固定 Read/Glob/Grep 白名单。
- `.harness/policies/collaboration-policy.md:125-151` 仍是同一旧策略。
- `.harness/project.json:240-276` 仍保存完整 `providerCapabilities` 数据。
- `.harness/project.schema.json:319-445` 仍要求该字段及
  `$defs.readOnlyProductManagerProvider`。
- `.harness/ownership.json:4-12` 仍绑定旧 contract/schema/policy digest。

验证缺口：

- `conflict-static.mjs:371-416` 只比较当前投影、ownership digest 与 Adapter 的 authority、
  path、allowlist；它不比较当前受管投影与最新 Harness 资产。
- `node scripts/harness-adapter.mjs conflicts` 返回 `0 blocking, 0 warning, 17 passed`，
  包括 `product-manager-managed-assets: PASS`。
- 但 `node --test tests/harness-init-skill.test.mjs` 为 6 pass / 2 fail，准确指出：
  根 `AGENTS.md` policy projection 与权威 policy 不同；根 Project Schema 与权威 Schema
  不同，差异正是 `providerCapabilities`。

影响：旧机制不是纯历史文本，它仍通过根指令和受管合同参与实际代理行为；同时日常冲突检查
无法发现这种“旧投影内部自洽、但与新权威不同”的漂移。这是 Interface 与 Implementation
之间的 Seam 断裂。

最小处理方向：

1. 使用受支持的 `harness-init` 事务迁移一次性再生 project contract/schema、owned policy、
   根管理块与 ownership digests；不要手改投影。
2. 给 `harness:conflicts` 增加对当前 Harness 权威资产的字节/规范化身份核验，避免旧 digest
   对继续自洽时假绿。

### H2. WebServer Stop 与 SSE handler 共同关闭同一 channel

状态：**Confirmed / 旧发现仍存在 / High**  
类型：资源所有权耦合、并发 panic  
推荐强度：**Strong**

证据：

- `components/ccg-workflow/codeagent-wrapper/server.go:111-119` 的 `Stop()` 遍历并
  `close(ch)`。
- `server.go:529-541` 的 `handleStream` defer 之后再次 `close(ch)`。
- `server.go:546-553` 使用 `event := <-ch`，没有检查 channel 的 `ok`；关闭后会持续得到
  零值 event，直到 request context 结束，随后 defer 可能触发 `close of closed channel`。
- `main.go:150-159` 在实际运行退出路径调用 `globalWebServer.Stop()`，路径可达。
- `server_test.go:43-76` 只覆盖 Start/Stop 基本路径，没有活动 SSE client + Stop 的并发用例。

离线短测试：

```text
GOPROXY=off go test -run 'TestWebServer|TestExecutorTestFactory' -count=1 -timeout=30s .
ok codeagent-wrapper 0.865s
```

该通过结果不覆盖上述并发组合。全量 `GOPROXY=off go test ./...` 运行 240 秒无输出后被终止，
因此不能声称全量 Go 测试通过。

最小处理方向：建立单一关闭所有权。优先让 shutdown/request context 结束 handler，由 handler
只负责注销；如果保留 channel close，则接收必须使用 `event, ok := <-ch`，且 close 只能经一个
受锁保护的 helper/`sync.Once` 发生。补一个活动 SSE client 与 Stop 并发的回归测试。

## 明确死代码与死配置

### D1. `.trellis/scripts/common/task_queue.py` 是无人消费的旧 Task Module

状态：**Confirmed / 新发现 / Medium**  
推荐强度：**Strong**

证据：

- 文件 `task_queue.py:1-189` 定义 6 个查询/格式化函数；全仓精确检索时，所有符号只出现在
  本文件。
- `common/__init__.py:58-92` 未导出该 Module。
- 当前 CLI 在 `task.py:229-335` 直接基于 `iter_active_tasks` 实现 `list --json`、状态和
  assignee 筛选；`py -3.14 .trellis/scripts/task.py list --json` 成功。
- `task_queue.py` 自称有 `__main__` 测试入口，但直接运行会因同目录 `types.py` 遮蔽标准库
  `types` 而抛出 `ImportError: cannot import name 'MappingProxyType' from 'types'`，因此它也不是
  一个可用的独立 CLI。
- `.trellis/.template-hashes.json:102` 表明它是 Trellis 受管文件，而非项目自建扩展。

删除测试：删除该文件不会删除任何当前生产入口；现有任务列表 Interface 在 `task.py`。
`get_task_stats` 没有现存消费者或文档入口。应从 Trellis 模板权威中删除并随更新移除投影，
不要只删当前受管副本。

### D2. `plugins/ccg/lib/shared.js` 是旧目录布局留下的重复文件

状态：**Confirmed / 新发现 / Medium-Low**  
推荐强度：**Strong**

证据：

- `components/ccg-workflow/plugins/ccg/lib/shared.js:1-99` 与
  `plugins/ccg/skills/lib/shared.js:1-99` SHA-256 完全相同：
  `31069aa30ee647b11b51bb3a933bd735fc5cf8bf9cc8480f6b9b7bf0899764fb`。
- 四个 verify Skill 的脚本都通过 `../.. /lib/shared.js` 解析到
  `plugins/ccg/skills/lib/shared.js`；全仓没有生产引用指向根 `plugins/ccg/lib/shared.js`。
- `.codex-plugin/plugin.json:21` 只声明 `"skills": "./skills/"`。
- `sync-local-plugin-cache.ps1:104-118` 会把整个 plugin root 复制到缓存，所以该死文件还会被
  无意义分发。
- Git 历史显示根副本在 `d1a5079` 后加入，而 live `skills/lib` 副本更早已存在。

删除测试：删除根副本不改变任何解析路径或 manifest Interface。最小处理是仅删除该文件，
保留 live `skills/lib/shared.js`；不要为了一个 dead duplicate 引入新抽象。

### D3. `[workflow-state:completed]` 是明确不可达的未来占位配置

状态：**Confirmed / 旧机制死配置 / Low**  
推荐强度：**Strong**

证据：

- `.trellis/workflow.md:128-133,259-269,675` 自己三次标注 `currently DEAD`，并说明只是为
  “future status-transition redesign” 保留。
- `.trellis/scripts/common/task_store.py:551-600` 在同一次 `cmd_archive` 中写
  `status=completed`、清除所有 session 指针并移动目录；不存在能让 hook 读取 completed
  状态的中间生命周期。
- `.trellis/workflow.md:714-717` 还引用不存在的
  `.trellis/spec/cli/backend/workflow-state-contract.md`。

删除测试：当前行为不依赖该 block。按 Ponytail/YAGNI，应从 Trellis 权威模板删除 block、
对应 customization 表项和失效文档链接；若以后真的增加显式 completed transition，再随真实
Interface 一起恢复。

## 耦合与重复问题

### C1. `product-manager.mjs` 同时承担六层职责

状态：**Confirmed / 旧发现仍存在 / Medium**  
推荐强度：**Worth exploring**

`scripts/lib/harness-adapter/product-manager.mjs` 共 1878 行，同一 Module 内包含：

- 状态 schema、校验与 legacy migration：`71-568`
- 状态写入与计划同步：`571-666`
- review 输入、响应校验和 projection：`668-1083`
- installed runtime 版本、snapshot 验证与清理：`1085-1289`
- Provider command 编排与 evidence 持久化：`1310-1507`
- 用户 gate/presentation 与 lock：`1509-1878`

`runInstalledProductManagerReview:1310-1507` 直接跨越 contract、filesystem、transport、state、
evidence 和 lock，Locality 与 Depth 都较差。最小演进顺序应先抽取无副作用 state core，之后再把
snapshot/runtime Adapter 与 gate/lock 分开；不要一次性建立多层抽象或改变现有 Interface。

### C2. bootstrap completion 重复读取同一 ownership 文件

状态：**Confirmed / 旧发现仍存在 / Low**  
推荐强度：**Strong**

`scripts/harness-lifecycle.mjs:324-339` 先在 `buildBootstrapOwnership` 参数内读取一次
ownership，随后立即再读一次用于 merge。两次都执行安全文件校验、JSON 解析和 schema 校验；
没有 hash/lock，因此第二次读取也不构成真正并发一致性检查。最小修复是读取一次局部变量并同时
传给 build 与 merge。

### C3. 两套 YAML parser 与两套 task-ref 规范化逻辑重复

状态：**Confirmed duplication / Low**  
推荐强度：**Worth exploring**

- `.trellis/scripts/common/config.py:21-164` 与
  `trellis_config.py:19-117` 复制同一 simple-YAML parser。
- `.trellis/scripts/common/paths.py:210-232` 与
  `active_task.py:120-137` 复制 `normalize_task_ref`。

两者都有“轻量 hook/standalone reader 不加载完整 task helpers”的隔离目的，因此不是直接删除
候选。只有在 Trellis 权威层可以提供一个零依赖底层 Module 时才合并；否则保留隔离并用同一组
契约测试防漂移。

### C4. lifecycle 与 transaction 各自复制 schema helper

状态：**Confirmed duplication / Low**  
推荐强度：**Speculative**

`scripts/lib/harness-lifecycle.mjs:458-483` 与
`scripts/lib/harness-transaction.mjs:650-675` 的 `assertPlainObject`、`assertExactKeys`
实现一致。两处都是安全校验边界；在没有真实漂移前，独立故障隔离可能比共享 helper 更有价值。
暂不建议为了去重扩大变更面。

### C5. `runtimeInvocations(contract, env)` 的依赖注入不完整

状态：**Confirmed coupling / Low**  
推荐强度：**Worth exploring**

`scripts/lib/harness-adapter/conflict-runtime.mjs:65-115` 接收 `env`，但仍直接读取
`process.platform`、`process.execPath`、`process.env.ComSpec`。这使 runner/env 注入无法完整模拟
跨平台路径，并降低确定性。最小方向是把 platform、execPath、ComSpec 作为同一环境依赖传入；
不需要新框架。

## 可疑但未确认可删

### `heartbeatProductManagerLock`

`scripts/lib/harness-adapter/product-manager.mjs:1861-1868` 在生产中没有调用；只由
`tests/product-manager-concurrency.test.mjs:17,72,83` 直接使用，并由
`scripts/lib/harness-adapter.mjs:25` 重新导出，因此是 test-only Interface 候选。
推荐强度：**Speculative**。

旧审计把“无 heartbeat”判断为长调用会被 stale-steal，本轮已否定：
`acquireProductManagerLock:1822-1837` 在 mtime 过期后仍读取 owner PID，并用
`isLiveProcess` 拒绝接管活进程。相关测试也通过了
`a live owner cannot be stale-stolen and dead crash residue is recoverable`。除非确认不存在仓库外
消费者，否则只能标为疑似生产死接口，不能宣称并发 bug。

## 明确排除的“伪死代码”

- `recoverLegacyAdvice` / `normalizeLegacyState`：`product-manager.mjs:394-460` 被
  `validateState` 调用，且 `product-manager-review.md:257` 明确要求 legacy projection 恢复。
- `codex-stop-hook`：已被 Harness 默认 `codex-root-wait` 替代，但 sidebar Skill 仍把它作为
  另一种真实 transport，脚本和测试均有调用；不是全局死机制。
- `templates/codex/hooks.json` / `ccg-workflow.py`：由 CCG 的 `codex-mode.ts` 安装路径和测试
  消费；它与项目本地 Trellis hooks 属于不同 Interface。
- `task.py init-context` guard：命令本体已删除，但 guard 提供迁移错误提示，仍有兼容职责。
- `safe_git_add` 的 `used_force` 返回位：总为 false，但源码明确说明保留 0.5.10 签名兼容；
  需要先定义兼容窗口才能删除。
- `.codex` / `.gemini` hook 和 Skill 重复：属于平台 schema 不同的受管投影，应从生成权威统一，
  不能手工合并。
- CCG 更新源的两次校验：第二次发生在质量门和外部工作之后，是 TOCTOU 安全复核，不应去重。
- 测试中的 temp fixture 与 `writeJson` 重复：存在，但属于低价值测试样板，当前没有足够漂移或
  故障证据，不值得优先抽象。

## 验证记录

| 命令 | 结果 | 说明 |
|---|---|---|
| `node --test tests/harness-adapter.test.mjs tests/product-manager-concurrency.test.mjs` | 34/34 pass | 证实当前 lock 活 PID 不会被 stale-steal；Adapter 现有测试通过 |
| `node --test tests/harness-init-skill.test.mjs` | 6 pass / 2 fail | 证实根 policy 与 Project Schema 投影落后于新权威资产 |
| `node scripts/harness-adapter.mjs conflicts` | 0 blocking / 0 warning / 17 pass | 反向证实现有 conflicts 对“旧投影自洽”假绿 |
| `GOPROXY=off go test -run 'TestWebServer|TestExecutorTestFactory' -count=1 -timeout=30s .` | pass | 现有短测试通过，但不覆盖 active SSE + Stop |
| `GOPROXY=off go test ./...` | 240s timeout | 无全量 Go 通过结论 |
| `py -3.14 .trellis/scripts/task.py list --json` | pass | 当前 Task list Interface 可用 |
| `py -3.14 .trellis/scripts/common/task_queue.py` | fail | standalone 入口被同目录 `types.py` 遮蔽标准库；且无生产 caller |

## 建议处理顺序

1. 先用受支持的 Harness migration 收敛 H1 的受管投影，并补 conflict Seam；这是当前实际会
   执行旧规则且会假绿的问题。
2. 修复 H2 的 SSE channel 单一所有权并加并发回归测试。
3. 从各自权威源删除 D1、D2、D3；不要直接手改 Trellis/Harness 受管投影。
4. 之后才处理 C1 的 Module 拆分；其余低优先重复只在真实维护痛点出现时合并。

本轮未发现可以一次删除的大型旧子系统。最安全的收益来自删除上述两个孤立文件、一个不可达
workflow block，并完成已经开始但尚未投影到当前项目的 Provider 权限迁移。
