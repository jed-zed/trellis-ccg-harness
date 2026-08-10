# ChatGPT Pro Agent Browser V2

## Scope

This is the active transport contract for the logical `chatgpt-pro-sidebar`
provider. It controls a user-approved external Chrome tab through
`agent-browser-cli`, not the Codex Desktop side browser or Windows UIA.

## Target identity

- Discovery reads `agent-browser-cli tabs` and accepts only canonical
  `https://chatgpt.com/` or exact canonical conversation URLs.
- One target is bound by `browserId`, `profileId`, optional `profileLabel`,
  `tabId`, `sessionKey`, `origin`, and sanitized URL.
- `profileId` is the persistent recovery identity. Browser, tab, and session
  identifiers are re-bound after a browser restart only when `tabtree --full`
  proves one current browser instance for that same profile.
- More than one matching ChatGPT tab is an error for discovery and send unless
  the caller supplies the complete opaque browser/profile/tab/session identity.
  Read-only recovery may select the ordinal-first same-profile tab only after
  the original binding is unavailable and every candidate has the same exact
  canonical conversation URL.
- Every mutating CLI result must report the same tab and session. A mismatch is
  a hard failure.
- A closed exact-conversation tab may be reopened only at its exact sanitized
  URL, in the same persistent profile, with `open --background`. The resulting
  current browser, tab, and session become the new immutable observation
  binding. Homepage state is never reopened as recovery.
- Recovery requires at least one connected normal tab in that profile. Closing
  the last normal Chrome page disconnects the extension bridge; the adapter
  then fails closed and never launches or focuses Chrome by itself.
- CLI tab listings may abbreviate long URLs. Exact URL equality is decided from
  the inspected page DOM, never from a truncated listing value.

## DOM boundary

- Page inspection uses only the checked-in fixed JavaScript file. Prompts never
  enter executable JavaScript.
- The checked-in scripts may inspect the structural composer, Send/Stop
  controls, login and challenge controls, the one visible composer-adjacent
  thinking-mode control, its bounded menu/submenu, and ordered user/assistant
  turn containers. Model selection never reads chat text or credentials.
- It must not read cookies, storage, credentials, unrelated history/titles, or
  make network requests.
- Output, turn count, identity length, response length, and CLI JSON are bounded.
  Stdout must be exactly one successful JSON object.

## Exact-once send

- `send` requires an empty evidence directory, a new idempotency reservation,
  one ready non-generating page, an empty composer, and either the exact
  existing URL or an explicitly fresh homepage. Before prompt fill, the adapter
  requires exactly one composer-adjacent thinking-mode control. If its visible
  label is not exactly `Pro`, it may open only that control, the unique matching
  thinking-mode submenu, and the unique exact `Pro` radio option; it then
  re-reads the fixed page snapshot and requires `Pro`.
- The prompt is filled once, then its normalized SHA-256 and one Send control
  are re-proved immediately before one click. ChatGPT may hide the model
  control after fill; the exact pre-fill `Pro` proof remains valid only while
  the same target mutex is held and target/URL/composer/send invariants remain
  unchanged. If the control remains visible, the snapshot must still prove
  exactly one selected `Pro` mode. Ambiguous controls, a failed
  selection, or post-fill mode drift terminates before the Send click and is
  reported to the original Codex task.
- After each click, the adapter observes the same bound target for up to `180`
  seconds. The first exact canonical conversation URL is persisted atomically
  before rendered user-turn checks. URL navigation alone never acknowledges an
  existing-conversation click; generation must start or exactly one structurally
  isolated user turn must be appended before the attempt enters `sent`
  observation. Composer clearing alone is not causal evidence.
- Rendered user-turn text is not compared with the original prompt hash. The
  baseline must still retain an unchanged ordered suffix and may append at most
  one user turn; the prompt hash remains the pre-click composer and evidence
  integrity proof.
- A lost click result, URL drift, or target mismatch records `send-uncertain`.
  A missing, reordered, or multiply appended rendered user-turn baseline is
  `recovery-required` after one click and is never retryable.
  `automaticResendAllowed` remains false.
  The only second click is an internal transition of the same logical request
  after the canonical root homepage preserves the complete prompt, exposes no exact URL,
  appends no user turn, and starts no generation for the full observation
  window. It opens one same-profile background tab and enforces a two-click
  maximum with the original idempotency identity.
- If the second 180-second observation again proves that unchanged
  not-submitted state, the adapter writes terminal
  `terminalOutcome=retry-not-submitted`; capacity may be released only from the
  complete durable proof. Any unproved or ambiguous post-click state writes
  terminal `terminalOutcome=recovery-required`, retains the isolated capacity
  claim, and reports `ConcurrencySlotRecoveryRequired`. Both outcomes return to
  the exact original Codex thread and never authorize another click.
- The first click starts one absolute 7200-second response deadline. Adapter
  observation, the optional retry, watcher startup, and response wait consume
  the same budget; no transition resets or rounds it up. Missing deadline state
  fails closed. The direct `run` command, RootWait, and batch children all use
  the same fixed ceiling, and observations or terminal completion arriving after
  the deadline are not accepted.
- Existing-conversation sends must remain on the original exact URL. Fresh
  homepage sends may adopt only the first exact URL observed on the same bound
  tab/session.
- Prompts over the declared Windows argument bound fail before fill or click.
  The adapter does not fall back to clipboard, keyboard, coordinates, CDP, or
  prompt-bearing JavaScript.
- `status` is observational after send: it still requires the exact bound
  target, allowed URL, login/challenge clearance, and one composer, but a mode
  control hidden by ChatGPT does not turn the observation into an adapter
  failure. The payload keeps `ready=false` and the selected-mode evidence;
  `send` alone retains the strict final pre-click `Pro` proof.
- Post-click observation reads only the injected `UtcNowProvider`. One sampled
  time value is compared with both the 180-second observation deadline and the
  absolute 7200-second response deadline; the loop must not consult wall-clock
  UTC through a second path.

## Thread and target ownership

- `send`, `wait`, `response`, and `run` require one exact UUID
  `CodexThreadId`. V2 state, completion evidence, watcher state, and terminal
  events persist that identity; every later read must match it before browser
  access or response import.
- Before fill or click, `send` atomically reserves global idempotency and then
  claims the target for the exact thread, evidence directory, and idempotency
  key. A target-claim failure after reservation records durable
  `pre-invoke-failed` evidence; a global-reservation failure never claims the
  target. A foreign thread or different active round fails closed.
- A conversation with an exact canonical URL is claimed by persistent profile
  plus URL. A fresh homepage without a stable conversation URL is claimed by
  the complete browser/profile/tab/session identity and adopts the stable
  profile-plus-URL claim after the first exact conversation URL is proved.
- Claims have no TTL and are never automatically deleted. The same exact round
  may recover idempotently; the same thread may start a different round on that
  target only after the previous round is completed, definitely failed before
  invocation, or carries the complete terminal `retry-not-submitted` proof. That
  proof may contain one proved first non-submission plus a retry preparation
  failure recorded before any second click.
  Generic `send-uncertain` never releases or transfers ownership.
- Claim updates are serialized by the stable claim key, so two runtime tabs
  showing the same canonical profile-plus-URL conversation cannot race a
  terminal ownership handoff.
- UI serialization is scoped by a SHA-256 of the complete runtime target
  identity. Incomplete bindings fail closed, the same target is serialized,
  and different complete targets may progress independently.
- A long `wait` never holds the target mutex across the polling interval. Each
  status or response observation acquires and releases the target mutex around
  that single browser operation.

## Concurrency limits

- The accepted and enforced product limits are three active GPT Pro rounds per
  Codex task and six active rounds per local user. Target/thread isolation and
  both capacity caps must not be widened silently.
- Batch timeout defaults to `7200` seconds. An item that never acquires a slot
  ends as `queued-timeout` with `errorCategory=ConcurrencySlotTimeout` and
  `submissionAcknowledged=false`; it must not be represented as sent.
- The scheduler passes the exact remaining whole-second budget and the parent
  absolute deadline to each child. It never raises a final sub-30-second budget,
  and a slot acquired at or after the deadline is released as pre-click-unsent
  without starting a child.
- An orphaned slot whose durable state proves neither pre-click-unsent nor
  terminal remains isolated and returns `ConcurrencySlotRecoveryRequired`.
- A slot owner's persisted process-start value is an ISO-8601 UTC identity, not
  a local `DateTime` value. Liveness requires both the PID and the parsed UTC
  process start to match after JSON `DateTime`/`DateTimeOffset`/string
  round-trips; malformed or reused identities are dead owners, not matches.
- Read-only diagnostics must expose current slot ownership, and one audited
  recovery operation may release only a provably pre-click-unsent or terminal
  slot. It must not delete idempotency or target claims or authorize another
  click.

## New chat and focus

- Only an already empty canonical root `https://chatgpt.com/` homepage is a
  valid fresh chat and requires no navigation. Custom GPT `/g/<id>` and exact
  conversation URLs are not retry-safe fresh pages.
- Otherwise `new-chat` opens one homepage tab in the same profile using
  `--background` and proves that exact new tab is empty before returning.
- Read, wait, recovery, and new-chat operations do not request focus. The
  bridge reports `focusRequested=false` and `clipboardUsed=false`.

## Wait and continuation

- `wait` reads target identity and response baseline only from `state.json`. It
  never resends and rejects incomplete historical `windows-uia` evidence. It
  checks the persisted absolute response deadline before any browser recovery
  or polling. An exact URL discovered during recovery is persisted but does not
  set `submissionAcknowledged`; one appended user turn is still required before
  completed evidence can be written.
- Completion requires the unchanged response baseline, exactly one stable new
  assistant turn, a durable post-click progress acknowledgement, and one exact
  canonical conversation URL. Evidence records the V2 transport, fixed
  extractor version, target binding, hashes, timestamps, attempt history, the
  absolute response deadline, and no-resend state.
- ChatGPT may virtualize an old rendered turn prefix. Response and user-turn
  isolation may therefore retain an unchanged ordered hash suffix only when at
  least one baseline turn remains visible and at most one new turn follows. A
  fully missing baseline, changed/reordered suffix, or multiple new turns fails
  closed. A single rendered user turn may differ textually from the original
  prompt because ChatGPT formatting is not a stable identity boundary.
- The only active watcher continuation is `codex-root-wait`. New starts without
  `-RootWait`, model-monitor mode, and Stop Hook mode fail closed.
- New complete rounds use one foreground `run-root` command. It invokes adapter
  `send` once as a logical request, starts the hidden watcher immediately after
  waitable ordinary post-send evidence exists, and waits on local state/event
  files before returning to the same Codex turn. An adapter terminal
  `retry-not-submitted` or `recovery-required` result is projected to the same
  RootWait terminal event in that root turn without starting another watcher.
  Separate `start` and `wait-root` remain recovery/diagnostic commands for an
  already post-send evidence directory.
- The hidden local watcher calls only adapter `status` and `wait`; RootWait polls
  local state/event files. Neither operation invokes a model polling turn.
- Adapter status exit `GenerationAlreadyActive` is a valid watcher observation
  only when its structured details also prove `ok=true`, `command=status`, and
  `generating=true`. Malformed or contradictory details remain failures.
- Adapter subprocesses read the single JSON result without waiting for inherited
  daemon pipe EOF and have a bounded direct-process timeout.
- Batch child stdout is diagnostic only because an inherited redirect handle
  may keep it exclusively locked after the child exits. Durable fallback may
  accept completion only from a watcher terminal event; nonterminal or
  `send-uncertain` state cannot become `completed` and cannot release capacity
  without separate durable pre-click-unsent or terminal proof.
- Switching Codex tasks or using another application must not affect the
  external Chrome target. Browser recovery stays background-only and bound to
  the same profile and exact URL.

## Required checks

- PowerShell and fixed JavaScript parse checks.
- Unit coverage for single-JSON parsing, ambiguous discovery, target/session
  mismatch, URL-first persistence, formatted or delayed user-turn observation,
  existing-conversation no-op rejection, structural user-turn ambiguity without
  retry, custom-GPT fresh-page rejection, one-click uncertainty, exact `Pro` selection, post-fill hidden-control
  continuity and visible mode-drift rejection, wait without model reselection,
  the one safe background retry, the two-click maximum, stable
  duplicate-URL read-only recovery, response isolation, RootWait-only launch,
  and no credential or prompt-bearing script access.
- Unit coverage named `keeps status observational when the proved mode control
  stays hidden after generation` and `uses only the injected clock to stop the
  post-click observation window`.
- Unit coverage for distinct-target mutex coexistence, same-target exclusion,
  stable-conversation claim serialization, incomplete-binding rejection,
  global-reservation failure without target claiming, same-round claim recovery,
  foreign-thread claim rejection, terminal `retry-not-submitted` same-thread
  reuse, and cross-thread wait rejection before browser polling.
- Unit coverage for the `7200`-second batch default, `queued-timeout` with
  `ConcurrencySlotTimeout`, and fail-closed
  `ConcurrencySlotRecoveryRequired` orphan handling, including UTC process-start
  JSON round-trips, locked-stdout terminal fallback, and locked-stdout
  nonterminal/`send-uncertain` rejection. Adapter wait, watcher launch/wait,
  recovery, and batch child coverage must prove the same absolute response
  deadline is never reset.
- Harness conflicts must require `transport=agent-browser-cli-v2` and
  `continuation=codex-root-wait` while preserving the logical Skill/protocol
  name `chatgpt-pro-sidebar`.
- Live release evidence must cover external Chrome discovery, one fresh send,
  stable completion, exact evidence hashes, zero resend, task/app switching,
  closed-tab exact-URL recovery, and observed focus behavior.

## Scenario: atomic RootWait round

1. **Scope and trigger** — use `run-root` for every new complete GPT Pro round;
   use split watcher commands only when recovering or diagnosing evidence that
   is already in `sent`, `send-intent`, or `send-uncertain`.
2. **Signature** — `run-root` requires `PromptPath`, an existing empty
   `EvidenceDir`, a unique opaque `IdempotencyKey`, the exact UUID
   `CodexThreadId`, and a bounded `TimeoutSeconds`; `FreshConversation` is
   optional and retains the adapter's existing proof requirements. A caller
   selecting among multiple targets must pass the complete opaque
   `BrowserId`, `ProfileId`, `TabId`, and `SessionKey` tuple; partial tuples
   fail before adapter invocation.
3. **Contract** — one process performs `send -> watcher start -> local wait` in
   that order for ordinary post-send observation. It returns only after a
   terminal event, leaves acknowledgement pending for independent Codex review,
   permits no caller-driven resend, and never registers a Stop Hook or invokes
   a model watcher. The adapter's single durable proved-not-submitted retry is
   internal to the same logical `send`; adapter terminal outcomes bypass watcher
   launch and return through the same root task.
4. **Validation and errors** — a pre-send failure without waitable evidence
   launches no watcher. A process/result failure with valid post-send evidence
   continues observation without retry. Generation-active status is normalized
   only from its exact structured details. Virtualized turn lists must retain an
   unchanged baseline suffix. Wrong thread, invalid state, stale watcher,
   mismatched event, or unproved baseline fails closed.
5. **Cases** — good: acknowledged send reaches `completed`; base: a valid
   `send-uncertain` state is observed without resend; terminal-safe:
   `retry-not-submitted` releases capacity only with complete durable proof;
   terminal-isolated: `recovery-required` returns
   `ConcurrencySlotRecoveryRequired` and retains capacity; bad:
   `pre-invoke-failed` stops before watcher launch.
6. **Required tests** — prove the ordered single command, one adapter send,
   post-send failure continuation, pre-send no-launch, strict generation-active
   normalization, retained baseline suffix, full-baseline-loss rejection,
   shared absolute deadline, both adapter terminal outcomes returning to the
   original thread, safe release versus retained isolation, batch non-success,
   terminal RootWait return, and separate matching acknowledgement.
7. **Wrong vs correct** — wrong: return to the model between `send`, `start`,
   and `wait-root`; correct: issue one `run-root` tool call, review its evidence,
   then invoke `acknowledge-root` exactly once.

## Scenario: batch RootWait across tasks

1. **Scope and trigger** — use `run-batch-root` when one Codex task has multiple
   independent GPT Pro rounds. Each task supplies its own exact UUID and page
   bindings; separate tasks may run concurrently under the shared user cap.
2. **Signature** — the manifest stays inside one local batch directory and
   declares schema version `1`, one exact `codexThreadId`, optional
   `maxConcurrency` from `1` to `3`, optional timeout defaulting to `7200`, and
   one or more rounds with unique IDs, prompt paths, evidence directories,
   idempotency keys, and complete target bindings for multi-round batches.
3. **Contract** — the parent process acquires capacity before starting a child
   `run-root`. At most three children for one task and six for the local user may
   run at once. An item without capacity remains local and must not open a page,
   write the composer, or click Send.
4. **Terminal evidence** — every item keeps independent watcher, URL, target,
   prompt, response, and evidence hashes. The parent writes one atomic
   `batch-result.json` with slot-wait and run-duration telemetry; local polling
   does not consume model tokens.
5. **Errors and recovery** — a queued item reaching its batch deadline becomes
   `queued-timeout` with `ConcurrencySlotTimeout` and
   `submissionAcknowledged=false`. A dead owner releases capacity only with
   durable pre-click-unsent or terminal proof; otherwise it remains isolated as
   `ConcurrencySlotRecoveryRequired`. No path authorizes an automatic resend.
6. **Required tests** — prove per-task `3`, global `6`, a seventh item starting
   no browser child, cross-thread slot ownership, atomic partial results,
   duplicate-key rejection, UTC owner identity round-trip, locked-stdout
   terminal fallback, nonterminal durable-evidence rejection, safe release
   proof, and no-resend recovery.
7. **Wrong vs correct** — wrong: treat a child exit or unreadable stdout as
   terminal and free its slot; correct: classify stdout as diagnostic, consult
   durable watcher state/event, and retain the slot as
   `ConcurrencySlotRecoveryRequired` unless terminal or pre-click-unsent proof
   exists.
