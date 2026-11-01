# Repair retained waiter and startup anomalies

User explicitly requests diagnosis and repair of the two anomalies from archived 10-23-bridge-concurrency-focus. Preserve commits, diagnostic edits and original failure evidence. No commit, push or global installation overwrite; no Pro tests and no safety recovery bypass.

Acceptance: reproduce the actual failing boundary for the missing watch-state error and correct the shared cause with bounded reads; permanent absence/corruption and identity violations must still fail. Attribute the Python foreground event using available process/command evidence, repair the owned launcher where proven, and verify startup without foreground activation. Do not invent historical causation. Use offline tests first; any necessary real send must use explicitly selected non-Pro mode and a new independent request. Original completed requests must never be resent.

Evidence remains under .ccg/bridge-concurrency-focus/anomaly-repair; original continuous-focus-active evidence is immutable. Root owns integration, task records and final gates. Waiter worker owns watcher script/tests only; Python worker initially owns diagnostic artifacts only.

## Confirmed diagnosis and repairs

The watcher had a shared File.Exists precheck outside its existing five-attempt read budget. A temporarily absent state therefore terminated RootWait without trying the existing bounded read path. The repair reads directly and handles persistent missing files only after the existing budget; malformed data and identity/deadline/recovery checks remain unchanged. Offline red/green evidence demonstrates the mechanism, not the unidentified historical filesystem cause.

The original foreground HWND still maps to Python PID48488, whose creation time precedes the capture and whose parent is Serena PID75704. Its multiprocessing command and Serena startup log identify the native Dashboard viewer. Installed pywebview WinForms code shows hidden windows still pass through Show then Hide. No bridge Python invocation caused this window. The project .codex/config.toml now appends supported --enable-web-dashboard false to Serena startup; MCP remains enabled. This setting applies on the next project MCP startup, without replacing the global installation or restarting the user's existing process. The isolated MCP test will validate this same option separately.

## Completion

Waiter fix passed targeted red/green reproduction, then all 141 watcher tests on PowerShell 7 and all 141 on Windows PowerShell 5.1. Evidence: .ccg/bridge-concurrency-focus/anomaly-repair/waiter/{red-corrected,green-ps7,full-ps7,full-ps51}.xml. Initial fixture/test failures remain retained. No retry budget, terminal proof, identity, deadline or resend policy was relaxed.

Python attribution is recorded in anomaly-repair/python/process-provenance.json and README.md. The isolated new Serena instance with the project startup option completed initialize/tools-list (23 tools) and exited normally without spawning the native viewer. All owned experimental processes exited; original MCP/viewer processes were preserved. Foreground samples showed no transition in the successful run (179 samples, maximum gap 2666ms); mechanism removal and process evidence support the fix, not a claim of arbitrarily fine continuous coverage. First fixture failure (missing projects key) was retained and corrected only in a separate second attempt. An unrelated Chrome transition in the failed fixture run belongs to a different chrome-devtools-mcp process tree.

Codex mcp get confirms the project override is effective and Serena remains enabled. The optional dashboard is disabled only for new instances in this repository. Existing sessions were not restarted. No model or browser calls were made, including zero Pro use. No global installation/configuration, original failed request, diagnostic task or prior commit was changed. The four observer additions and earlier task archive remain preserved.

Root reviewed the integrated diff and scoped whitespace check. Default conflicts passed 19 pass/2 info/0 warnings/0 blockers before archive; source snapshot/manifest were unchanged and their previous default verification remains applicable. All requested local repairs are complete, with next-start application of the Serena setting explicit. No commit or push is authorized.

Post-archive ordinary conflicts passed: 17 pass / 3 info / 0 warnings / 0 blockers. Final direct-byte preservation passed all baseline groups and the five copied original anomaly/recovery artifacts; HEAD remains 23cf90f and the index is empty.
