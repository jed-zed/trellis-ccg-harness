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
- More than one matching ChatGPT tab is an error unless the caller supplies the
  complete opaque browser/profile/tab/session identity.
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
- The script may inspect the structural composer, Send/Stop controls, login and
  challenge controls, Pro indicator, and ordered user/assistant turn containers.
- It must not read cookies, storage, credentials, unrelated history/titles, or
  make network requests.
- Output, turn count, identity length, response length, and CLI JSON are bounded.
  Stdout must be exactly one successful JSON object.

## Exact-once send

- `send` requires an empty evidence directory, a new idempotency reservation,
  one ready non-generating Pro page, an empty composer, and either the exact
  existing URL or an explicitly fresh homepage.
- The prompt is filled once, then its normalized SHA-256 and one Send control
  are re-proved immediately before one click.
- A successful send acknowledgement requires exactly one appended user turn
  whose hash equals the prompt and an emptied composer or active generation.
- After the click boundary, any lost result, URL drift, target mismatch, or
  acknowledgement uncertainty records `send-uncertain`. Automatic resend is
  always forbidden.
- Existing-conversation sends must remain on the original exact URL. Fresh
  homepage sends may adopt only the first exact URL observed on the same bound
  tab/session.
- Prompts over the declared Windows argument bound fail before fill or click.
  The adapter does not fall back to clipboard, keyboard, coordinates, CDP, or
  prompt-bearing JavaScript.

## New chat and focus

- An already empty ChatGPT homepage is a valid fresh chat and requires no
  navigation.
- Otherwise `new-chat` opens one homepage tab in the same profile using
  `--background` and proves that exact new tab is empty before returning.
- Read, wait, recovery, and new-chat operations do not request focus. The
  bridge reports `focusRequested=false` and `clipboardUsed=false`.

## Wait and continuation

- `wait` reads target identity and response baseline only from `state.json`. It
  never resends and rejects incomplete historical `windows-uia` evidence.
- Completion requires the unchanged response baseline, exactly one stable new
  assistant turn, the bound prompt/user-turn acknowledgement, and one exact
  canonical conversation URL. Evidence records the V2 transport, fixed
  extractor version, target binding, hashes, timestamps, and no-resend state.
- ChatGPT may virtualize an old rendered turn prefix. Response and user-turn
  isolation may therefore retain an unchanged ordered hash suffix only when at
  least one baseline turn remains visible and at most one new turn follows. A
  fully missing baseline, changed/reordered suffix, or multiple new turns fails
  closed; the one new user turn must still hash to the prompt.
- The only active watcher continuation is `codex-root-wait`. New starts without
  `-RootWait`, model-monitor mode, and Stop Hook mode fail closed.
- New complete rounds use one foreground `run-root` command. It invokes adapter
  `send` once, starts the hidden watcher immediately after waitable post-send
  evidence exists, and waits on local state/event files before returning to the
  same Codex turn. Separate `start` and `wait-root` remain recovery/diagnostic
  commands for an already post-send evidence directory.
- The hidden local watcher calls only adapter `status` and `wait`; RootWait polls
  local state/event files. Neither operation invokes a model polling turn.
- Adapter status exit `GenerationAlreadyActive` is a valid watcher observation
  only when its structured details also prove `ok=true`, `command=status`, and
  `generating=true`. Malformed or contradictory details remain failures.
- Adapter subprocesses read the single JSON result without waiting for inherited
  daemon pipe EOF and have a bounded direct-process timeout.
- Switching Codex tasks or using another application must not affect the
  external Chrome target. Browser recovery stays background-only and bound to
  the same profile and exact URL.

## Required checks

- PowerShell and fixed JavaScript parse checks.
- Unit coverage for single-JSON parsing, ambiguous discovery, target/session
  mismatch, exact URL recovery, one-click uncertainty, user-turn
  acknowledgement, response isolation, RootWait-only launch, and no credential
  or prompt-bearing script access.
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
   optional and retains the adapter's existing proof requirements.
3. **Contract** — one process performs `send -> watcher start -> local wait` in
   that order. It returns only after a terminal event, leaves acknowledgement
   pending for independent Codex review, never resends, and never registers a
   Stop Hook or invokes a model watcher.
4. **Validation and errors** — a pre-send failure without waitable evidence
   launches no watcher. A process/result failure with valid post-send evidence
   continues observation without retry. Generation-active status is normalized
   only from its exact structured details. Virtualized turn lists must retain an
   unchanged baseline suffix. Wrong thread, invalid state, stale watcher,
   mismatched event, or unproved baseline fails closed.
5. **Cases** — good: acknowledged send reaches `completed`; base: a valid
   `send-uncertain` state is observed without resend; bad: `pre-invoke-failed`
   stops before watcher launch.
6. **Required tests** — prove the ordered single command, one adapter send,
   post-send failure continuation, pre-send no-launch, strict generation-active
   normalization, retained baseline suffix, full-baseline-loss rejection,
   terminal RootWait return, and separate matching acknowledgement.
7. **Wrong vs correct** — wrong: return to the model between `send`, `start`,
   and `wait-root`; correct: issue one `run-root` tool call, review its evidence,
   then invoke `acknowledge-root` exactly once.
