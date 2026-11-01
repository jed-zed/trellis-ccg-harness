# 父会话独立审核包：完整计划正文

复审请求：07:35:22–07:42:27 UTC；接续计划：07:44:02–07:47:51 UTC。均为 Claude Code 2.1.302，命令显式 `--model opus[1m]`，实际 `claude-opus-5-5[1m]`、1,000,000上下文，exit 0、success；一次复审+一次计划，无重复请求。默认权限，Read/Glob/Grep；模型记录的Read均在独立快照内，未见权限拒绝或hook错误。使用已安装CCG技能及原始快照助手，原生只读传输适配，未验证默认托管wrapper启动链。

源码及GitHub状态核查于2026-10-22 07:30–07:48 UTC，本轮最后HEAD与工作区状态未变。当前只完成复审和计划，不实施；父会话明确审核通过后，用户的同范围条件授权可直接接续，不再问一次开工许可。

证据文件（本目录）：CLAUDE-REVIEW.md、CLAUDE-PLAN.md原文；CCG-CLAUDE-EVIDENCE.json；github-current.json；ccg58-59-comparison.json；local-current.json、local-final-status.txt；current-source-excerpts.md；targeted-tests.txt；context.json、conflicts.json。本文是原始Claude计划经控制端逐点核实校正的完整审核版，改动理由在PARENT-REVIEW-NOTES.md。

---

# CCG 计划：trellis-ccg-harness 复审后的项目内最小修复（F1/F2/F3/N1/N2）

**生成方式**：本计划由 Claude Code CLI `opus[1m]` 担任 CCG backend 角色，经原生只读传输生成，只用了 Read/Glob/Grep 读取当前快照。默认托管 wrapper 启动链没有使用，因为它硬编码了权限绕过参数。本结果不能作为该链路已验证的证据。
**角色状态**：`backend=claude`，frontend、search、product-manager 均不适用，本轮没有调用其他 Provider。
**来源**：以下为 Claude 计划经控制端核实后的完整审核版；原始模型结果保持不变，校正明细见 PARENT-REVIEW-NOTES.md。
**实施对象**：只针对 `I:/ai/trellis-ccg-harness`。下文的行号和片段都来自本快照。

---

## 1. 当前基线

- **分支与提交**：分支 `codex/sync-main-20261021`，HEAD 是 `724975b274d4cf4ec2f69ebfe7d7a888193e7706`。相对 `origin/main 9eb87bd`，ahead 12、behind 0。
- **较上次新增 3 个提交，共改 12 个文件（+55/−79）**：
  - `a87e975`：把 `tests/harness-init-cli.test.mjs:151` 的断言改成 `/a simple task may stay inline/`，修正 policy v14 带来的措辞漂移。
  - `761bb65`：删除 `assertCodexMutationHost` 及其全部调用，包括 init-core 的 12 处，以及 adapter、lifecycle、local-recipe、install.ps1、bootstrap.ps1 中的调用。`codex-host-boundary.mjs` 只保留 `isClaudeHost`，用于选择上下文内容。`run-tests.mjs:26-28` 在测试环境里删除宿主标记。
  - `724975b`：恢复 `openai.yaml` 的提交字节。实测提交 blob 与远端 main blob 一致；工作树是 CRLF（`i/lf w/crlf`），按 LF 归一化后与 HEAD 一致，但工作树字节不等于远端 blob。不能把这两件事混为一谈。
- **9 个本地提交不在任何当前远端分支**：`724975b`、`761bb65`、`a87e975`、`13ab2df`、`04c7dcc`、`9ea43ae`、`a828280`、`552001c`、`e156470`。另外 3 个提交已在 #57 的 head `a6c6d31` 中。
- **工作区**：暂存区和已跟踪文件都没有改动。未跟踪项只有 `.serena/` 和 `pnpm-lock.yaml` 两个。`.pnpm-store` 已不存在，不重建。
- **CI**：上述9个提交不被核查时任何当前远端分支引用；不能据此证明它们从未被推送。未取得 `724975b` 的远端 CI 证据。#57 的绿色 CI 针对的是 `a6c6d31`，不能套用到当前 HEAD。
- **本轮控制端实测**：
  - `context` 成功。
  - `conflicts --ci` 结果为 14 ok / 5 info / 0 warning / 0 blocking，其中 `ccg-source-tree` 的期望值和实际值都是 `768226c8…`。
  - 聚焦测试 12/12 通过：`ci-contract` 7 项、`codex-host-boundary` 4 项、`readme-provenance` 1 项。
- **这些结果不能证明的部分**：
  - host 用例大多在空 fixture 的早期路径就结束了，不能证明写入阶段的 `.claude` 安全，也不能当作完整的跨宿主生命周期验收。
  - 本轮没有跑 `harness-adapter.test.mjs`、`harness-init-cli.test.mjs`、完整套件、doctor 或安装链。所以 `a87e975` 修正的那条测试在本地仍未运行。
  - F1/F2 用的是上轮纯内存复现，对应源文件没有变化，可以沿用；但这不算本轮新的复现。

## 2. 逐项判定与实施方案

### F1 现存（P2，触发面收窄）：探针错误先截断后脱敏

- **位置**：`scripts/lib/harness-adapter/probe.mjs:73-75`
  ```js
  error: rawError
    ? redactString(String(rawError).slice(0, 500), [apiKey])
    : null,
  ```
- **为什么会漏**：`redaction.mjs:31-35` 只对完整 key 做精确替换；`probe.mjs:308` 的 `redactValue` 也一样，补不上被截断后剩下的半截 key。
- **收窄的理由**：`redaction.mjs:6-7` 的通用规则能盖住 `Bearer …` 和 `sk-` 后至少 12 个字符的片段，但前缀片段被截得过短时仍可能不匹配，不能据此保证带前缀的 key 不受影响。
- **触发条件**（需同时满足）：
  1. 显式运行手动兼容探针（Grok 默认禁用）；
  2. 对端在 `error.message` 或非 ok 的响应正文里回显 key；
  3. key 恰好跨过第 500 个字符，残片未被通用规则覆盖（例如无通用前缀，或前缀残片过短）。
- **后果**：key 的前半段写进探针报告。
- **修复**：改成 `redactString(String(rawError), [apiKey]).slice(0, 500)`。先对全文脱敏再截断；截断落在 `[REDACTED]` 中间没有关系。`:82` 的 catch 分支没有截断但已全量脱敏，不算泄露，不改。
- **测试**：在 `tests/harness-adapter.test.mjs:1494` 之后新增一个用例：
  ```js
  const secret = `hk_${"Q7".repeat(20)}`;
  fetchImpl: async () => response(401, { error: { message: `${"x".repeat(490)}${secret}` } })
  ```
  断言：
  - `report.models.ok === false`；
  - `report.models.error.length <= 500`；
  - `JSON.stringify(report)` 不包含 `secret.slice(0, 10)`。

  先在旧代码上跑一遍，确认这个用例失败（旧代码会留下 `hk_Q7Q7Q7Q`），再改代码并确认通过。
- **验收边界**：只覆盖合成 key 和截断边界，不承诺任意格式的 key 都不会泄露。

### F2 现存（P3）：IPv6 回环地址被误拒

- **位置**：`probe.mjs:8` 是 `url.hostname === "::1"`，但 WHATWG URL 返回的是 `"[::1]"`，所以只监听 IPv6 回环的本地 HTTP 服务会被误拒。
- **修复**：只把 `:8` 改成 `url.hostname === "[::1]"`。
- **测试**：在 `tests/harness-adapter.test.mjs:487-504` 的现有用例里补两条断言：
  - `normalizeBaseUrl("http://[::1]:8080/") === "http://[::1]:8080"`；
  - `http://[::2]/` 抛出 `/must use HTTPS/`。

  原有的远程 HTTP 和带凭据 URL 两条断言保持不变。

### F3 现存（P2）：Dependabot 直接改冻结快照

- **位置**：`.github/dependabot.yml:9-19` 对 `/components/ccg-workflow` 配了 npm 和 gomod 更新。
- **为什么是问题**：`conflict-static.mjs:82-91` 会把快照目录的 gitTree 与清单精确比较，不一致就报 blocking。这类 PR 只改快照、不同步来源和清单，必然失败。远端 5 个 `dependabot/npm_and_yarn/components/ccg-workflow/*` 分支对应 #5–#9，全部冲突且 CI 失败。
- **合同测试把错误配置锁死了**：`tests/ci-contract.test.mjs:121-129` 断言这两段必须存在。
- **修复**：
  - 删除 `dependabot.yml` 第 8–19 行（含第 8 行空行），保留第 1–7 行的 github-actions 配置和结尾换行。
  - 合同测试改名为 “Dependabot covers Actions only and never edits the frozen CCG snapshot”：保留 github-actions 断言，并新增 `assert.doesNotMatch(config, /components\/ccg-workflow/)` 和 `assert.doesNotMatch(config, /package-ecosystem:\s*"(npm|gomod)"/)`。
  - 冲突门禁本身不改。
- **风险**：本仓库不再自动提出组件依赖升级，组件依赖只能先在来源仓库升级再走导入流程。来源仓库是否有自己的 Dependabot，目前没有证据，记为待核实。现有 #5–#9 不由本次操作处理，也不作为验收条件。

### F4 排除：来源侧待办

- **现象**：`components/ccg-workflow/templates/commands/go.md:27-51` 整段被注释掉，但 `:165` 仍写着“复用 Phase -1 已生成的安全 `<task-id>`”。
- **PR59 也没修**：固定 head `252de07` 的同一模板这几行与快照相同；PR59 的 diff 不含 `templates/commands/go.md`。#52 的线程 `PRRT_kwDOThZdic6npbEG` 仍未解决。
- **处置**：保持为来源侧待办。不改 `components/` 或 `harness.sources.json`，不导入快照。

### N1 收窄保留（P3）：上传路径缺离线测试，文档与实现不一致

- **现象**：
  - Node 和 Pester 测试里搜索 upload/Attachment 都是 0 命中。
  - `chatgpt-pro-sidebar.ps1:6448-6505` 实际开放了 `upload` 和 `upload-status`；`:6451` 规定 `run` 遇到附件就拒绝。
  - 但 `.trellis/spec/tooling/chatgpt-pro-sidebar-v2.md:62` 写的是 “without enabling optional attachment operations”，与实现不符。
- **测试**：新建 `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-upload.Tests.ps1`。
  - 文件头与现有测试一致：`#requires -Modules @{ModuleName='Pester';ModuleVersion='5.0.0'}`。
  - `BeforeAll` 先 dot-source `chatgpt-pro-sidebar.ps1`，再 dot-source `chatgpt-pro-upload.ps1`，用现有的 `Get-ExceptionCategory` 读取错误类别。
  - 只测 `Read-ApprovedUploadManifest`（`upload.ps1:15-22`）在绑定检查（`:23`）之前的纯离线分支，文件都放在 `$TestDrive`：
    - manifest 不存在 → `AttachmentManifestMissing`；
    - 65537 字节 → `AttachmentManifestOverLimit`；
    - `files` 为 0 个、7 个，或 `schemaVersion` 为 2 → 都是 `AttachmentManifestInvalid`。
  - CI 的 `sidebar-offline.yml:33` 会对整个目录运行 Pester，所以新文件会被自动纳入。
- **文档**：只把 v2 规范第 60–62 行改成准确表述：
  - 适配器提供显式的 `upload` 和 `upload-status`，只接受 1 到 6 个经 manifest 授权的 ZIP；必须先绑定空白首页，`run` 拒绝附件。
  - 说明已有显式命令不等于默认启用或已获实际上传授权；本次保持 SKILL.md 不变。
  - `upload.ps1:148-203` 的密封显示名恢复是一次性审定的恢复逻辑，不得泛化，也不得当死代码删除。
- **不改的部分**：
  - 生产脚本不改。
  - `SKILL.md` 本次不改，以保持最小范围；不能仅凭 `allow_implicit_invocation: true` 就断言补文档会扩大实际调用权限。
  - “第 5 个增量映射”（`:103` 只有 4 个证据名，`:22` 却允许 6 个文件）未复现。要真正测到它，必须穿过 `:106/:114/:121/:125` 并走到 `:130`，需要很复杂的完整成功夹具，证据不足，不纳入本次承诺，标为未验证。

### N2 现存（P3）：现行哈希禁令说明已过时

- **位置**：`.trellis/spec/tooling/index.md:177-188` 仍写 “Current global rules prohibit file-hash calculation…”，与现行规则不符。现行规则允许运行必需的既有哈希检查，只禁止新增可选的哈希清单。
- **修改**：
  - 标题改成 “File-Hash Rule (current since 2026-10-22)”。
  - 正文改写为：必需的既有检查（adapter context/conflicts、初始化和生命周期安全检查、CI）可以运行，不得移除或用 skip 绕过；不新增可选的 hash inventory。2026-10-22 之前按旧禁令记为受阻的结果属于历史记录。
  - 第 190–194 行保留只读入口说明，但把 “blocked adapter gates” 改成 “adapter gates”，消除当前过时措辞。
  - 第 196–215 行包括标题完整保留；在整段之后单独追加日期标注，说明当时限制已于2026-10-22按新规则解除。
  - 实施后在文件末尾追加 “Documentation Verification (2026-10-22)”，只写实际执行过的结果。
- **不改的部分**：根 `AGENTS.md` 的条件句、它的硬链接，以及任何历史记录。

### 只记录、不实施的复审发现

- **A（过渡限制）**：`components/ccg-workflow/src/cli-setup.ts:26-27` 仍拒绝 Claude 宿主标记，而 `harness-lifecycle.mjs:921-924` 会对组件 CLI 做 `--version` 冒烟。静态链路表明 Claude 宿主下可能在此失败；未动态运行 update/rollback，不能声称已验证其具体阶段、回滚或数据安全结果。不注入 `CCG_HOST=codex` 来掩盖，也不导入来源。
- **B**：`harness-lifecycle.md:177-182` 和 `codex-host-boundary.mjs:1-4` 里 “`.claude` byte guards” 的表述过宽。可选建议，不改。
- **C**：resolveCodexHome 未见显式拒绝 Claude 根重叠的检查，但已有文件系统根、realpath和非链接路径检查。需要显式误传参数；未复现，不升格或纳入本次修复。
- **D**：host 测试只覆盖早期路径，覆盖强度有限。不扩测。

本轮没有发现其他可信的新缺陷。

## 3. PR59 与关联影响

- **当前状态**：`jed-zed/ccg-gptpro-worflow#59` 开放、可合并，固定 head `252de07`，base `9dde150`；变更涉及61个文件。
- **CI**：7 个 check 成功（build、test 共 4 个、go-build 共 2 个），publish 为 skipped。
- **审查**：Codex 审查摘要从 2026-10-22T03:45:03Z 起一直显示 Running，reviews 和 threads 都为空。这既不是审查通过，也不说明没有问题。
- **与 #58 的关系**：compare 证实 #58 的 head `2ce289b` 是 #59 的祖先（ahead 8、behind 0，47 个文件有差异）。这只证明 #59 包含 #58 的历史，不证明整合后 #58 的内容字节都没变。
- **对本仓库的影响**（只作影响分析）：
  - **规则**：精简后的门禁和 GPT Pro 软预算与本地 policy v14 方向一致，但没有导入。
  - **宿主隔离**：PR59 删除了 CLI 和 Grok engine 的全局宿主拒绝，未来合入并受控导入可能解除发现A的旧拒绝点，但仍需验证完整生命周期；它保留的 `~/.claude` / `CLAUDE_CONFIG_DIR` 路径重叠保护与发现C相关，并非本PR新增。
  - **doctor**：新增只读的 “Upstream CCG overlap” 检查，本轮没有安装或运行。
  - **save-codex**：PR59 加入的网页路由不启用。
- PR59 不构成升级授权，也不是安全证明。

## 4. 11 个 Harness PR 现状（只读）

| PR | 状态 |
|---|---|
| #57（草稿） | clean，head `a6c6d31`，CI 全绿，但对应的不是当前 HEAD |
| #56 | clean，setup-node 升级 |
| #55（草稿） | clean |
| #52 | dirty，旧 base `2ffd604`，1 条未解决线程（F4） |
| #9 / #8 / #7 / #6 / #5 | dirty，快照 Dependabot PR，CI 失败 |
| #4 | unstable，Go/windows 失败 |
| #3 | clean，7 月的旧 CI |

- 所有 PR 自 10-20 起没有新评论；开放 issue 为 0。绿色 CI 都不等于审查通过。
- 9 个本地提交与各 PR 之间还没有做 patch-id 或内容等价映射。“不在远端分支”只是按分支包含关系得出的结论。
- 本次实施不推送、不评论、不关闭任何 PR；这些都不是修复的必要步骤。

## 5. 开工前置与执行顺序

1. **父会话独立审核通过后才开工。** 实施时不再向用户确认同一许可。
2. **先确认基线没有并发变化**：`git rev-parse HEAD` 必须等于 `724975b…`；`git branch --show-current` 必须是 `codex/sync-main-20261021`；`git status --porcelain=v1` 只能有 `?? .serena/` 和 `?? pnpm-lock.yaml`。若不同，先识别是否影响白名单或审核基线，保留新变化并重新核对；影响审核范围时停止相关修改交回父会话，不能覆盖或机械地要求用户重复确认。
3. **严格文件白名单**（共 7 个）：
   - `scripts/lib/harness-adapter/probe.mjs`
   - `tests/harness-adapter.test.mjs`
   - `.github/dependabot.yml`
   - `tests/ci-contract.test.mjs`
   - 新建 `.agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-upload.Tests.ps1`
   - `.trellis/spec/tooling/chatgpt-pro-sidebar-v2.md`
   - `.trellis/spec/tooling/index.md`

   另外，唯一的 Trellis 任务目录用于同步计划。
4. **备份**：在仓库外新建独立目录，例如 `J:/Codex-Archive/2026-10-21/task-2/recheck-20261022-0730/implementation-backup/`，只复制拟改的 6 个已有文件；改完后逐文件保存 `git diff -- <file>`，新文件另存原样副本。不 reset，也不 checkout 整个文件。
5. **任务权威**：Trellis 是后续唯一的任务权威。实施方复用或新建一个结构化任务。本次涉及敏感信息处理和多个模块，采用 `prd.md`、`design.md`、`implement.md`：分别保存需求验收、技术边界和父会话认可的执行计划；不复制成第二套CCG任务。本只读报告不是额外的执行计划来源。
6. **执行顺序**：F1 先写测试、确认在旧代码上失败，再改代码确认通过 → F2 → F3 → N1 → N2 → 运行检查 → 在 index 末尾追加验证记录 → 用中文汇报。不提交。

## 6. 测试命令与回滚

- **必需检查**：
  - `node --test tests/harness-adapter.test.mjs tests/ci-contract.test.mjs tests/readme-provenance.test.mjs`（该文件用到既有哈希，现行规则允许运行）
  - `node scripts/harness-adapter.mjs context`
  - `node scripts/harness-adapter.mjs conflicts --ci`（预期 blocking 仍为 0）
  - 针对 7 个白名单文件的 `git diff --check`
- **Pester**：本轮已发现Pester 5.7.1；实施时只使用已安装的5.x版本，不安装：
  - `$r = Invoke-Pester -Path .agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-upload.Tests.ps1 -PassThru`；要求 `$r.FailedCount -eq 0` 且 `$r.PassedCount -gt 0`
  - 如果没有 5.x，记为受阻；不安装，也不写通过。
  - 可选：在同目录对现有离线测试跑一次整目录 Pester，以确认 dot-source 没有冲突。
- **不跑的内容**：UI、浏览器、真实上传、真实 Provider、安装链、新 doctor，以及可选的哈希清单。在上述范围不变的前提下，使用对应测试文件覆盖改动；若实施暴露范围或调用链变化，重新应用项目必需门禁，不能据模型计划豁免。完整 `harness:test` 当前未运行。未运行的检查一律写“未运行”。
- **回滚**：
  1. 先把当前 diff 与备份目录中的补丁比对，确认之后没有别的改动叠加上来。
  2. 逐文件执行 `git apply -R --check <patch>`，通过后再 `git apply -R <patch>`。
  3. 新建的 Pester 文件只在内容与副本一致时删除。
  4. 如果出现后续改动，只手工反转本次的精确 hunks。禁止整库复原。


### 分项验收、风险与回滚对应

| 项目 | 必须满足的验收 | 剩余风险与精确回滚 |
|---|---|---|
| F1 | 新合成用例在旧表达式失败、修复后通过；最终报告不含指定敏感片段，错误长度仍≤500 | 只证明覆盖的回显格式；反转probe截断顺序hunk及对应新增测试 |
| F2 | `[::1]`接受，`[::2]`、远程HTTP、内嵌凭据仍拒绝 | 不扩大整个IPv6允许范围；反转单个字面值及对应断言 |
| F3 | 仅保留Actions配置，合同通过，来源树门禁零阻断 | 组件升级转由来源流程，现有PR不自动处理；反转YAML删除hunks和合同测试hunks |
| N1 | 5个输入分支断言具体错误类别，Pester实际发现并通过；无浏览器/网络调用；文档明确显式授权 | 不证明真实上传或密封映射路径；仅删除本次新测试（先核对内容）及反转规范hunks |
| N2 | 当前规则准确，历史196–215行含标题保留，链接/实际diff检查通过 | 不把新结果倒写进历史；反转现行规则/新标注/新验证段hunks |

本文没有执行任何修复。所有回滚只针对本次实施补丁，不能回退9个既有提交或覆盖随后新增的用户修改。

## 7. 保留与禁止事项

- **保留**：9 个本地提交、基于目标的宿主隔离（target-based host isolation）、policy v14、`openai.yaml` 的现有字节（不改、不重新格式化）、全局规则和项目规则、两个未跟踪路径。
- **禁止**：
  - 删除密封的历史恢复逻辑、按行数拆分大文件、恢复旧的 Grok 流程、启用 save-codex 网页路由、安装新 doctor。
  - 修改 `components/`、`harness.sources.json` 或来源仓库，导入快照。
  - 宿主伪装，注入 `CCG_HOST`。
  - 提交、推送、合并、关闭 PR，安装，涉及凭据、权限、认证或隧道的操作。

**状态：复审与计划完成，等待父会话独立审核，未实施。**

## Parent approval supplement
Parent reviewed and approved this complete scope. F1 requires synthetic crossing500 AND normal-length error tests, retaining red/green output. N1 requires exactly five discovered manifest cases with pass/fail/discovery counts; dot-source must not invoke browser or produce real file side effects. F3 documentation must state source dependencies still need normal/security updates followed by controlled import. Normal formal sandbox approvals are allowed; do not alter system permissions. Parent approval source thread: 01a15691-e0ff-776b-b97a-0627cf34a0e6.


## Authorized Junction compatibility continuation (2026-10-22)
User 09:19 UTC approved continuing the existing Codex-home Junction compatibility issue. Parent source thread 01a15691-e0ff-776b-b97a-0627cf34a0e6 authorizes project-only resolver/validation/tests/documentation changes with equivalent protections. The exact old seven-file implementation remains intact.

Permit only the default .codex leaf alias (including an explicitly identical default path), canonicalize to a verified non-root real directory, reject linked ancestors/nondefault explicit aliases/files/dangling/cycles, preserve missing-default compatibility, and pass the physical identity into repository isolation checks. Existing approval/ownership/CAS/rollback comparisons stay in place. Required source pin must match new resolver bytes. No installation, system-link/ACL/default-entry/auth changes or credential/session reads. Claude authors the scoped snapshot implementation and any mechanical pin-updater; Codex reviews and integrates.

The old written rejection of a default alias is deliberately superseded only within this new authorization; this is not approval to weaken other checks. Legacy journal migration and sameCodexHome historical semantics are unchanged. Runtime acceptance must use the original conflicts/doctor commands, not an alternate home or skip. Regression tests use disposable synthetic directories.

Scope: .agents/skills/harness-init/scripts/codex-home.mjs; .agents/skills/harness-init/scripts/harness-init-core.mjs; scripts/verify-sources.ps1; tests/harness-split-roots.test.mjs; .agents/skills/harness-init/SKILL.md; .trellis/spec/tooling/harness-initializer.md; scripts/DESIGN.md

Verification: split-roots regression and affected offline contracts; previous 43 Node and five Pester cases; context, conflicts --ci, original runtime conflicts, doctor/source verification; CCG change/quality/security checks. Parent final review remains pending.

Analysis source: J:\Codex-Archive\2026-10-21\task-2\junction-20261022\CLAUDE-ANALYSIS.md
