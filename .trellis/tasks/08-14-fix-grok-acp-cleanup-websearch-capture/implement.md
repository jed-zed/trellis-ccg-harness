# Implementation Plan — Grok ACP cleanup and one-shot WebSearch capture

## 1. Re-establish exact source provenance

- [x] Re-read this task's `prd.md`, `design.md`, and `implement.md`; load `trellis-before-dev` before source edits.
- [x] Run `node scripts/harness-adapter.mjs context` from the Harness checkout and record that Trellis owns lifecycle while CCG source owns runtime.
- [x] Re-verify the personal remote URL, local `gptpro/main` ref, commit, tree, CCG version, and target-path clean status without altering existing checkouts.
- [x] Create a new clean `codex/fix-grok-acp-cleanup-error-precedence` worktree from the verified personal main ref. Do not reuse `I:/ai/ccg-gptpro-worflow-main-3.4.14`, which contains unrelated user changes.
- [x] Confirm the template and plugin ACP client projections are byte-identical before editing.

## 2. Add failing cleanup-precedence regressions

- [x] Extend the existing ACP client dependency seam so tests can inject deterministic child termination behavior while production defaults remain unchanged.
- [x] Add a focused case with a known primary protocol error plus a synthetic termination cleanup error.
- [x] Before the fix, prove the test fails because cleanup masks the primary error and/or skips later cleanup.
- [x] Add observable assertions for capture deletion, credential-home restoration, lease release, and cleanup-only fail-closed behavior.

Focused red command:

```powershell
pnpm test -- src/utils/__tests__/grokIntelligenceAcp.test.ts
```

## 3. Implement the minimum cleanup collector

- [x] In both source-owned `acp-client.mjs` projections, preserve the original Error object and message when cleanup also fails.
- [x] Run termination, capture close/delete, credential restoration, and lease release as individually guarded ordered steps so one failure cannot skip the rest.
- [x] Apply the same error-precedence contract to the spawn failure branch.
- [x] Keep cleanup-only failure fatal and attach additional cleanup diagnostics without exposing them in public output.
- [x] Do not change process signals/timeouts, Provider permissions, auth, routing, MCP, model, retry, fallback, raw caps, ACL/path checks, or normal success result shape.

## 4. Focused offline verification

- [x] Run the focused ACP suite and observe all new/old cases pass.
- [x] Run event and runner suites to prove normalization and outer run-root cleanup remain unchanged:

```powershell
pnpm test -- src/utils/__tests__/grokIntelligenceAcp.test.ts
pnpm test -- src/utils/__tests__/grokIntelligenceEvents.test.ts
pnpm test -- src/utils/__tests__/grokIntelligenceRunner.test.ts
pnpm test -- src/utils/__tests__/pluginParity.test.ts
```

- [x] Verify the two runtime projections are byte-identical and record SHA-256.
- [x] Inspect the focused diff; every line must map to R2-R4.

## 5. Full source gates

- [x] Run `pnpm lint`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [x] Run CCG change and quality gates because the runtime/projection diff is likely over 30 lines.
- [x] Run the CCG security gate because this touches command execution, process trees, credentials, private raw files, input validation, and network/provider boundaries.
- [x] Review for secret/path leakage, untracked raw evidence, generated artifacts, and unrelated changes.

## 6. Prepare the one-shot diagnostic harness

- [x] Create an ignored task-local `.ccg/tasks/08-14-fix-grok-acp-cleanup-websearch-capture/` diagnostic harness with no credentials or embedded user text.
- [x] Read the exact failing request from the existing task file and bind its plan/dependency paths; do not interpolate task text into the shell command.
- [x] Parse the existing CCG intelligence config read-only and override only `max_retries=0` in memory.
- [x] Inject a wrapper through `runGrokIntelligence(...runAcp)` that captures only correlated WebSearch `tool_call` / `tool_call_update` notifications before normalization.
- [x] Enforce exclusive private output, mode/ACL checks, raw caps, redaction, no terminal dump, and a structural-summary-only output contract.
- [x] Run the harness against fake/offline fixtures first to prove capture filtering, summary generation, deletion, and no-secret behavior without invoking Grok.

## 7. Execute exactly one real Grok call

- [x] Confirm immediately before execution: source diff passed offline gates; Grok CLI version; cached auth/config health without login; no other Grok process/lease is active; `max_retries=0`; no fallback; exact target cwd and bindings.
- [x] Start one official Grok CLI ACP model call with `mode=contract`, `depth=normal`, `force_refresh=true`.
- [x] Do not retry on exit 2/3/4, timeout, cleanup failure, missing query, or non-reproduction.
- [x] Record non-secret execution metadata: UTC time, CCG commit/tree, Grok version, attempts, exit/status, private capture SHA-256, and event counts.
- [x] Inspect only the relevant correlated event structure and classify it as `provider_empty_or_missing_query`, `parser_schema_mismatch`, or `not_reproduced_or_inconclusive`.
- [x] Delete the private raw event slice after structural summary and hash are verified. Confirm no raw event, prompt, credential, session body, or secret remains in task/working directories.

## 8. Final review and handoff

- [x] Re-run the focused ACP tests after removing the one-shot diagnostic harness/raw capture.
- [x] Inspect `git status`, diff stat, and exact diff in the clean CCG worktree; confirm only planned permanent source/test files remain.
- [x] From the Harness checkout run `node scripts/harness-adapter.mjs conflicts`; do not sync the snapshot.
- [x] Update this task's evidence checkboxes and record the structural classification without raw payload.
- [x] Present implemented cleanup behavior, tests/gates, one-shot call metadata, classification, residual risk, and the exact next authorization if a parser fix is indicated.
- [x] Stop before commit, push, PR, release, Harness sync, installation, config changes, or any second Provider call.

## Rollback Points

- After step 3: revert only the two ACP client projection hunks and focused test additions in the isolated source worktree.
- After step 5: keep the failed worktree for review; do not propagate to Harness or installation.
- After step 7: remove the ignored diagnostic harness and private capture; permanent cleanup fix remains independently testable.

## Execution Evidence — 2026-08-15 UTC

- Source provenance: personal `jed-zed/ccg-gptpro-worflow`, commit `9d94210f5a9132eb0637c9db3303760bf5c93c5f`, tree `5ae03b467656a46f34ca7fe13cccf6b8a7b755ba`, CCG `3.4.14`.
- Isolated worktree: `I:/ai/ccg-gptpro-worflow-fix-grok-acp-cleanup`, branch `codex/fix-grok-acp-cleanup-error-precedence`. Protected dirty checkouts were not modified.
- Red proof: the new regression surfaced the synthetic termination error instead of the primary `ACP session/prompt failed: invalid model` error and left the capture file behind before the control-flow fix.
- Permanent change: two byte-identical ACP runtime projections plus `src/utils/__tests__/grokIntelligenceAcp.test.ts`. Final projection SHA-256: `2ccdc69a6ae371922164e372ff1425a4703b857faeabe28a405e1ae8bbd31e25`.
- Focused verification: ACP/events/runner/parity suites passed `113/113`; final cleanup regression rerun passed `3/3`.
- Full verification: lint passed, typecheck passed, build passed, Vitest passed `633` with `3` skipped. Local CCG change and security gates passed. Quality gate passed with the same five pre-existing warnings as the exact base file. Change analysis passed with one documentation warning caused by the focused test file exceeding 50 changed lines; the Trellis design records the behavior and no source module responsibility or public interface changed.
- One-shot input identity: trimmed task SHA-256 `8d9fb0e73195e4116f22c3ad1664d06d22a006e80531b2f9392b63494e0a6f29`; plan SHA-256 `a94efb821e25a738aabbe94932394a189b90efab031228a65fa877bf178ed7ab`; dependency SHA-256 `2d9e470eaa847e9e33e24fa846da64916a961d3e26f1bb80fcadaf014270a910`.
- One-shot execution: Grok `0.2.118 (1e1687c1cf)`, `runnerInvocations=1`, `acpInvocations=1`, `attempts=1`, no retry and no fallback.
- Capture: 72 correlated WebSearch lifecycle events, 77,955 bytes, SHA-256 `3c20410fff43b2d924301065712cde1112825540b97420cf92910d278dd70803`; private raw JSONL deleted after structural analysis.
- Structural conclusion: `parser_schema_mismatch`. Of 36 completed correlated actions, 22 search-result shapes had `query/sources/type` with a non-empty query, 12 URL shapes had `type/url`, and 2 pattern shapes had `pattern/type/url`. The failing action was `type/url`; current `events.mjs` incorrectly requires query/sources for every completed WebSearch update instead of discriminating action variants.
- Residue: no new canonical intelligence artifact, raw file, lease, or private run root from this task remained. Four older run roots predated this call and were left untouched. Active Grok processes belong to separate FastCtx jobs under `G:/CodexWorktrees/gptpro-run-starting-slot-recovery-harness`, not this task.
- Process-attribution incident: a 20:56 process tree was misattributed from timestamp/process metadata alone and terminated by exact PID tree. A later FastCtx job inventory showed the same external worktree had running jobs, so the terminated tree likely belonged to that separate task. Its controller remained running and later started another Grok job. No further external process was touched; final residue checks use job ownership rather than process-name heuristics.
- Prior scope stop: `events.mjs` was not modified before the later explicit parser-fix authorization. The ignored one-shot harness was removed. No commit, push, PR, release, Harness sync, install, config/login/model/routing/cache mutation, other Provider, or second Grok call occurred.

## 9. Authorized WebSearch action variant parser fix

- [x] Re-run `trellis-before-dev`, update the task contract with the new authorization, and trace every `normalizeAcpEvents` caller before editing.
- [x] Add a focused offline fixture containing search-result, URL, and Pattern completed actions; prove the current parser fails on the URL/Pattern variant.
- [x] Update both byte-identical `events.mjs` projections so observed auxiliary actions complete correlation bookkeeping and remain unknown, without becoming search evidence.
- [x] Prove actual search-result query/sources validation remains strict and no fallback, retry, Provider call, configuration, or public result schema is added.
- [x] Run focused event/runner/parity tests, full offline gates, change/quality/security checks, projection parity, and Harness conflict audit.
- [x] Update execution evidence and stop before commit, push, PR, release, Harness sync, installation, or another Provider call.

## Parser-fix execution evidence — 2026-08-16 UTC

- Red proof: the three-variant offline regression failed on the unchanged parser with `WebSearch url-action query must be a non-empty string`.
- Permanent parser change: the two byte-identical `events.mjs` projections recognize only completed actions with neither `query` nor `sources` and with observed `url` or `pattern` fields as auxiliary Web actions. They complete correlation bookkeeping, remain in `unknownEvents`, and do not enter `events` or `searches`. Other actions retain strict query/sources validation.
- Parser projection SHA-256: `633238ecdb490090069002505aa52ad3a5ef82867691fe8785d1310bdabf1dd7`.
- Final focused verification: events/runner/parity passed `81/81`; the full cleanup/events/runner/parity set passed `114/114` before final consolidation.
- Final full gates: lint passed, typecheck passed, build passed, Vitest passed `634` with `3` skipped, security scan passed with zero findings, change analysis passed with one documentation warning, and quality scan passed with the same four pre-existing complexity warning categories as the base `events.mjs`.
- Spec sync: `.trellis/spec/tooling/codex-provider-runtime.md` now records search-result versus URL/Pattern action contracts, validation matrix, cases, tests, and wrong/correct behavior.
- Residue and scope: the temporary dependency Junction was removed after exact-target verification and the dependency source remained intact. No Provider call, retry, fallback, commit, push, PR, release, Harness sync, installation, cache/config/login/model/routing mutation, or raw capture was added.

## 10. Authorized commit and Harness synchronization

- [x] Re-run the delivery context check and confirm there is no product-manager gate.
- [x] Run the installed `ccg:commit` staged-scope gates and commit only the six verified source files.
- [x] Record source commit `8663e9084289d47e5f838bf5702af0cb1a7356fb` and tree `5739c3db94cbb2d788289c90716743c90c151c4c`; confirm the personal CCG worktree is clean.
- [ ] Commit this task's delivery record without staging unrelated Harness changes.
- [ ] Create a clean isolated Harness worktree and run the supported `harness:update -- --source-checkout I:/ai/ccg-gptpro-worflow-fix-grok-acp-cleanup` transaction.
- [ ] Verify source provenance, materialized-tree parity, Harness conflicts, and repository checks; commit only the synchronized snapshot, manifest, and this task's final evidence.
- [ ] Finish/archive the Trellis task from the clean Harness worktree.
- [ ] Confirm no push, PR, merge, release, installation, Provider call, or installed-cache/config mutation occurred.
