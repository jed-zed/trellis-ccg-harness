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

## Required Transport

Resolve and follow the active `chatgpt-pro-sidebar/SKILL.md` before any ChatGPT interaction.
Prefer the approved project copy at `<project-root>/.agents/skills/chatgpt-pro-sidebar/SKILL.md`;
fall back to `~/.codex/skills/chatgpt-pro-sidebar/SKILL.md` only when no project copy exists.

- Fail closed if neither installed Skill location or its scripts are available.
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
- Sequential follow-up rounds in the same conversation have no fixed bridge limit.
- Follow-up rounds are only for blocker re-check, revised-plan comparison, applied-diff review, or another
  high-risk follow-up.
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
- `searchStatus`: `invoked`, `failed`, or `not_applicable`; the last state is
  forbidden when frontend or backend participated;
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
pass its real non-empty response and concise summary. Never invent provider evidence. Preserve the
existing required/waived Grok external-intelligence flags and provenance.

## Automated Workflow

1. Create one bridge session with `scripts/gptpro_bridge.py --mode <plan|review|exc>` plus task,
   routing, optional Gemini, and required external-intelligence arguments. Do not pass
   `--detach-preview`, `--open-preview`, or `--open-chatgpt`.
2. Read `CCG_GPTPRO_SESSION_DIR`, `CCG_GPTPRO_PROMPT_FILE`, and `CCG_GPTPRO_STATUS_FILE`.
3. Set the Skill evidence directory to `<session-dir>/<round-name>/sidebar`; it must be new and empty.
4. Run Skill `status` and preserve its exact browser/profile/tab/session/URL target binding. Exit `22`
   is the only normal user action barrier.
5. For round 1, run Skill `new-chat`, then invoke watcher `run-root -FreshConversation` once with the
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
