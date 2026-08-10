# Strategy: Review Audit — 代码审查

## Evidence Mode Selection

For a pure local code review, use the diff, source, tests, CI, and local Provider evidence; do not run Grok external-intelligence or apply an official-domain gate. Only when a conclusion depends on a current external fact, predeclare its authoritative domain and run:

`ccg route --workflow review --phase final-verify --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

For that external-fact path append `--trigger final_diff_verify`, repeated `--official-domain <domain>`, and the actual `--diff` plus any `--plan`, `--target`, and `--dependency` files. Choose the domain before Grok runs; never promote a returned domain. Stop ordinary work on exit code `2`, `3`, or `4`.

For local Grok review, bind every regular workspace-relative file with
`--grok-review-target`. The wrapper embeds only those files in a fresh,
Provider session and appends the validated `CCG_GROK_REVIEW_JSON`
scope envelope. For local Antigravity review, bind the concrete files in the prompt
and invoke `ccg wrapper --backend antigravity --antigravity-review`; require a
completed model report. Neither local path uses the external-intelligence
route or an official-domain gate.

> 适用于代码审查需求，双模型交叉验证，结果分级输出。

## 适用条件
- 用户请求代码审查
- 任何复杂度级别
- 自动检测 git diff 作为审查范围

## 前置加载

```
Read("~/.claude/.ccg/engine/model-router.md")
```

---

## 工作流状态机

[phase-state:1-scope]
当前阶段：确定审查范围
📍 Next: 范围确定后启动双模型审查
[/phase-state:1-scope]

[phase-state:2-review]
当前阶段：双模型审查
Gate: 审查范围已确定 ✓
📍 Next: 双模型审查返回后综合报告
[/phase-state:2-review]

[phase-state:3-report]
当前阶段：综合报告
Gate: 双模型审查已返回 ✓
📍 Next: 报告输出后等待用户决定
[/phase-state:3-report]

---

## 阶段详情

### Phase 1: 确定审查范围 [required]

1. 如果用户指定了文件/范围 → 使用指定范围
2. 如果未指定 → 自动获取：
   - `git diff HEAD` — 未提交的变更
   - 如果无 diff → `git diff HEAD~1` — 最近一次提交
   - 如果仍无 diff → 询问用户要审查什么
3. 读取变更涉及的完整文件（不只是 diff，需要上下文）

输出审查范围：
```
📋 审查范围
  变更: [N] 文件，[+M/-K] 行
  文件: [文件列表]
```

### Phase 2: 双模型审查 [required]

**Gate check**: 审查范围已确定

**并行调用**（`run_in_background: true`）：
- **backend 模型**：reviewer 角色
  ```
  <TASK>
  需求：审查以下代码变更
  上下文：[git diff + 完整文件上下文]
  </TASK>
  OUTPUT: 审查发现（按严重度分级：Critical/Warning/Info，每条含：位置、问题、建议）
  ```
- **frontend 模型**：reviewer 角色（相同格式）

等待双模型返回。

### Phase 3: 综合报告 + 质量关卡

**Gate check**: 双模型审查已返回

#### 3a. 质量关卡

**⛔ 必须逐个调用 Skill，不可跳过：**
- 调用 Skill `verify-security` — 等待报告
- 调用 Skill `verify-quality` — 等待报告

#### 3b. 综合报告

合并双模型发现 + 质量关卡结果，去重，按严重度分级：

```
📋 代码审查报告

## Critical（必须修复）
1. [file:line] — [问题描述]
   建议: [具体修复建议]
   来源: [backend/frontend/质量关卡]

## Warning（建议修复）
1. [file:line] — [问题描述]
   建议: [具体修复建议]

## Info（供参考）
1. [file:line] — [观察/建议]

---
总计: [N] Critical, [M] Warning, [K] Info
```

如果有 Critical 发现，询问用户是否立即修复（可切换到 `direct-fix` 策略）。

#### Spec Evolution（审查完成后执行）

参考 `phase-guide.md § 8 Spec Evolution Protocol` 执行：
1. 从审查发现中提炼可复用的编码规范（特别是 Critical/Warning 级反复出现的模式）
2. 如有值得记录的经验 → 草拟 Spec 条目，展示给用户确认后追加到 `.ccg/spec/{domain}/index.md`
3. 无值得提炼的经验 → 跳过

---

## 铁律

- **审查结果必须分级** — 不可笼统说"代码看起来没问题"
- **双模型必须独立审查** — 交叉验证的价值在于独立性
- **Critical 必须明确标出** — 不可淡化严重问题
- **如无发现，明确说明** — "经双模型审查，未发现问题" 优于沉默

## Optional GPT Pro Escalation

Use `/ccg:gptpro-review` as an escalation checkpoint, not as the default review step.

Good triggers:

- release-blocking or high-risk changes;
- disagreement between backend/frontend reviewers;
- security, auth, data-loss, migration, or packaging risks;
- user explicitly requests GPT Pro evidence.

Before creating the GPT Pro bridge, required Gemini gate evidence must be present in
`.ccg/tasks/<task-id>/evidence.json`. After bridge creation, set `task.json.gate` to
`gptpro_sidebar_running` and stop after the detached watcher is registered. Resume through the
same-task Stop Hook and import the completed GPT Pro sidebar response.
