# Harness Collaboration Policy

The Harness distribution's upstream source for this reusable policy is
`.agents/skills/harness-init/assets/collaboration-policy.md`. In every
initialized project, the canonical owned policy snapshot is
`.harness/policies/collaboration-policy.md`; `harness-init` updates that owned
copy from the distribution asset and projects it into a dedicated managed block
in root `AGENTS.md`. Do not edit the owned source or managed block directly.

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

## Product-manager review boundary

The optional product-manager role is a read-only CCG evidence provider inside
the existing Trellis lifecycle. It never owns task identity, requirements,
plans, milestones, status, completion, or workspace writes.

- CCG unified routing role `product-manager` is the only selected-provider
  authority. Project and task state may narrow the allowed provider set but
  must not select or fall back to another provider. `[product_manager]` stores
  behavior parameters only.
- Canonical product state is the tracked
  `.trellis/tasks/<task>/product-manager.json` projection. Raw requests,
  responses, locks, and journals stay under the ignored task-local
  `.ccg-evidence/product-manager/` path.
- Every valid review projects the Provider's `user_acceptance_summary`,
  findings, risks, process adjustments, recommended next action, identity, and
  evidence refs into tracked `latestAdvice` and the checkpoint review. Clearing
  `currentGate` after a user response must not clear or replace that advice
  with the generic Trellis resume action.
- The current Codex task is the sole orchestrator. It prepares review input,
  explicitly authorizes any network or paid provider call, validates the
  response, and applies it through the Harness adapter.
- Provider executions must be independently read-only with workspace writes,
  terminal tools, subagents, and provider fallback disabled. A provider failure
  records `unavailable`; it never fabricates acceptance.
- Claude Code may be the explicitly selected product-manager Provider. It must
  run from its trusted native executable in a disposable directory with safe
  mode, tools, MCP, skills/plugins, hooks, session persistence, and workspace
  writes disabled. Harness initialization still never installs or logs in Claude.
- Existing prompt hooks may inject only pending-gate and resume breadcrumbs.
  They must not call a provider, acquire a product-manager lock, write product
  state, create another hook, or become a second orchestrator.
- After every valid review, Codex must show the current advice before
  continuing: restate the Provider's `user_acceptance_summary` verbatim, then
  report its findings, risks, process adjustments, and recommended next
  action. `pm status` must keep the same `latestAdvice` visible after the gate
  is cleared.
- Milestone and final acceptance remain hard user gates. A product-manager
  verdict does not mutate Trellis lifecycle status or authorize finish/archive
  by itself.
- For a hard gate, Codex must run `pm present`, show and restate that exact
  review, list the three allowed responses, and end the turn. `pm respond`
  requires the resulting presentation revision and a fresh explicit user
  response. A prior blanket approval, milestone approval, or response from
  before this presentation may never answer the new gate or trigger an
  automatic response.

## Protected sources

Do not modify Ponytail or Caveman `SKILL.md`, CodeGraph or fast-context MCP
implementations, plugin source/cache, or global installations to enforce this
policy. Integrate through project-owned rules and initialization templates.
