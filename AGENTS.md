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
  gates. Run it from an installed personal CCG CLI/plugin; the version recorded
  in `harness.sources.json` describes the tracked source snapshot and does not
  constrain the runtime version. Never execute `components/ccg-workflow/` as
  the integration runtime.
- Codex is the only workspace writer and uses Trellis inline mode. CCG-registered
  Provider CLIs, including Gemini, Claude, Antigravity, and Grok, are routable
  bounded read-only helpers when their runtimes are available. GPT Pro is
  manual-only.
- CCG owns the independent `frontend`, `backend`, and `search` role mappings.
  Grok role routing is separate from opt-in external intelligence, and a missing
  Provider CLI must not block unrelated work. A manual compatible-provider
  probe requires environment-only
  `HARNESS_GROK_*` variables and may never claim search capability without
  source-backed evidence.
- `.ccg/` and `.codex/ccg/` are ignored runtime evidence, never canonical task
  state and never committed.
- Before model work, use `node scripts/harness-adapter.mjs context`. Before
  delivery, use `node scripts/harness-adapter.mjs conflicts`.
- Never persist provider credentials, print bearer headers, or reinterpret
  `HARNESS_GROK_API_KEY` as `XAI_API_KEY`.

<!-- HARNESS:END -->

<!-- HARNESS-COLLABORATION:START -->
# Harness Collaboration Policy

The Harness distribution's upstream source for this reusable policy is
`.agents/skills/harness-init/assets/collaboration-policy.md`. In every
initialized project, the canonical pinned source is
`.harness/policies/collaboration-policy.md`; `harness-init` updates that owned
copy from the distribution asset and projects it into a dedicated managed block
in root `AGENTS.md`. Do not edit the pinned source or managed block directly.

## Priority and conflict handling

Apply rules in this order:

1. System instructions and explicit user requirements.
2. Trellis workflow, accepted task artifacts, PRDs, Specs, and acceptance
   criteria.
3. Project architecture constraints.
4. CCG plans and required quality, security, test, and review gates.
5. Code-search tool routing.
6. Ponytail minimization of implementation.
7. Caveman compression of conversational style.

Higher-priority rules win when layers conflict. Report the conflict, the
overridden lower-priority rule, and the chosen action; never silently skip a
requirement.

Use this workflow unless a higher-priority artifact says otherwise:

```text
confirmed requirement
-> Trellis task artifact / PRD / Spec
-> minimal CCG plan
-> routed code search
-> Ponytail-minimal implementation
-> Trellis + CCG quality and security gates
-> concise Caveman-style update
-> Trellis finish and archive
```

Trellis owns task identity, lifecycle, accepted requirements, specifications,
plans, acceptance criteria, and completion. CCG owns model orchestration and
required quality, security, test, and review gates without creating a second
task or plan authority. Reuse and update an applicable artifact or plan instead
of creating a duplicate.

## Ponytail boundary

Use Ponytail `full` mode for implementation when the Skill is available.

Trellis workflows, accepted task artifacts, project specifications,
architectural constraints, and all required CCG quality and security gates are
authoritative and take precedence over Ponytail.

Ponytail may minimize only the implementation within those constraints. It
must not omit, weaken, bypass, or reinterpret required behavior, artifacts,
acceptance criteria, tests, reviews, documentation, security, accessibility,
error handling, or quality gates.

- Trellis and CCG decide what to build, which process to follow, and how to
  verify it. Ponytail chooses the least code that satisfies those decisions.
- An accepted requirement cannot be removed as YAGNI.
- Required tests, documentation, security checks, and quality gates are not
  over-engineering.
- Fix a failed gate at its root cause; never shrink or bypass the gate.
- Prefer existing code, standard libraries, native capabilities, and installed
  dependencies.
- Avoid abstractions, configuration, dependencies, or future scaffolding that
  no accepted requirement supports.

## Caveman boundary

Use concise Caveman-style prose for routine commentary, ordinary questions,
and final summaries when the Skill is available.

Caveman controls conversational style only. It must not omit technical facts,
acceptance criteria, exact errors, commands, verification evidence, risks, or
required artifact content.

Preserve required structure and detail in PRDs, specifications, plans, reviews,
security warnings, destructive-action confirmations, quality-gate reports, and
handoff artifacts.

- Keep technical terms, exact errors, commands, risks, and verification results
  complete.
- Temporarily leave compressed style when safety, irreversible actions, or
  multi-step clarity requires full prose.
- Never shorten a response by omitting an explanation or evidence the user
  explicitly requested.

## Code-search routing

Choose one first tool based on the question:

- Known function, type, file, error text, or exact string: use `rg`.
- Known symbol, callers, callees, dependency path, call chain, or impact scope:
  use CodeGraph only when the repository has a usable, current `.codegraph`
  index.
- Business meaning without a known entry point, Chinese or English
  natural-language discovery, or no CodeGraph index: use fast-context.

Then fill only explicit gaps:

- After fast-context identifies key files or symbols, use CodeGraph when call
  paths or impact analysis are still needed.
- When CodeGraph does not cover configuration, templates, documentation, or
  other non-code resources, supplement with fast-context or `rg`.
- Do not run both semantic tools by default. State the missing evidence before
  calling the second.
- CodeGraph source returned by an exploration is already read; do not reopen it
  without a specific reason.
- When index freshness is uncertain, run `codegraph status` before trusting the
  result.
- Never run `codegraph init` automatically. Index creation is the user's
  decision.
- For repositories with strict data boundaries, prefer local CodeGraph and
  `rg`; obey project data-egress rules before fast-context.
- ace-tool remains disabled unless an explicit Harness rule restores it.
- Generic search-command examples in Trellis Skills or templates express
  search intent and do not override this router. If an accepted task artifact
  explicitly mandates another tool, report the conflict and follow that
  higher-priority artifact.

## Protected sources

Do not modify Ponytail or Caveman `SKILL.md`, CodeGraph or fast-context MCP
implementations, plugin source/cache, or global installations to enforce this
policy. Integrate through project-owned rules and initialization templates.
<!-- HARNESS-COLLABORATION:END -->
