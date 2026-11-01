---
name: gptpro-bridge
description: Shared automated ChatGPT Pro sidebar bridge for CCG planning, review, and execution route review flows.
---

# CCG GPT Pro Browser Bridge

This bridge delegates bounded work to the user's already logged-in ChatGPT Pro session in an approved
external Chrome tab. It uses the installed `chatgpt-pro-sidebar` Skill for every browser operation,
local RootWait monitoring, and response capture. There is no normal copy/paste handoff.

Codex remains the final owner. Ordinary CCG roles use their configured providers before this named
GPT Pro step. GPT Pro is untrusted, read-only helper evidence; it never becomes a workspace writer,
implementation owner, or lifecycle authority.

## Optional scoped MCPX production

Ordinary routing remains unchanged. Explicit opt-in budget requests may use the existing MCPX
connection for scoped code production. Read [the setup tutorial](../../../../README.zh-CN.md#mcpx-setup)
and [RUNTIME_CONTRACT.md](./RUNTIME_CONTRACT.md) first. MCPX must already be installed, configured,
connected and verified; these helpers never install services, change authentication or create tunnels.

Use `scripts/gptpro_budget.py configure` with one canonical task state, its actual Codex thread ID,
`--evidence-access mcpx`, a controller-owned scope and a fresh successful existing-tool preflight.
`prepare` validates that scope without sending. New scopes default to bounded read/write/execute,
requiring explicit authorization, exact task/output paths and exact argv with `shell: false`.
Explicit read-only scopes remain supported. Server privileges remain unchanged. Summary-only code
drafting needs no MCPX: select `--evidence-access summary` and label missing direct workspace access.

Only the budget-bound production request permits the webpage to use its exact authorized MCPX
write/execute tools. All other bridge calls retain the read-only evidence boundary. Codex retains
independent code review, local verification and final acceptance. Capability rounds read only the
entrypoint; each strength/profile/workspace needs its own validated capability. Use
`--thinking-mode Pro` with the source sidebar baseline; other strengths require a separately capable
installed sidebar and fail closed when unsupported.

Bind the returned brief and `bridgeArgs` through this existing bridge and the installed RootWait
transport. Never replace uncertain identities. `record` additionally requires independent complete
structured history and current input revisions; a completed confirmation round is linked using
`--mcpx-confirmation-dir`, preserves blocked `resultHistory`, exact argv, binding and original deadline.
A pending confirmation is not execution success. `--reextraction-file` accepts only an immutable
sibling receipt from the original completed reply; it never overwrites the original artifacts.

## Required Transport

Resolve and follow the active `chatgpt-pro-sidebar/SKILL.md` before any ChatGPT interaction.
Resolve these candidates in order:

1. `<project-root>/.agents/skills/chatgpt-pro-sidebar/SKILL.md`
2. `~/.codex/skills/chatgpt-pro-sidebar/SKILL.md`
3. `~/.agents/skills/chatgpt-pro-sidebar/SKILL.md`

When `CODEX_HOME` is configured, use `<CODEX_HOME>/skills/chatgpt-pro-sidebar/` for the second candidate.
Continue to the next candidate only when `SKILL.md` is absent. An existing but unreadable Skill,
an incomplete installation, or unavailable scripts must fail closed. Derive both scripts from the
same resolved Skill directory; never combine files from different installations.

- Fail closed if no installed Skill location or its scripts are available.
- Use `chatgpt-pro-sidebar.ps1` as the only ChatGPT browser entry point; its active transport must be
  `agent-browser-cli-v2`.
- Use `chatgpt-pro-sidebar-watch.ps1 run-root` for the atomic send and local RootWait lifecycle.
- Do not copy browser automation or fixed DOM extraction logic into CCG.
- Do not register Stop Hook or start a model watcher.
- Do not use the legacy localhost preview page for a normal CCG handoff.
- Never bypass the installed Skill with Playwright, CDP, arbitrary browser-internal APIs, cookies,
  tokens, or browser profile secrets.
- Never automate login, account selection, CAPTCHA, password, passkey, MFA, recovery, billing, or
  entitlement. Skill exit `22` pauses for the user; all other normal bridge operations are automatic.
- Never automatically resend after `send-uncertain`.

## Explicit webpage strength

Keep --mode plan/review/exc for workflow semantics. Use --thinking-mode <webpage strength> for
an explicit user choice; default Pro. Support Instant, Medium, High, Extra High (极高/超高), and Pro
with the shared aliases. Codex xhigh is not a webpage strength. Never substitute Pro when the user
asked for Extra High, or silently downgrade an unavailable choice.
Read CCG_GPTPRO_THINKING_MODE and pass that exact effective value as -ThinkingMode to Skill
status, new-chat and watcher run-root. In batches, every round carries thinkingMode; an explicit
CLI --thinking-mode overrides batch defaults and round hints. Session and per-round status persist
it; follow-up defaults inherit the prior round, and recovery uses the original immutable value.
Use selectedModeMatchesRequested=true for acceptance, rather than requiring selectedModeIsPro=true
for every request. Import rejects disagreement among session, adapter state, manifest and watcher event.
Only an isolated empty homepage may be used for non-sending set-mode verification.

## Task Authority Adapter

Resolve one existing canonical task directory and pass it through `--task-dir`:

- Native CCG task: `.ccg/tasks/<task-id>`.
- Trellis-owned task: `.trellis/tasks/<task-id>`.

For a Trellis-owned task, the bridge stores CCG/GPT Pro artifacts under
`.trellis/tasks/<task-id>/.ccg-evidence/`. It must not create a parallel `.ccg/tasks/<task-id>` or
write CCG gate fields into Trellis `task.json`. Trellis remains authoritative for lifecycle state;
bridge `status.json` records only GPT Pro evidence state.

## Question And Conversation Guidance

- Expected questions per independent task: 1.
- Sequential follow-up rounds in the same conversation remain available for
  task-relevant questions; the bridge has no fixed conversation-round limit.
- PR reviews follow `../ccg-gptpro-review/SKILL.md`: normally one complete review
  plus one focused re-review after fixes as a soft budget. Further rounds need
  a concrete blocker or changed risk, not an automatic repeat loop. Unresolved
  blockers remain incomplete; a round count never grants approval. This review
  budget does not cap ordinary user-requested conversation follow-ups.
- Decompose independent complex workstreams into separate bridge sessions and separate ChatGPT Pro
  conversations.
- When multiple connected external Chrome tabs are available, bind each conversation to its exact
  browser/profile/tab/session/URL identity.
- One Codex task may run at most three independent RootWait rounds through `run-batch-root`; the
  per-user global hard limit is six. Extra rounds wait locally without opening or writing a page.

## Base Routing Evidence

Before `/ccg:gptpro-plan`, `/ccg:gptpro-review`, or `/ccg:gptpro-exc`, run the matching ordinary CCG
semantics, including its **Companion Role Contract**, and write Base CCG
Routing Evidence containing:

- the current orchestrator and command semantics;
- routed frontend/backend/search evidence that actually exists;
- `searchStatus`: `invoked`, `failed`, or `not_applicable`; use the last state
  when external research would not materially help;
- `productManagerStatus`: `authorization_required`, `authorized`, `declined`,
  `disabled`, `unavailable`, `completed`, or `not_applicable`;
- the ordinary orchestrator conclusion;
- skipped, failed, or intentionally absent model steps.

Pass it with:

```text
--routing-evidence-file <routing-evidence-file> --routing-summary-file <routing-summary-file> --require-routing-evidence
```

Search is advisory when ordinary routing used frontend or backend; `failed` or
`not_applicable` must not block an otherwise valid local result. A product-manager
candidate may stop at `authorization_required`; GPT Pro must not convert that
state into authorization or fabricated Provider evidence.
Gemini remains optional and is included only when ordinary role routing actually used it. If present,
pass its real non-empty response and concise summary. Never invent provider evidence.
Use existing research agents and grok-search MCP when external sources help.
Include useful findings and original links in the prompt; ordinary bridge calls
do not require a Grok receipt, waiver, or external-intelligence flags.

## Mode output

Use the current mode's prompt for its requested content; the shared bridge adds
no universal scoring or section gate. Review reports verified findings (or zero),
verification limits and the next action without mandatory numerical scores.
Optional suggestions do not become requirements, and missing evidence is stated
explicitly. Preserve the current plan/exc prompt contracts, Plan-only Boundary
and product-manager authorization gate. No review opinion or score authorizes
execution, supplies absent Provider evidence or changes Codex's ownership.

## Automated Workflow

1. Create one bridge session with `scripts/gptpro_bridge.py --mode <plan|review|exc>` plus task,
   routing and optional Gemini arguments. Do not pass `--detach-preview`, `--open-preview`,
   or `--open-chatgpt`. Keep the explicit legacy external-intelligence validator available
   for a user-selected legacy workflow only.
2. Read `CCG_GPTPRO_SESSION_DIR`, `CCG_GPTPRO_PROMPT_FILE`, `CCG_GPTPRO_STATUS_FILE`, and `CCG_GPTPRO_THINKING_MODE`.
3. Set the Skill evidence directory to `<session-dir>/<round-name>/sidebar`; it must be new and empty.
4. Run Skill `status` and preserve its exact browser/profile/tab/session/URL target binding. Exit `22`
   is the only normal user action barrier.
5. For round 1, run Skill `new-chat -ThinkingMode <CCG_GPTPRO_THINKING_MODE>`, then invoke watcher `run-root -ThinkingMode <CCG_GPTPRO_THINKING_MODE> -FreshConversation` once with the
   bridge prompt, sidebar evidence directory, a unique opaque idempotency key, and the exact current
   `CODEX_THREAD_ID`. The command performs one send, starts the local watcher immediately, and keeps
   this root turn blocked until terminal evidence without model polling.
6. After `run-root` returns, inspect `watch-event.json`. Only `completed` may enter the import command;
   all other terminal states require diagnosis and never automatic resend.
7. Import the captured response:

```text
python scripts/gptpro_bridge.py \
  --import-session <CCG_GPTPRO_SESSION_DIR> \
  --import-sidebar-evidence <session-dir>/<round-name>/sidebar \
  --expected-codex-thread-id <CODEX_THREAD_ID>
```

8. Require `CCG_GPTPRO_SIDEBAR_IMPORTED=1`, non-empty `response.md`, exact conversation URL,
   response/evidence hashes, `automaticResendAllowed=false`, and the untrusted-output/Codex-writer
   authority fields.
9. Independently classify the response, adapt any useful proposal, run required tests, and decide
    the CCG workflow outcome.

The import is exact-once. Re-importing the same response succeeds idempotently; a different response
cannot overwrite the current round. Evidence from another Codex task, another bridge round, a
non-exact conversation URL, invalid hashes, non-live fixtures, or a non-completed watcher is rejected.

## Independent Batch Rounds

For two or more independent workstreams, write one local batch request JSON with `schemaVersion=1`,
the exact `codexThreadId`, `maxConcurrency` from `1` to `3`, optional `timeoutSeconds` (default
`7200`), and unique rounds containing `roundId`, bounded `prompt`, opaque `idempotencyKey`, and one
complete distinct `targetBinding`. Then:

1. Create atomically isolated bridge sessions with `--create-batch-manifest <batch-request.json>` and
   read `CCG_GPTPRO_BATCH_FILE` plus `CCG_GPTPRO_BATCH_MANIFEST`.
2. Invoke watcher `run-batch-root -ManifestPath <CCG_GPTPRO_BATCH_MANIFEST>` once. It uses local child
   processes only, enforces three slots per Codex task and six globally, and writes `batch-result.json`.
3. Import completed items with `--import-batch-result <CCG_GPTPRO_BATCH_FILE>` and
   `--expected-codex-thread-id <CODEX_THREAD_ID>`.

Never split one dependent conversation into parallel rounds. A partial batch keeps valid completed
evidence but must not report all success. `queued-timeout` means no slot and no send;
`ConcurrencySlotRecoveryRequired` keeps the slot isolated until durable pre-click or terminal proof
allows explicit diagnostic release. The capacity-claim schema is independent from watcher/evidence
and batch-manifest schemas. A current claim stays `run-starting/submissionAttempted=false` through
direct and batch handoff, then changes atomically immediately before the single adapter send. Recovery
may accept a schema-2 `run-starting/false` claim as `never-invoked` only after durable evidence checks
and only when watcher and terminal markers are absent. Legacy schema-1 claims, attempted sends,
non-canonical values, and contradictory evidence remain recovery-required. Neither state authorizes
resend or deletion of idempotency and target claims.

## Follow-up Rounds

Create each follow-up with `--followup-session <session-dir> --followup-reason <reason>`. The bridge
advances to the next sequential round automatically; `--round <next-round>` may be supplied as an
explicit sequence check. Keep the same exact ChatGPT conversation selected. Use ordinary Skill
`send`, not `new-chat` or `-FreshConversation`, then start a new watcher and import its separate
`round-N/sidebar` evidence.

## Project Context And Final Ownership

Every prompt includes sanitized project metadata, branch, commit, dirty state, bounded source/diff
context, Base CCG Routing Evidence, and optional routed evidence. Never tell ChatGPT Pro it can read a
local path unless the relevant bounded content is actually in the prompt.

ChatGPT Pro code and conclusions are advisory. Codex alone applies local changes, reviews dependencies
and the resulting diff, runs verification, and reports whether work is local, committed, pushed, or
deployed.

## Manual strength selection fallback

An ordinary current-strength mismatch still permits one safe automatic selection. A changed slider,
ambiguous control, failed step/close proof, or unconfirmed result enters
ThinkingModeManualSelectionRequired (code 23), with waitingForUser=true, requestedThinkingMode,
targetBinding, manualSelectionStateFile, and userNotificationNeeded. This is a user-action wait,
separate from authentication code 22 and an explicitly unavailable label.
Relay the target strength, exact URL and tab once when userNotificationNeeded=true. Ask the user to
select it manually and reply; do not repeatedly call selection or keep prompting while waiting.
Read-only status is allowed. After the reply, re-read the same bound target and require
selectedModeMatchesRequested=true. A verbal confirmation alone never proves the setting.
The persisted gate suppresses automatic clicks until observation proves the original target choice.
Preserve the original evidence, prompt, thinkingMode, thread and idempotency key. A pre-click manual
wait resumes through the original send/run-root -ResumeUnsent, retaining its original fresh/existing
conversation flag and binding; never open New chat or invent a replacement identity. Pre-fill resume
is accepted only with zero attempts and no reservation/claim; a filled draft uses the existing strict
unsent-resume proof. A post-click request only continues waiting/capture; mode drift never authorizes
another send or a change to its original mode/deadline. Do not ask the user to stop an in-flight answer.

## Optional Codex budget orchestration

When explicitly enabled for this canonical task, load ../ccg-save-codex/SKILL.md. Reuse this same
browser transport, immutable request identity, RootWait, ownership verification and validated import.
Use gptpro_budget.py prepare before a new advice request and pass its --budget-state/--budget-request
identity into this bridge. A budget route never authorizes a browser send. The existing direct Pro
workflow remains unchanged when this opt-in mode is absent or disabled.

Read RUNTIME_CONTRACT.md from this live Skill directory before using a cached main Skill text.

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
