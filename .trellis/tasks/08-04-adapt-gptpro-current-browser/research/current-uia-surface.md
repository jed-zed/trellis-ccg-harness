# Current Codex bottom-browser UIA surface

## Initial baseline evidence

- Rechecked after implementation approval on 2026-08-04 against Codex package `OpenAI.Codex_26.730.7989.0_x64__2p2nqsd0c76g0`; host executable file/product version `151.0.7922.71`.
- Host process: `ChatGPT.exe`, PID `21352`, top-level HWND `133222`, class `Chrome_WidgetWin_1`, visible rectangle `1280 x 820`.
- Chromium accessibility content is bridged into Windows UIA under the host process; descendant controls commonly have `NativeWindowHandle=0`.
- With the bottom panel collapsed, the exact UIA button `切换底部面板显示` exposed `TogglePattern=Off`. It was toggled once to `On` through the allowed UIA recovery pattern.
- With the bottom panel open, the visible root still contained one `Document` named `Codex` with `AutomationId=RootWebArea`.
- The panel exposed one selected `TabItem` named `C:\Program Files\PowerShell\7\pwsh.exe` plus `Terminal input`; it did not expose a browser tab or browser web document.
- The visible main `Edit` is now named `Do anything`, class `ProseMirror`. It is the main Codex composer and is not sufficient evidence of a ChatGPT composer.
- No independent bottom-browser `Document`, address `Edit`, URL value, browser tab, or other stable UIA element exposing `https://chatgpt.com/` was found.
- Visible browser-related controls included `切换底部面板显示` and `在外部浏览器中打开`, but invoking the external-browser control would violate the active Skill boundary and was not attempted.
- Project and user adapter SHA-256 values matched: `378dca98a257c62709477bf25b95978c6fe0968470594e17efea860c6a044234`.
- Adapter `status -NoPanelRecovery -NoFocusRestore` failed closed with exit `21`, category `EmbeddedDocumentMissing`, after the panel was opened.
- No prompt was written or submitted during discovery. No idempotency reservation or watcher registration was created.
- The final cleanup check found the bottom-panel toggle already back at `Off`; no additional UI action was issued.

## Validation evidence

- PowerShell parser gate: 5 files passed.
- Project-local Pester `5.7.1`: 140 tests discovered, 140 passed, 0 failed, 0 skipped after the compatibility change.
- The passing tests prove deterministic adapter, watcher, Stop Hook, replay, acknowledgement, idempotency, URL validation, response evidence, and forbidden-transport contracts. They do not prove a live ChatGPT interaction.

## Post-update Raw View evidence

- A bounded re-probe after the user reopened ChatGPT found the current browser surface only in Windows UI Automation Raw View.
- One visible `Document` named `ChatGPT` exposed `AutomationId=RootWebArea` and canonical `https://chatgpt.com/` through `ValuePattern`; one visible composer exposed `AutomationId=prompt-textarea` and name `与 ChatGPT 聊天`.
- The minimally updated adapter then returned live `status` exit `0` with `ready=true`, one embedded document, one address control, one composer, one Pro indicator, no login/security barrier, and `urlAllowedForChat=true`.
- Subsequent repeated probes after Codex UI rerenders were not stable: one run exited `99`, then bounded runs exited `21 EmbeddedDocumentMissing` in 31-45 seconds.
- Safe follow-up probes found two visible Codex top-level surfaces under `ChatGPT.exe` PID `21352`. Each exposed one browser address control, but neither address nor any document exposed a canonical ChatGPT URL and neither exposed a ChatGPT composer. No prompt was sent.
- Codex-native `open_in_codex` requests for `https://chatgpt.com/` returned `queued`; navigating back to this task did not make the page appear in the live UIA tree during the same turn.
- The external CCG review route could not start its required Grok diagnostic because `grok` is not installed (`spawn grok ENOENT`, exit `4`). The separately configured Antigravity frontend review completed read-only with no blocking findings.

## Probe hygiene note

The first diagnostic name filter was too broad and matched unrelated local Codex UI text. Its output stayed in the local tool channel and was not written to the task evidence or sent to any external Provider. The probe was immediately narrowed to exact control names plus documents, edits, tabs, and canonical ChatGPT URL values before the final capability decision.

## Consequence

The approved Raw View capability is live and the shared UIA compatibility path now reaches it without desktop-wide enumeration. The task remains in progress only because Codex Desktop must load and explicitly trust the exact new Stop Hook before a one-shot live send can safely prove same-task continuation.

## Prohibited fallback

Do not introduce coordinates, OCR, screenshots, synthetic input, clipboard, browser drivers, CDP, internal browser APIs, external browser control, cookie/token access, or profile inspection.

## Final execution probe

- The prior all-desktop descendant scan could block indefinitely in an unrelated UIA provider. A process-scoped probe completed in about three seconds and showed one visible `ChatGPT` top-level window with 990 descendants, one `Document` named `Codex`, and no independent ChatGPT document, address control, canonical URL, or ChatGPT composer.
- The adapter now uses the shallow non-authoritative product marker (`ChatGPT` or `Codex`) before running bounded descendant discovery. The descendant `Codex` document remains the independent proof; the product marker alone cannot select an acting window.
- `status -NoPanelRecovery -NoFocusRestore` completed in 1.876 seconds with exit `21`, category `EmbeddedDocumentMissing`. The focused top-level RuntimeId was identical before and after the probe.
- Parser validation passed for 5 files; project-local Pester 5.7.1 discovered and passed 158 of 158 tests with 0 skipped.
- The current live capability gate therefore remains blocked. No panel, URL, composer, send, new-chat, watcher, or application-launch action was performed.

## Root-window enumeration fix and current gate

- A staged live probe isolated the remaining delay to desktop-wide `AutomationElement.RootElement.FindAll(TreeScope.Children, ...)`; an unrelated desktop UIA provider could block that call for more than 12 seconds.
- Resolving only bounded native main-window candidates by handle completed in 1.2 seconds. The handle is a non-authoritative hint: selection still requires the descendant `Document` named `Codex` and all existing RuntimeId, cardinality, URL, composer, Pro, login, security, and generation checks.
- After this root-cause fix, `status -NoPanelRecovery -NoFocusRestore` completed in 2.6 seconds with exit `0`, `ready=true`, exactly one Codex window, ChatGPT document, address control, composer, and Pro indicator, no barrier, idle generation, and canonical `https://chatgpt.com/`.
- Parser validation passed for 5 files; project-local Pester 5.7.1 passed 158 of 158 tests; the CCG security scanner reported 0 findings; Harness conflicts reported 0 blocking and 0 warnings.
- The exact user-level Stop Hook command and timeout `7500` are now present in `C:\Users\29933\.codex\hooks.json`, and the handler exits successfully with no registration. Codex Desktop has no trust record for this new Stop Hook yet. No prompt, new chat, idempotency reservation, or watcher registration was created before that manual trust gate.

## First live E2E attempt after Hook trust

- Codex Desktop recorded trust for the exact Stop Hook and timeout, scoped to current task `019fcfe6-0b04-7da0-b347-577e80ce7320`.
- The preflight returned `ready=true` against RuntimeId `42.787626`. One UIA New chat invoke returned `NewChatUncertain` after the former six-second proof horizon; the driver stopped before send and watcher launch.
- A later read-only status proved that the one action had succeeded: the canonical URL was `https://chatgpt.com/`, `urlExact=false`, the composer was empty, and generation was idle. The evidence directory remained empty and the unique idempotency key was unused.
- The adapter now treats an already-proved fresh root as an idempotent New chat success with zero Invoke and uses a bounded 15-second post-action proof horizon. Two new regressions cover both behaviors.
- The next preflight then failed closed with `EmbeddedDocumentMissing` before any UI action. PowerShell 7 and Windows PowerShell 5.1 returned the same result, confirming that the ChatGPT document disappeared from the live UIA tree rather than a runtime-specific failure.
- Parser validation passed for 5 files; project-local Pester 5.7.1 passed 160 of 160 tests; security scan found 0 findings; Harness conflicts reported 0 blocking and 0 warnings. No test prompt has been sent and no watcher registration exists.

## 2026-08-05 bounded traversal repair and current gate

- The previous Raw View helper called descendant `FindAll()` before checking its
  result count. A provider could therefore block before the advertised 10,000
  element limit was evaluated. It now uses incremental `RawViewWalker` traversal
  with a 10,000 visited-element limit and a five-second deadline.
- Repeated selectors originally made a fresh Raw View traversal for every name or
  control-type query. One read-only traversal of the current 734-element surface
  took about 1.751 seconds, making a full status exceed its ten-second outer
  bound. The adapter now reuses one in-memory element snapshot per exact
  root/walker/scope and clears it whenever `Get-LiveCodexWindow` starts a new
  top-level resolution.
- Candidate discovery no longer uses one `MainWindowHandle` per process. Candidate
  process IDs build a UIA `TreeWalker` view, and all matching top-level elements
  continue through document, RuntimeId, visibility, cardinality, and focus proof.
- Bottom-panel target selection now requires a unique finite toggle-to-ExpandPanel
  row relation before reading the selected toggle's pattern. ToggleState no longer
  chooses the target.
- Parser validation passed 5/5. Project-local Pester 5.7.1 passed 170/170 with no
  failures or skips. The local security scanner examined the two changed
  PowerShell files and found no findings; Harness conflicts remained 0 blocking
  and 0 warning.
- One post-cache status finished in 5.071 seconds with exit 21 /
  `EmbeddedDocumentMissing`. Five further ten-second-bounded reads all completed:
  four returned `EmbeddedDocumentMissing` and one transiently returned
  `CodexWindowMissing`. No UIA action path ran.
- Four repeats kept the same focused top-level RuntimeId. One repeat observed an
  ambient change between two Codex RuntimeIds while the adapter was read-only;
  this is not causal proof against the adapter, but it prevents any
  background-safe or live-E2E conclusion.
- Preserved evidence from 2026-08-05T04:09:25.8173364Z remains `send-intent` with
  `invokeAttempted=false`, no bound conversation URL, and
  `automaticResendAllowed=false`. A durable global idempotency reservation exists.
  No watcher, callback, response, or acknowledgement exists, and the attempt must
  not be retried or bypassed.

The current outcome is therefore deterministic repair verified, live ChatGPT UIA
surface still unavailable, and full bridge E2E still unverified.

## 2026-08-05 top-level filtered-walker timeout repair

- A fresh live status failed before document discovery with exit 20 /
  `TopLevelWindowTraversalTimeout` at the five-second bound. The process-filtered
  `TreeWalker` was the only top-level provider call on that path.
- A filtered UIA walker can flatten matching descendants into its view, so
  `GetFirstChild(AutomationElement.RootElement)` may perform a deep provider
  search instead of enumerating desktop direct children.
- Top-level discovery now uses `RawViewWalker` for direct children and applies
  the existing candidate ProcessId HashSet in the bounded walk condition. The
  512-element/five-second limits and later visibility, Codex-document,
  RuntimeId, focus, and uniqueness proofs are unchanged.
- The focused adapter suite first failed 119/120 on the new source contract,
  then passed 120/120 after the minimal change. A separate top-level deadline
  regression also passes.
- Two read-only live status runs completed within the outer 20-second bound and
  both reached exit 21 / `EmbeddedDocumentMissing` with zero visible/geometric
  ChatGPT document candidates. No panel recovery, focus restoration, new chat,
  send, watcher, callback, or acknowledgement ran.
- The top-level traversal timeout is fixed. The current live acceptance gate is
  now the independently missing ChatGPT UIA Document, so full bridge E2E remains
  unverified and no prior uncertain send may be retried.

## 2026-08-05 continuation evidence

- The surface temporarily returned and produced a fully ready root preflight on
  RuntimeId `42.787626`. A no-send recovery observation preserved both the
  focused top-level and focused-element RuntimeIds.
- A single new harmless send reached `InvokePattern.Invoke()` and returned from
  that call, but exact URL capture timed out. Durable state is
  `send-uncertain`, the URL is unbound, and automatic resend is prohibited.
- After the panel closed, Raw View exposed one exact SidebarToggle in Off state,
  no `ExpandPanel`, and no Browser control. This proved the former requirement to
  relate the toggle to `ExpandPanel` before opening was impossible in the fully
  closed state.
- The selector now admits only the sole exact toggle when `ExpandPanel` is
  absent; multiple toggles still fail, while the structural relation remains
  required whenever `ExpandPanel` exists. The focused suite passed 119/119.
- The latest Codex top-level record had a non-finite rectangle and was not an
  eligible acting window. Manual restoration is therefore required before a
  hash-only, no-send adjudication of the uncertain submission.
