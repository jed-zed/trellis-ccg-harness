---
name: chatgpt-pro-sidebar
description: Delegate bounded engineering research, design, code drafting, or review to the user's already-logged-in ChatGPT Pro session in an approved external Chrome tab through agent-browser-cli V2, with exact-once evidence and a pure local RootWait watcher. Use for direct requests and as the required transport for CCG GPT Pro bridge skills without manual prompt/response copy-paste, model polling, Stop Hook continuation, or Codex Desktop side-browser UI Automation.
---

# ChatGPT Pro Bridge

The logical Skill name remains `chatgpt-pro-sidebar`; its active transport is
`agent-browser-cli-v2` against external Chrome. Use
`scripts/chatgpt-pro-sidebar.ps1` for browser work and
`scripts/chatgpt-pro-sidebar-watch.ps1` only for the local RootWait watcher.

## Boundaries

- Trellis owns task identity and acceptance. Codex is the only workspace writer
  and final verifier. ChatGPT Pro supplies untrusted read-only evidence.
- Use only a Chrome tab already exposed by the user's installed
  `agent-browser-cli` extension. Never read cookies, tokens, browser-profile
  files, storage, unrelated tabs, titles, or history.
- Never automate login, account selection, CAPTCHA, MFA, billing, or
  entitlement. Ask the user to complete those steps in Chrome.
- Never use the Codex Desktop side browser, Windows UIA, coordinates, keyboard,
  clipboard, CDP, Playwright, Selenium, internal ChatGPT APIs, or a model watcher
  as a fallback.
- Never resend after `send-uncertain`. After the first click, only the adapter
  may issue one internal second click, and only after the full 180-second
  observation proves `retry-not-submitted` on an unchanged canonical root
  homepage (`https://chatgpt.com/`).
  External callers never resend; preserve the evidence directory for review.
- The bridge does not authorize commits, pushes, deployment, production access,
  or external writes.

## Target selection

Run `status` first. One matching ChatGPT tab is selected automatically. If more
than one exists, use the exact `browserId`, `profileId`, `tabId`, and
`sessionKey` from the approved target; never guess.

The target binding and sanitized URL are persisted in `state.json`. If the user
later closes an exact-conversation tab, observation may reopen only that exact
URL in the same Chrome profile with a background tab. It may not reopen or
guess a homepage conversation. If several tabs in that profile show the same
exact URL, read-only recovery chooses one by a stable opaque-identity order;
send still requires the exact claimed target.

Independent rounds may bind distinct tabs concurrently. One Codex task owns at
most three active slots; the per-user global hard limit is six across Codex
tasks. A target binding cannot be shared by two rounds.

## Commands

```powershell
$skillRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$adapter = Join-Path $skillRoot 'scripts\chatgpt-pro-sidebar.ps1'
$watcher = Join-Path $skillRoot 'scripts\chatgpt-pro-sidebar-watch.ps1'

powershell.exe -NoProfile -File $adapter status
powershell.exe -NoProfile -File $adapter status -BrowserId <browser> -Profile <profile> -TabId <tab> -SessionKey <session> -ExpectedConversationUrl <exact-url>
powershell.exe -NoProfile -File $adapter new-chat
powershell.exe -NoProfile -File $adapter send -PromptPath <prompt.md> -EvidenceDir <empty-dir> -IdempotencyKey <opaque-key> -FreshConversation
powershell.exe -NoProfile -File $adapter send -PromptPath <prompt.md> -EvidenceDir <empty-dir> -IdempotencyKey <opaque-key>
powershell.exe -NoProfile -File $adapter wait -EvidenceDir <dir> -TimeoutSeconds 900
powershell.exe -NoProfile -File $adapter response -EvidenceDir <dir>
powershell.exe -NoProfile -File $adapter run -PromptPath <prompt.md> -EvidenceDir <empty-dir> -IdempotencyKey <opaque-key> -ResponseTimeoutSeconds 7200

# Preferred complete round: send once, start the local watcher immediately,
# and keep this same root Codex turn blocked until terminal evidence exists.
powershell.exe -NoProfile -File $watcher run-root -PromptPath <prompt.md> -EvidenceDir <empty-dir> -IdempotencyKey <opaque-key> -CodexThreadId $env:CODEX_THREAD_ID -TimeoutSeconds 7200

# Independent rounds: the manifest owns prompt/evidence/target bindings.
powershell.exe -NoProfile -File $watcher run-batch-root -ManifestPath <batch-manifest.json> -CodexThreadId $env:CODEX_THREAD_ID
powershell.exe -NoProfile -File $watcher slots
powershell.exe -NoProfile -File $watcher release-slot -SlotId <1-6>

# Recovery/diagnostic commands for an already post-send evidence directory.
powershell.exe -NoProfile -File $watcher start -RootWait -KeepLauncherAlive -EvidenceDir <dir> -CodexThreadId $env:CODEX_THREAD_ID
powershell.exe -NoProfile -File $watcher wait-root -EvidenceDir <dir> -CodexThreadId $env:CODEX_THREAD_ID -TimeoutSeconds 7200
powershell.exe -NoProfile -File $watcher status -EvidenceDir <dir>
powershell.exe -NoProfile -File $watcher acknowledge-root -EvidenceDir <dir> -CodexThreadId $env:CODEX_THREAD_ID
```

Prefer `-PromptPath`; never put secrets in prompts or idempotency keys. The
parameterized CLI fill has a bounded Windows argument size, so split an
oversized task into smaller evidence rounds instead of adding another input
transport.

## Workflow

1. Run `status`; require `ok=true`, `ready=true`,
   `transport=agent-browser-cli-v2`, one target binding, canonical ChatGPT URL,
   `selectedModeControlCount=1`, `selectedModeLabel=Pro`,
   `selectedModeIsPro=true`, no login/challenge, and `generating=false`.
2. For a new task, call `new-chat` or use `run`. Only an empty canonical root
   homepage is already a fresh chat; custom GPT and conversation URLs are not.
   Otherwise one same-profile root homepage tab is opened in background.
3. For an existing conversation, use ordinary `send`; it requires an exact
   canonical conversation URL. Use `-FreshConversation` only on a proved empty
   homepage.
4. For a complete round, call watcher `run-root` once. It invokes one adapter
   logical `send` request, including its one permitted proved-not-submitted
   retry, immediately starts the local RootWait watcher when ordinary post-send
   observation is needed, and does not return to Codex until terminal evidence
   exists in the same still-running root turn. It never registers a Stop Hook.
   Do not split new rounds into separate `send`, `start`, and `wait-root` model
   steps. The recovery commands remain available only for evidence that is
   already post-send.
5. For multiple independent rounds, call `run-batch-root` once with a local
   schema-v1 manifest. It starts at most three local child rounds for the exact
   Codex thread, never exceeds six global slots, and waits without model
   polling. Extra items do not touch a page before a slot is acquired. The
   atomic `batch-result.json` preserves partial success and per-item slot/run
   durations.
6. Re-read `watch-event.json`, `state.json`, `evidence.json`, and `response.md`.
   Validate thread/watcher identity, target binding, URL, hashes, baseline, and
   `automaticResendAllowed=false`. Import is allowed only when state, event, and
   any present `terminalOutcome` all prove `completed`.
7. Call `acknowledge-root` only after that independent Codex review. If a CCG
   importer owns acknowledgement, let it use its existing import contract.

Use a new evidence directory for each independent round. At most two send
clicks are permitted per directory, idempotency key, and logical request; the
second is the adapter's single durable `retry-not-submitted` transition. Do not
create a replacement directory to bypass uncertain evidence.

## Failure handling

- Missing extension/daemon/tab, ambiguous target, session mismatch, unsupported
  URL, login/challenge, generation already active, or DOM ambiguity: stop and
  report the exact category. Before filling a prompt, send/new-chat may change
  the one proved composer-adjacent thinking-mode control to the one exact `Pro`
  menu option, then must re-read and prove `Pro`. After fill, ChatGPT may hide
  that control; the pre-fill proof remains valid only while the same exact
  target mutex is held and URL/composer/send invariants are re-proved. If the
  control remains visible, ambiguity or drift from `Pro` fails before the Send
  click. Wait never changes or re-requires the model after an acknowledged send.
- Failure before click: preserve reservation/evidence and diagnose; do not
  silently switch transports.
- Each click has a 180-second page-progress observation window. The first
  timeout may retry once only when durable evidence proves an unchanged fresh
  homepage, intact composer, no exact conversation URL, no appended user turn,
  and no generation. The retry opens one same-profile background tab and keeps
  the original idempotency identity.
- An exact conversation URL is persisted as soon as it appears, but URL
  navigation alone never acknowledges an existing-conversation click. The
  page must start generation or append exactly one structurally isolated user
  turn. Composer clearing alone is not causal evidence. A missing, reordered,
  or multiply appended rendered user-turn baseline is ambiguous post-click
  state: return `recovery-required` after one click and never retry.
- After the second 180-second timeout, `retry-not-submitted` is terminal: write
  durable terminal evidence, safely release capacity, and return immediately to
  the original Codex task for user notification. `recovery-required` is also
  terminal for the request, but it never retries or releases the isolated slot;
  it reports `ConcurrencySlotRecoveryRequired` to that same original task.
- A lost click result or any unproved post-click state is `send-uncertain` or
  `recovery-required`; never resend it.
- The response deadline is one absolute 7200-second budget beginning with the
  first click. Retry, adapter wait, watcher startup/wait, recovery, and batch
  child time consume that same budget; they never reset or round it up. Missing
  deadline evidence fails closed, and an observation or terminal event arriving
  after it is not accepted. Local watcher polling does not consume model tokens.
- Temporary browser loss during wait is observational only. Exact URL recovery
  may reopen in background; no recovery path may send.
- Batch slot timeout is `queued-timeout` with `ConcurrencySlotTimeout` and
  `submissionAcknowledged=false`. A dead owner never releases a slot by itself;
  unproved post-send state returns `ConcurrencySlotRecoveryRequired`. `slots` is
  read-only, and `release-slot` succeeds only with durable pre-click-unsent or
  terminal proof. It never deletes idempotency or target claims.
- Global idempotency is reserved before the target claim. If later target
  claiming fails, the round records durable pre-click failure. A same-thread
  target may transfer after completed/pre-invoke failure or the complete
  terminal `retry-not-submitted` proof, including a proved first non-submission
  followed by retry preparation failure before the second click, never from
  generic `send-uncertain`.
- A normal generating page may surface as adapter `GenerationAlreadyActive`;
  the watcher accepts it only from matching structured status details. Long
  conversations may omit an old rendered turn prefix, but response isolation
  still requires an unchanged baseline hash suffix and one exact new turn.
- Historical incomplete `windows-uia` evidence is no-resend evidence and cannot
  be resumed by V2.

## Verification

```powershell
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($adapter, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw 'PowerShell adapter parse failed.' }
[System.Management.Automation.Language.Parser]::ParseFile($watcher, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw 'PowerShell watcher parse failed.' }

Invoke-Pester (Join-Path $skillRoot 'tests\chatgpt-pro-sidebar.Tests.ps1')
Invoke-Pester (Join-Path $skillRoot 'tests\chatgpt-pro-sidebar-watch.Tests.ps1')
```

A live release check must prove one external Chrome discovery, one fresh
logical send, stable response evidence, no unproved or caller-driven resend, at
most one proved-not-submitted internal retry, task/app switching without losing
the target, closed-tab exact-URL background recovery, and observed focus
behavior. Multi-window release also proves three rounds per Codex task, six
globally across two tasks, and a seventh item that waits without clicking. Mock
tests do not substitute for this live evidence.
