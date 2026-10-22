# Fix GPT Pro watcher launch false positive

## Goal

Stop Kaspersky `PDM:Trojan.Win32.Generic` heuristic alerts caused by the GPT Pro
sidebar watcher's PowerShell launch shape, without weakening antivirus
protection or changing the bridge's conversation and continuation safety
contracts.

## Requirements

- Replace the detached worker's Base64 `EncodedCommand` launch with a normal,
  reviewable `powershell.exe -NoProfile -File` invocation.
- Remove unnecessary `ExecutionPolicy Bypass` use from the watcher and its test
  child process. Do not change the machine or user execution policy.
- Preserve a hidden, detached, zero-model watcher that returns one process ID
  promptly and does not display a console window.
- Preserve exact conversation URL, window runtime ID, Codex task ID, watcher ID,
  worker-token hash, mutex, idempotency, Stop Hook, and no-automatic-resend
  behavior.
- Quote direct-launch arguments safely for Windows PowerShell 5.1, including
  paths containing spaces or apostrophes, and fail closed for an unrepresentable
  argument.
- Keep `-NoWake` limited to deterministic validation; normal operation must
  continue through the trusted same-task Stop Hook.
- Update only the canonical project Skill and its tests. After validation,
  back up and synchronize the reviewed files to the active user-level Skill.
- Do not disable Kaspersky, add broad trusted-application rules, trust all
  PowerShell activity, reboot, or click the existing cleanup action.

## Acceptance Criteria

- [x] The production watcher and watcher tests contain no `EncodedCommand` and
      no `ExecutionPolicy Bypass` launch pattern.
- [x] Unit tests prove the detached worker uses `-File`, quotes a spaced path,
      keeps `-NoWake` explicit, and retains one hidden `Start-Process` launch.
- [x] The same-directory launch mutex, active watcher reuse, stale-state
      rejection, exact evidence binding, and Stop Hook tests remain green.
- [x] Windows PowerShell 5.1 parser checks pass for the watcher and tests.
- [x] The complete `chatgpt-pro-sidebar` Pester suite passes with Pester 5.
- [x] A harmless isolated `-NoWake` smoke test starts the real detached worker,
      records a nonzero PID, and reaches a bounded terminal state without
      sending a prompt, resuming a Codex task, or creating a new Kaspersky
      detection.
- [x] The active user-level watcher is backed up before replacement and is
      byte-identical to the validated project watcher afterward.
- [x] Security review confirms no protection bypass was added and no existing
      authentication, browser, command-execution, or continuation boundary was
      weakened.
- [x] Harness conflict audit and relevant repository quality gates pass.

## Notes

- The repeated alert is heuristic evidence, not proof of malware. Prior
  source/hash checks found the active watcher matched the reviewed source, but
  the exclusion did not stop this System Watcher detection.
- Existing Kaspersky exclusions are left unchanged during this task. Removing
  them is a separate cleanup decision after the revised launcher is proven.
- Historical worktrees, temporary copies, and unrelated dirty task artifacts
  are out of scope.
- The active user-level watcher was exercised after its SHA-256 changed away
  from the checksum-bound exclusion. Kaspersky's exported `SW2` report contains
  no event for the smoke PID and no new watcher detection after the pre-existing
  08:56 event, so no exclusion change is needed for this acceptance check.
