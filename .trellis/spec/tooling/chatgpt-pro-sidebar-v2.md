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
- Require one selected requested thinking mode and verified composer text before sending.
  `-ThinkingMode` defaults to `Pro`; webpage strength is independent of CCG
  plan/review/exc and Codex reasoning settings. `Extra High` is not `Pro`.
  Login, account, CAPTCHA, billing, and entitlement actions remain user-owned.
- `new-chat` and `send` select and independently verify the requested strength
  before fill without changing the underlying model. The bound live control
  proves availability; unknown or ambiguous choices never authorize a send.
- `status` is observational. `set-mode` changes only a bound empty homepage;
  it never fills or sends. A manual-selection wait resumes the original unsent
  request only after observing the matching mode, not from a user's assertion.
- State, evidence and watcher events retain `thinkingMode`. Recovery inherits
  that original value and rejects an explicit mismatch; historical absent
  values mean `Pro`. Completed ownership recovery keeps the same mode/deadline.
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
- Internal failures retain bounded diagnostic metadata through adapter errors,
  pre-invocation failure state, and RootWait errors: exception types, numeric
  error codes, and an allowlisted script basename with numeric code location.
  Preserve the original failure location across rethrows. Never persist raw
  exception text, source lines, full paths, prompts, or unfiltered stack traces
  in this metadata. Diagnostics do not authorize a resend or alter claim state.
- Adapter and watcher share the atomic-file helper. Mutable evidence readers
  allow delete sharing so their own reads do not block atomic replacement.
  Only a Windows sharing violation receives a bounded replacement retry;
  permanent errors retain their diagnostics and the previous durable content.
  Never replace atomic persistence with delete-then-write.
- Reextraction publishes its exclusive staging directory by atomic rename.
  A reproduced Windows child-file lock may surface as IOException 0x80070005;
  retry only that rename at most three times with 50 ms sleeps, while the
  source exists and destination is absent. Existing destination races retain
  the next-revision rule. Other errors or an exhausted budget propagate and
  retain the failed staging evidence; never alter permissions or overwrite a
  published revision.
- Prepare a first-click intent on an independent state object and adopt it only
  after durable persistence succeeds. A caught failure before the actual click
  retains consistent zero-click evidence; a post-click ambiguity remains
  non-resendable. This correction does not rewrite historical mixed failure
  records or relax the existing unsent-resume proof.

## Distribution and validation

The V2 source synchronization includes the adapter, watcher, their shared atomic-file helper, DOM and mode
selection helpers, `thinking-modes.json`, and the existing upload helper pair.
The adapter exposes explicit `upload` and `upload-status` commands that accept
only one to six ZIP files authorized by an explicit local manifest, require the
bound blank ChatGPT homepage, and keep `run` rejecting attachments. Distributing
these commands neither enables them by default nor authorizes an actual upload.
The sealed display-name recovery in the upload helper is one-time reviewed
recovery logic; do not generalize it or remove it as dead code.
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

### Watcher state visibility during replacement

Watcher JSON reads use the existing five-attempt read budget (four 25 ms waits),
including temporary file absence. A separate existence precheck must not bypass
that budget. Permanent required-file absence and invalid JSON remain failures;
optional absence returns null only after the budget. This read tolerance does
not authorize resubmission, deadline reset, identity substitution or slot release
without the existing durable proof.
