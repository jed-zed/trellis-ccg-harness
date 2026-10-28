---
name: save-codex
description: Opt-in Codex quota-saving orchestration: bounded webpage Extra High advice, Pro for key decisions, Codex implementation and verification, with observable budgets and reusable evidence.
---

# Optional Codex budget orchestration

Use only when the user enables it. It changes analysis allocation for one canonical task; standard
routing is the default. The webpage helpers are external advice calls through the installed bridge,
not native Codex subagents, separate Codex quotas, account rotation, or permission to bypass limits.

## Enable and disable

Natural language: "enable save-codex for this task" / "disable save-codex".
Entrypoints: /ccg:save-codex on|off|stats or /ccg:go --orchestration save-codex|standard.
Resolve the current canonical task. Use <task>/.ccg-evidence/advice-budget.json for a Trellis task,
or <task>/advice-budget.json for a native CCG task. Do not create another task identity or modify
Trellis lifecycle fields. Resolve scripts relative to ../ccg-gptpro-bridge/scripts/.

    python gptpro_budget.py configure --state <state> --mode save-codex --codex-thread-id <current-thread>
    python gptpro_budget.py configure --state <state> --mode standard
    python gptpro_budget.py stats --state <state>

Enabling does not send anything. Explicitly requested new external advice remains subject to the
session's authorization, privacy and dangerous-action constraints. Never treat implementation or
configuration approval as approval for a real browser acceptance send.

Defaults: at most 8 logical advice requests, 2 Pro requests, 16 possible web send attempts, 2
concurrent advice requests, and 0 orchestration retries. Configure with --max-requests,
--max-pro-requests, --max-web-attempts, --max-concurrency (1..3), --max-pre-invoke-retries (0..2).
The existing global browser limit remains 6 and per-Codex-thread limit 3; use the lower applicable
limit. The planner reserves two possible attempts per request because the existing adapter may
perform its one proved-not-submitted retry after 180 seconds. Count the actual attemptCount when
observed; uncertain requests retain their reservation. No external retry may follow a possible click.

## Routing and context

- Webpage Extra High (极高): frequent bounded low-risk checks, option comparison, small-step
  reasoning, failure-log interpretation, test-case proposals. Batch 2-5 related checks into one
  short brief; do not call once per line or file edit.
- Webpage Pro: key design, important tradeoffs, high risk, security/data loss/deployment decisions,
  complexity >=4/5, difficult diagnosis, conflicting advice or two unsuccessful local attempts.
  Escalation consumes its own budget and requires a new original task identity, never a resend of
  an uncertain request. If the budget is exhausted, pause and report.
- An explicit user webpage strength overrides routing defaults, including Pro versus Extra High.
  Preserve the choice through prepare --thinking-mode, bridge --thinking-mode and Skill
  -ThinkingMode. Keep model selection and Codex reasoning effort separate.
- Codex root: read bounded files, extract evidence, maintain task identity, independently review
  proposed and revised code, own local writes, run tests and make the final acceptance decision. Existing workers get a bounded file/write
  ownership scope, concise accepted advice, relevant code/evidence and test commands. Avoid sending
  each worker the entire transcript or asking root and workers to repeat the same deep analysis.
  Workers still inspect their own files, resolve implementation details and verify their output.
- Do not blindly apply webpage code. Preserve local permissions, confirmation for dangerous actions,
  required provider evidence, project rules, tests, ownership and final Codex review. Opt-in allocation
  supersedes redundant optional native research leaves; it does not waive required checks.

## Independent code review and bounded correction loop

Webpage Extra High / Pro may provide bounded analysis, designs and code drafts or unified diffs.
They return text and use only the authorized read tools; Codex owns all local writes and execution.

1. Codex independently reviews each proposed or revised diff against the actual scoped source and
   acceptance criteria before applying it: correctness, interfaces, security, regressions and tests.
   A webpage assurance, successful import or cached response is not code approval.
2. Codex applies only reviewed changes, runs the relevant local tests and inspects the resulting diff.
   Codex retains engineering judgment and final review; it is not a blind copy/apply tool.
3. If review or tests find issues, send only bounded findings: file/line, expected versus actual
   behavior, a minimal reproducer or failing test, relevant context and the accepted design.
   Request a corrected diff and a finding-by-finding response; do not repeat the full design.
4. Treat each correction as new budgeted advice within the existing canonical task, authorized
   scope and send limits, with a new request identity. Never overwrite or resend an uncertain
   request, bypass a paused/exhausted budget, or infer new-send permission from this contract.
5. Codex independently re-reviews the revised diff, applies accepted changes, reruns relevant
   checks and makes the final acceptance decision. An unresolved finding leaves the code unaccepted.

The planner/importer's completed status means validated external evidence, not a completed code
review or product acceptance. Keep concise review findings, test results and acceptance evidence.
A full live webpage code-generation/correction/review cycle and quota savings remain unmeasured
until separately tested; offline prompt tests do not establish those outcomes.

Prepare a bounded job JSON with importance step|critical, risk low|high, complexity 1..5, goal,
acceptance, an explicit snapshot fingerprint (commit + diff/dependency/test hashes), and inputs
(relative file paths whose hashes invalidate reuse). Put only the necessary source excerpts,
log facts and prior conclusions into a short context file; combined job/context limit 12000 chars.
Do not tell a webpage helper it can inspect a local path. Request Goal, Evidence, Steps, Expected
changes, Acceptance, Uncertainty; never request private chain of thought.

    python gptpro_budget.py prepare --state <state> --job-file <job.json> --context-file <summary.md> --workdir <project> [--thinking-mode <explicit-choice>]

Handle every returned action:

- ordinary-ccg: use existing default routing.
- prepare-bridge: create one normal CCG bridge session with the returned briefFile and bridgeArgs,
  plus the existing canonical task/routing evidence flags. Use its idempotencyKey for the one
  authorized RootWait send, passing the returned thinkingMode. CCG persists the budget binding.
- resume-existing: read its existing session/evidence; wait/recover only. No replacement session,
  key, send or New chat. A pre-invoke-failed request may use retry-preinvoke only when its configured
  budget and unchanged zero-attempt proof allow it; adapter -ResumeUnsent rechecks the exact draft.
- reuse: use the already validated unchanged response and cite its evidence. New request count is 0.
- queue: wait locally for a configured concurrency slot. Do not open a page or allocate more work.
- pause: report the reason. Never silently replace an exhausted webpage call with expensive Codex
  deep reasoning. Continue only independent authorized implementation/testing, or wait for the user
  to change the budget/provider. Do not rotate accounts or evade limits.

Independent prepared requests use distinct sessions, keys and exact browser bindings. Existing
run-batch-root may monitor them within configured limits; place its manifest above their contained
session directories, carry each thinkingMode, and import each round independently. Never parallelize
steps depending on an unverified earlier response.

After terminal local evidence:

    python gptpro_budget.py record --state <state> --request-id <id> [--failure-kind quota|capacity|other]

record validates task/key/prompt/mode identity and reuses normal live-evidence import for completion.
Quota/capacity failures pause the budget; configure --resume is an explicit decision, not automatic
fallback. Preserve uncertain evidence and its slot; never retry it. A changed model/slider follows
the installed Skill's one-notification manual-selection wait. On manual completion, independently
verify the original requested strength before any send.

## Measurements and comparison

stats reports logical requests by strength, observed attemptCount, failed attempts, reserved unknown
attempts, elapsed web seconds and completed results. Actual token numbers are recorded only when
an adapter usage.total_tokens source field exists, with path/field/hash; otherwise tokens stay null
and unknown. No browser API here exposes platform billing or Codex quota deductions.
Never claim a savings percentage from request counts or missing token fields.

For acceptance, compare standard versus save-codex on equivalent bounded tasks and code snapshots
in separate disposable worktrees, with equal tests and quality review. Record sourced Codex tokens
if legitimately available, webpage calls by strength, sourced webpage tokens/unknown, failed-call
cost, total wall time, defects/rework and test success. Report reductions in Codex use separately
from added webpage use and latency. Offline route/cache tests verify control flow only; live
end-to-end sending and a real usage comparison require explicit new authorization.

## Existing MCPX workspace evidence

The enabled save-codex workflow defaults to evidenceAccess=mcpx; standard CCG is unchanged. Configure:

    python gptpro_budget.py configure --state <task-budget> --mode save-codex --codex-thread-id <thread> --evidence-access mcpx --mcpx-preflight-file <fresh-receipt.json> --mcpx-scope-file <scope.json>

Use existing workspace/session/runtime_read/read tools first. Save their successful structured facts
as receipt schemaVersion=1, source=successful-existing-MCPX-tools, observedAtUtc, runtime.version,
workspace.name/path, remoteSession.id/status, availableTools, and sourceFiles entries {path,revision
or rev,sha256 when actually returned}. Do not fabricate timestamps, IDs, hashes or successful reads.
A receipt expires after five minutes; refresh versions with bounded read windows rather than pasting
whole files. No script here opens tunnels or obtains credentials.

scope.json contains workspaceId, remoteSessionId, browserProfileId from the actual bound browser,
entrypoint, and allowedPaths of 1-20 exact relative files. Prefer an existing REVIEW_ENTRYPOINT.md
plus files-manifest.json. For a new authorized task, Codex may write these small review artifacts
inside its existing registered project: task goal, exact path allowlist, source versions, acceptance,
and read-only/no-secret instructions. Then re-read their metadata through MCPX. Never register a
new root or copy unrelated data just to satisfy a missing scope. For capability testing an existing
small authorized entrypoint such as AGENTS.md is sufficient; scope it explicitly.

    python gptpro_mcpx.py --preflight-file <receipt> --scope-file <scope>

prepare-capability-check is a distinct, budgeted, non-sending preparation action. Once separately
authorized, it only tests the requested strength's read tools. It must emit the unique request marker
in the first read's activity.intent and cite actual entrypoint lines/revision/hash. Normal project
analysis begins only after validated response import AND server read-history proof mark that mode
verified. Extra High and Pro have independent capability records; no automatic switching.

After a completed web round, Codex exports observe(history) for that exact Remote Session, bounded
by state.firstClickAtUtc and completedAtUtc. Include the request marker activity and successful read
events, fetch all pages, and preserve server event_id/sequence/path/status. Reads must cover the
required scoped files and there must be no out-of-scope reads or non-read tools. Refresh every
source revision/hash using the existing read tools, then:

    python gptpro_budget.py record --state <budget> --request-id <id> --mcpx-history-file <history.json> --mcpx-current-receipt <fresh-receipt.json>

Unproved access remains awaiting-mcpx-proof; explicit MCPX_ACCESS_BLOCKED or MODE_TOOLS_UNAVAILABLE
pauses the route. No silent summary or Pro fallback. Explicit configure --evidence-access summary
labels its Codex-supplied provenance and missing direct workspace access. Cached results require
fresh identical source versions; changed sources produce a new bounded task identity.
Independent concurrent requests need distinct supplied MCPX Remote Sessions within existing roots
so their activity/read attribution cannot overlap. Connection metadata alone proves neither web
strength's tool capability. Tests with fixtures are not live webpage evidence.
