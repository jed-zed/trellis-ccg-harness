# Silent background recovery evidence

## Confirmed implementation behavior

- `Get-LiveFocusState`, `Test-FocusRestoreAllowed`, and `Restore-FocusState` preserve focus only when the current top-level UIA identity is still either the automation target or the original top level. If the user moves to a third application, restoration is skipped (`chatgpt-pro-sidebar.ps1:1330-1403`).
- Panel recovery wraps `TogglePattern`, `SelectionItemPattern`, or `InvokePattern` activation in that best-effort focus restoration (`chatgpt-pro-sidebar.ps1:1846-1879`). The action itself can still cause a transient focus or foreground change; restoration is not isolation.
- Exact URL fallback explicitly calls `SetFocus()` on the address control and may select its text before restoring focus (`chatgpt-pro-sidebar.ps1:2106-2139`). This path is incompatible with a strict no-observable-focus-change background contract unless bypassed or deferred.
- Composer preparation uses `ValuePattern.SetValue`, while new-chat and send use one `InvokePattern.Invoke` wrapped by race-aware restoration (`chatgpt-pro-sidebar.ps1:2160-2187`, `2731-2757`, `2887-2969`). Each concrete action needs live evidence that it does not activate the target window before it can be classified background-safe.
- `Invoke-LiveDesktopWake` calls `Start-Process codex://threads/<thread-id>`, writes the main Codex Desktop composer, and invokes its submit control without the normal focus-preservation wrapper (`chatgpt-pro-sidebar.ps1:2349-2448`). It can activate or switch the user's current Codex task and is excluded from silent recovery.
- Existing deterministic tests cover race-aware focus restoration and reject `SetForegroundWindow`, synthesized input, clipboard, browser drivers, CDP, cookies, tokens, and internal HTTP (`chatgpt-pro-sidebar.Tests.ps1:901-915`, `1009-1019`). They do not prove that panel/navigation patterns remain background-safe in a live Codex build.

## Identity boundaries

- `conversationUrlBound` is the durable ChatGPT conversation identity. It does not identify which Codex top-level window may be mutated.
- `windowRuntimeId` is an ephemeral UIA action/observation lock. If the original top-level target remains, it is the only eligible automatic recovery surface.
- `CODEX_THREAD_ID` scopes watcher registration and Stop Hook continuation to one Codex task, but it does not bind a ChatGPT URL to a UIA window.
- The global adapter mutex prevents concurrent adapter actions; it does not prevent a user from operating another Codex window and does not authorize replacement-window selection.

## Planning decision

Silent recovery is capability-gated, not assumed:

1. Passive observation may continue while the exact bound surface is readable.
2. Before any recovery mutation, re-prove the frozen target and sample the focused top-level UIA element.
3. Permit only a uniquely proved in-app UIA action whose live smoke shows zero foreground/focus change for the current Codex build.
4. If the user moves focus between proof and action, or the action requires `SetFocus`, activation, deep linking, app launch, or another Codex window, defer and persist a pending/manual recovery state.
5. If the original top-level window disappeared, never repurpose another existing Codex window. A replacement surface is automatic only if Codex exposes a separately proved target-isolated, background-safe in-app creation/navigation action.
6. `send-intent` and `send-uncertain` recovery remains read-only observation and never resends.

## Minimum validation additions

- Background observation does not change foreground/focused top-level identity.
- URL recovery within the still-bound target records a new browser-surface RuntimeId, exact URL, and zero send/new-chat invocations.
- A user in another Codex task causes recovery mutation to defer; that task's panel, URL, composer, and focus remain unchanged.
- A focus change between proof and action prevents both the action and focus restoration.
- Target-window loss with another Codex window present does not select, navigate, or mutate the remaining window.
- Missing background-safe navigation produces a pending/manual recovery category without `codex://`, Desktop Wake, app launch, default URL handler, synthesized input, or external browser fallback.
- A live smoke is required before labeling any UIA recovery action background-safe; fixtures prove state logic only.
