# Design: Kaspersky-safe GPT Pro watcher launch

## Confirmed trigger surface

The production launcher currently builds a UTF-16LE Base64 command, starts
`powershell.exe` with `-ExecutionPolicy Bypass -EncodedCommand`, and hides the
child window. The watcher also launches its adapter with `ExecutionPolicy
Bypass`, and one mutex test launches another encoded child command. This is the
smallest shared surface that matches the repeated behavioral detection.

## Minimal change

1. Replace `ConvertTo-EncodedWorkerCommand` with one argument builder for the
   existing worker entry point.
2. Launch the same script through `powershell.exe -NoProfile -NonInteractive
   -File <watcher> worker ...` and keep `-WindowStyle Hidden` only as the
   `Start-Process` option.
3. Remove `ExecutionPolicy Bypass` from the adapter `status` and `wait` calls.
4. Rewrite the mutex test to place its short child body in `$TestDrive` and run
   that file directly instead of encoding an inline command.

No new executable, service, scheduled task, dependency, launcher abstraction,
or security-product integration is introduced.

## Argument safety

Windows PowerShell 5.1 `Start-Process -ArgumentList` ultimately forms one native
command line. The builder will quote only arguments that may contain spaces,
using double quotes. Script and evidence paths are normalized and cannot
legitimately contain a double quote; the builder will reject such an argument
rather than emit an ambiguous command line. UUID, token, numeric, and switch
arguments retain their existing validation and fixed ordering.

The worker token remains an opaque, short-lived local capability. It was already
recoverable from the reversible encoded command line, so direct arguments do
not create a new cross-user secret boundary. The worker continues to compare
only its SHA-256 hash from state before doing work.

## Preserved contracts

- The launcher remains detached and returns immediately with the child PID.
- The existing named mutex remains the sole same-evidence-directory start lock.
- State is written before launch and transitions to `running` only after a PID
  is returned; launch failure remains fail-closed.
- Conversation URL, window runtime ID, Codex task ID, watcher ID, and worker
  token remain bound before polling.
- Normal completion still uses the registered Stop Hook for the same Codex
  task. `-NoWake` remains test-only and never clicks or writes to the Codex
  composer.

## Validation and rollout

Static tests will inspect the captured `Start-Process` arguments and ban the two
removed launch markers. Parser and Pester gates cover Windows PowerShell 5.1.
The live check uses a new isolated evidence directory, a harmless canonical
conversation URL, a deliberately nonexistent window runtime ID, short bounded
timeouts, and `-NoWake`; it can prove process creation and terminal handling
without sending or resuming anything.

Only after project validation will the active user-level Skill be synchronized.
The existing file is copied to a timestamped backup first, then the new file is
copied and both SHA-256 values are compared. Historical worktrees are not
rewritten.

## Residual risk and fallback

`Start-Process -WindowStyle Hidden` is still behavior that antivirus software
may score. If a new detection appears after the encoded command and policy
bypass are removed, stop and collect the exact new Kaspersky event. Do not
broaden exclusions. A signed/native launcher is a separate escalation only if
the minimal direct-file launch is still detected.
