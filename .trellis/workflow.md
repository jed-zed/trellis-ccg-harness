# Development Workflow

## Core Principles

1. Understand the request and its actual impact before choosing a workflow.
2. Default to the fast lane for known, local, low-risk work.
3. Keep authoritative requirements, design and one execution plan; complex tasks require all three artifacts.
4. Implement the smallest change that meets acceptance criteria and preserves trust boundaries.
5. Run project checks and the test-coverage checklist; verify the full affected task scope before completion.

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

Structured tasks live under `.trellis/tasks/{MM-DD-name}/`. `task.json` owns identity and lifecycle; `prd.md` owns requirements and acceptance. Complex tasks also require `design.md` and `implement.md`; lightweight tasks may keep a short plan in the PRD. Other optional artifacts must have a trigger below.

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

Fast lane does not ask whether to create a task and does not create task artifacts, PRD/design/plan files, journal, or invoke `task.py start`, finish/archive, or a commit lifecycle. Read only context needed for the answer or change. Code changes follow the project checks and test-coverage checklist in `trellis-check`; conversation and read-only inspection need no test command.

Fast lane never bypasses applicable input validation, security, data protection, basic accessibility, or explicit project/CI checks. File count and line count alone cannot prove low risk. An active task does not force unrelated simple questions into its lifecycle; preserve its status and any pending gate.

For structured work, reuse the matching task. If a new task is needed, obtain task-creation consent unless already given. Task creation and implementation are separate approvals. Present the completed planning artifacts for review and obtain implementation approval before starting. If task creation is declined, clarify or narrow the request instead of hiding broad work in the fast lane.

### Planning Artifacts

The minimum skeleton is task identity, accepted requirements, one authoritative plan, implementation, project verification, and a completion record. Lightweight structured tasks may be PRD-only. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`: requirements and acceptance in the PRD, technical contracts and tradeoffs in the design, and the ordered execution/verification plan in implement.md. Do not duplicate these authorities in CCG.

| Extra step | Trigger fact -> required output -> stop condition |
|---|---|
| `design.md` | Complex task, or unresolved architecture/interface/data-flow choice -> technical design and contract -> choices, boundaries and rollback are documented |
| `implement.md` | Complex task -> one ordered execution plan -> each stage has an action, verification and rollback point |
| Research/search | A specific unanswered question blocks correctness -> source-backed answer -> that question is answered |
| Provider or product-manager evidence | A required external capability or explicitly requested review -> bounded evidence -> answer/review returned or its failure reported; obtain network/paid authorization first |
| Sub-agent | An independently bounded task benefits from delegation and dispatch is authorized -> specified result -> assigned question/action is complete; Codex inline remains the writer |
| Review | A changed risk boundary or explicit review requirement -> actionable findings against that boundary -> findings resolved or explicitly accepted |
| Broader tests | Final structured-task verification, shared impact, a failure, or project/CI requirement -> full affected-scope evidence -> checks pass |
| Spec/journal | A durable contract changed or an actual handoff needs missing context -> concise update/link -> future work can proceed without duplicating the task |

Complex-task documents and the project quality checklist are required. For other extra steps, record the trigger fact, output and stop condition in the existing plan; hypothetical future needs do not count. Required security, data, ownership, transaction, and project/CI gates remain mandatory. Do not create a second CCG task or plan authority.

### Phase 1: Plan

- 1.0 Reuse or create task `[required · once]` for structured work with consent
- 1.1 Confirm requirements and planning artifacts `[required · repeatable]`
- 1.2 Research `[on evidence]`
- 1.3 Configure context `[on authorized sub-agent dispatch]`
- 1.4 Activate task `[required · once]` after requirements/plan are reviewed and implementation is authorized
- 1.5 Check readiness

[workflow-state:no_task]
No active task. Default fast lane for simple conversation, read-only local inspection, or known local low-risk edits: needed context -> answer/minimal edit -> applicable quality checks -> report. Do not ask a task-creation question or create task artifacts, journal, start/finish/archive, or commit lifecycle for these requests.
Unknown impact or ambiguous requests enter the structured lane. Authentication/authorization, credentials, permissions, data migration/loss, Provider/network/paid calls, install/sync/publish, destructive operations, shared core or multiple modules also enter the structured lane. Preserve applicable security, data protection, accessibility, authorization, and project/CI gates.
Structured work reuses a matching task; obtain creation consent only if a new task is needed and not already authorized. Complex tasks require prd.md, design.md and implement.md, followed by planning review and separate implementation approval. Other extra steps require a trigger fact -> required output -> stop condition. See Request Triage and Planning Artifacts in workflow.md.
[/workflow-state:no_task]

[workflow-state:task_error]
The active task record could not be read. Do not create or activate another task.
Inspect the task directory named above and repair its task.json. It must be a valid JSON object with a non-empty status.
Preserve existing task fields and artifacts. If the correct status cannot be determined safely, ask the user before reconstructing the record.
[/workflow-state:task_error]

[workflow-state:planning]
Lightweight structured tasks may be PRD-only. Complex tasks must finish prd.md, design.md and implement.md before task.py start. Present the completed plan and wait for explicit user approval; task-creation consent does not authorize implementation.
Curate context only for authorized sub-agent dispatch. Research, Providers and other extras need a trigger fact -> required output -> stop condition.
[/workflow-state:planning]

[workflow-state:planning-inline]
Lightweight structured tasks may be PRD-only. Complex tasks must finish prd.md, design.md and implement.md before task.py start. Present the completed plan and wait for explicit user approval; task-creation consent does not authorize implementation.
Inline mode skips JSONL curation and loads task artifacts/specs directly. Research, Providers and other extras need a trigger fact -> required output -> stop condition.
Product-manager gate: if currentGate.status=awaiting_user_acceptance, present that exact review and stop; only pm respond with a fresh explicit response may clear it. Resume the same task afterward.
[/workflow-state:planning-inline]

### Phase 2: Execute

- 2.1 Implement `[required · repeatable]`
- 2.2 Applicable quality checks `[required · repeatable]`
- 2.3 Rollback `[on failure]`

[workflow-state:in_progress]
Implement the accepted plan -> project lint/typecheck/tests and coverage checklist -> completion record. Dispatch only when the plan records a concrete trigger and delegation is authorized. A dispatched implement/check agent works directly without recursive implement/check dispatch; its prompt starts with Active task: <task path> and names the bounded output. Read referenced context and task artifacts.
Final verification covers the full affected task scope. Spec, journal, additional tests, Provider and review calls are conditional on their recorded trigger; keep required safety/project gates. Commit only when requested/authorized. Complete the task without forcing a commit or bookkeeping bundle.
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
Read requirements, design, execution plan and specs -> minimal edit -> project lint/typecheck/tests and coverage checklist -> completion record. Codex implements/checks directly; do not dispatch implement/check sub-agents. Research, Providers and other extras require a trigger fact -> required output -> stop condition. Preserve required safety/project gates.
Update specs only for a changed durable contract; commit only when requested/authorized. Completion does not require a commit, archive commit, or journal bundle.
Product-manager gate: if currentGate.status=awaiting_user_acceptance, present that exact review and stop; only pm respond with a fresh explicit response may clear it. Resume the same task afterward.
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

Structured lane only. Reuse a matching task before creating another. Obtain creation consent if not already given. Use `task.py create "<title>" --slug <name>` without a date prefix; it creates planning state. Do not automatically start before the requirements and plan are ready. Parent/child tasks are optional only for independently delivered work needing separate ownership; record real dependency ordering in the owning plan.

#### 1.1 Requirement exploration `[required · repeatable]`

Inspect available evidence and record the accepted outcome, scope, constraints and observable acceptance in `prd.md`. Complex tasks also require `design.md` and `implement.md`, each with its own purpose. Use `trellis-brainstorm` for planning and unresolved choices. Add research only using Planning Artifacts triggers. Update the owning artifact when the scope changes.

#### 1.2 Research `[on evidence]`

Name the unanswered question first. Use the repository's search router and existing evidence. External calls retain their authorization and data boundaries. Write a concise answer in the existing plan, or link a research file if the material needs independent reference. Stop when the question is answered; do not search or call another model merely for reassurance.

#### 1.3 Configure context `[on authorized sub-agent dispatch]`

Inline mode loads relevant specs directly through `trellis-before-dev`; skip JSONL curation. When `task.py start` sees seed-only manifests, use its supported `--allow-empty-context` option for this inline contract, not for a delegated task lacking context.

For authorized sub-agent work, curate `implement.jsonl` / `check.jsonl` with actual needed specs/research: `{"file":"<repo-relative path>","reason":"<why>"}`. Seed `_example` rows do not count. Read task artifacts in addition to these references. Manifests supply context, not a second plan. Every dispatch starts with `Active task: <task path>` and a bounded assignment; an implement/check child never recursively dispatches implement/check.

#### 1.4 Activate task `[required · once]`

Review accepted requirements, design, execution plan and applicable gates. Task-creation or planning consent does not authorize coding. After presenting the completed plan, wait for explicit user approval before `task.py start`. Unresolved material decisions and pending hard gates still require the user's response.

Run `task.py start <task-dir>` (inline seed-only context: add `--allow-empty-context`). Follow any actual session-identity error; do not manufacture an identity or use another task's state.

#### 1.5 Completion criteria

Task identity, accepted requirements, reviewed planning artifacts, separate implementation approval and `in_progress` status are required. Complex tasks require prd.md, design.md and implement.md. A delegated task also needs its curated context.

## Phase 2: Execute

#### 2.1 Implement `[required · repeatable]`

Read the owning task artifacts and applicable specs via `trellis-before-dev`. Trace callers and the changed boundary, reuse existing mechanisms, then implement the minimum accepted behavior. Codex inline writes directly. Other dispatch modes use their native context protocol only when delegation is authorized and triggered.

Do not add fallback, retry, caching, compatibility wrappers, defensive branches, configuration or abstractions for hypothetical failures. A reproduced fault, accepted contract, or actual trust/data boundary must justify each one. Fix the shared root cause instead of layering guards at every caller; return clear errors rather than silently claiming success. Preserve security, input validation at trust boundaries, data-loss prevention and accessibility.

#### 2.2 Quality check `[required · repeatable]`

Use `trellis-check` for the actual diff and all affected behavior. Run the project's lint, type-check, and test commands. Check new functions have unit tests, Bug fixes have regression tests, and changed behavior has updated tests. Check debug logging, suppressed warnings, type-safety bypasses, spec synchronization and applicable cross-layer data flow. Preserve mandatory project/CI gates.

If a check fails, fix the root cause and rerun project checks. The final structured-task pass covers all affected packages, not only the latest implementation chunk: load each package's Quality Check section and verify the full task scope before completion.

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

Record accepted results, verification evidence and any remaining limitation in the existing task plan/PRD. Resolve applicable hard acceptance gates before marking completion. Use `trellis-finish-work` to archive the current completed task with `--no-commit`; keep branch validation and ownership checks. A journal is optional for a concrete handoff need. Do not scan/clean unrelated tasks or create automatic archive/journal commits.

## Customizing Trellis

`.trellis/workflow.md` owns request triage, phase details and `[workflow-state:STATUS]` text. Hooks parse it; do not add a risk scorer or duplicate classifier in hooks. Preserve `## Phase Index`, `## Phase 1: Plan`, `#### X.Y` step headings and existing status keys so `get_context.py` and hooks can load the same guidance. Change the policy asset through Harness's supported owned projection; do not hand-edit generated policy blocks.
