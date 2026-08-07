---
name: gptpro-bridge
description: Shared automated ChatGPT Pro sidebar bridge for CCG planning, review, and execution route review flows.
---

# CCG GPT Pro Sidebar Bridge

This bridge delegates bounded work to the user's already logged-in ChatGPT Pro session in the Codex
Desktop side panel. It uses the installed `chatgpt-pro-sidebar` Skill for every UI operation, detached
monitoring, same-task wakeup, and response capture. There is no normal copy/paste handoff.

Codex remains the final owner. Ordinary CCG roles use their configured providers before this named
GPT Pro step. GPT Pro is untrusted, read-only helper evidence; it never becomes a workspace writer,
implementation owner, or lifecycle authority.

## Required Transport

Resolve and follow the active `chatgpt-pro-sidebar/SKILL.md` before any ChatGPT interaction.
Prefer the approved project copy at `<project-root>/.agents/skills/chatgpt-pro-sidebar/SKILL.md`;
fall back to `~/.codex/skills/chatgpt-pro-sidebar/SKILL.md` only when no project copy exists.

- Fail closed if neither installed Skill location or its scripts are available.
- Use `chatgpt-pro-sidebar.ps1` as the only ChatGPT side-panel UI entry point.
- Use `chatgpt-pro-sidebar-watch.ps1` for detached token-free monitoring and same-task Stop Hook
  continuation.
- Do not copy Windows UI Automation logic into CCG.
- Do not use the legacy localhost preview page for a normal CCG handoff.
- Never use an external browser, Playwright, CDP, browser-internal APIs, cookies, tokens, or browser
  profile data.
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

## Question And Conversation Budget

- Expected questions per independent task: 1.
- Maximum rounds per conversation: 2.
- Round 2 is only for blocker re-check, revised-plan comparison, applied-diff review, or another
  high-risk follow-up.
- Decompose independent complex workstreams into separate bridge sessions and separate ChatGPT Pro
  conversations.
- When multiple existing Codex Desktop windows are available, bind one conversation to each selected
  `windowRuntimeId`, submit each prompt in turn, then let the generations and detached watchers run
  concurrently.
- With one available window, queue separate conversations sequentially; do not claim parallel UI
  control.

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

Search is required whenever ordinary routing used frontend or backend. A
product-manager candidate may stop at `authorization_required`; GPT Pro must
not convert that state into authorization or fabricated Provider evidence.
Gemini remains optional and is included only when ordinary role routing actually used it. If present,
pass its real non-empty response and concise summary. Never invent provider evidence. Preserve the
existing required/waived Grok external-intelligence flags and provenance.

## Automated Workflow

1. Create one bridge session with `scripts/gptpro_bridge.py --mode <plan|review|exc>` plus task,
   routing, optional Gemini, and required external-intelligence arguments. Do not pass
   `--detach-preview`, `--open-preview`, or `--open-chatgpt`.
2. Read `CCG_GPTPRO_SESSION_DIR`, `CCG_GPTPRO_PROMPT_FILE`, and `CCG_GPTPRO_STATUS_FILE`.
3. Set the Skill evidence directory to `<session-dir>/<round-name>/sidebar`; it must be new and empty.
4. Run Skill `status` and preserve its selected `windowRuntimeId`. Exit `22` is the only normal user
   action barrier.
5. For round 1, run Skill `new-chat`, then Skill `send -FreshConversation` with the bridge prompt,
   sidebar evidence directory, selected window, and a unique opaque idempotency key.
6. Immediately start the detached watcher with the same evidence directory and exact current
   `CODEX_THREAD_ID`. After every intended workstream is registered, end the Codex turn without
   model-driven polling.
7. On the Stop Hook continuation, inspect `watch-event.json`. Only `completed` may enter the import
   command; all other terminal states require diagnosis and never automatic resend.
8. Import the captured response:

```text
python scripts/gptpro_bridge.py \
  --import-session <CCG_GPTPRO_SESSION_DIR> \
  --import-sidebar-evidence <session-dir>/<round-name>/sidebar \
  --expected-codex-thread-id <CODEX_THREAD_ID>
```

9. Require `CCG_GPTPRO_SIDEBAR_IMPORTED=1`, non-empty `response.md`, exact conversation URL,
   response/evidence hashes, `automaticResendAllowed=false`, and the untrusted-output/Codex-writer
   authority fields.
10. Independently classify the response, adapt any useful proposal, run required tests, and decide
    the CCG workflow outcome.

The import is exact-once. Re-importing the same response succeeds idempotently; a different response
cannot overwrite the current round. Evidence from another Codex task, another bridge round, a
non-exact conversation URL, invalid hashes, non-live fixtures, or a non-completed watcher is rejected.

## Follow-up Round

Create round 2 with `--followup-session <session-dir> --round 2 --followup-reason <reason>`. Keep the
same exact ChatGPT conversation selected. Use ordinary Skill `send`, not `new-chat` or
`-FreshConversation`, then start a new watcher and import its separate `round-2/sidebar` evidence.

## Project Context And Final Ownership

Every prompt includes sanitized project metadata, branch, commit, dirty state, bounded source/diff
context, Base CCG Routing Evidence, and optional routed evidence. Never tell ChatGPT Pro it can read a
local path unless the relevant bounded content is actually in the prompt.

ChatGPT Pro code and conclusions are advisory. Codex alone applies local changes, reviews dependencies
and the resulting diff, runs verification, and reports whether work is local, committed, pushed, or
deployed.
