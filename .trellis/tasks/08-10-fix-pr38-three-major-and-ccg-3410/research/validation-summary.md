# M1 validation summary

Captured at: `2026-08-10T21:35:55.0745285Z`

## Result

All engineering gates required before the M1 Product Manager review passed. PR #38 remains Draft and no source, Harness, or PR branch was pushed.

## Focused checks

| Check | Result |
|---|---|
| PowerShell parser: sidebar scripts and Pester files | passed |
| `node --check`: fixed agent-browser scripts | passed |
| `python -m py_compile`: both bridge copies | passed |
| RootWait capacity smoke | `ROOTWAIT_CAPACITY_SMOKE_OK` |
| Pester 5.9.0 sidebar suite | 304 passed, 0 failed, 0 skipped |
| GPT Pro bridge Vitest, single worker | 59 passed, 0 failed |
| Product Manager state/concurrency/e2e | 25 passed, 0 failed |
| Harness adapter/lifecycle/gates/source focused suite | 70 passed, 0 failed |

The first ordinary Vitest invocation completed all 59 assertions but exited nonzero after a worker RPC `onTaskUpdate` timeout. Re-running the same file with one worker and no file parallelism passed 59/59 with exit code 0; this is recorded as runner isolation, not a waived test failure.

## Full gates

| Gate | Result |
|---|---|
| `pnpm ccg:lint` | passed |
| `pnpm ccg:typecheck` | passed |
| `pnpm ccg:test` | 621 passed, 3 skipped, 0 failed |
| `pnpm ccg:build` | passed |
| `pnpm harness:test` | 452 passed, 3 skipped, 0 failed |
| Harness doctor with explicit clean authoritative checkout | passed; 18 adapter checks passed, 0 blocking, 0 warning |
| `pnpm harness:conflicts -- --ci` | 16 passed, 0 blocking, 0 warning, 4 info |
| `verify-sources.ps1 -AuthoritativeCheckout ...` | passed; CCG 3.4.10, exact commit/tree |
| `git diff --check` and staged diff check | passed |

The default remote-fetch doctor mode cannot fetch the intentionally unpushed source commit and exits nonzero with `not our ref`. The supported explicit-clean-checkout mode passed; publishing the source remains outside M1 authorization.

## Durable raw logs

Raw logs are ignored under `.ccg-evidence/m1/logs/`.

| File | Bytes | SHA-256 |
|---|---:|---|
| `ccg-full.log` | 26746 | `aebe1aa166cd0076944cf7376203b362853573dea3e9fbfb3fa103fb9576dc85` |
| `doctor-local-authority.log` | 3101 | `55aa3a703a06f8998f39a94c555c1bf1594d8e38df43b222a7e87b04829699db` |
| `harness-full.log` | 40940 | `070a28a607cf057562483e3b1d300c395ffbb97bccaf5b60a04686b9a98c6198` |
| `pester-5.9.0.log` | 29552 | `c243a3bf0f8fa8b05760d12faaf535867735b190a470beb14bd59fbbde06d45b` |

Pester was downloaded only to the task-local ignored evidence directory after fresh Boss authorization. Installed manifest: `Pester 5.9.0`, SHA-256 `a35b3320360821222bf138906af05fb7d4474ae2f24f5840bd53c15f144ccb9e`. No global module or profile was modified.

## AC ledger before Product Manager review

- AC1: passed — source 3.4.10, plugin 3.4.10+codex.1, both required histories reachable.
- AC2: passed — supported Harness lifecycle and exact source/manifest/doctor verification.
- AC3: passed — direct fourth/seventh capacity denial occurs before adapter/browser invocation.
- AC4: passed — batch handoff single-count, identity fail-closed, proof-gated release and recovery retention.
- AC5: passed — atomic response replacement and fault/replay tests in both bridge copies.
- AC6: passed — PR39 permission contract aligned without canonical-authority or gate relaxation.
- AC7: passed — all listed parse, focused, full, doctor, conflict, provenance and diff gates green.
- AC8: implementation commit/tree and current remote state are signed above; the M1 Provider invocation separately binds the tracked evidence projection and full current snapshot. Any later product-code or source-tree change invalidates these digests.
- AC9: pending — M1 Product Manager review, presentation, and fresh Boss response.
- AC10: satisfied so far — PR remains Draft; no push, publish, Ready, merge, or global install.
