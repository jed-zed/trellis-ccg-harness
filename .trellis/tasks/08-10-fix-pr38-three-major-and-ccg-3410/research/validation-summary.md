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

## Post-acceptance publication revalidation

Captured at: `2026-08-10T22:39:46.3386830Z`

- Published personal CCG source commit `28a428cedbe218cc217d4207f04532c8ac785337` to `gptpro/codex/gptpro-url-first-recovery-source-migrated`; remote lookup returns the exact commit and the source worktree remains clean.
- Default remote-fetch `pnpm run doctor` passed with 18 adapter checks, 0 blocking, and 0 warnings. `pnpm run verify:sources` passed against CCG tree `f935be940641bb0eeb7864602547c6ccc68f6f97`.
- Merged current `origin/main` into the PR candidate. The only new semantic main-side file was the already-aligned Grok local-review permission specification; the personal CCG manifest identity remained unchanged.
- The ordinary parallel CCG test run completed 619 assertions but exited nonzero after two 20-second test timeouts and a Vitest worker `onTaskUpdate` timeout. The two affected files passed 35/35 with one worker; the complete stable one-worker suite then passed 621 tests with 3 skipped and exit code 0.
- CCG lint, typecheck, build, Harness conflicts, doctor, source verification, and both staged/unstaged `git diff --check` passed.
- The first Harness full run was terminated only by the command host's 240-second ceiling. The unbounded rerun passed 452 tests with 3 skipped and 0 failures in 648.6 seconds.

New raw logs:

| File | Bytes | SHA-256 |
|---|---:|---|
| `C:/Users/29933/.fastctx/jobs/j-52f8og/output.log` | 17582 | `b8cacff7f8f79b92afd0163c8430f77a7bf53c9b495733aee8f7bfa404b60bfb` |
| `C:/Users/29933/.fastctx/jobs/j-2ivux7/output.log` | 41002 | `b876bde568a2b1c2f63dfe2103ffd54f7e33a4ea8cde191e2dc16b7ae8dd6e65` |

The prior M1/FINAL Provider advice remains historical evidence for implementation commit `349cdc4`. Publishing a new PR head changes the identity bound by AC8, so PR #38 remains Draft until the new head, CI, and final Provider gate are revalidated.

## FINAL acceptance ledger for the reviewed product head

Captured at: `2026-08-11T01:10:36Z`

- Reviewed product/CI head: `33b00ccd98c2da6bb312b75715fc95eeed3791e6`
- Tree: `cef8b6b17ca014542791ddc747cbd3e4a5534360`
- PR base: `7059785bfe4790e9ecd4f91396ca9f09cce1fdf1`
- Diff SHA-256: `9bf7c070a5d4be32737497b33ebd137c8eb0decd6f679cc58930bcd58b92c730`
- Required checks: `10/10` successful; PR is `MERGEABLE` and `CLEAN`.
- FINAL Product Manager review: `accepted`; fresh Boss response recorded at `stateRevision=12`.

This identity covers the reviewed product and CI tree. The following task-only evidence commit will move the branch head; its exact head/tree/diff and CI are re-captured from the GitHub PR after push rather than claimed self-referentially inside that same commit.

- AC1: passed — CCG `3.4.10` source `28a428ce` / tree `f935be94`; required histories remain reachable.
- AC2: passed — supported Harness lifecycle, exact manifest/source identity, default remote doctor and `verify:sources` all green.
- AC3: passed — direct fourth/seventh `run-root` denial occurs before adapter/browser work.
- AC4: passed — batch claim handoff is single-count, identity-bound, proof-released, and recovery-retaining.
- AC5: passed — both bridge copies use atomic response replacement; fault/replay and content-conflict tests passed.
- AC6: passed — PR39 Provider permission contract is aligned without weakening canonical authority, no-fallback, or hard gates.
- AC7: passed — focused/full CCG and Harness gates, parse, conflicts, doctor, source verification and diff checks are green on the recorded runs.
- AC8: passed for the reviewed product head above; the task-only evidence head must be re-signed after push.
- AC9: passed — M1 and FINAL advice were presented and received fresh Boss acceptance; FINAL acceptance is recorded at state revision 12.
- AC10: passed so far — only authorized source/PR pushes occurred; PR remains Draft, with no merge or global install.

Accepted verification limit: the Product Manager snapshot excludes `.agents/` and the plugin copy, so AC3/AC4 implementation review relies on the explicit contract plus `304/304` Pester and `ROOTWAIT_CAPACITY_SMOKE_OK` evidence. Boss accepted FINAL with this limitation disclosed; live ChatGPT E2E remains separately authorized and out of scope.
