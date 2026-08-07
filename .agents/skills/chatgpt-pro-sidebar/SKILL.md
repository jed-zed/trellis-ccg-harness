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
- Never resend after `send-intent` or `send-uncertain`. Preserve the evidence
  directory for review.
- The bridge does not authorize commits, pushes, deployment, production access,
  or external writes.

## Target selection

Run `status` first. One matching ChatGPT tab is selected automatically. If more
than one exists, use the exact `browserId`, `profileId`, `tabId`, and
`sessionKey` from the approved target; never guess.

The target binding and sanitized URL are persisted in `state.json`. If the user
later closes an exact-conversation tab, observation may reopen only that exact
URL in the same Chrome profile with a background tab. It may not reopen or
guess a homepage conversation.

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
powershell.exe -NoProfile -File $adapter run -PromptPath <prompt.md> -EvidenceDir <empty-dir> -IdempotencyKey <opaque-key> -TimeoutSeconds 900

# Start this command as a background local process when the tool host reaps
# detached children. Keep the same root Codex turn active.
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
   Pro present, no login/challenge, and `generating=false`.
2. For a new task, call `new-chat` or use `run`. An empty homepage is already a
   fresh chat; otherwise one same-profile homepage tab is opened in background.
3. For an existing conversation, use ordinary `send`; it requires an exact
   canonical conversation URL. Use `-FreshConversation` only on a proved empty
   homepage.
4. After `send`, start the watcher with `-RootWait`, then call `wait-root` in the
   same still-running root turn. The watcher uses only local scripts and local
   evidence; it never registers a Stop Hook or starts a model.
5. Re-read `watch-event.json`, `state.json`, `evidence.json`, and `response.md`.
   Validate thread/watcher identity, target binding, URL, hashes, baseline, and
   `automaticResendAllowed=false` before using the response.
6. Call `acknowledge-root` only after that independent Codex review. If a CCG
   importer owns acknowledgement, let it use its existing import contract.

Use a new evidence directory for each independent round. At most one send click
is permitted per directory and idempotency key. Do not create a replacement
directory to bypass uncertain evidence.

## Failure handling

- Missing extension/daemon/tab, ambiguous target, session mismatch, unsupported
  URL, login/challenge, missing Pro, generation already active, or DOM ambiguity:
  stop and report the exact category.
- Failure before click: preserve reservation/evidence and diagnose; do not
  silently switch transports.
- Any failure at or after the click: treat as send-uncertain and never retry.
- Temporary browser loss during wait is observational only. Exact URL recovery
  may reopen in background; no recovery path may send.
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
exact-once send, stable response evidence, no resend, task/app switching without
losing the target, closed-tab exact-URL background recovery, and observed focus
behavior. Mock tests do not substitute for this live evidence.
