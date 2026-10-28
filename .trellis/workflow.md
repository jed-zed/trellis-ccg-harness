# Development Workflow

## Core Principles

1. Understand the request and its actual impact before choosing a workflow.
2. Default to the fast lane for known, local, low-risk work.
3. Keep authoritative requirements, design and one execution plan; complex tasks require all three artifacts.
4. Implement the smallest change that meets acceptance criteria and preserves trust boundaries.
5. Use checks proportionate to the changed behavior and risk, including required project/CI gates; report unverified work accurately.

## Trellis System

### Developer Identity

Initialize identity only when structured work needs it:

```bash
python ./.trellis/scripts/init_developer.py <your-name>
```

### Specs and Tasks

Read the relevant `.trellis/spec/<package>/<layer>/index.md` and only the guidelines applicable to the changed boundary. Discover packages when their location is unknown:

```bash
python ./.trellis/scripts/get_context.py --mode packages
```

Structured tasks live under `.trellis/tasks/{MM-DD-name}/`. `task.json` owns identity and lifecycle; `prd.md` owns requirements and acceptance. Complex tasks also require `design.md` and `implement.md`; lightweight tasks may keep a short plan in the PRD. Add optional artifacts only for a concrete need.

```bash
python ./.trellis/scripts/task.py create "<title>" --slug <name>
python ./.trellis/scripts/task.py start <name>
python ./.trellis/scripts/task.py current --source
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive <name> --no-commit
python ./.trellis/scripts/task.py set-branch <name> <branch>
python ./.trellis/scripts/task.py set-base-branch <name> <branch>
```

`create` starts planning and binds the task to the current session when identity is available. `start` sets `in_progress`; `finish` clears the session pointer; `archive` sets `completed` and moves the task. Use the CLI's `--help` for current options. Do not fake session identity or copy another session's pointer.

### Context and Journals

```bash
python ./.trellis/scripts/get_context.py
python ./.trellis/scripts/get_context.py --mode phase
python ./.trellis/scripts/get_context.py --mode phase --step <X.Y> --platform codex
```

Load context once when needed, then refresh only changed or missing facts. A journal is optional when the task's completion record already captures the result. If a cross-session handoff needs one, use `add_session.py --no-commit`; do not generate a separate commit just for bookkeeping.

## Phase Index

```text
Fast lane: needed context -> answer or minimal edit -> applicable quality checks -> report
Structured lane: task -> requirements / design / execution plan -> planning review and approval -> implement -> quality gates -> completion record
```

### Request Triage

Classify the current request before loading the task lifecycle. This is an instruction to the assistant, not a prompt classifier or new runtime mode.

| Request and observed impact | Route |
|---|---|
| Simple conversation, explanation, or translation | Fast lane: answer directly; no task-creation question |
| Read-only local inspection with no sensitive-data or external-call boundary | Fast lane: inspect only what answers the request |
| Known local low-risk edit with understood callers and bounded impact | Fast lane: read target, make minimal edit, run applicable project checks, report |
| Ambiguous request or impact/risk that cannot be established | Structured lane: resolve the uncertainty; do not assume low risk |
| Authentication, authorization, credentials, permissions, data migration/loss, Provider/network/paid call, install/sync/publish, destructive operation, shared core or multiple modules | Structured lane: apply the relevant risk and authorization gates |

Fast lane does not ask whether to create a task and does not create task artifacts, PRD/design/plan files, journal, or invoke `task.py start`, finish/archive, or a commit lifecycle. Read only context needed for the answer or change. Use the risk-proportionate verification in `trellis-check`; conversation and read-only inspection need no test command.

Fast lane never bypasses applicable input validation, security, data protection, basic accessibility, or explicit project/CI checks. File count and line count alone cannot prove low risk. An active task does not force unrelated simple questions into its lifecycle; preserve its status and any pending gate.

For authorized structured development, automatically reuse or create the task and necessary artifacts unless the user opted out for this scope/session. An explicit no-task instruction remains effective; continue within the authorized scope without fabricating task state. Task bookkeeping and phase transitions are not separate approval questions. Apply Shared plan approval before implementation; unresolved material decisions and the selected original CCG strategy's required gates remain authoritative.

### Shared plan approval

Keep the selected original CCG strategy's gates: direct-fix adds no plan approval; quick-implement requires its compact-plan approval; guided/full retain their analysis, plan/mode, review and quality gates. Do not downgrade a strategy to avoid its gates.

CCG and Trellis use one approval for the same implementation scope. Check the actual user message and, when available, `task.json.meta.planApproval`; a plan file or an agent assertion alone is not approval.

- Reuse approval of the same task, plan scope, risks and action classes across handoff, phase changes and session resume. A fresh summary, formatting-only digest change or evidence refresh does not invalidate it.
- When no required approval covers the presented plan, show it and wait once. A request to execute an already presented plan can supply that approval; an initial request does not approve an unseen plan.
- Ask again only for a material scope/risk/acceptance change, a new external effect, withdrawal, or an explicit expiry. Record the source message and covered scope in the existing task metadata; do not invent approvals or another plan authority.
- Plan approval cannot answer a product-manager hard user gate. Run `pm present` and show that exact review; `pm respond` requires the resulting presentation revision and a fresh explicit user response.
- Task management and plan approval never authorize unapproved paid/network actions, credential access, installation, publishing, deployment or destructive changes.

### Planning Artifacts

The minimum skeleton is task identity, accepted requirements, one authoritative plan, implementation, project verification, and a completion record. Lightweight structured tasks may be PRD-only. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`: requirements and acceptance in the PRD, technical contracts and tradeoffs in the design, and the ordered execution/verification plan in implement.md. Do not duplicate these authorities in CCG.

Complex-task documents remain required. Add research for a specific unanswered question, a spec update for a changed durable contract, or a journal for missing handoff context. Use Providers and independent reviews when requested or needed for a concrete capability or risk; retain network/paid authorization. Delegate useful independent work under the Codex native leaf workers policy, without a worker-count target.

Use the existing task, Git diff, PR and CI records. Do not require a trigger/output/stop record for every small step, or add a manager, rule checker, database or separate evidence system. Stop optional work once it answers the question; preserve required security, data, ownership, transaction and project/CI gates. Do not create a second CCG task or plan authority.

### Phase 1: Plan

- 1.0 Reuse or create task `[required · once]` automatically for authorized structured work unless the user opted out
- 1.1 Confirm requirements and planning artifacts `[required · repeatable]`
- 1.2 Research `[on evidence]`
- 1.3 Configure context `[on authorized sub-agent dispatch]`
- 1.4 Activate task `[required · once]` after requirements/plan are reviewed and implementation is authorized
- 1.5 Check readiness

[workflow-state:no_task]
No active task. Default fast lane for simple conversation, read-only local inspection, or known local low-risk edits: needed context -> answer/minimal edit -> applicable quality checks -> report. Do not ask a task-creation question or create task artifacts, journal, start/finish/archive, or commit lifecycle for these requests.
Unknown impact or ambiguous requests enter the structured lane. Authentication/authorization, credentials, permissions, data migration/loss, Provider/network/paid calls, install/sync/publish, destructive operations, shared core or multiple modules also enter the structured lane. Preserve applicable security, data protection, accessibility, authorization, and project/CI gates.
For authorized structured development, automatically reuse/create the task and necessary artifacts unless the user opted out for this scope/session. Complex tasks require prd.md, design.md and implement.md. Apply Shared plan approval and preserve the original CCG strategy gates. Extra work needs a concrete question or risk; use existing task, Git, PR and CI records. See Request Triage and Planning Artifacts in workflow.md.
[/workflow-state:no_task]

[workflow-state:task_error]
The active task record could not be read. Do not create or activate another task.
Inspect the task directory named above and repair its task.json. It must be a valid JSON object with a non-empty status.
Preserve existing task fields and artifacts. If the correct status cannot be determined safely, ask the user before reconstructing the record.
[/workflow-state:task_error]

[workflow-state:planning]
Lightweight structured tasks may be PRD-only. Complex tasks must finish prd.md, design.md and implement.md before task.py start. Apply Shared plan approval: reuse an unchanged approved scope without asking again; present a required unapproved plan once.
Curate context only for authorized sub-agent dispatch. Extra work needs a concrete question or risk; stop when it is resolved.
[/workflow-state:planning]

[workflow-state:planning-inline]
Lightweight structured tasks may be PRD-only. Complex tasks must finish prd.md, design.md and implement.md before task.py start. Apply Shared plan approval: reuse an unchanged approved scope without asking again; present a required unapproved plan once.
Inline mode skips JSONL curation and loads task artifacts/specs directly. In the Codex host, apply the Codex native leaf workers policy for bounded native research; the coordinator retains task state. Extra work needs a concrete question or risk; stop when it is resolved.
Product-manager gate: if currentGate.status=awaiting_user_acceptance, present that exact review and block its dependent checkpoint. Only `pm respond` with a fresh explicit response may clear it. Optional unavailable advice without a gate does not block independent authorized work. Resume the same task afterward.
[/workflow-state:planning-inline]

### Phase 2: Execute

- 2.1 Implement `[required · repeatable]`
- 2.2 Applicable quality checks `[required · repeatable]`
- 2.3 Rollback `[on failure]`

[workflow-state:in_progress]
Implement the accepted plan -> risk-proportionate verification and required project/CI gates -> completion record. Dispatch useful authorized independent work. A dispatched implement/check agent works directly without recursive implement/check dispatch; its prompt starts with Active task: <task path> and names the bounded output. Read referenced context and task artifacts.
Final verification accounts for all affected task behavior and reuses passing checks for unchanged work. Extra work needs a concrete question or risk; keep required safety/project gates. Commit only when requested/authorized. Complete the task without forcing a commit or bookkeeping bundle.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Read requirements, design, execution plan and specs -> minimal edit -> risk-proportionate verification and required project/CI gates -> completion record. In the Codex host, inline permits independent research, bounded implementation and verification under the Codex native leaf workers section of .harness/policies/collaboration-policy.md. Dispatch ready packages when useful, without a worker-count target. Each write path has one owner; the coordinator retains task state, shared control files, final integration and verification of all affected task behavior. Extra work needs a concrete question or risk; stop when it is resolved. Preserve required safety/project gates.
Update specs only for a changed durable contract; commit only when requested/authorized. Completion does not require a commit, archive commit, or journal bundle.
Product-manager gate: if currentGate.status=awaiting_user_acceptance, present that exact review and block its dependent checkpoint. Only `pm respond` with a fresh explicit response may clear it. Optional unavailable advice without a gate does not block independent authorized work. Resume the same task afterward.
[/workflow-state:in_progress-inline]

### Phase 3: Finish

- 3.2 Debug retrospective `[on repeated failure]`
- 3.3 Spec update `[on changed durable contract]`
- 3.4 Commit `[on user request/authorization]`
- 3.5 Completion record `[required · once]`

[workflow-state:completed]
Report acceptance and verification from the completion record. Do not force commits or a journal. Archive only the current completed task through trellis-finish-work; other tasks require their own scope.
[/workflow-state:completed]

### Rules

Complete the required skeleton in order. Return to planning when a discovery changes the accepted requirements. Missing design.md or implement.md blocks complex-task implementation. An unrelated quick question can be answered without changing the active task. No workflow instruction can answer a pending product-manager hard user gate.

Load step details only when needed with `get_context.py --mode phase --step <X.Y> --platform codex`. The workflow-state blocks above are the hook's single lifecycle text source; keep them consistent with the details below.

## Phase 1: Plan

#### 1.0 Create task `[required · once]`

Structured lane only. Automatically reuse or create a matching task for authorized development unless the user opted out for this scope/session. Use `task.py create "<title>" --slug <name>` without a date prefix; it creates planning state. Do not automatically start before the requirements and plan are ready. Parent/child tasks are optional only for independently delivered work needing separate ownership; record real dependency ordering in the owning plan.

#### 1.1 Requirement exploration `[required · repeatable]`

Inspect available evidence and record the accepted outcome, scope, constraints and observable acceptance in `prd.md`. Complex tasks also require `design.md` and `implement.md`, each with its own purpose. Use `trellis-brainstorm` for planning and unresolved choices. Add research only using Planning Artifacts triggers. Update the owning artifact when the scope changes.

#### 1.2 Research `[on evidence]`

Name the unanswered question first. Use the repository's search router and existing evidence. External calls retain their authorization and data boundaries. Write a concise answer in the existing plan, or link a research file if the material needs independent reference. Stop when the question is answered; do not search or call another model merely for reassurance.

#### 1.3 Configure context `[on authorized sub-agent dispatch]`

Inline mode loads relevant specs directly through `trellis-before-dev`; skip JSONL curation. Codex native leaves receive a bounded work packet with task/spec references, needed context, mode and exact write ownership, following `Codex native leaf workers` in `.harness/policies/collaboration-policy.md`; they do not create a separate task. When `task.py start` sees seed-only manifests, use its supported `--allow-empty-context` option for this inline contract, not for a formally delegated task lacking context.

For authorized Trellis implement/check task dispatch outside Codex native inline leaves, curate `implement.jsonl` / `check.jsonl` with actual needed specs/research: `{"file":"<repo-relative path>","reason":"<why>"}`. Seed `_example` rows do not count. Read task artifacts in addition to these references. Manifests supply context, not a second plan. Structured-task dispatch identifies `Active task: <task path>` and a bounded assignment; an implement/check child never recursively dispatches implement/check. Fast-lane native leaves reference their work packet without creating a task.

#### 1.4 Activate task `[required · once]`

Review accepted requirements, design, execution plan and applicable gates. Task-creation or planning consent does not authorize coding. Apply Shared plan approval before `task.py start`; reuse an unchanged approved scope rather than asking again. Unresolved material decisions and pending hard gates still require the user's response.

Run `task.py start <task-dir>` (inline seed-only context: add `--allow-empty-context`). Follow any actual session-identity error; do not manufacture an identity or use another task's state.

#### 1.5 Completion criteria

Unless the user opted out, task identity, accepted requirements, reviewed planning artifacts, applicable Shared plan approval and `in_progress` status are required. Complex tasks require prd.md, design.md and implement.md. A delegated task also needs its curated context.

## Phase 2: Execute

#### 2.1 Implement `[required · repeatable]`

Read the owning task artifacts and applicable specs via `trellis-before-dev`. Trace callers and the changed boundary, reuse existing mechanisms, then implement the minimum accepted behavior. Codex inline permits the coordinator and explicitly scoped native write leaves, with one writer per path. The coordinator retains task state, shared control files, integration and final verification; apply `Codex native leaf workers` in `.harness/policies/collaboration-policy.md` for early results, follow-ups and failure handoff. This Codex-only policy does not change the official Claude workflow. Other dispatch modes use their native context protocol only when delegation is authorized and triggered.

Use the smallest sufficient implementation and existing mechanisms. Defensive code must serve a real boundary, supported input range, concrete failure model or business invariant. Do not mechanically repeat checks guaranteed internally; preserve independent security controls. Do not add fallback, retry, caching, compatibility wrappers, configuration, persistence, abstractions or gates for hypothetical future needs. Fix the common root cause; propagate clear errors without swallowing exceptions or claiming success. Keep retries bounded in one responsible layer. Account for idempotency when retries or repeated calls can duplicate side effects and inspect the original operation before retrying an uncertain result. Preserve security, trust-boundary validation, data protection and accessibility.

#### 2.2 Quality check `[required · repeatable]`

Use `trellis-check` for the actual diff and all affected behavior. Choose checks proportionate to the changed behavior and risk, including required project/CI checks. Add or update the smallest meaningful regression for changed nontrivial behavior; do not require a unit test for every new function. Rule or documentation wording needs relevant content/context checks, not unrelated builds. Account for the full affected task scope using existing passing evidence; never label an unrun check as passed.

Review findings must identify location, trigger, consequence and supporting evidence. Zero findings is valid; optional suggestions do not become requirements. Address credible security or data-loss risks within scope, and report blockers or missing authorization. For a user-requested GPT Pro independent PR review, retain one full round plus one targeted re-review as the default soft budget. Recheck the fix or changed risk rather than restarting the whole review. A real blocker keeps the task incomplete; do not loop indefinitely or force a pass at the round limit.

After a fix, rerun the affected check. Repeat or broaden verification only for a new change, failure, unresolved concrete concern or required gate. Stop once acceptance and required checks are satisfied; retain and report unresolved failures.

#### 2.3 Rollback `[on failure]`

If requirements are wrong, revise the owning artifact. If implementation fails, undo only the task-owned change using its rollback plan; preserve unrelated dirty work. Managed ownership/transaction rules still apply. Do not mask a failed gate by shrinking it.

## Phase 3: Finish

#### 3.2 Debug retrospective `[on repeated failure]`

Use `trellis-break-loop` if repeated attempts failed. Record the common root cause and one useful prevention where it belongs; no separate retrospective for routine successful work.

#### 3.3 Spec update `[on changed durable contract]`

Use `trellis-update-spec` for a changed reusable interface, workflow contract or proven recurring pitfall. Update the existing relevant spec. Do not create documentation solely because code changed, or duplicate the task's plan and results.

#### 3.4 Commit changes `[on user request/authorization]`

Completion does not require a commit. When a commit is requested/authorized, inspect the diff and dirty paths, include only the agreed task-owned paths, and use logical commits. Never include unrelated edits, amend or push without the relevant authorization. If authorization is absent, report the uncommitted result without forcing a commit approval question or blocking completion.

#### 3.5 Completion record `[required · once]`

Record accepted results, verification evidence and any remaining limitation in the existing task plan/PRD. Resolve applicable hard acceptance gates before marking completion. Use `trellis-finish-work` to archive the current completed task with `--no-commit`; keep branch validation and ownership checks. A journal is optional for a concrete handoff need. Do not scan/clean unrelated tasks or create automatic archive/journal commits. Report naturally in concise Chinese: current stage, useful result, verification limits, next action and any decision needed. Do not invent scores or completion percentages.

## Customizing Trellis

`.trellis/workflow.md` owns request triage, phase details and `[workflow-state:STATUS]` text. Hooks parse it; do not add a risk scorer or duplicate classifier in hooks. Preserve `## Phase Index`, `## Phase 1: Plan`, `#### X.Y` step headings and existing status keys so `get_context.py` and hooks can load the same guidance. Change the policy asset through Harness's supported owned projection; do not hand-edit generated policy blocks.
