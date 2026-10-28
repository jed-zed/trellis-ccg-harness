# Integrated bridge live browser acceptance

User explicitly requested a real-browser acceptance pass after local consolidation, without commit, push, or overwriting global installations. This extends the previously completed local integration with live browser verification; it is not a deployment or a PR review.

2026-10-23 continuation authorization: investigate and fix the two observed blockers, retain diagnostic changes and failure evidence, never bypass safe recovery, then continue real-browser acceptance. Local source fixes and bounded synthetic experiments are now authorized; commit, push and global replacement remain prohibited.

## Scope and execution

Use only the repository's self-contained chatgpt-pro-sidebar scripts and the already connected agent-browser-cli extension. Preserve existing conversations/drafts, diagnostics, global source installations, branch, HEAD and index. Use newly created background ChatGPT tabs with synthetic prompts and explicitly described synthetic attachments. Never access credentials or unrelated browsing data. Do not restart services or resend uncertain requests.

1. Discover the approved connected target, record the baseline and create isolated background acceptance tabs.
2. Verify available thinking strengths and Chinese aliases through set-mode and read-only status, without changing the selected model.
3. Exercise an atomic RootWait request with synthetic UTF-8/code output, independently validate completion and acknowledge it. Exercise an exact-conversation follow-up and original-answer reextraction.
4. Exercise supported synthetic attachment upload and bound send/response; exercise closed acceptance-tab exact-URL recovery and mode-mismatch rejection where safe.
5. Inspect final evidence, source/worktree preservation and report each passing, failed or untested behavior. Do not claim live stress/multi-task concurrency or human focus behavior from mocks.

Evidence belongs under ignored `.ccg/bridge-live-acceptance/`. The main agent owns browser operations and task state. Read-only explorer `live_acceptance_contracts` identifies schemas and safe checks; it has no browser/write authority.

## Acceptance record — not passed

The real-browser pass ran on 2026-10-23 using the repository scripts, Windows PowerShell 5.1 and the existing Chrome extension. The requested all-functions acceptance remains incomplete. No production code was changed to make the tests pass.

### Passed live checks

- Initial discovery/status bound the existing source tab `403437147`, with one composer, Pro selected, no generation/auth barrier and an empty draft.
- On the independently created test tab `403437150`, `set-mode` proved Instant, Medium, High, Extra High and Pro. Chinese aliases 即时/中等/高/极高 resolved correctly. Each result was ready, mode-matched, draft-empty and zero user turns; no focus request was made. This does not prove human-observed operating-system focus behavior.
- UTF-8 synthetic text and an 80-assignment Python block were filled into the test composer without corruption: the live composer digest equals the original prompt digest. Nothing was submitted.
- An explicit Extra High recovery of the original Pro evidence failed safely with `ThinkingModeEvidenceMismatch` (code 28), before page mutation.
- Diagnostic propagation preserved the real failure's exception type, numeric error and allowlisted source line without raw exception text.

### Failures and blocked checks

1. First `new-chat` returned `AgentBrowserOpenTargetUnproved` (code 20) after opening tab `403437150`. A later exact-target status proved the same-profile empty homepage. The initial open return and discovery-window trace were not captured, so delayed discovery is plausible but not established as its root cause.
2. Atomic `run-root` of the synthetic text failed in `Write-Utf8NoBomAtomic` at `chatgpt-pro-sidebar.ps1:446`, `System.IO.File.Replace`, with inner HRESULT `-2147024864` (Windows sharing violation). Its durable phase is `pre-invoke-failed`, `invokeAttempted=false`, `submissionAcknowledged=false`, but `attemptCount=1`, attempt outcome `clicking`, and first-click/deadline fields have already been populated. Source order places the failed state write before the actual click. Live status confirmed the exact original draft, zero user/assistant turns and no generation. Do not clear those fields or manufacture another request identity. Existing `ResumeUnsent` requires zero attempts/empty click evidence, so this request was not resumed.
3. A second `new-chat`, instrumented only by a local CLI logging wrapper, opened tab `403437151`; the real open result and tab enumeration matched after about 2.4 seconds. It then returned `NewChatUncertain` (code 26) because the new homepage inherited the first test's draft. An independent status proved its composer digest equals the text-round prompt digest, with zero turns and no generation. The empty-page guard correctly prevented attachment preparation. No draft was erased and no replacement text request was sent.

No attachment was uploaded, no model answer generated, and no successful send/watcher/completion/acknowledgement occurred. Complete-code response extraction, follow-up isolation, reextraction, closed-conversation-tab recovery, manual-selection recovery and batch concurrency therefore remain unverified live. A synthetic 277-byte ZIP was prepared locally only. The original test prompt remains as a draft in the two acceptance tabs; the original source conversation was unchanged (same URL, Pro, empty composer, one user and one assistant turn).

The initial `run-root` invocation also reported that its evidence directory must already exist; this caller preflight was corrected before reservation/send. That invocation is not a send attempt.

### Preservation and gates

- All 22 bridge source files match the pre-test byte copies. Git status paths, HEAD `bb32c0f`, branch `codex/sync-main-20261021` and empty index stayed unchanged after task initialization. No diagnostic task files or global installation sources were written. No commit, push, install, service restart or cleanup was performed.
- Required live-worktree `conflicts` ran: 18 passed / 2 info / 1 blocking, the already known uncommitted CCG source-tree identity mismatch. The prior fixed-snapshot verification is still recorded in the consolidation task; this run does not erase or bypass the dirty-tree guard.
- Earlier offline tests are unchanged evidence, not a substitute for this failed live pass. No unrelated full test suite was repeated.
- Read-only explorer identified attachment/batch contracts. Worker `newchat_live_failure` ran only offline identity replays and prepared an ignored logging driver; the main agent alone executed browser operations. Diagnostic driver changes no production functions' behavior or outputs beyond recording returned metadata.

Evidence: `.ccg/bridge-live-acceptance/`, especially `text-run-root.json`, `text-round/state.json`, `text-failure-validation.json`, `mode-*.json`, `attachment-newchat.json`, `final-browser-validation.json`, `preservation.json`, and `newchat-diagnosis/newchat-call-log.jsonl`.

Next action: resolve atomic-write sharing failures and reconcile pre-click failure/resume state without weakening exact-once safeguards; investigate cold tab discovery and homepage draft synchronization. Then resume a fresh authorized acceptance pass. Keep this task incomplete until the real send/response and dependent checks pass.

## Completion record — repaired scope accepted, 2026-10-23

The initial failed pass above is retained unchanged as history. The authorized local repairs and the bounded live acceptance in Scope and execution are now complete. This is not global deployment or a claim that every release/stress scenario was exercised.

### Result

- Removed the blanket empty-directory admission check at the user's explicit request. Arbitrary notes and valid upload artifacts coexist with sending. Only actual protocol output collisions and request ownership remain protected; collision handling no longer writes a failure state over someone else's output.
- Corrected atomic replacement reader sharing and bounded sharing-violation retry, staged first-click intent before adopting it, and bounded exact opened-session discovery. The original mixed text failure remains untouched and non-resumable.
- Added explicit same-identity continuation only for the historical directory rejection that proves preparation never started. The real attachment round retained its original directory/key/target/prompt, uploaded once, clicked Send once, preserved the complete prior failure, and completed successfully. No uncertain request was replayed.
- Corrected historical reextraction after a completed same-thread follow-up while retaining active/foreign claim restrictions. Bounded only the reproduced staging rename error, retained atomic publication and failed staging evidence, and made no permission changes.

### Verified evidence

- Final Windows PowerShell 5.1: **452 passed / 0 failed / 0 skipped**, 98.61 s; final PowerShell 7: **452 / 0 / 0**, 49.63 s. Both parsed all 15 PowerShell files. Logs/results: `.ccg/bridge-live-acceptance/integrated-{ps51,pwsh}-final.{log,json}`. Earlier failed invocations remain preserved.
- Unchanged JavaScript bridge: **42/42** tests and nine syntax checks passed in the integrated run; no later JavaScript change invalidated those results.
- Existing fixed validation worktree with final bridge/contracts: `node scripts/harness-adapter.mjs conflicts --ci` exited 0, **14 passed / 5 info / 0 blocking / 0 warning**. Evidence: `.ccg/consolidate-bridge-pr58/bridge-live-acceptance-conflicts-final.log`. The real dirty worktree's earlier source-provenance rejection remains recorded; no staging, commit, manifest falsification or global overwrite was used to clear it. Broader unchanged consolidation checks are reused.
- Live fresh new-chat succeeded. Previous five-strength/Chinese-alias checks remain valid. One fresh text/code round and one exact-conversation follow-up completed and were independently checked and acknowledged. All 40 code rows, Chinese text and indentation matched; the follow-up correctly returned 40 / 820 / 蓝色龙珠-40.
- Live ZIP upload and bound send completed. The answer matched the attachment marker, beadCount 7, 蓝色, and full Chinese sentence. Original upload receipt/ledger/prompt bytes were preserved. The complete directory-rejection state remains in both the frozen backup and `originalPreparationFailure`.
- Live reextraction returned the latest answer, then reopened the closed owned tab at the exact URL and returned identical content. After the claim fix it also selected original response index 0 with the full 40 rows, including one final-version reextraction after rename integration. Four independently verified receipts record zero new model requests and unchanged original artifacts/timestamps.
- Main independently verified state/event/evidence completion, request/thread/watcher/binding identity, required integrity fields, baselines and automaticResendAllowed=false before each acknowledgement. Validators/results are under `.ccg/bridge-live-acceptance/`: `verify-completed.py`, `verify-reextraction.py`, `*-verified.json`.
- Final source tab 403437147 retains its original URL, Pro, empty draft and one user/assistant turn. Original failed tab 403437150 retains its draft and zero turns. Completed attachment tab 403437151 has one user/assistant turn; recovered code tab 403437157 has two. All are stopped. Original diagnostics/failure artifacts, protected unrelated work, and global installation match their correct frozen baselines; `repair-preservation.json` records direct-byte comparisons. Branch `codex/sync-main-20261021`, HEAD `bb32c0f`, empty index unchanged.
- Actual integrated diffs were inspected. The upload helper retains its preexisting CRLF encoding to avoid a whole-file rewrite; CRLF-aware Git whitespace checking passed without changing repository config.

### Limits

Multi-task six-slot stress, manually forced strength-selection recovery, and human-observed OS focus switching were not exercised live; their existing offline coverage is not labeled live proof. Original spontaneous file-lock holders and the first untraced cold-open failure remain unattributed, although the reproduced mechanisms and final required paths are covered. The stalled launcher/no-output incident and all earlier failure/test logs remain evidence, not passes. No commit, push, global install, service restart or unrelated task cleanup occurred.
