# ChatGPT Pro Browser V2

The project-scoped `chatgpt-pro-sidebar` Skill is the bundled platform source
selected first by the installed personal CCG bridge. Its adapter, watcher,
browser helpers, documentation, and tests must form one self-contained version.
Do not combine scripts from project and global installations. The provenance-
locked `components/ccg-workflow` snapshot is not the integration runtime.

## Active protocol

- Browser entry point: `scripts/chatgpt-pro-sidebar.ps1` inside the Skill.
- Transport: `agent-browser-cli-v2`, using the approved external Chrome tab.
- Atomic round: `scripts/chatgpt-pro-sidebar-watch.ps1 run-root`, with
  `-PromptPath`, `-EvidenceDir`, `-IdempotencyKey`, `-CodexThreadId`, and the
  exact browser/profile/tab/session binding. Pass `-FreshConversation` for a
  prepared new conversation.
- `run-root` owns send, local watcher startup, and waiting for terminal evidence.
  Local polling consumes no model tokens. It does not register a Stop Hook or
  start a model monitor.
- CCG imports only completed evidence through its installed bridge. Direct
  delegation uses `acknowledge-root` after independent Codex validation; CCG
  retains ownership of its own import acknowledgement.
- The existing CLI must already be installed. Missing dependencies or browser
  access produce explicit errors; the Skill does not install or log in tools.

## Safety and evidence boundaries

- Preserve thread, target, prompt, response, and exact conversation URL binding.
  An unrelated page or another thread's evidence must never authorize an action.
- Require one selected `Pro` mode and verified composer text before sending.
  Login, account, CAPTCHA, billing, and entitlement actions remain user-owned.
- `new-chat` and `send` automatically select the unique Pro option before fill,
  then re-read and verify Pro. A non-Pro initial status is preparation work,
  not a requirement for the user to switch modes manually.
- Extract sanitized turn text with the existing `nodePlainText` traversal so
  `<br>` preserves its newline even after the turn is cloned and detached.
- A hidden composer duplicate may be excluded by a bounded numeric DOM path
  intersected with the approved composer selector. The final composer and send
  selectors must still match exactly one raw node, with send scoped to that
  same composer form; multiple visible composers remain an error.
- New-chat preparation waits for both the composer and its mode control within
  the existing 10-second loading window. A missing control at expiry, ambiguous
  control, login/challenge, or active generation still fails before any send.
- Reserve durable idempotency before mutation. A lost click result,
  `send-uncertain`, or `recovery-required` never authorizes an external resend.
- The bundled implementation permits at most one internal retry after its
  complete 180-second proof of non-submission. An uncertain result is not such
  proof. Retain that distinction and its regression tests.
- All post-click work consumes the same absolute response deadline, at most
  7200 seconds from the first click. A retry or watcher must not reset it.
- Reject incomplete historical `windows-uia` evidence for V2 resume. Retained
  UIA helpers and Stop Hook tests are historical maintenance, not fallbacks.
- Browser automation stays inside the Skill. No separate Playwright/CDP,
  credential extraction, login automation, or hidden transport switch.
- GPT Pro remains untrusted read-only advice. Codex owns workspace changes,
  verification, and the existing Trellis/CCG completion rules.

## Distribution and validation

The V2 source synchronization includes the adapter, watcher, their DOM and Pro
selection helpers, and the existing upload helper pair referenced by the adapter.
Keep companion files available without enabling optional attachment operations.
Never copy runtime evidence, browser state, backups, or generated caches.

Parse PowerShell scripts, syntax-check JavaScript helpers, and run the bundled
Pester tests offline. RootWait regressions must exercise send/start/wait order,
fresh-conversation forwarding, exact-thread binding, absolute deadlines,
uncertain-send rejection, terminal evidence, and acknowledgement ownership.
Run the repository's required offline gates after integration.

Offline tests establish protocol and fixture behavior. A live release claim
still requires the Skill's external Chrome acceptance checks; report live
verification separately and reuse existing authorization only when it covers
the Provider, data, action, and cost scope.
