---
name: spec-plan
description: Create a Chinese Codex-native implementation plan from a CCG spec. Use when the user invokes /ccg:spec-plan.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow spec-plan --phase spec-plan --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Bind the proposal as --dependency, the selected artifact as --target, and any available plan/diff so Spec evidence is invalidated by real artifact changes. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Spec Plan

Create a zero-decision implementation plan from `.codex/ccg/specs/<name>/constraints.md`.

## Outputs

- `.codex/ccg/specs/<name>/plan.md`
- `.codex/ccg/plans/<name>.md` when a standalone execution plan is useful

## Required Helper Flow

- Run `../ccg-spec-init/scripts/spec_manager.js validate <name> --json` before planning.
- Refuse to generate the plan when `constraints.md` is missing or validation is not clean.
- After writing `.codex/ccg/specs/<name>/plan.md`, keep the spec lifecycle aligned with `status.json`.

## Required Plan Content

- 验收标准
- 关键文件
- 实施顺序
- 验证命令
- 风险表
- Codex/Gemini 分析

Saved plan content must be Chinese by default, matching `/ccg:plan`.
