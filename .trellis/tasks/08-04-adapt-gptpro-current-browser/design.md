# Design: current Codex browser compatibility

## Boundary

The adapter remains a Windows UI Automation client. It does not gain a second transport and does not consume ambient model UI state as evidence. Codex remains the only workspace writer and final verifier; ChatGPT Pro remains untrusted read-only evidence.

## Compatibility model

Retain the existing legacy path and add at most one current-layout resolver inside the shared live-context boundary.

1. Codex may nominate or focus an intended top-level window, producing only an optional candidate RuntimeId/focus hint.
2. The adapter enumerates bounded top-level UIA records and independently selects only an explicit unique target, one eligible candidate, one uniquely browser-bearing candidate, or one uniquely focused candidate. Empty/duplicate RuntimeIds are unbindable; enumeration failure or more than 512 top-level elements remains an explicit bounded error.
3. Attempt the existing independent-document/address path unchanged.
4. If that path is absent, look only for the current right-side browser accessibility shape that provides a uniquely attributable ChatGPT root, one eligible ChatGPT composer, and a trustworthy canonical URL value through supported UIA patterns/properties.
5. Exclude the main Codex document/composer using structural identity, automation ID/class/name evidence, supported patterns, and unique containment—not coordinates or ambient browser state.
6. Before any acting command performs repeated resolution or prompt preparation, freeze the first proven non-empty RuntimeId into the existing command-scoped target binding. Every later resolution must match it; no resolver may silently return a replacement window during the same operation.
7. Return the same normalized context contract consumed by auth, generation, new-chat, send, wait, and response extraction.
8. If any required identity, capability, or URL evidence is missing or ambiguous, return a specific fail-closed compatibility error before any write/invoke action.
9. Persist the canonical exact `conversationUrlBound` as durable conversation identity. Treat `windowRuntimeId` only as an ephemeral action/observation lock that may change after a browser surface is safely reopened and re-proved.
10. Restrict automatic recovery to an already-running Codex Desktop instance. If the original top-level RuntimeId still exists, only that window may host recovery. If it disappeared, never reuse another existing Codex window; create a replacement surface only through a uniquely proved target-isolated in-app UIA action.
11. Classify every recovery mutation as background-safe only after a bounded live smoke proves zero foreground and focused-top-level change for the exact UIA pattern on the current app build. `SetFocus`, address text selection, `codex://threads/...`, Desktop Wake, application launch/relaunch, and any action that activates or switches a task are not silent-recovery mechanisms.
12. Re-check the frozen target and sample focused top-level identity immediately before each recovery mutation. A stable focus on another application or Codex task is allowed only for an independently live-proved focus-free action; if focus changes between proof and action, the target/capability drifts, or background safety is unproved, persist a pending/manual recovery result without acting or restoring focus.
13. Use one URL acquisition contract for every command: read and sanitize only the address value/text already exposed through UIA. Never call `Address.SetFocus()`, select address text, re-resolve after focus, or restore focus to improve URL evidence; callers fail closed when the direct value is insufficient.
14. Retry only `new-chat` pre-action proof for fifteen seconds with the existing transient categories plus bounded `RawViewTraversalTimeout`, and the same immutable target. Keep hard barriers and the single Invoke outside that retry. Restore focus only across top-levels when automation still owns the current top-level; never restore within the original Codex top-level.
15. Keep composer writes focus-free by default. The explicit Boss-selected foreground mode may focus the already uniquely proved ChatGPT composer once immediately before `ValuePattern.SetValue()`. It does not authorize address focus, synthetic input, weaker prompt-hash proof, or extra Send invokes.

The current live probe did not find such a complete accessibility shape. Therefore the implementation begins with a read-only capability re-probe against the exact app build. If the required URL/surface evidence remains absent, the correct implementation outcome is a documented blocker rather than a weaker transport.

## Data flow

`Codex candidate hint -> UIA top-level discovery -> independent proof -> operation target lock -> layout resolver -> normalized live context -> auth/generation/url checks -> new-chat/send -> [exact URL available: durable URL binding | acknowledged fresh root send: same-window URL-pending binding] -> passive watcher (-RootWait) -> exact URL adoption on the frozen window -> finalized response evidence -> blocking local wait returns terminal metadata -> Codex review -> acknowledgement`

Boss selected the pure-script continuation, so the final segment is:

`passive watcher (-RootWait) -> still-running root blocks in wait-root on exact local files -> terminal metadata -> root independently validates evidence -> [direct: root-wait acknowledgement | CCG: importer acknowledgement]`

`wait-root` is file-wait plumbing only. It never replaces the token-free UIA
watcher, reads the response body, writes acknowledgement evidence, or becomes
evidence authority. The root may remain active while the user uses another app
or top-level Codex window, but same-window task switching can still hide the
bound browser surface from UIA and defer the watcher until that exact surface
returns. This transport creates neither Stop evidence nor a model/subagent poll.
When the Codex command host reaps detached descendants as soon as `start`
returns, `-KeepLauncherAlive` keeps that launcher host blocked on only the hidden
worker PID. The caller runs that start command as a background local-script
operation while the root independently runs `wait-root`; other transports retain
their existing prompt-returning launcher behavior.

Every boundary keeps exact cardinality and canonicalization checks. No consumer is allowed to compensate for a weak resolver.

## Binding state machine

`discover -> prove -> lock -> act -> observe -> complete`

- `discover`: enumerate bounded top-level candidates; a Codex focus/runtime hint may narrow but never prove the target.
- `prove`: validate the top-level Codex identity plus a unique ChatGPT surface, composer, canonical URL, auth state, and generation state.
- `lock`: record the non-empty unique RuntimeId in the existing process-local target before repeated resolution or any action preparation.
- `act`: re-resolve against the locked target, verify prompt and URL invariants, then perform the one allowed UIA action.
- `observe`: continue resolving only the locked target while the surface remains readable; watcher persistence retains RuntimeId plus exact conversation/thread/evidence bindings and performs no foreground mutation.
- `observe-pending-url`: only after an acknowledged fresh root send, retain the immutable RuntimeId, prompt hash, baseline, and no-resend reservation while the URL remains root/non-exact. The watcher may passively observe that same window and adopt its first canonical exact URL; it cannot navigate, rebind, resend, or finalize without that URL.
- `recover`: after surface loss, keep the exact bound URL, discard the stale surface/window lock as applicable, and permit one bounded in-app recovery only when target isolation and zero focus/foreground side effects are independently proved. Re-prove URL/auth/security/Pro/conversation evidence before storing the new ephemeral RuntimeId.
- `defer`: if focus changes between proof and action, the original top-level target vanished, multiple Codex windows exist, or background-safe navigation is unavailable, persist pending/manual recovery and leave every other Codex window untouched.
- `invalidate`: on `ElementNotAvailable`, target loss/replacement, empty or duplicate identity, pattern/capability change, URL drift, or ambiguity, discard the operation and require a fresh command. Never rediscover and act in the same operation.

## Minimal-change rule

- Prefer extending `Resolve-LiveContext` and its existing selection helpers over branching every command.
- Reuse the existing `$Script:TargetWindowRuntimeId`/`-WindowRuntimeId` binding for the operation lock; do not add a second lock service or persistent window registry.
- Reuse `Find-LiveElementsByNames`, `Find-LiveElementsByControlTypes`, `Select-UniqueControlRecord`, `ValuePattern`, and `InvokePattern`.
- Extend the existing focus snapshot/RuntimeId checks as the pre-action silence guard; do not add foreground APIs, an idle detector, a second mutex, a process/window registry, or a background service.
- Add no dependency, service, coordinate map, OCR model, browser driver, or parallel bridge implementation.
- Do not change watcher/Stop Hook code unless an end-to-end failure proves a contract defect there.
- Keep root-wait inside the existing watcher state and acknowledgement boundary.
  Add no service, scheduler, queue, subagent, or second UI polling
  implementation; the blocking script reads only local watcher files while the
  existing detached worker remains the sole UIA observer.
- Keep `Invoke-LiveDesktopWake` outside the recovery and Stop Hook fallback path. Do not repair or broaden it in this task; silent recovery must never invoke its `codex://threads/...` activation or main-composer write.

## Error and compatibility behavior

- Legacy layout continues to work as before.
- Current layout with complete UIA evidence returns the same public result schema.
- Current layout without a trustworthy URL/surface returns a bounded compatibility category and performs no `new-chat` or `send` action.
- Codex nomination without adapter proof is rejected. A frozen target that disappears or changes returns an explicit target-lost/identity-invalid category and never falls back to another candidate in the same command.
- A closed browser panel/tab inside the still-bound top-level target may recover only through a live-proved background-safe action and exact URL navigation. If the top-level target disappeared, another Codex window is never chosen even when it is the only remaining or focused candidate.
- User focus outside the bound target, a focus change between proof and action, insufficient direct URL evidence, missing background-safe navigation, or any foreground/task activation requirement returns a pending/manual recovery category with no UI mutation and no later focus restoration.
- `send-intent` and `send-uncertain` recovery may reopen and observe only the exact bound URL; it never creates a chat, reserves another key, invokes send, or uses Desktop Wake.
- Ambiguity, login/security barriers, generation-in-progress, uncertain invoke acknowledgement, conversation change, or evidence mismatch keep their existing fail-closed semantics.
- A Send pre-action Raw View timeout may be retried read-only inside a
  fifteen-second bound. `ValuePattern.SetValue()` is never sufficient evidence:
  the freshly resolved composer must expose the exact prompt hash and one enabled
  Send control, otherwise stop at `ComposerOrSendNotReady` with zero Send Invoke.

## Rollback

The implementation should be confined to the project Skill adapter/tests and, only if required, its Skill documentation. Rollback is the task-owned diff for those files; evidence directories remain ignored and are preserved for diagnosis. No antivirus exclusion, login state, Hook trust entry, or external configuration is removed or rewritten as part of rollback.
