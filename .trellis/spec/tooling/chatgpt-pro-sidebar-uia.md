# ChatGPT Pro Sidebar UIA

> Legacy implementation reference. The active bridge contract is
> [ChatGPT Pro Browser V2](./chatgpt-pro-sidebar-v2.md). These UIA and Stop Hook
> rules apply only to retained historical code/evidence; they do not select a
> transport or authorize resuming old evidence through V2.

## 1. Scope and Trigger

This contract applies when changing the `chatgpt-pro-sidebar` PowerShell
adapter's window discovery, Raw View traversal, panel selection, exact-once
send behavior, watcher, or Stop Hook task binding. The bridge remains Windows
UI Automation only.

## 2. Signatures

Public commands and exit codes remain backward compatible. The shared live
helpers have these contracts:

- `Invoke-LiveBoundedTreeWalk(Root, Walker, Condition, Scope, Kind,
  MaximumVisitedElements, TimeoutMilliseconds, UtcNowProvider)`
- `Find-LiveRawElementsByCondition(Root, Condition, Scope, Walker,
  MaximumVisitedElements, TimeoutMilliseconds, UtcNowProvider)`
- `Find-LiveTopLevelElementsByProcessId(ProcessIds, Root, Walker,
  MaximumVisitedElements, TimeoutMilliseconds, UtcNowProvider)`
- Stop Hook stdin: official `session_id: string`; optional inherited
  `CODEX_THREAD_ID: UUID` environment fallback.
- Stop Hook registry:
  `%LOCALAPPDATA%\ChatGptProSidebar\stop-hook-v2\<thread-uuid>\<watcher-uuid>.json`.
- Stop Hook stdout on a claimed terminal watcher:
  `{"decision":"block","reason":"..."}`.
- Selected pure-script start:
  `watcher start -RootWait -KeepLauncherAlive -EvidenceDir <dir> -CodexThreadId <uuid>`.
- Blocking local terminal wait:
  `watcher wait-root -EvidenceDir <dir> -CodexThreadId <uuid> -TimeoutSeconds <30..86400>`.
- Direct root-wait acknowledgement:
  `watcher acknowledge-root -EvidenceDir <dir> -CodexThreadId <uuid>`.

## 3. Behavioral Contracts

- Raw View discovery walks incrementally with a `10000` element and five-second
  bound; it never calls descendant `FindAll()` and converts only matching nodes
  to live records.
- Selectors sharing one exact root, walker, and scope may reuse one bounded
  in-memory Raw View snapshot. The cache is cleared when top-level window
  resolution starts again and is never durable evidence.
- `Get-Process` supplies candidate process IDs only. A Raw View walk enumerates
  only the desktop's direct children, then filters those top-level elements by
  process ID. Every match enters the normal visibility, document, RuntimeId,
  and uniqueness proof; a process ID or `MainWindowHandle` never authorizes an
  action. A process-filtered `TreeWalker` is forbidden because its filtered
  view can flatten matching descendants and block inside an unrelated provider.
- When `ExpandPanel` is exposed, the sidebar toggle is selected only when
  exactly one finite geometric relation is proved. A fully closed panel may
  expose no `ExpandPanel`; in that state exactly one eligible exact-name
  SidebarToggle is required, and two or more candidates fail closed.
  `ToggleState` decides whether the selected control needs toggling, not which
  control is selected.
- An unbound or uncertain `send-intent` preserves its reservation and must not
  invoke, resend, create another reservation, or bind a replacement window.
- A fresh send from canonical root/GPT-root that has one returned Invoke and
  positive UI acknowledgement may persist `phase=sent` with
  `conversationUrlBindingPending=true`. Only this state may start the watcher
  without an exact URL. It remains locked to the send-time RuntimeId, prompt
  hash, response baseline, and no-resend reservation; final evidence still
  requires one canonical exact URL.
- While URL binding is pending, the watcher accepts root/non-exact status only
  on that frozen RuntimeId and adopts the first canonical exact conversation
  URL exposed there. It never navigates or rebinds. After adoption, any
  non-exact or different URL terminates as `conversation-changed`.
- After an acknowledged send, loss of the bound ChatGPT document, address, or
  top-level window is a passive watcher deferral until the existing overall
  timeout. It does not count toward ordinary consecutive probe failures and
  cannot navigate, rebind, resend, or mutate the newly active Codex task.
- Switching tasks inside one Codex top-level window may remove the inactive
  task's browser UIA subtree. Observation resumes only when the exact bound
  window and conversation URL reappear. Continuous observation while another
  task remains active requires a separately existing Codex top-level window;
  the bridge must not fabricate a background window action that live UIA does
  not expose.
- The Stop Hook considers the official payload identifiers first, followed by
  inherited `CODEX_THREAD_ID`, but accepts only UUID candidates. It selects the
  first candidate that owns an exact, unacknowledged watcher registration; it
  never enumerates another task or treats `turn_id`/`conversation_id` as a task
  identity fallback.
- When no payload or environment value is a valid UUID, the Hook exits zero,
  creates no claim/callback, and logs only boolean presence flags. Session or
  thread identifier values must never enter the diagnostic log.
- Desktop `/hooks` showing an enabled/trusted Stop entry is configuration
  evidence, not dispatch proof. A working `UserPromptSubmit` hook proves only
  that the session can execute that event type. Live continuation is accepted
  only after Stop emits a run event and the registered watcher produces its
  claim, callback, and acknowledgement. If those remain absent after a full
  Desktop restart, classify the app build as Stop-dispatch unavailable; do not
  weaken handler mapping or add scheduled turns, `codex exec resume`, main
  composer writes, or Desktop Wake as a hidden fallback.
- The selected `-RootWait` transport disables Stop registration and records
  `codex-root-wait`. The active root stays in the same turn and invokes one
  blocking `wait-root` script. The detached watcher remains the only UIA poller;
  `wait-root` polls only the exact local state/event files and creates no child,
  service, scheduler, queue, prompt, submission, or network operation.
- Codex command hosts that reap detached descendants start RootWait with
  `-KeepLauncherAlive` in a background local-script operation. The switch is
  invalid outside RootWait and waits only for the hidden worker process; it does
  not poll UIA, inspect responses, register Stop, or create another orchestrator.
- `wait-root` returns only exact-thread/exact-watcher terminal metadata whose
  event requires Codex review and forbids automatic resend. The root then
  independently verifies the event and thread/watcher/hash bindings, plus an
  exact URL for `completed` or the strict pending-URL contract otherwise. Direct
  delegation writes `codex-root-wait-reviewed` only through
  `acknowledge-root`; CCG import retains ownership of its existing
  acknowledgement. If the detached watcher exits before writing an event,
  `wait-root` writes one local `worker-crashed` terminal event and returns it for
  review instead of waiting until the overall timeout. Detached-worker stdout
  and stderr remain in the bounded evidence directory. Timeout and worker crash
  never permit resend, transport switching, or synthesized Stop evidence.
- `Get-LiveUrlState` reads and sanitizes only the address control's currently
  exposed UIA value/text. It never focuses the address, selects its text,
  re-resolves after focus, or restores focus. Callers keep responsibility for
  rejecting a direct root/GPT-root value when an exact conversation URL is
  required.
- `new-chat` may retry only its pre-action proof for three seconds with 150 ms
  intervals, using the existing transient UI categories and the same immutable
  target RuntimeId. Authentication/security, Pro state, generation, target
  replacement, and action-capability errors remain immediate failures. The one
  New Chat `InvokePattern` call remains outside the retry boundary.
- Send preparation may treat `RawViewTraversalTimeout` as retryable only before
  Send Invoke and only inside its fifteen-second proof window. Every attempt
  retains the immutable target and must re-prove the exact composer hash plus
  one enabled Send control. Raw View limits, target replacement, auth/security,
  Pro, generation, ambiguity, and Invoke errors remain hard failures.
- `ValuePattern.SetValue()` returning is not composer-write proof. If the exact
  normalized prompt hash never appears in a freshly resolved composer, return
  `ComposerOrSendNotReady` and perform zero Send Invoke; do not fall back to
  keyboard, clipboard, coordinates, CDP, or browser-internal APIs. Silent mode
  never focuses the composer. When the Boss explicitly selects foreground input,
  `send`/`run -AllowComposerFocus` may call `SetFocus()` once on the already
  uniquely proved ChatGPT composer immediately before `ValuePattern.SetValue()`;
  exact hash and one enabled Send remain mandatory afterward.
- Focus restoration is allowed only when the original focus came from a
  different top-level and the current focused top-level is exactly the proved
  automation top-level. If automation began inside the original Codex
  top-level, restoration is always a no-op so it cannot overwrite the user's
  later control choice in that same window.

## 4. Error Matrix

| Condition | Category | Required behavior |
|---|---|---|
| Raw View visit limit exceeded | `RawViewElementLimitExceeded` | Stop with zero UIA mutation |
| Raw View deadline exceeded outside Send preparation | `RawViewTraversalTimeout` | Stop with zero further UIA mutation |
| Raw View deadline exceeded during Send pre-action proof | transient read-only preparation gap | Retry inside the fifteen-second proof bound; never cross the Send Invoke boundary without exact composer/send proof |
| Raw View element disappears | `TransientUiRerender` | Fail closed; caller may start a new observation |
| Top-level visit limit exceeded | `TopLevelWindowLimitExceeded` | Stop; never fall back to one handle |
| Top-level deadline exceeded | `TopLevelWindowTraversalTimeout` | Stop; never fall back to one handle |
| Sidebar relation is missing or ambiguous | `SidebarToggleAmbiguous` | Stop before reading or invoking the toggle pattern |
| Closed panel exposes no `ExpandPanel` and multiple toggles | `SidebarToggleAmbiguous` | Stop with zero UIA mutation |
| Bound surface disappears during watcher observation | `EmbeddedDocumentMissing` / related surface category | Defer until exact target returns or overall timeout; zero rebind/resend/navigation |
| Payload `session_id` does not map a watcher, but validated `CODEX_THREAD_ID` does | exact environment registration | Wait/claim only that registration |
| No payload/environment UUID is usable | `hook_skipped_unmapped_thread` log | Exit zero; no claim/callback; log booleans only |
| Stop is enabled/trusted and another hook runs, but no Stop run event exists after restart | Desktop Stop dispatcher unavailable | Keep task incomplete; preserve registration; do not change handler or install wake/poll fallbacks |
| `-RootWait` requested for existing Stop/disabled/agent-monitor evidence | continuation transport mismatch | Stop; never reinterpret or relaunch the evidence |
| Root wait sees wrong thread/watcher, non-terminal status, review not required, or resend allowed | invalid root-wait evidence | Stop without acknowledgement |
| Root file wait reaches its bound | root-wait timeout | Stop the wait only; preserve watcher/evidence and never resend |
| `new-chat` pre-action proof returns an existing transient UI category | transient preparation gap | Retry only until the three-second deadline against the same target; zero Invoke until proof succeeds |
| `new-chat` sees target replacement, auth/security, missing Pro, generation, or unsupported action | existing hard category | Fail immediately with zero Invoke and zero rebind |
| Fresh root send is acknowledged but exact URL is not yet exposed | `sent` + `conversationUrlBindingPending=true` | Start passive same-window observation; never resend/navigate/rebind; require exact URL before completion |
| Direct URL value cannot satisfy any other caller's URL requirement | existing URL category | Fail closed; never focus or select the address to improve the value |
| Composer `ValuePattern.SetValue()` returns but the exact prompt hash never becomes visible | `ComposerOrSendNotReady` | Stop with zero Send Invoke; preserve the idempotency reservation for adjudication |
| `-AllowComposerFocus` is used outside `send`/`run` | `ComposerFocusModeInvalid` | Stop before any UI mutation |

## 5. Examples

- Good: two controls exist; only one toggle has one finite same-row relation to
  `ExpandPanel`, so that pair is selected.
- Base: the proved toggle is already On, so panel recovery is a no-op.
- Bad: choose the first Off toggle, enumerate only `MainWindowHandle`, or count
  results after an unbounded descendant query.
- Good: one bounded Raw View timeout occurs while proving a prepared Send; retry
  read-only resolution, then proceed only after exact prompt hash and one Send.
- Good: a fresh root send is acknowledged while the address still reads root;
  persist URL-pending `sent`, observe the frozen window, then bind its first
  exact URL before writing completed evidence.
- Bad: treat a writable `ValuePattern` return as proof, or synthesize input when
  the controlled composer does not expose the exact prompt afterward.
- Good: `session_id` does not name a UUID registry, while the inherited current
  task UUID owns one registration; claim only that exact registration.
- Base: neither candidate owns a registration; exit without output.
- Bad: scan all task directories, accept `turn_id`, or write raw session values
  to the Hook log.
- Good: Desktop emits a real Stop run event and the exact registration reaches
  claim, callback, then acknowledgement.
- Base: `/hooks` is enabled/trusted and `UserPromptSubmit` runs, but Stop has no
  run event after restart; preserve the registration and report the app build
  blocked.
- Bad: treat enablement as callback proof or add a scheduled/wake path to hide
  the missing Desktop lifecycle event.
- Good: the still-active root blocks in `wait-root`, receives exact terminal
  metadata from local files, re-reads evidence, and writes the direct root-wait
  acknowledgement.
- Bad: end the root turn, spawn a model monitor, synthesize a Stop
  claim/callback, switch transports, or treat the wait result as final review.

## 6. Required Tests

Tests must cover normal traversal, node/deadline bounds, repeated RuntimeIds,
sibling cycles, same-root snapshot reuse, direct-child top-level traversal and
its deadline, multiple same-process top-level windows, explicit RuntimeId
binding, structural toggle orientation and
ambiguity, the unique-toggle/no-expand closed state, multiple closed-state
toggles, non-finite geometry, and zero action for unbound `send-intent`.
Tests also cover passive deferral across temporary bound-surface loss, recovery
on exact target return, overall timeout, and ordinary probe failures remaining
bounded. Stop Hook tests must cover payload-first resolution, validated
`CODEX_THREAD_ID` fallback to an exact registration, unmapped identifiers
producing no claim, and diagnostics containing no identifier value.
Root-wait tests must cover no Stop registration, exact transport persistence,
mode-change rejection, bounded local file waiting, exact thread/watcher terminal
validation, required Codex review, no-resend, idempotent direct acknowledgement,
and no synthesized Stop claim/callback. The live release gate requires one
same-turn `start -RootWait` -> terminal `wait-root` -> independent root
validation -> matching acknowledgement path. Fixture, trust, enablement, another
hook event, or an agent mailbox smoke cannot substitute for that live transport.
Adapter tests must also cover transient-then-stable and persistent-transient
New Chat preparation, hard barriers with zero Invoke, one uncertain Invoke,
direct root/GPT-root/exact URL reads with zero focus/selection/restoration, and
the cross-top-level-only focus-restore predicate. Send preparation must cover a
bounded `RawViewTraversalTimeout` followed by stable exact composer/Send proof.
Composer input tests must prove zero `SetFocus()` by default and exactly one
composer `SetFocus()` when foreground input is explicitly enabled.
Pending-URL tests must prove strict admission of only an acknowledged fresh
`sent` state, same-RuntimeId root observation, first-exact-URL adoption,
post-binding URL drift failure, final exact-URL evidence, and continued rejection
of unbound `send-intent`, `send-uncertain`, and follow-up states.

## 7. Wrong vs Correct

Wrong: `Root.FindAll(Descendants, ...)` followed by a result-count limit.
Correct: incremental `TreeWalker` traversal that enforces count and deadline
before the result set exists.

Wrong: treating each process's `MainWindowHandle` as the complete window set,
or constructing a filtered `TreeWalker` whose view may flatten descendants.
Correct: a Raw View walk over desktop direct children, process-ID filtering,
then independent identity and uniqueness proof.

Wrong: require the official `session_id` to be a UUID and silently discard a
current-task watcher when it is not.
Correct: validate bounded payload/environment UUID candidates and accept only
the first candidate with an exact registration; otherwise log flags and stop.

Wrong: end the root turn and expect a local script to wake it later, or add a
model child as the selected polling path.
Correct: keep the detached local watcher token-free and keep the root turn open
inside one blocking local file wait, followed by independent validation and the
matching acknowledgement owner.

Wrong: focus or select the address to obtain a more complete URL, or wrap New
Chat Invoke inside a transient retry.
Correct: use the directly exposed sanitized URL, retry only pre-action transient
proof against the immutable target, and invoke at most once after proof succeeds.

Wrong: accept `ValuePattern.SetValue()` return as successful input or broaden to
synthetic input when the hash is absent.
Correct: re-resolve within the bounded Send preparation window and require the
exact prompt hash plus one enabled Send control before the single Invoke. If the
Boss selected foreground input, focus only that proved composer once before the
write; never focus the address or synthesize input.

Wrong: turn an acknowledged fresh root send into `send-uncertain` only because
the exact URL did not appear within a short post-send window.
Correct: persist URL-pending `sent`, passively observe only the frozen window,
adopt its first exact URL, and prohibit completion until that binding exists.
