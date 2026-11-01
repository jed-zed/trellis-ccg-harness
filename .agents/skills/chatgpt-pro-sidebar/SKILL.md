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
- Never use the Codex Desktop side browser, Windows UIA, coordinates, OS keyboard automation,
  clipboard, CDP, Playwright, Selenium, internal ChatGPT APIs, or a model watcher
  as a fallback.
- Never resend after `send-uncertain`. After the first click, only the adapter
  may issue one internal second click, and only after the full 180-second
  observation proves `retry-not-submitted` on an unchanged canonical root
  homepage (`https://chatgpt.com/`).
  External callers never resend; preserve the evidence directory for review.
- The bridge does not authorize commits, pushes, deployment, production access,
  or external writes.

## Webpage thinking strength

Default is Pro. An explicit user webpage strength takes priority. Use -ThinkingMode on status,
new-chat, send/run, and watcher run-root; CCG uses --thinking-mode independently from --mode plan/review/exc.
Verified current menu strengths: Instant, Medium, High, Extra High, Pro. English aliases are
case-insensitive; Chinese aliases include 即时, 中等, 高, 极高/超高. 极高 means Extra High, not Pro.
Codex reasoning xhigh is a different setting and is not mapped to a webpage strength.
The live bound menu proves availability; unknown, absent or ambiguous choices stop before fill/send.
Model selection (for example GPT-6) remains separate and must stay unchanged.

The fixed thinking-mode DOM template parameterizes only the finite integers -1, 0, 1 or 2 (2 closes the bound popup). On the unique
composer-bound reasoning slider that advertises ArrowLeft/ArrowRight, it may dispatch those DOM
keyboard events, then independently re-read its live status and unchanged selected model.
It may dispatch Escape only on that unique bound popup, then prove it closed.
No arbitrary JavaScript, prompt interpolation, model-radio clicking, OS keys or coordinate fallback.
Status is read-only. set-mode -ThinkingMode <label> changes only an isolated empty ChatGPT homepage;
it never fills or sends. new-chat and send prove the requested mode before preparation and again
when visible after fill. State, evidence and watcher events persist thinkingMode; waiting inherits
it and rejects an explicit conflicting recovery value. Historical absent fields mean Pro.

## Target selection

Run `status` first. One matching ChatGPT tab is selected automatically. If more
than one exists, use the exact `browserId`, `profileId`, `tabId`, and
`sessionKey` from the approved target; never guess.

`new-chat` binds only the actual `opened_tab_id` and `opened_session_key`
returned by the background open. It proves that same session with the fixed
DOM inspector within ten seconds, independent of delayed tab enumeration.
The process timeout consumes the remaining discovery budget. A homepage may
inherit a same-profile draft; nonempty drafts are rejected and never cleared
automatically. Opening another tab does not prove an empty conversation.

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
powershell.exe -NoProfile -File $adapter set-mode -ThinkingMode "Extra High"
powershell.exe -NoProfile -File $adapter status -BrowserId <browser> -Profile <profile> -TabId <tab> -SessionKey <session> -ExpectedConversationUrl <exact-url>
powershell.exe -NoProfile -File $adapter new-chat
powershell.exe -NoProfile -File $adapter send -PromptPath <prompt.md> -EvidenceDir <round-dir> -IdempotencyKey <opaque-key> -FreshConversation
powershell.exe -NoProfile -File $adapter send -PromptPath <prompt.md> -EvidenceDir <round-dir> -IdempotencyKey <opaque-key>
powershell.exe -NoProfile -File $adapter wait -EvidenceDir <dir> -TimeoutSeconds 900
powershell.exe -NoProfile -File $adapter response -EvidenceDir <dir>
powershell.exe -NoProfile -File $adapter reextract -EvidenceDir <completed-dir> -CodexThreadId $env:CODEX_THREAD_ID
powershell.exe -NoProfile -File $adapter run -PromptPath <prompt.md> -EvidenceDir <round-dir> -IdempotencyKey <opaque-key> -ResponseTimeoutSeconds 7200

# New independent round from the proved empty root homepage: declare fresh,
# send once, and keep this root Codex turn blocked until terminal evidence exists.
powershell.exe -NoProfile -File $watcher run-root -PromptPath <prompt.md> -EvidenceDir <round-dir> -IdempotencyKey <opaque-key> -CodexThreadId $env:CODEX_THREAD_ID -TimeoutSeconds 7200 -FreshConversation

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

1. Run `status` as a read-only target and safety probe; require `ok=true`,
   `transport=agent-browser-cli-v2`, one target binding, canonical ChatGPT URL,
   one composer, `selectedModeControlCount=1`, no login/challenge, and
   `generating=false`. A different initial strength
   may report `ready=false`; continue to automatic preparation. Changed or
   ambiguous controls enter the persisted manual-selection gate.
2. For a new task, call `new-chat` or use `run`. `new-chat` always opens one
   separate same-profile root homepage tab in background, preserving the source
   tab and its draft. Use the returned exact target binding for the new round.
   `new-chat` and `send` automatically select the unique requested strength,
   then re-read and require one selected requested-strength control before filling a prompt.
3. For an existing conversation, use ordinary `send`; it requires an exact
   canonical conversation URL. Use `-FreshConversation` only on a proved empty
   homepage.
4. For a complete round, call watcher `run-root` once. New independent homepage
   rounds must include `-FreshConversation`; exact-URL follow-ups omit it.
   It invokes one adapter
   logical `send` request, including its one permitted proved-not-submitted
   retry, after acquiring one of the existing per-task/global capacity slots.
   It immediately starts the local RootWait watcher when ordinary post-send
   observation is needed, and does not return to Codex until terminal evidence
   exists in the same still-running root turn. It never registers a Stop Hook.
   Do not split new rounds into separate `send`, `start`, and `wait-root` model
   steps. The recovery commands remain available only for evidence that is
   already post-send.
5. For multiple independent rounds, call `run-batch-root` once with a local
   schema-v1 manifest. It starts at most three local child rounds for the exact
   Codex thread, never exceeds six global slots, and waits without model
   polling. Each child validates and reuses the parent's claim instead of
   acquiring a second slot. Extra items do not touch a page before a slot is
   acquired. The atomic `batch-result.json` preserves partial success and
   per-item slot/run durations.
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

The round directory must exist but need not be empty. Unrelated notes and
validated upload state/receipts may coexist with the send evidence. Existing
round-owned output files and request identities remain protected from overwrite.

## Complete code extraction and reextraction

Assistant CodeMirror blocks are read from the complete document owned by that
assistant body. Virtualized visible lines are never accepted as complete code.
Missing ownership, an unavailable or oversized document, or a length mismatch
fails closed. Detached plain text keeps line breaks and code indentation.

A stopped, completed round can use `reextract` to read its original reply again.
It verifies the original thread, exact conversation, browser/profile, prompt and
transcript baseline, then writes `response.md` and `reextraction.json` in a new
sibling `reextraction` directory (numbered when one already exists). Original
state, response, timestamps, watcher event and failure history remain untouched.
The receipt binds their hashes and the original completion timestamp. This is
read-only recovery with zero new requests; it never sends, waits for generation,
or extends the original deadline. Independently validate the derived receipt
before import. Recovery inherits the original webpage thinking strength.

After a completed follow-up transfers the same conversation claim, `reextract`
may still read an earlier completed round owned by the same Codex thread.
It verifies the current owner is completed on that exact conversation/profile
and holds the existing stable claim lock for the read. Active or foreign claims
remain blocked; send, wait and ordinary response ownership are unchanged.

## Failure handling

- Missing extension/daemon/tab, ambiguous target, session mismatch, unsupported
  URL, login/challenge, generation already active, or DOM ambiguity: stop and
  report the exact category. Before filling a prompt, send/new-chat may change
  the one proved composer-adjacent thinking-mode control to the requested available strength, then must re-read and prove that exact choice. After fill, ChatGPT may hide
  that control; the pre-fill proof remains valid only while the same exact
  target mutex is held and URL/composer/send invariants are re-proved. If the
  control remains visible, ambiguity or drift from the requested strength fails before the Send
  click. Wait never changes or re-requires the model after an acknowledged send.
- Failure before click: preserve reservation/evidence and diagnose; do not
  silently switch transports.
- A historical `EvidenceDirectoryNotPristine` failure may use explicit
  `run-root -ResumeUnsent` with its original key, directory, prompt and target
  only when durable evidence proves preparation never started: no reservation,
  target claim, fill, click or submission, and the bound homepage still has an
  empty composer/transcript. Retain the complete original preparation failure.
  This does not relax recovery for reserved or uncertain requests.
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
- Missing assistant ownership during proved generation stays pending without
  capturing activity text. Once generation ends, ownership must be proved.
  For an old `MessageOwnershipAmbiguous` probe failure, run adapter `wait` on
  that same evidence directory, then `wait-root`. Reconciliation requires a
  verified completed response, identical round binding and an unexpired original
  deadline; it preserves the failed event in `previousProbeFailure`.
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
- Explicit user-authorized abandonment is separate from normal proof-based
  release. `abandon-slot` archives the exact original claim and available
  evidence, retains the request's no-resend reservation and target claim, and
  releases only capacity after its audit receipt is durable. It requires exact
  original identity and a dead owner/watcher; changed evidence or failed
  archival keeps the slot occupied. It never turns an uncertain or late result
  into `completed`, resets a deadline, or authorizes a send. Requests that can
  use normal safe release, including `pre-invoke-failed`, use that existing
  path instead. Never invoke abandonment merely because a request is old.
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
