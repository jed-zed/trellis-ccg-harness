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
- Codex is the only workspace writer and uses Trellis inline mode. Registered
  Providers may supply bounded evidence with their native permissions and a
  disposable snapshot as the default input and working directory. Claude may
  be selected for frontend, backend, or the
  snapshot-bound product-manager role, but not search. GPT Pro uses the approved
  `chatgpt-pro-sidebar` Skill for automated side-browser handoff and remains
  read-only evidence.
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

<!-- HARNESS-COLLABORATION:START -->
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

## Request triage and proportional workflow

Apply request triage before task-phase instructions. Upstream lifecycle steps
apply to structured tasks; they do not require every request to become a task.
Use the matching Request Triage and Planning Artifacts in
`.trellis/workflow.md` when available; the portable Harness defaults are:

- Simple conversation, read-only local inspection, and known local low-risk
  edits use the fast lane: needed context -> answer/minimal edit -> applicable
  quality checks -> report. Do not ask a task-creation question, create task/PRD/
  design/plan/journal artifacts, or enter start/finish/archive/commit lifecycle.
- Unknown impact or ambiguous requests use structured work. Authentication,
  authorization, credentials, permissions, data migration/loss, Provider/network/
  paid calls, install/sync/publish, destructive operations, shared core and
  multiple modules also require structured work with the applicable gates.
  File or line counts alone never establish low risk.
- Reuse or create a matching Trellis task automatically for authorized structured
  development unless the user opted out for the scope/session. Keep task identity, accepted requirements,
  one authoritative execution plan, implementation, verification and a
  completion record. Complex tasks require `prd.md`, `design.md`, and
  `implement.md`; a lightweight task may keep its short plan in `prd.md`.
  Apply Shared plan approval before implementation: reuse actual same-scope user
  approval; task bookkeeping is not another approval. A required original CCG
  plan gate without prior approval still needs the presented plan and user response.
- Run project lint, type-check and tests, including new-function unit tests,
  bug regressions and updates for changed behavior. Final verification covers
  the full affected task scope, not only the last edit. Preserve the quality
  checklist in `trellis-check`.
- Beyond required complex-task documents and quality checks, every extra
  research artifact, search, Provider, sub-agent, review or broader test
  needs a trigger fact -> required output -> stop condition in the existing
  plan. Without a fact, skip it. Architecture uncertainty, a blocking question,
  changed shared impact or an explicit gate can supply that fact; hypothetical
  future needs cannot. Stop after sufficient evidence and reuse passing checks
  for unchanged behavior.
- Preserve required security, data protection, accessibility, ownership,
  transaction and project/CI gates. Explicit implementation authorization remains
  valid within its reviewed scope; unresolved material decisions and pending
  hard user gates still require the user's answer.
- Completion does not force a commit, archive commit or journal. Archive only
  the current completed structured task with `--no-commit`; a journal needs an
  actual handoff reason. Commit, publish, install and Provider actions retain
  their separate authorization boundaries.

Trellis owns task identity, lifecycle, accepted requirements, specifications,
plans, acceptance criteria, and completion. CCG supplies bounded evidence and
applicable quality gates without creating a second task or plan authority.
Reference the existing canonical artifact instead of copying its requirements
or plan into another layer.

## Workflow gates and approval reuse

- Preserve the selected original CCG strategy's required analysis, plan,
  review and quality gates. Do not downgrade the strategy to avoid them.
- Conversation and read-only inspection need no task. For authorized development,
  Codex automatically maintains the Trellis task and necessary artifacts unless
  the user opted out for the scope/session; task creation and phase transitions
  are not extra approval questions.
- Follow `.trellis/workflow.md#shared-plan-approval`: reuse an actual user
  approval of the same task, plan scope, risks and action classes across CCG
  handoff and resume. Restating a summary or changing formatting does not
  invalidate approval. A missing original strategy approval or a material
  scope/risk/external-effect change still requires a user decision.
- Optional evidence failures remain visible but do not stop independent
  authorized work. A new hard gate must identify an original strategy rule,
  explicit user requirement, or concrete safety/data-loss/external-effect risk,
  and name the affected action and recovery path.
- Existing authorization remains valid within its stated scope. Never infer
  paid/network-call, installation, publishing, deployment or destructive-action
  authorization from an ordinary code-edit approval.

## Codex native leaf workers

This section applies only to the Codex host and its native workers. It does
not alter the official Claude CCG workflow or grant a CCG Provider workspace
writes. Trellis dispatch stays `inline`: the Codex coordinator owns task
state, shared control files, final integration and full-scope verification.
Inline permits independent research, bounded implementation and verification
leaves; a CCG/Trellis-managed task is not by itself a reason to refuse them.

- Dispatch a useful ready work package as soon as its inputs and boundaries
  are known; do not wait to finish unrelated investigation. Usually start
  with 1–2 workers and grow to 3–4 only for additional independent work and
  available host capacity. A simple task stays inline; zero workers is valid.
  These are planning targets, not a worker-count gate or a mandatory team flow.
- Give each package its outcome, needed context or task references,
  dependencies, read-only or write mode, exact owned write paths, acceptance
  check and time budget. Native leaves reuse this packet and need no separate
  Trellis task or JSONL curation. Use the existing Trellis context protocol for
  a formally delegated implement/check task. CCG roles describe the work;
  provider calls and CLI processes are not native-worker counts.
- Read-only leaves receive no write ownership. Before a write leaf starts,
  the coordinator must establish a trusted, authorized scope and one writer
  per path, including ancestor/descendant overlaps. Serialize overlapping
  paths and shared files; the coordinator also waits before editing a leaf's
  paths. A read overlapping an active writer also waits or uses a frozen
  snapshot; only read/read overlaps may run concurrently on the same live
  paths. Missing or ambiguous write scope blocks those writes. Missing batch
  IDs or totals may be filled by the coordinator and do not stop safe work.
- Leaves do not mutate task lifecycle, shared orchestration files or another
  worker's paths, recursively dispatch implement/check work, or enlarge
  permissions. Keep user-selected models/reasoning, sandbox, approval,
  network/payment and tool-access boundaries; delegation grants none of them.
- Return useful findings or a stable partial result early, with its limits;
  the coordinator can use it for independent work while the leaf continues.
  A dependent package starts only after the coordinator accepts a frozen
  delivery or fixed snapshot; a progress message is not a completed dependency.
  A partial result does not release write ownership. Small follow-ups may
  reuse the same package/context. Final checks or independent review must use
  the actual integrated revision; self-review is not independent review.
- On timeout, failure or unavailable capability, continue unrelated ready
  work and report the gap. After the previous writer is confirmed stopped,
  inspect its partial changes and transfer ownership before a replacement or
  inline takeover. Never have both writers race, invent a passing result or
  bypass a required check. Reduce concurrency for CPU/memory pressure or
  nested provider work; only one owner runs a heavy shared test/build at once.
- Record the actual assignments, useful results, failures and checks in the
  existing task/report. No duplicate audit documents or quota gate is needed.
  This is coordinator instruction, not a new automatic scheduler or sandbox.


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
- Do not add speculative defensive branches, fallback, retries, compatibility
  wrappers, caching, configuration or abstractions. Each must serve an accepted
  requirement, reproduced fault or actual trust/data boundary. Fix the common
  root cause instead of layering guards at every caller; report clear errors
  rather than silently claiming success.
- Preserve input validation at trust boundaries, data-loss prevention, security
  and accessibility. Existing ownership/transaction safeguards are not optional.

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

The optional product-manager role is a CCG evidence provider inside the
existing Trellis lifecycle. It never owns task identity, requirements,
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
  checks user authorization for any network or paid provider call, validates
  the response, and applies it through the Harness adapter. Reuse authorization
  already covering the same Provider, data, action and cost scope.
- PM is advisory by default. Only an explicit user requirement recorded by
  Codex as `task.json.meta.productManager.required: true` makes its reviews
  mandatory; the Provider cannot set this policy. An enabled Provider or a
  candidate event alone is not a required review or call authorization.
- If an installed CCG Skill reports `authorization_required` for an optional
  PM candidate, skip that call and continue authorized work. This project rule
  takes precedence over older per-candidate stop wording; never call a paid
  Provider merely to avoid asking. Original CCG strategy gates still apply.
- Provider executions inherit the personal CCG fork's upstream Provider
  permission mode. The task-local snapshot, schema, identity, timeout, output,
  retry, no-fallback, network/payment authorization, and user-gate contracts
  remain enforced. A provider failure records `unavailable`; it never fabricates
  acceptance or gains authority over the canonical workspace.
- Claude Code may be explicitly selected for frontend, backend, or
  product-manager routing; defaults stay unchanged and Claude is not a search
  Provider. Product-manager Claude sees a bounded task-local snapshot. Project
  transport defaults to native local Claude; explicit SSH stores only `ssh` in
  the project contract, reads connection details from the fixed environment
  allowlist, requires bridge protocol v2, and never falls back. Harness
  initialization still never installs or logs in Claude.
- Existing prompt hooks may inject only pending-gate and resume breadcrumbs.
  They must not call a provider, acquire a product-manager lock, write product
  state, create another hook, or become a second orchestrator.
- After every valid review, Codex must show the current advice before
  continuing: restate the Provider's `user_acceptance_summary` verbatim, then
  report its findings, risks, process adjustments, and recommended next
  action. `pm status` must keep the same `latestAdvice` visible after the gate
  is cleared.
- Optional reviews, including milestone/final reviews, retain advice and
  failure diagnostics without creating acceptance gates or completing a
  milestone. Required reviews, material decisions and existing user acceptance
  cards remain hard gates for the dependent checkpoint. Unrelated authorized
  work may continue. Never erase an old pending card during review or plan sync.
- An advisory `final-eligibility` result of `not_required` means only that PM
  adds no completion gate; it is not evidence of task completion. Trellis and
  the selected original CCG strategy still own completion and verification.
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
<!-- HARNESS-COLLABORATION:END -->
