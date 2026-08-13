---
name: workflow
description: Explain or enter the Codex-native CCG workflow. Use when the user invokes /ccg:workflow.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow workflow --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4` only for an explicit required semantic route; advisory search failures do not block ordinary work.

# CCG Workflow

Load `skills/ccg-executor/SKILL.md` for the full rule.

Explain in Chinese:

- Original CCG: Claude Code orchestrates Codex + Gemini.
- Codex CCG: Codex orchestrates and applies final code; four top-level roles
  select existing registered providers.
- Follow the shared **Companion Role Contract**: frontend or backend work evaluates
  advisory search evidence and automatically evaluates the product-manager
  authorization gate; the Provider call still requires explicit authorization.
- Analysis, planning, and review are phases inside those roles.
- Gemini browser preview is automatic whenever a role selects Gemini.
  Provider-specific commands still use their named provider directly.

If the user supplies a plan path or task, route it to `/ccg:execute`.
