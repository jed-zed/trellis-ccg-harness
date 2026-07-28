# Product Manager Review Contract

## 1. Scope / Trigger

This contract applies when changing the optional product-manager reviewer,
its installed CCG provider runtime, the Harness adapter commands, the tracked
Trellis projection, or the task-local evidence and gate flow.

The reviewer is evidence inside the existing Trellis task. It never owns task
identity, requirements, plans, milestone state, completion, or workspace
writes. Codex remains the sole orchestrator and writer.

## 2. Signatures

Installed CCG runtime:

```text
ccg product-manager status --json --allowed-providers <csv>
ccg product-manager review \
  --input <absolute-json-path> \
  --task-dir <absolute-trellis-task-path> \
  --allowed-providers <csv> \
  [--provider-response <absolute-json-path>] \
  [--allow-provider-call]
```

Harness adapter:

```text
node scripts/harness-adapter.mjs pm sync-plan
node scripts/harness-adapter.mjs pm status
node scripts/harness-adapter.mjs pm review \
  --trigger <INTAKE_REVIEW|PLAN_REVIEW|DRIFT_REVIEW|MILESTONE_REVIEW|FINAL_REVIEW> \
  --checkpoint <id> \
  [--evidence <ref>]... \
  [--grill-handoff <task-local-json>] \
  [--provider-response <absolute-json-path>] \
  [--allow-provider-call]
node scripts/harness-adapter.mjs pm respond \
  --response <accept|reject|override|reopen> \
  --state-revision <integer>
node scripts/harness-adapter.mjs pm final-eligibility
```

Only `--allow-provider-call` authorizes a live provider invocation. Provider
selection, status, plan sync, response application, and eligibility checks are
offline operations.

## 3. Contracts

### Authority and storage

- Trellis owns `.trellis/tasks/<task>/task.json`, `prd.md`, `design.md`,
  `implement.md`, task status, and finish/archive transitions.
- The committable reviewer projection is
  `.trellis/tasks/<task>/product-manager.json`.
- Raw request, response, invocation, lock, and journal evidence is stored only
  under ignored
  `.trellis/tasks/<task>/.ccg-evidence/product-manager/`.
- The installed `~/.codex/ccg/config.toml` is the sole selected-provider
  authority. Project state may narrow `allowedProviders`, but cannot select or
  fall back to another provider.

### Installed configuration

```toml
[product_manager]
enabled = false
provider = ""
contract_version = "1"
max_retries = 1
timeout_ms = 180000
max_output_bytes = 1048576
```

`provider` is empty, `codex`, or `gemini`. Enabling requires explicit consent
and a non-empty provider. Selection never installs a provider, logs in, reads
credentials, calls the network, or authorizes a paid call.

Optional test/operator overrides are:

```text
CCG_PRODUCT_MANAGER_CODEX_EXECUTABLE
CCG_PRODUCT_MANAGER_CODEX_MODEL
CCG_PRODUCT_MANAGER_GEMINI_ENTRYPOINT
CCG_PRODUCT_MANAGER_GEMINI_MODEL
```

They do not change provider authority. Executables must resolve to approved
absolute paths, run with `shell: false`, and receive a minimal environment.

### Invocation and output

Every invocation binds:

```text
contract_version + task_id + trigger_type + checkpoint_id
+ plan_revision + input_digest + evidence_digest
```

The canonical SHA-256 invocation key is single-flight across processes. The
same provider and invocation key may be retried within `max_retries`; provider
fallback is forbidden. Output must preserve all bound identity fields and use
one verdict:

```text
accepted | rejected | needs_user_decision | reopen_request | unavailable
```

Provider execution occurs in a disposable directory with workspace writes,
terminal tools, MCP tools, subagents, and provider fallback disabled. The
response is size- and time-bounded, schema-validated, redacted, and rechecked
against current task, plan, input, evidence, and state revision before it may
update the projection.

### Lifecycle and hooks

- `MILESTONE_REVIEW` and `FINAL_REVIEW` create user hard gates.
- A final verdict never calls Trellis finish/archive.
- `final-eligibility` is a read-only authorization result.
- A user response updates the expected `stateRevision` through CAS.
- The last milestone and final gate may merge only when their bound inputs are
  unchanged and one response can update both atomically.
- Hooks may inject only pending-gate or resume breadcrumbs. They must not call
  a provider, acquire a reviewer lock, write product state, or create another
  hook/orchestrator.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| No active Trellis task | Refuse reviewer state or review commands |
| State path is outside the active task | Refuse without mutation |
| Evidence root is not task-local and ignored | Blocking conflict |
| Installed provider is empty, disabled, unavailable, or disallowed | Return `unavailable`; never fall back |
| Live review lacks `--allow-provider-call` and has no saved response | Refuse the call without network access |
| Input/output has missing, unknown, malformed, or oversized fields | Reject before projection |
| Task/checkpoint/plan/input/evidence digest changes | Preserve raw audit as stale; do not project |
| Invocation lock has a live owner | Refuse the second owner |
| Dead lock has a valid matching identity | Recover the same invocation safely |
| `stateRevision` changed before apply/respond | Reject CAS without overwriting newer state |
| Provider requests a tool, write, terminal, MCP, or subagent | Deny and return invalid/unavailable evidence |
| Verdict is rejected, unavailable, or needs a decision | Keep Trellis task in progress and require user action |
| Final eligibility is false | Do not call Trellis finish/archive |

## 5. Good / Base / Bad Cases

- Good: Codex prepares a `MILESTONE_REVIEW`, explicitly authorizes Gemini, the
  read-only response matches all digests, and the adapter creates one user gate
  in the tracked projection.
- Base: `pm sync-plan` creates or refreshes the projection from the existing
  Trellis plan without changing `task.json.status` or calling a provider.
- Good: a saved fake provider response drives offline CI through milestone,
  final, user response, and eligibility checks.
- Bad: the project selects Gemini while installation config selects Codex.
  The project may disallow Codex, but cannot silently switch to Gemini.
- Bad: a late response for an older plan revision is applied after the plan
  changed. It must remain raw stale evidence and cannot update the projection.
- Bad: a hook sees a pending gate and invokes the provider. Hooks may only
  inject a breadcrumb for the current Codex orchestrator.

## 6. Tests Required

Run:

```powershell
node --test tests/product-manager-state.test.mjs
node --test tests/product-manager-concurrency.test.mjs
node --test tests/product-manager-e2e.test.mjs
node --test tests/harness-adapter.test.mjs
node --test tests/harness-init-cli.test.mjs
pnpm ccg:test
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm verify:sources
```

Assertions must cover:

- exact input/output schema and digest binding;
- selected-provider authority and no fallback;
- provider selection having zero network, credential, login, or install effect;
- disposable read-only execution and denied tools;
- task-local tracked projection versus ignored raw evidence;
- single-flight lock ownership, dead-owner recovery, and late-response staleness;
- state-revision CAS and atomic merged final response;
- milestone/final hard gates and Trellis finish separation;
- hooks remaining breadcrumb-only;
- fake-provider offline E2E with no local login or paid call.

## 7. Wrong vs Correct

Wrong:

```javascript
state.milestones[0].status = "completed";
task.status = "done";
await writeFile(".trellis/tasks/task/task.json", JSON.stringify(task));
```

This bypasses Trellis authority, evidence identity, user acceptance, and CAS.

Correct:

```javascript
const prepared = prepareProductManagerReview(repoRoot, taskDir, {
  triggerType: "MILESTONE_REVIEW",
  checkpointId: "M1",
  evidenceRefs: ["test:focused"],
});
const projected = applyProductManagerReview(taskDir, prepared, response);
```

Codex validates the read-only evidence, the adapter updates only the tracked
review projection, and a later explicit user response authorizes any Trellis
lifecycle transition.
