# PR #55 historical baseline compatibility

Authorized direct fix: the user asked to fix the reviewed P2 (2026-11-06 parent delegation). Start from PR head 2d986bdb77fbe431a4c11cdc737c9c2b989b0ea3. Do not merge, publish, install, send a model request, or rewrite existing task evidence.

## Requirements and plan

- Keep formatted reply extraction and unchanged composer fingerprints. New browser rounds identify structural hashes as dom-agent-turn-v2.
- Old dom-agent-turn-v1 records validate against their original sanitized plain-text traversal. This draft also used v1 for structural text, so v1 may match either complete ordered baseline representation, never arbitrary per-turn mixtures. New v2 rounds must not use the legacy fallback. Unknown versions fail closed.
- Derive a bounded legacy comparison value from the same owned, sanitized DOM clone. Keep Content/ContentSha256 as the new formatted result; use the legacy hash only in explicitly allowed historical comparisons. Never edit persisted baseline hashes to make a check pass.
- Cover user acknowledgement and assistant isolation in wait, and exact-prefix checks in reextract. Preserve URL/thread/target/claim, truncation, deadline, no-resend and immutable-source checks.
- Preserve independent receipt-import validation: record observed matching historical hashes for the prefix/prompt and the structural hash for the new response. Exercise the existing bundled Python importer without editing the frozen component; explicitly provision its Python runtime in sidebar CI.

Sequence: add failing regressions; update extraction metadata and version-aware matching at the shared boundary; update the existing browser contract; run focused regressions, all sidebar Node/Pester suites, conflict audit and relevant root contracts. Reuse unchanged component CI evidence rather than rebuilding unrelated bundled code.

## Acceptance

- Legacy concatenated v1 baselines and prior draft structural v1 baselines recover; v2 and empty/new-session baselines recover without fallback.
- Saved hashes remain unchanged, returned text keeps paragraph/list boundaries, and reextract never changes original artifacts or sends anything.
- Changed/reordered/missing baselines, extra appended turns, mixed-format baselines, v2 structural changes, unknown versions, unavailable/oversized legacy text, wrong prompt and URL/target ownership remain rejected.
- Check exact PR refs before implementation and delivery; record scoped changes and test results here. The initial repair phase did not authorize push; the later user-authorized PR delivery scope is recorded below. Merge and release remain excluded.

## Completion

Implementation complete locally on `fix/pr55-baseline-compat`, based on PR head `2d986bdb77fbe431a4c11cdc737c9c2b989b0ea3`. New rounds use v2; old v1 concatenated and draft structural baselines both recover. Matching retains the longest unchanged ordered baseline and never mixes hash representations within it. Version checks, bounded legacy extraction, original evidence, ownership locks, response deadline and no-resend behavior are preserved.

Reextraction receipts use hashes from the observed representation that actually passed the historical comparison. This also fixes downstream import, without changing the bundled CCG source or relaxing its checks. Formatted response output remains unchanged. The maximum 200-turn mismatch probe dropped from 2548 ms to 67 ms after computing hash arrays once; this is a local diagnostic, not a performance guarantee.

Verification evidence lives in `../review-evidence/` relative to the repository:

- Original-head control: two expected legacy wait/reextract failures and six passing structural/new-session controls (`baseline-original-head-control.log`). The intermediate receipt control also reproduced the legacy-only importer rejection (`baseline-importer-red.log`).
- Final focused regressions: 22/22, including all four old/new wait and reextract modes, immutable source files, rejected altered/reordered/missing/mixed baselines, unsupported versions, extra replies, invalid legacy metadata, wrong prompt/URL, and unchanged independent importer acceptance plus tamper rejection (`baseline-focused-final.log`).
- Final complete sidebar Pester: 499/499, no failures or failed containers, Pester 5.7.1 / PowerShell 7.6.9 (`pester-fix-final-summary.json`, `pester-fix-final.log`). Node DOM/composer suites: 59/59 on Node 24.14.0 (`node-fix-final.log`). Final CI/adapter/skill contracts: 50/50 (`root-contracts-final.log`).
- Deterministic conflicts: 16 passed, zero blocking/warnings (`conflicts-fix-final.log`). Scoped diff whitespace check passed. The six-file patch, including the new test file, passes forward application against original-head files and reverse application against the final working tree (`PR55-baseline-compat.patch`).
- Full root Harness: 590 total, 589 passed, zero failures, one Windows-inapplicable AGENTS permission-mode case skipped, 1803 seconds (`harness-fix-final.log`). This run started before the final receipt/cache refinement; final behavior was separately rerun through the complete sidebar suite, unchanged independent importer and 50 root contracts above. It is not presented as an immutable-final-snapshot run.

Delivery recheck: local HEAD and remote PR #55 head both remain `2d986bdb77fbe431a4c11cdc737c9c2b989b0ea3`; PR remains open/draft/unmerged. The only product changes are two scripts, two test files, sidebar CI Python setup and the browser contract. The CCG snapshot and source manifest are unchanged. Acceptance is satisfied with no blocking local checks; retain the local patch and test logs for handoff.

Limits: offline DOM fixtures and mocked observation, no live ChatGPT request or daily installation. Existing deadlines and bounds still apply. Old v1 retains its original text-hash proof strength; new v2 cannot use the compatibility fallback. The initial repair handoff had no commit or push. Remote CI on the original PR head is previous evidence, not CI for this patch.

## Authorized PR delivery follow-up

The user subsequently requested updating the remote PR. This explicitly authorizes committing and pushing the verified repair to PR #55, superseding the initial local-only delivery boundary. It does not authorize approving, merging or releasing.

Preflight revalidated the open draft PR branch `fix/gptpro-dom-20261009`, head `2d986bdb77fbe431a4c11cdc737c9c2b989b0ea3`, and local branch `fix/pr55-baseline-compat` at the same commit. The saved six-file product patch still reverse-applies exactly; the remaining untracked files belong only to this task record. Reuse the completed runtime verification above because product code has not changed since it ran.

Delivery plan: commit only those six product files and this canonical task record, push by fast-forward to the existing PR branch without force, update the PR description to match the complete change, then inspect the resulting commit and its exact-head remote checks. A moved remote branch must be inspected before integrating or retrying. GitHub PR/commit/Actions records are authoritative for the final delivery and CI outcome.
