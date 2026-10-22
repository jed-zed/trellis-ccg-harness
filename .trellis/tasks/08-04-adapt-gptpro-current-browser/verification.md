# Execution verification

## 2026-08-06 RootWait detached-worker liveness repair

- Read-only preflight proved one ready Pro root surface on RuntimeId `42.788972`.
  The first bounded send process was killed by the 30-second command wrapper
  before `state.json`; the durable reservation existed, but code ordering plus
  absent prompt/state evidence proved Send Invoke was never reached. It was not
  retried and its evidence was preserved.
- A new opaque key then completed exactly one acknowledged fresh-root Send with
  `phase=sent`, `conversationUrlBindingPending=true`, the frozen RuntimeId, and
  `automaticResendAllowed=false`. `start -RootWait` launched watcher
  `bb915276-bc7e-431d-bc58-2d1453a777d0`, but that hidden process exited before
  writing `watch-event.json`; the old `wait-root` continued waiting indefinitely.
- Fixed the shared terminal-evidence writer and made `wait-root` check the bound
  watcher PID. A dead worker with no event now produces a reviewed,
  no-resend `worker-crashed / root-wait-worker-not-running` terminal event.
  Hidden worker stdout/stderr are redirected into the bounded evidence directory.
- Replaying `wait-root` against the real stale evidence returned
  `worker-crashed` in about one second and `acknowledge-root` recorded the exact
  thread/watcher review. No resend occurred. The live `completed` E2E remains
  pending because the browser surface subsequently returned `CodexWindowMissing`.
- Focused watcher Pester passed 59/59. Full Skill Pester passed 208/208 with zero
  failed/skipped, PowerShell parser validation passed 5/5, and the CCG security
  scanner covered eight Skill files with zero findings.
- The command host was independently reproduced as reaping a detached watcher
  after launcher exit. RootWait now has explicit `-KeepLauncherAlive`; a real
  offline worker remained alive, completed six polls, and produced the expected
  terminal `timeout` instead of `worker-crashed`.
- A later live `new-chat` first failed before action with
  `RawViewTraversalTimeout`. Its old three-second recovery window was shorter than
  one five-second traversal bound. The pre-action proof now retries inside fifteen
  seconds, still with at most one Invoke; the same root then returned
  `conversationReset=false`. The subsequent Send was rejected before idempotency
  reservation or Invoke because the evidence directory was not pristine. The
  directory contains only its lock and prompt; no request was sent or retried.

## 2026-08-06 delayed exact-URL binding after fresh root send

- Corrected the contract so canonical root/GPT-root remains a valid fresh-send
  entry point. One returned and UI-acknowledged fresh Send may now persist
  `phase=sent` with `conversationUrlBindingPending=true` instead of being
  downgraded to `send-uncertain` solely because the exact URL did not appear
  inside the eight-second capture window.
- Only that strict state can start the watcher without an exact URL. It requires
  the send-time RuntimeId, returned Invoke, positive UI acknowledgement, empty
  pre-send/bound conversation URLs, and `automaticResendAllowed=false`.
  Unbound `send-intent`, `send-uncertain`, and follow-up states remain rejected.
- The watcher passively observes only the frozen RuntimeId, accepts root while
  binding is pending, durably adopts the first canonical exact URL exposed there,
  and fails `conversation-changed` if the URL later becomes non-exact or differs.
  Final response evidence still requires one exact URL and retains all hashes.
- Red/green evidence: the two affected suites first failed in four intended new
  contracts; after the adapter/watcher change, focused tests passed 188/188.
  Full Skill Pester passed 203/203 with zero failed/skipped; PowerShell parser
  passed 5/5; CCG security scan covered four changed files with zero findings;
  Harness conflicts passed 17 with zero blocking/warning; `git diff --check`
  passed (line-ending warnings only).
- Live acceptance did not send. A no-recovery status and one bounded panel-
  recovery status both returned exit 21 / `EmbeddedDocumentMissing`, so no
  composer focus, prompt write, Send Invoke, watcher, or RootWait was started.

## 2026-08-06 foreground-input RootWait live E2E

- Boss explicitly authorized one fresh live request. Read-only preflight proved
  one ready ChatGPT surface on RuntimeId `42.788972`, Pro state, idle generation,
  an empty composer, and canonical fresh root URL.
- The fresh-root `new-chat` command returned `conversationReset=false`, so it made
  zero New Chat Invoke calls. A new prompt, opaque idempotency key, and otherwise
  empty evidence directory were then used for exactly one
  `send -FreshConversation -AllowComposerFocus` command.
- Send Invoke returned and the UI acknowledged the submission, but the adapter
  could not durably capture an exact `/c/...` URL inside the post-send bound. It
  exited `29 / ExactConversationUrlUnavailableAfterSend`; no retry was attempted.
- Preserved state records `phase=send-uncertain`, `invokeAttempted=true`,
  `invokeReturned=true`, `uncertainReason=post-send-url-capture-timeout`, empty
  `conversationUrlBound`, and `automaticResendAllowed=false`.
- The first read-only adjudication against the frozen RuntimeId failed with
  `CodexWindowTargetMissing`: `42.788972` had disappeared and the only candidate
  was `42.1381948`. Unbound status then failed with `EmbeddedDocumentMissing`.
  The adapter did not rebind or mutate the replacement candidate.
- The evidence directory contains only the adapter lock, durable prompt, and
  `state.json`. No watcher, RootWait terminal event, response evidence, or
  acknowledgement was created. The complete E2E therefore remains unproved and
  this exact attempt must never be resent or bypassed with another key/directory.
- After Boss manually restored the side page, read-only adjudication found the
  original RuntimeId `42.788972` again, but the UIA address remained
  `https://chatgpt.com/` with `urlExact=false`. The page was idle, its composer
  was empty, visible assistant response count was zero, and the expected marker
  matched zero responses.
- The durable prompt evidence hash still matched. Adjudication performed zero UI
  mutation and did not send, resend, start a watcher, or change reservation/state.
  This proves only that no currently visible exact conversation can be recovered;
  it does not prove that the earlier Invoke did not submit. The attempt remains
  `send-uncertain`, `automaticResendAllowed=false`, and ineligible for RootWait.

## 2026-08-06 transient New Chat and focus-interference repair

- The adapter regression suite first failed in five expected places: one
  transient New Chat preparation case, three direct URL cases, and the
  same-top-level focus-restore predicate. After the minimal adapter change it
  passes 128/128.
- `Invoke-LiveNewChat` now retries only pre-action proof for three seconds with
  150 ms intervals and existing transient categories. It preserves the same
  target RuntimeId, keeps hard barriers immediate, and leaves the one Invoke
  outside the retry. Persistent transient and replacement-target fixtures make
  zero Invoke calls; an Invoke exception remains `NewChatUncertain` after one call.
- `Get-LiveUrlState` now performs one direct UIA value/text read and sanitization.
  Root, GPT-root, and exact-conversation fixtures prove zero address focus,
  selection helper, re-resolution, and focus restoration. The unused selection
  helper was deleted.
- Focus restoration now requires original top-level != automation top-level and
  current top-level == automation top-level. Starting inside the Codex top-level,
  staying on the original external top-level, moving to a third app, or missing
  identity all result in no restoration.
- PowerShell parser: 0 errors. Full project Skill Pester: 197 passed, 0 failed,
  0 skipped. `git diff --check` passed. CCG change analysis passed; the security
  scanner inspected the adapter and its test with 0 findings. The generic quality scanner
  does not support PowerShell and reported `files_scanned=0`, so it is not counted
  as a quality pass.
- Harness conflicts: 17 passed, 0 blocking, 0 warning, 3 informational. The
  session has no active Trellis pointer because the existing task helper currently
  has an unrelated Python syntax error; the tracked task remains `in_progress`.
- The read-only live gate ran three `status -NoPanelRecovery -NoFocusRestore`
  samples. All failed closed with `RawViewTraversalTimeout` after 6.531–7.334
  seconds, returned no target RuntimeId, and performed no panel recovery. Focus
  identity stayed unchanged twice; one no-action sample observed ambient focus
  drift, so this does not prove live focus safety.
- No UIA live mutation or ChatGPT request ran in that initial batch. Because the read-only
  gate never reached `ready=true`, three-point focus sampling and one fresh
  RootWait E2E remain pending explicit Boss window preparation; no old prompt,
  key, evidence directory, or uncertain action may be reused or retried.
- After Boss prepared a stable window, three read-only samples all returned
  `ready=true` for RuntimeId `42.788972`, with no panel recovery and unchanged
  focused top-level/element identity.
- Live New Chat Invoke ran exactly once and left focus unchanged both immediately
  after the pattern and before the no-op restore. A later read-only status proved
  the fresh root and empty composer, so New Chat was not retried.
- Composer `ValuePattern.SetValue()` also left focus unchanged, but the current
  controlled UI either retained an earlier exact owned test prompt or reverted to
  its empty placeholder. Send preparation never observed the requested exact hash
  plus one enabled Send control; every attempt stopped before Send Invoke.
- The reproduced `RawViewTraversalTimeout` during Send preparation now receives
  only a bounded fifteen-second read-only retry. Its regression failed at 128/129
  before the fix and passed 129/129 afterward. The final live blocker remained
  `ComposerOrSendNotReady`, not a send-uncertain state.
- The composer exposes only Value, Text, and ScrollItem patterns. Text is read-only
  and the writable Value pattern did not persist the exact prompt. No synthetic
  keyboard/mouse, clipboard, coordinates, browser driver, CDP, token, or internal
  API fallback was attempted. Send Invoke stayed at zero, so no watcher, RootWait,
  response evidence, or acknowledgement was created.
- The first key reservation was moved to an ignored task-local backup only after
  exact proof that no Send Invoke or submission occurred. The final failed
  pre-invoke attempt created a fresh reservation again; it remains preserved for
  audit and no alternate key/directory was used to bypass it afterward.
- Final local gates: five PowerShell files parsed with zero errors; full Skill
  Pester 197/197; Python Stop Hook AST parse passed; security scans inspected the
  adapter and its test with zero findings; Harness conflicts reported 17 passed,
  0 blocking, 0 warning, and 3 informational; `git diff --check` passed.
- Boss-approved foreground-input probe on RuntimeId `42.788972` called focus only
  on the unique ChatGPT composer, observed the exact owned marker in two
  consecutive fresh resolutions, and then cleared the strictly shaped marker.
  It invoked neither New Chat nor Send and used no clipboard or synthetic input.
  The first cleanup error was local parameter binding: `Set-LiveComposerValue`
  rejects an empty `Value`; direct writable `ValuePattern.SetValue('')` completed
  the exact-owned cleanup.
- The adapter now exposes opt-in `-AllowComposerFocus` only for `send`/`run`.
  Default writes make zero focus calls; opt-in writes focus the proved composer
  exactly once before `SetValue`. A second live probe exercised the production
  helper and returned `ok=true`, `markerPersisted=true`, and `cleared=true`, with
  zero New Chat/Send actions. Final gates: parser 5/5, adapter 130/130, full Skill
  198/198, security scanner 2 files/0 findings, Harness conflicts 17 passed with
  0 blocking/0 warning, and `git diff --check` passed. A fresh live Send/RootWait
  E2E is still pending and no request was sent in this probe.

## 2026-08-05 pure-script RootWait continuation

- Boss selected the pure-script path. `start -RootWait` reuses the detached UIA
  watcher, creates no Stop registration, and persists
  `continuationTransport=codex-root-wait`. Existing evidence cannot switch to or
  from this transport.
- `wait-root` keeps the root turn active and polls only exact local state/event
  files. It returns only after matching thread/watcher terminal evidence and a
  matching terminal watcher state; it never reads response text, acknowledges,
  touches UI/network, creates a child/model poll, or synthesizes Stop evidence.
- Direct review uses idempotent `acknowledge-root`, which records
  `codex-root-wait-reviewed` only after the shared exact-thread/exact-watcher,
  terminal, Codex-review-required, no-resend validation. CCG import retains its
  existing acknowledgement ownership.
- The Harness contract and its provider-separation gate now require
  `codex-root-wait`. Focused Harness adapter tests pass 31/31 and live conflict
  checks pass 17/17 with 0 blocking/0 warning/3 informational findings.
- PowerShell parser: 5/5. Focused watcher Pester: 53/53. Full Skill Pester:
  187/187. CCG security scans: 17 files, 0 findings. `git diff --check` passes;
  changed PowerShell source/tests retain UTF-8 BOM.
- The generic quality scanner still does not analyze PowerShell. It scanned the
  pre-existing Python Stop handler and the Harness MJS gate, reporting their
  existing structural warnings; no changed-path error was reported.
- The aggregate repository test runner was attempted but is not a clean task
  gate: it exceeded 240 seconds after many unrelated Windows/init test failures.
  The directly affected PowerShell and Harness adapter suites above are green.
- No ChatGPT request was sent or retried in this batch. A fresh harmless live
  `new-chat -> send -> start -RootWait -> wait-root -> root validation ->
  acknowledgement` remains required before claiming live E2E completion. The
  same-window task-switch UIA limitation remains unchanged; use another
  top-level Codex window for uninterrupted observation.

## 2026-08-05 GPT-5.6 Luna low agent-monitor transport

- Boss explicitly selected the alternative after the current Desktop build was
  live-proved not to dispatch `Stop`. The watcher now accepts explicit
  `-AgentMonitor`, creates no Stop registration, records
  `continuationTransport=codex-agent-monitor`, and refuses to change transport
  for existing evidence.
- Direct review uses `acknowledge-monitor`. It accepts only an exact current
  thread UUID, matching watcher ID, one of the six terminal statuses,
  `requiresCodexReview=true`, and `automaticResendAllowed=false`. It writes an
  idempotent `codex-agent-monitor-reviewed` acknowledgement without creating a
  Stop claim or callback. CCG imports retain ownership of their existing import
  acknowledgement.
- One real `agent_type=default` / GPT-5.6 Luna low child with
  `fork_turns=none` read the already-terminal exact evidence directory and
  reported `completed`, watcher/thread/URL bindings, response bytes, and hash
  presence through the agent mailbox. It did not read response text, write
  files, operate UI/network, or submit/retry anything. The root independently
  validated the persisted evidence.
- This mailbox smoke proves reporting of an existing terminal event, not a new
  pending-to-terminal ChatGPT run. No ChatGPT request was resent. Same-window
  Codex task switching can still hide the browser UIA subtree and defer the
  detached watcher until the exact surface returns.
- PowerShell parser: 5/5. Focused watcher Pester: 47/47. Full Skill Pester:
  181/181. CCG security scan: 8 files, 0 findings. The quality checker scanned
  only the unchanged Python Stop handler and reported four pre-existing
  structural warnings; it does not analyze the changed PowerShell watcher.
  Harness conflicts: 19 passed, 0 blocking, 0 warning, 2 informational.
- The three CCG quality routes classified this as local-only and skipped
  external intelligence; Grok was not invoked.

## 2026-08-05 live watcher and Stop Hook session mapping

- One direct follow-up was submitted exactly once on
  `https://chatgpt.com/c/6a731eaf-caac-83ea-91d5-1e008077b2df` with
  `sendActionInvokedOnce=true`, `submissionAcknowledged=true`, one prior
  response baseline, and `clipboardUsed=false`.
- Watcher `e1259f79-c5e4-46c4-bc4d-2a79bbbe5143` remained bound to RuntimeId
  `42.787626`, recorded ten successful exact-URL observations, finalized the
  response, and terminated `completed`. It did not record a surface failure or
  `deferred=true`, so this run proves background readability of the bound
  window but not same-top-level task-switch deferral.
- The response hash and URL hash were persisted, but `response.md` contains the
  UI status line `思考了 14s` before the expected marker. Response extraction
  isolation therefore remains a separate acceptance issue.
- The natural Stop lifecycle produced no `watch-stop-hook.claim`, callback,
  current-thread `wait_started` log, or post-turn `hook/started` event. The
  handler therefore did not get an execution opportunity in this run; payload
  mapping is not the live failure currently proven.
- The handler now tries bounded UUID candidates from the official payload and
  validated `CODEX_THREAD_ID`, choosing only an exact existing registration.
  Unmapped input logs boolean presence flags only. Focused Stop Hook tests pass
  15/15; the full Skill run passes 176/176.
- Codex Desktop was fully restarted. The replacement Codex process PID 109724
  started at `2026-08-05T12:35:47.3020367Z`, after both `hooks.json` and the
  trusted hash were written. Multiple clean natural turn ends after that restart
  still produced no current-thread `hook/started`, claim, callback, or
  acknowledgement. No ChatGPT resend occurred.
- Boss confirmed in the Desktop `/hooks` UI that all hooks are enabled. The
  current turn also received `<codex-mode>` and `<workflow-state>` from the
  configured `UserPromptSubmit` handler, proving that this Desktop session can
  execute user hooks while continuing to omit `Stop`.
- A separately launched Codex CLI 0.146 App Server reports the exact Stop entry
  as enabled, trusted, and hash-current with zero warnings/errors. The Desktop
  rollout identifies its embedded runtime as `0.147.0-alpha.1.2`; package
  `OpenAI.Codex_26.730.8199.0` did not dispatch Stop. This matches the failure
  class in the still-open upstream reports
  [#18541](https://github.com/openai/codex/issues/18541) and
  [#21639](https://github.com/openai/codex/issues/21639), but those reports are
  supporting evidence rather than proof of the exact upstream code defect.
- Current status: the local UIA bridge, watcher, and handler are verified, but
  live same-task continuation is blocked by the current Codex Desktop Stop-event
  dispatcher. Scheduled model turns, `codex exec resume`, main-composer writes,
  and Desktop Wake were not added as fallbacks. The task remains `in_progress`.
- The configured frontend route is Antigravity, but the required review was
  unavailable: the frontend intelligence gate incorrectly attempted disabled
  Grok and returned `spawn grok ENOENT`, while no installed
  `codeagent-wrapper.exe` exists. No Provider fallback or installation was
  performed.

## 2026-08-05 cross-task passive-observation repair

- Live A/B reproduction: while another Codex task occupied the same top-level
  window, adapter `status -NoPanelRecovery -NoFocusRestore` returned exit 21 /
  `EmbeddedDocumentMissing`; immediately after returning to the originating
  task, the same command returned `ready=true` on RuntimeId `42.787626`.
- A bounded process-level UIA probe proved the inactive task's ChatGPT URL and
  composer were absent from the exposed tree, not merely selected by a wrong
  panel heuristic. No exact-name UIA action for creating a new Codex window was
  exposed.
- The watcher now defers bound-surface failures until the existing overall
  timeout and resumes only after the exact window and conversation URL return.
  It performs no rebind, navigation, resend, focus restore, or mutation of the
  newly active Codex task.
- Focused watcher tests: 42 passed, 0 failed, 0 skipped.
- Parser: 5/5 files passed. Full Skill Pester: 174 passed, 0 failed, 0 skipped.
- The real cross-task watcher/Stop Hook smoke is still pending. The earlier live
  response completed, but its registration never produced
  `watch-stop-hook.claim`; `continuationRegistered=true` was only registration
  intent and is not counted as callback proof.

## 2026-08-05 local repair batch

- Replaced descendant `FindAll()` with incremental `RawViewWalker` traversal.
  Every successful snapshot is bounded to 10,000 visited elements and a five-second
  deadline; `RawViewElementLimitExceeded` and `RawViewTraversalTimeout` remain
  explicit fail-closed categories.
- Reused one in-memory Raw View element snapshot for selectors rooted at the same
  exact element. `Get-LiveCodexWindow` clears that cache before every new top-level
  resolution, including every post-mutation re-resolution.
- `Get-Process` now supplies candidate process IDs only. A process-filtered UIA
  `TreeWalker` enumerates every matching top-level element, so two Codex windows
  owned by one process are retained for RuntimeId/cardinality proof.
- Bottom-panel selection no longer uses `ToggleState=Off` as target identity. It
  requires one finite, unique geometry relation between the toggle and
  `ExpandPanel` before any UIA action, then re-resolves both controls after a panel
  mutation.
- Watcher and Stop Hook implementation files were not changed by this batch.

## Deterministic verification

- PowerShell parser: 5/5 files passed.
- Project-local Pester 5.7.1: 170 discovered, 170 passed, 0 failed, 0 skipped.
- Focused adapter suite: 117 passed, including visited-element/deadline bounds,
  sibling cycles, duplicate RuntimeIds, same-process multi-window enumeration,
  structural toggle selection in both ToggleState orientations, non-finite
  geometry with zero action, and unbound `send-intent` no-resend/no-reservation.
- CCG local security scanner: 2 PowerShell files scanned, 0 findings.
- CCG quality checker: 0 PowerShell files scanned. Its `passed=true` value is not
  counted as a quality result because this checker does not support `.ps1`.
- Forbidden transport/source scan: 0 matches.
- Harness conflicts: 19 passed, 0 blocking, 0 warning, 2 informational.
- `git diff --check`: passed; existing LF-to-CRLF worktree warnings remain.
- Grok, GPT Pro, and Claude were not called for this batch.

## Read-only live verification

All live commands were the project adapter's
`status -NoPanelRecovery -NoFocusRestore`, launched through an outer ten-second
process timeout. No `new-chat`, `send`, watcher, Stop Hook callback, panel action,
URL action, composer write, or application launch ran.

- The first pre-cache probe exceeded ten seconds and was terminated with no
  stdout/stderr and no residual adapter process.
- A staged read probe then measured process-filtered top-level discovery at about
  4.636 seconds and one 734-element Raw View traversal at about 1.751 seconds.
- After same-root snapshot reuse, a status probe completed in 5.071 seconds and
  failed closed with exit 21 / `EmbeddedDocumentMissing`.
- Five bounded repeats completed in 3.252-5.653 seconds: four returned
  `EmbeddedDocumentMissing`; one returned transient `CodexWindowMissing`.
- Focused top-level RuntimeId was unchanged in four repeats. During one read-only
  repeat it changed from `42.7343744` to `42.787626`. The status path performed no
  UIA action, so this is recorded as ambient focus drift rather than attributed to
  the adapter. It prevents any background-safety or live E2E claim.

## Preserved uncertain submission evidence

The existing ignored evidence at
`.trellis/tasks/08-04-adapt-gptpro-current-browser/.ccg-evidence/live-e2e-raw-uia-round1/state.json`
remains untouched:

- `phase=send-intent`
- `intentAtUtc=2026-08-05T04:09:25.8173364Z`
- `invokeAttempted=false`
- empty `conversationUrlBound`
- `automaticResendAllowed=false`
- a non-empty bound window RuntimeId and durable global idempotency reservation

No watcher registration, response callback, or acknowledgement exists for that
attempt. The evidence and reservation must not be deleted, retried, or bypassed
with another evidence directory.

## Remaining acceptance blocker

The deterministic repair is verified, but the current Codex Desktop surface did
not expose one independently provable ChatGPT document, composer, and canonical
URL during the 2026-08-05 live probes. The required
`new-chat -> send -> watcher -> Stop Hook -> acknowledge` acceptance remains
unmet. This task stays `in_progress` and must not be archived or described as E2E
working.

## 2026-08-05 continuation and second live attempt

- The same bound window returned a fully ready root preflight: one Codex window,
  one ChatGPT document, one address, one composer, one Pro indicator, no barrier,
  idle generation, and `https://chatgpt.com/`. A no-send panel recovery smoke kept
  the focused top-level and focused-element RuntimeIds unchanged.
- One `new-chat` command exceeded its outer process timeout. No residual adapter
  process or evidence state remained, and a later read proved the page was still
  the fresh canonical root. The command was not retried.
- One independent harmless `send -FreshConversation` used a new evidence
  directory and durable key. Its state is now `send-uncertain` with
  `uncertainReason=post-send-url-capture-timeout`, `invokeAttempted=true`,
  `invokeReturned=true`, no bound conversation URL, and
  `automaticResendAllowed=false`. No resend is allowed.
- The ChatGPT surface subsequently disappeared while the panel was fully closed.
  A bounded probe found exactly one visible/enabled exact SidebarToggle in Off
  state, zero `ExpandPanel`, and zero Browser controls. Requiring a relation to an
  absent `ExpandPanel` made closed-panel recovery unreachable.
- The minimal fix admits the sole exact SidebarToggle only when no eligible
  `ExpandPanel` exists. Multiple toggles still fail closed; when `ExpandPanel` is
  exposed, the unique finite structural relation remains mandatory. The focused
  adapter suite passed 119/119 after a verified 118/119 red run.
- The complete project Skill run discovered 174 tests and passed 171. Three
  watcher tests in separately dirty watcher files failed; those files changed
  outside this batch and were not modified here. The two changed adapter files
  each passed the current local CCG security scanner with zero findings.
- The latest top-level probe exposed the bound Codex window with a non-finite
  rectangle, so automatic recovery stopped before mutation. Boss must restore the
  Codex window and make its Browser surface visible before observation can
  continue. No watcher, callback, response evidence, or acknowledgement exists
  for this second attempt.

## 2026-08-05 top-level traversal timeout repair

- Red verification reproduced the old source contract: the adapter suite passed
  119/120 because top-level discovery still constructed a process-filtered
  `TreeWalker`.
- The minimal repair uses `RawViewWalker` only over the desktop's direct children
  and applies the existing ProcessId HashSet in the bounded condition. It deletes
  the now-unused `New-OrCondition`; all later window identity and uniqueness
  proofs remain unchanged.
- Focused adapter Pester passed 120/120. Parser validation passed 5/5 and the full
  project Skill passed 188/188 with 0 failed and 0 skipped.
- The CCG local security scanner examined the adapter and its test file with 0
  findings. Scoped `git diff --check` passed; only existing LF-to-CRLF notices
  were printed.
- Harness conflicts reported 16 passed and one blocking source-tree digest drift
  in the separately dirty personal CCG component. This batch did not restore or
  overwrite that unrelated source tree.
- Two outer-20-second, read-only `status -NoPanelRecovery -NoFocusRestore` runs
  both completed past top-level discovery. Neither returned
  `TopLevelWindowTraversalTimeout`; both stopped at exit 21 /
  `EmbeddedDocumentMissing` with zero visible/geometric ChatGPT documents.
- No panel recovery, focus restoration, new chat, send, watcher, callback, or
  acknowledgement ran. The traversal bug is repaired, while full GPT Pro bridge
  E2E remains blocked by the currently absent independently provable ChatGPT UIA
  Document.
