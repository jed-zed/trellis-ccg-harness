---
name: ccg
description: CCG command index for Codex. Use when the user invokes /ccg, asks what CCG commands are available, or gives a CCG plan/task without choosing a subcommand.
---

# CCG

This is the Codex plugin prompt index for CCG. Current Codex CLI builds may not show it in TUI slash autocomplete, but the invocation text still routes to this skill.

Route all real work to `skills/ccg-executor/SKILL.md`.

If the user provided no argument, answer in Chinese with the CCG command index:

- `/ccg:ccg` - show this index; with a plan path or task, execute it.
- `/ccg:plan <task>` - create or revise a CCG plan with applicable role providers.
- `/ccg:workflow` - explain the Codex-native CCG workflow.
- `/ccg:doctor` - diagnose local CCG plugin, skill, MCP, bridge, and Gemini availability.
- `/ccg:doctor --fix` - from this source checkout only, refresh stale local plugin cache.
- `/ccg:execute <plan>` - execute a CCG plan with independently configured role providers.
- `/ccg:codex-exec <plan>` - explicit Codex-led execution alias with the same parity rules.
- `/ccg:excute <plan>` - typo-compatible alias.
- `/ccg:feat <task>` - implement a feature with the applicable configured role providers.
- `/ccg:frontend <task>` - handle frontend/UI work with the configured frontend provider.
- `/ccg:backend <task>` - handle backend-heavy work with the configured backend provider.
- `/ccg:analyze <target>` - read-only code, architecture, risk, or option analysis.
- `/ccg:debug <bug>` - reproduce, diagnose, fix, and verify failures.
- `/ccg:optimize <target>` - optimize with evidence, tests, and regression checks.
- `/ccg:test <target>` - add, repair, or design tests.
- `/ccg:enhance <task>` - enhance existing behavior while preserving local patterns.
- `/ccg:init` - initialize Codex-native CCG project artifacts under `.codex/ccg/`.
- `/ccg:context <subcommand>` - manage Codex-native context history under `.codex/ccg/context/`.
- `/ccg:commit` - prepare a safe commit message and gate checklist.
- `/ccg:rollback` - plan safe rollback or revert operations.
- `/ccg:clean-branches` - dry-run cleanup of safely merged branches.
- `/ccg:worktree <subcommand>` - manage Git worktrees with safety checks.
- `/ccg:spec-init` - initialize `.codex/ccg/specs/`.
- `/ccg:spec-research <requirement>` - write spec research and constraints.
- `/ccg:spec-plan <spec>` - create a Chinese spec-backed CCG plan.
- `/ccg:spec-impl <spec>` - execute a spec-backed plan.
- `/ccg:spec-review <spec>` - review spec, plan, implementation, and tests.
- `/ccg:team` - show Codex-native team workflow commands.
- `/ccg:team-research <task>` - research a task for worker ownership.
- `/ccg:team-plan <task>` - create a worker ownership plan.
- `/ccg:team-exec <plan>` - execute scoped worker plans with Codex as final owner.
- `/ccg:team-review <task>` - review worker output, diffs, and tests.
- `/ccg:review [plan-or-diff]` - review a CCG implementation.
- `/ccg:gemini-preview <prompt>` - manual smoke-test/debug entry for the same browser preview helper used automatically by CCG workflow Gemini calls.
- `/ccg:gptpro-plan <task>` - ordinary `/ccg:plan` semantics first, then automated GPT Pro sidebar planning evidence.
- `/ccg:gptpro-review [target]` - ordinary `/ccg:review` semantics first, then automated GPT Pro sidebar review evidence.
- `/ccg:gptpro-exc <task-or-plan>` - ordinary `/ccg:execute` preflight/routing evidence first, then an automated GPT Pro sidebar second opinion before code landing.
- `/ccg:gen-docs <module-path>` - generate README/DESIGN skeletons for a new module.
- `/ccg:verify-change` - analyze change impact and documentation sync.
- `/ccg:verify-module <module-path>` - check module structure and required documentation.
- `/ccg:verify-quality <changed-path>` - inspect complexity, duplication, naming, and code smells.
- `/ccg:verify-security <changed-path>` - scan security-sensitive changes.
- `ccg routing list` - show the provider selected for the four top-level roles.
- `ccg routing set <role> <provider>` - change one role without changing the others.

If the user provided a plan path or task, treat it as `/ccg:execute`.

Core rule: all four roles resolve through `ccg routing`; analysis, planning,
and review occur inside those roles. Follow the shared **Companion Role
Contract**: frontend or backend adds required search evidence and evaluates the
product-manager authorization gate. Codex remains the orchestrator, sole
real-workspace writer, and final verifier.
Whenever a role selects Gemini, invoke the bundled browser preview helper
automatically. Explicit provider commands bypass default role routing without
changing it.
