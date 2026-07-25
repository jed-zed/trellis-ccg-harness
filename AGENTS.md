<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

<!-- HARNESS:START -->
# Layered Harness Adapter

The Harness is the combination of Trellis and the personal CCG implementation.
`.harness/adapter.json` and `scripts/harness-adapter.mjs` are its internal
integration boundary, not a third framework.

- Trellis is the canonical authority for task identity, status, requirements,
  design, implementation plans, specifications, and completion.
- CCG owns model orchestration, evidence helpers, GPT Pro bridges, and quality
  gates. Run it from the installed CLI/plugin version recorded in
  `harness.sources.json`; never execute `components/ccg-workflow/` as the
  integration runtime.
- Codex is the only workspace writer and uses Trellis inline mode. Gemini is a
  bounded read-only helper. Claude is disabled. GPT Pro is manual-only.
- Grok is optional and disabled by default. Its absence must not block ordinary
  work. A manual compatible-provider probe requires environment-only
  `HARNESS_GROK_*` variables and may never claim search capability without
  source-backed evidence.
- `.ccg/` and `.codex/ccg/` are ignored runtime evidence, never canonical task
  state and never committed.
- Before model work, use `node scripts/harness-adapter.mjs context`. Before
  delivery, use `node scripts/harness-adapter.mjs conflicts`.
- Never persist provider credentials, print bearer headers, or reinterpret
  `HARNESS_GROK_API_KEY` as `XAI_API_KEY`.

<!-- HARNESS:END -->
