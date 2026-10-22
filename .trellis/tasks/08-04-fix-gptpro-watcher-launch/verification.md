# Verification

- Windows PowerShell 5.1 parser and UTF-8 BOM checks: pass for watcher and tests.
- Project Skill Pester 5.7.1: 135 passed, 0 failed.
- Active user-level Skill Pester 5.7.1: 135 passed, 0 failed.
- Isolated real watcher `-NoWake` smoke: nonzero PID, bounded `probe-failed`
  terminal state, no prompt send, no Codex continuation.
- Static forbidden-launch scan: no `EncodedCommand`, `ExecutionPolicy Bypass`,
  or legacy encoded-worker helper matches.
- CCG security scanner: pass for watcher and watcher tests, zero findings.
- Antigravity `gemini-3.1-pro-high` review: `SUCCESS`, verdict `Pass`, no
  blocking or major findings; two minor path/input concerns were verified as
  unreachable through production validation.
- `git diff --check`: pass.
- Harness tests: 445 passed, 3 skipped, 0 failed.
- CCG tests: 583 passed, 1 skipped, 0 failed; lint, typecheck, and build pass.
- Harness doctor, source verification, and conflict audit: pass; conflict audit
  reports 0 blocking and 0 warning.
- Active Skill backup:
  `C:\Users\29933\.codex\backups\chatgpt-pro-sidebar\20260804-095132`.
- Project and active watcher SHA-256:
  `9E7FB9F346D397015381F2F1B05C645B79950C593BC5F0F8FC654B14DEC6DD4C`.
- Project and active watcher-test SHA-256:
  `41A767416E1C065FB395A6ECC6DC0B93D7E81F86479F8EAD1AF48DC37F9F4788`.

## Active user-level Kaspersky smoke

- At 2026-08-04 10:16 local time, the active watcher under
  `C:\Users\29933\.agents\skills\chatgpt-pro-sidebar` started as PID `62816`
  with `-NoWake`, a nonexistent window runtime ID, and bounded timeouts.
- It reached the expected `probe-failed` terminal state after two observations;
  the process exited, `automaticResendAllowed=false`, and no continuation was
  registered.
- The watcher remained present and byte-identical with SHA-256
  `9E7FB9F346D397015381F2F1B05C645B79950C593BC5F0F8FC654B14DEC6DD4C`.
- Kaspersky `avp.com REPORT SW2 /RA` succeeded. Its complete System Watcher
  report contains no PID `62816` and no new watcher detection after the existing
  08:56:10 event for an old worktree copy. The visible protected alert is the
  pre-existing event, not a new event from this smoke.
- The old exclusion checksum is different, so its checksum condition does not
  match the active watcher. The exclusion was left unchanged.
