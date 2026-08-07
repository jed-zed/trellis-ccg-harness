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
ccg product-manager snapshot \
  --workdir <absolute-project-path> \
  --task-dir <absolute-trellis-task-path> \
  --json
ccg product-manager review \
  --input <absolute-json-path> \
  --task-dir <absolute-trellis-task-path> \
  --allowed-providers <csv> \
  --workspace-snapshot <absolute-snapshot-path> \
  --workspace-manifest <absolute-manifest-path> \
  --claude-transport <local|ssh> \
  [--response <absolute-json-path>] \
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
node scripts/harness-adapter.mjs pm present \
  --state-revision <integer>
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
- Every valid review stores the Provider's `user_acceptance_summary` verbatim
  as `latestAdvice.productManagerStatement`, together with findings, risks,
  process adjustments, the unique recommended next action, Provider identity,
  and evidence refs. The checkpoint review stores the same rich advice.
- Clearing `currentGate` after a response never clears `latestAdvice`.
  A later plan revision marks the advice stale in status output but keeps it
  available for audit and user display.
- Raw request, response, invocation, lock, and journal evidence is stored only
  under ignored
  `.trellis/tasks/<task>/.ccg-evidence/product-manager/`.
- The installed `~/.codex/ccg/config.toml` unified routing role
  `product-manager` is the sole selected-provider authority. Project state may
  narrow `allowedProviders`, but cannot select or fall back to another
  provider.
- `.harness/project.json.productManager.claudeTransport` is the sole Claude
  transport authority. Missing legacy fields mean `local`; `ssh` is explicit.
  Transport never selects a Provider and never falls back.

### Installed configuration

```toml
[routing.product-manager]
models = ["claude"]
primary = "claude"
strategy = "fallback"

[product_manager]
enabled = false
contract_version = "2"
max_retries = 1
timeout_ms = 7200000
max_output_bytes = 1048576
```

Routing can select any registered CCG Provider, while the product-manager
adapter is currently implemented for `codex`, `gemini`, and `claude`.
Unimplemented or disallowed selections fail closed without fallback.
`[product_manager]` stores behavior only. A legacy provider field is migrated
once into unified routing and then removed. Selection never installs a
provider, logs in, reads credentials, calls the network, or authorizes a paid
call.
Legacy stored version `1` configuration is accepted only for migration and is
normalized to version `2`; new exact version `1` review requests are rejected.

Optional test/operator overrides are:

```text
CCG_PRODUCT_MANAGER_CODEX_EXECUTABLE
CCG_PRODUCT_MANAGER_CODEX_MODEL
CCG_PRODUCT_MANAGER_GEMINI_ENTRYPOINT
CCG_PRODUCT_MANAGER_GEMINI_MODEL
CCG_PRODUCT_MANAGER_CLAUDE_EXECUTABLE
CCG_PRODUCT_MANAGER_CLAUDE_MODEL
CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST
CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER
CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT
CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE
```

They do not change provider authority. Executables must resolve to approved
absolute paths, run with `shell: false`, and receive a minimal environment.
SSH details are environment-only and must not enter argv, project contracts,
tracked state, or evidence. Harness does not install or authenticate Claude.

### Invocation and output

Every invocation binds:

```text
contract_version + task_id + trigger_type + checkpoint_id
+ plan_revision + input_digest + evidence_digest
+ workspace_snapshot + claude_transport
```

The canonical SHA-256 invocation key is single-flight across processes. CCG
owns Provider-call serialization under `locks/`; Harness uses a distinct
`projection-locks/` namespace only while preparing and applying the tracked
projection. Harness must never hold a file in CCG's Provider lock namespace
while invoking CCG. The same provider and invocation key may be retried within
`max_retries`; provider fallback is forbidden. Output must preserve all bound
identity fields and use one verdict:

```text
accepted | rejected | needs_user_decision | reopen_request | unavailable
```

The Provider-facing output JSON Schema is generated per invocation. It binds
the contract, task, trigger, checkpoint, plan revision, invocation/input/evidence
digests, and provider/model/CLI identity with JSON Schema `const` values. The
post-response validator remains an independent fail-closed boundary; the
Provider must not be asked to infer or reproduce these identity fields from a
generic shape-only schema.

Provider execution occurs in a verified task-local snapshot with workspace
writes, terminal tools, MCP tools, subagents, and provider fallback disabled.
The snapshot contains Git tracked, dirty, and unignored new files after strict
secret/instruction/plugin/cache exclusions, and is capped at 2000 files,
2 MiB per file, and 64 MiB total. Its manifest identity is bound before review
and its contents are removed in `finally`. The
response is size- and time-bounded, schema-validated, redacted, and rechecked
against current task, plan, input, evidence, and state revision before it may
update the projection.

The Claude adapter must always pass `--model`. When
`CCG_PRODUCT_MANAGER_CLAUDE_MODEL` is unset or empty, the argument is
`--model opus`; an explicit environment value replaces only that model
argument. It must not inherit the machine default or silently use `sonnet`.
Claude may use only `Read`, `Glob`, and `Grep` inside the snapshot. Local mode
accepts only a native non-link Claude executable. SSH mode accepts only the
seven allowlisted environment variables and a protocol-v2 bridge; every error
stays on SSH and never starts local Claude.

The installed CCG command is a strict machine boundary: successful stdout must
contain exactly one JSON document and no support banner, progress message, or
diagnostic prefix/suffix. CCG initialization and Provider child environments
must both disable known support notices. Harness keeps strict `JSON.parse`
behavior and must not search stdout for a JSON substring.

Every failed attempt in a same-provider retry sequence must append an
`attempt_failed` audit record with the 1-based attempt, total attempts,
provider, and a bounded diagnostic. The evidence-store redaction boundary must
sanitize that diagnostic before persistence. Retry diagnostics never create a
second verdict, authorize fallback, or expose raw credentials.

### Lifecycle and hooks

- `MILESTONE_REVIEW` and `FINAL_REVIEW` create user hard gates.
- A hard gate begins unpresented. `pm present` records the exact advice/card
  digest and the resulting state revision without calling a Provider.
- `pm respond` fails closed until that exact gate has been presented. Codex
  must restate the Provider's `productManagerStatement` verbatim, report its
  findings, risks, process adjustments, and recommended next action, list the
  three allowed responses, and end the turn before accepting a fresh explicit
  user response.
- Prior blanket approvals, approvals for other checkpoints, and responses sent
  before presentation cannot satisfy a newly created gate.
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
| Snapshot output, path containment, manifest digest, file type, or cap is invalid | Refuse before Provider start and clean up bounded residue |
| Project Claude transport is missing | Treat as `local` |
| Project Claude transport is unknown | Blocking conflict |
| Local Claude override is an SSH bridge | Fail closed; do not use it as native Claude |
| SSH config or protocol v2 probe fails | Return unavailable on SSH only; never start local Claude |
| Installed provider is empty, disabled, unavailable, or disallowed | Return `unavailable`; never fall back |
| Live review lacks `--allow-provider-call` and has no saved response | Refuse the call without network access |
| Input/output has missing, unknown, malformed, or oversized fields | Reject before projection |
| Task/checkpoint/plan/input/evidence digest changes | Preserve raw audit as stale; do not project |
| Invocation lock has a live owner | Refuse the second owner |
| Dead lock has a valid matching identity | Recover the same invocation safely |
| `stateRevision` changed before apply/respond | Reject CAS without overwriting newer state |
| Provider requests a tool, write, terminal, MCP, or subagent | Deny and return invalid/unavailable evidence |
| Provider exits, times out, or returns invalid output | Audit each bounded and redacted attempt failure; retry only the same provider |
| Rich advice exists only in ignored raw evidence | Recover a legacy projection once, persist it on the next canonical write, and expose it through `pm status` |
| `pm respond` is attempted before `pm present` | Refuse without clearing the gate or applying the response |
| A prior blanket approval is reused for a new gate | Refuse orchestration; show and restate the current review, then wait for a fresh user response |
| Claude model override is absent | Pass `--model opus` explicitly; do not inherit or fall back to `sonnet` |
| Installed command stdout contains anything besides one JSON document | Reject as a protocol error; do not recover by substring parsing |
| Verdict is rejected, unavailable, or needs a decision | Keep Trellis task in progress and require user action |
| Final eligibility is false | Do not call Trellis finish/archive |

## 5. Good / Base / Bad Cases

- Good: Codex prepares a `MILESTONE_REVIEW`, explicitly authorizes the selected
  Claude provider, the
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
- snapshot-bound read-only execution and the Provider-specific read/search allowlist;
- local default, SSH environment-only opt-in, protocol-v2 probing, cleanup, and
  no transport fallback;
- task-local tracked projection versus ignored raw evidence;
- Provider single-flight versus Harness projection-lock separation, dead-owner
  recovery, and late-response staleness;
- exact machine-readable stdout, provider support-notice suppression, and
  bounded/redacted per-attempt retry diagnostics;
- per-invocation JSON Schema `const` binding for every invocation and Provider
  identity field, plus fail-closed rejection of mismatches;
- explicit Claude `--model opus` default plus exact environment override;
- state-revision CAS and atomic merged final response;
- rich advice round-trip, legacy recovery, presentation-before-response, and
  advice persistence after gate clearing;
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
  workspaceSnapshot,
  claudeTransport: "local",
});
const projected = applyProductManagerReview(taskDir, prepared, response);
```

Codex validates the read-only evidence, the adapter updates only the tracked
review projection, and a later explicit user response authorizes any Trellis
lifecycle transition.
