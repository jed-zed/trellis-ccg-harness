---
name: plan
description: Create or revise a CCG implementation plan with the applicable frontend, backend, and search providers and Codex as final plan owner. Use when the user invokes /ccg:plan, asks to generate a .codex/ccg/plans/*.md CCG plan, asks to revise an existing CCG plan, or wants Codex-native multi-model planning without modifying product code.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow plan --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Plan

Create decision-complete CCG plans for later `/ccg:execute`. Codex gathers
context and writes the final plan under `.codex/ccg/plans/`. Planning is an
internal phase of the applicable frontend, backend, and search roles. The
shared **Companion Role Contract** makes search advisory whenever frontend or
backend participates and evaluates the product-manager authorization gate;
configured providers supply bounded analysis when a real plan is created or
revised.

## Boundaries

- Write and revise plans only under `.codex/ccg/plans/*.md`.
- Do not modify product code, tests, migrations, package files, or original Claude CCG plugin files.
- Read `../../rules/ccg-role-routing.md`, follow its **Companion Role
  Contract**, classify plan slices as frontend, backend, and/or search, then
  resolve the required top-level roles before assigning planning analysis.
- Claude may be explicitly selected for `frontend`, `backend`, or
  `product-manager`. It is not eligible for `search`; defaults and no-fallback
  behavior remain unchanged.
- Do not call `/ccg:execute` automatically and do not ask for a Y/N execution handoff.
- If no user requirement is provided, answer in Chinese with usage examples and do not write files.
- If the user explicitly asks to revise an existing plan file, update only that plan file. Otherwise create a new plan and never overwrite an existing plan; use `-v2`, `-v3`, and so on.

## Language Contract

All `/ccg:plan` user-facing output must be Chinese by default. This includes empty-input usage/help, progress summaries, ambiguity questions, provider launch or failure reports, saved-plan summaries, and the final `/ccg:execute <plan-path>` handoff. English is allowed only for literal commands, file paths, code identifiers, generated English slugs, model names, environment variables, and raw provider excerpts that are clearly labeled as excerpts.

The generated plan file itself must also be Chinese by default. Hard requirement:

- Use Chinese section headings, table headers, checklist labels, narrative text, risk descriptions, test strategy, and handoff explanation.
- Keep English only for literal commands, file paths, code identifiers, model names, environment variables, generated slugs, URLs, and clearly labeled short provider excerpts.
- Do not write an English plan template and then summarize it in Chinese; the saved `.codex/ccg/plans/*.md` content is the final CCG planning output and must be Chinese.
- If a role provider responds in English, synthesize it into Chinese before writing the final plan, while preserving short literal excerpts only when useful.

Internal prompts to tools or providers may use English when that improves retrieval or technical precision, but Codex must translate the final planning interaction and the saved plan content back into concise Chinese for the user.

## Role-provider planning evidence gate

For any real plan creation or plan revision, classify the task into frontend,
backend, and any materially useful search slice first. Resolve every required
top-level role; frontend or backend makes search advisory companion evidence
and automatically evaluates the mapped product-manager authorization gate.
Before writing or presenting a final plan:

- when a selected role provider is `codex`, Codex may perform that role's
  planning analysis directly;
- when an external role provider is selected, capture and read its non-empty
  response before writing the plan;
- when a selected role provider is `gemini`, use the bundled preview helper
  without `--model` unless the user configured an explicit pin, and record its preview URL and response
  file;
- include Codex analysis, applicable role-provider analysis, and the final
  synthesis.
- record `searchStatus` and `productManagerStatus`; when the latter is
  `authorization_required`, stop before the Provider call until the user
  explicitly authorizes it. If invoked, record the validated task-local
  evidence identity.

If a selected external provider cannot start or still has no usable response
after at most two total attempts, stop and report the failure in Chinese. Do
not write or present a final plan and do not emit fake multi-model evidence.

This gate does not apply to empty-input usage/help responses.

## Workflow

1. **Preflight**
   - Run `git status --short`.
   - Read relevant project instructions such as `AGENTS.md`, local README files, and existing plan files only when they affect the requested plan.
   - Resolve the absolute project root from the current workspace; do not infer it from home paths.

2. **Enhance the requirement**
   - Convert the user request into structured planning input: goal, in-scope behavior, out-of-scope behavior, constraints, acceptance criteria, likely affected areas, and open questions.
   - If high-impact ambiguity remains, ask the user before writing any plan.

3. **Search project context**
   - Read the current project's `AGENTS.md` and follow its search policy.
   - For known identifiers, filenames, literals, or error messages, use `rg`.
   - Use an approved semantic search tool only when the project policy calls
     for it and the user has explicitly approved its installation. Do not
     install, configure, or enable an MCP server from this workflow.
   - Do not invoke ace-tool or create a CodeGraph index automatically. If an
     optional search tool is absent or unavailable, continue with targeted
     reads and exact search instead of aborting.
   - Gather enough evidence to name key files, symbols, existing patterns, and verification commands. Do not invent paths.

4. **Run role-provider planning analysis**
   - Classify the task as frontend, backend, search, or a combination and
     resolve those roles.
   - If a selected role uses `codex`, perform that role's analysis directly.
   - If a selected role uses `gemini`, run the bundled helper from `../ccg-executor/scripts/invoke_gemini_preview.py` as a foreground command inside a tool-managed background job with `--approval-mode plan --prompt-template plan` and no `--direct-workdir`. Omit `--model` unless explicitly configured. Do not pass `--detach`; monitor the background job until the helper exits and then read its non-empty response file.
   - For another external provider, run `ccg wrapper --backend <provider> --progress - "<workdir>"` for bounded analysis of that role's slice. Pass the prompt through stdin and do not add `--lite`.
   - Include the enhanced requirement, context evidence, and a request for concise analysis: alternative approaches, edge cases, UI/UX concerns when relevant, tests, risks, and recommended plan steps.
   - Make at most two total attempts for a failed external provider call, using
     the same configured Provider and stable operation/evidence identity, then
     stop without writing a plan.
   - Read the non-empty provider response before writing the final plan.

5. **Synthesize the plan**
   - Codex owns repository adaptation and final sequencing.
   - Treat configured role providers as bounded planning evidence.
   - Record disagreements and the final tradeoff instead of hiding them.
   - Translate or synthesize provider findings into Chinese before saving the final plan.

6. **Write the plan**
   - Create `.codex/ccg/plans/` if missing.
   - Generate an English kebab-case slug from the task name. If it cannot be inferred cleanly, use `ccg-plan`.
   - For a new plan, choose `.codex/ccg/plans/<slug>.md`; if it exists, use `.codex/ccg/plans/<slug>-v2.md`, then `-v3`, etc.
   - For an explicit revision request, write only the specified existing plan file under `.codex/ccg/plans/`.
   - Ensure the saved plan content follows the Chinese plan template below. Then show the full plan summary in Chinese and stop. Do not continue into implementation.

## Plan Template

Use this Chinese Markdown structure:

```markdown
# CCG 计划：<任务名称>

**生成者**：Codex CCG Planner
**任务类型**：后端 / 前端 / 全栈 / 文档 / 重构
**计划路径**：`.codex/ccg/plans/<file>.md`
**职责 Providers**：`frontend=<provider>`、`backend=<provider>`、`search=<provider|not_applicable>`
**外部证据**：`<role=response-file-or-inline-codex>`
**伴随状态**：`searchStatus=<invoked|failed|not_applicable>`（建议证据失败不阻塞本地结果）、`productManagerStatus=<authorization_required|authorized|declined|disabled|unavailable|completed|not_applicable>`
**产品经理证据**：<未调用 / 已调用；证据标识>

## 1. 增强需求

### 目标
<业务或技术目标>

### 范围内
- <包含的行为>

### 不在范围内
- <排除的行为>

### 约束
- <技术或流程约束>

### 验收标准
- [ ] <可观察的验收条件>

## 2. 上下文证据

| 区域 | 证据 |
|------|------|
| <模块> | `<file-or-symbol>` - <关键点> |

## 3. 多模型分析

### Codex 分析
<架构、后端/数据影响、仓库模式适配>

### 职责 Provider 分析
<按 frontend/backend/search 分组综合发现，用中文表述>

### 分歧与最终决策
| 主题 | 决策 | 原因 |
|------|------|------|

## 4. WBS 实施步骤

### 模块 A：<名称>（<点数> 任务点）

**文件**：`<path>`

- [ ] **任务 A.1**：<任务>（<点数> 点）
  - **输入**：<依赖>
  - **输出**：<交付物>
  - **步骤**：
    1. <机械步骤>
    2. <机械步骤>

## 5. 关键文件

| 文件 | 动作 | 说明 |
|------|------|------|
| `<path>` | 新建 / 修改 / 验证 | <原因> |

## 6. 测试策略

- **单元测试**：<聚焦测试>
- **集成测试**：<API/数据流测试>
- **E2E/手工验证**：<关键用户流程或手工检查>

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|

## 8. Codex 原生交接

审阅后手动运行：

```text
/ccg:execute .codex/ccg/plans/<file>.md
```

职责 Providers：`<applicable-role-provider-map>`
外部证据：`<role=evidence-location>`
Claude 产品经理：<未选择 / 已选择但本次未调用 / 已调用；证据标识>
```

## 交付消息

保存计划后，用中文回复：

- 说明保存路径。
- 概括选定的技术方案。
- 说明适用的职责 Provider 以及证据位置。
- 说明 Claude 产品经理是否由已安装配置选中，以及本次是否产生了已验证证据。
- 提供准确的手动执行命令：

```text
/ccg:execute .codex/ccg/plans/<file>.md
```

然后停止。不要询问是否要继续执行。
