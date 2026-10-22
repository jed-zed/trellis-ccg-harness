# PR #58 MCPX evidence-window repair

## Authorized scope and plan

User requested independent reproduction of review discussion_r4350091547 at Harness
bb32c0f6421ca8b4a079e636eae2ac50b0d7f748, a minimal isolated-branch fix, regression
coverage of full browser windows/repeated intents/escaped reads and writes/template
parity/completed-state handling, and a factual investigation of Sidebar CI.
Preserve Codex ownership, model routing, personal configuration and installed versions.
No live provider, MCPX production, installation, deployment or merge is part of this task.

This is a lightweight structured security repair. The single execution plan is:
inspect caller and runtime contract; reproduce on the pinned source; fix the shared
verifier in both distributions; challenge the candidate with an independent read-only
review; rerun focused suites; construct a provenance-consistent Harness candidate;
record CI facts and remaining integration gates. Local implementation and tests are
covered by the user's explicit Action request. Candidate branches are for review only.

## Acceptance and implementation

- Negative checks inspect the full original browser time window (plus only the
  explicitly registered confirmation interval). Later intent events cannot truncate it.
- The earliest matching marker anchors positive evidence. Repeating it cannot erase
  earlier violations. A distinct request marker is rejected, so it cannot donate reads.
- Reads, writes and successful execution used as positive proof must follow that
  marker; successful execution must also follow the final write. Pre-marker violations
  within the browser window are still checked.
- Same-session cross-workspace effects and standalone file.changed events in read-only
  mode are rejected. Other sessions and events outside the browser window stay excluded.
- Existing disjoint confirmation, gap rejection, exact argv/cwd, pending-execution and
  successful read-only/production behavior remains covered by the original suite.
- record_result persists awaiting-mcpx-proof for the original malicious sequence;
  completed count remains zero and a capability is not falsely verified.
- Plugin and CLI-template gptpro_mcpx.py are byte-identical. No provider routing,
  authorization defaults or installed runtime was changed.

Implementation lives in personal-source candidate commit
57adff77ff2f4343d49b7daf1a6c012eef9a25f5, tree
b933b67cfde2e8a06aba73a1277ad7f32bee472a, based on pinned 252de07d55744be8d0a2a4d17b03144ca7dc75d9.
Harness imports precisely those three changed source files and updates its manifest
in the same candidate. Package version remains 3.4.16-localarchive.7; this is not a
release or installation. The existing Harness Node CI matrix now runs the Python
bridge discovery command, which previously ran only in the personal source's CI.

## Independent evidence

Read-only boundary investigator confirmed both the latest-marker reset and next-intent
cutoff, plus the need to check pre-marker effects and preserve confirmation windows.
A fresh read-only candidate reviewer found two attribution regressions in the initial
candidate: pre-marker production success and reads donated by a different request.
Both were independently reproduced (four failing subtests across the two copies),
then fixed and retained as regression cases. No reviewer had write ownership.

The original source's existing MCPX suite passed 39/39 before changes. The first eight
new regression methods failed on the original source with 40 failing subtests and two
errors (the harmless-intent positive control was wrongly rejected). This included
record_result returning completed instead of awaiting-mcpx-proof. They passed after
repair. The final new file has 12 methods exercising both implementations.

## Actual validation results

On the source candidate:

- Python AST parsing of both helpers and the new test file: passed.
- git diff --check: passed.
- python -B -m unittest discover -s plugins/ccg/skills/ccg-gptpro-bridge/tests -q:
  **74 passed**, including all original 39 MCPX tests and all 12 window regression methods.
- pnpm install --frozen-lockfile: succeeded in this disposable checkout. Available
  runner was pnpm 11.25.0, not the repository's pinned 10.17.1; no lockfile change.
- pnpm lint; pnpm typecheck; pnpm build: all exit 0.
- pnpm exec vitest run src/utils/__tests__/gptproBridge.test.ts:
  **68 passed, 2 skipped**, exit 0. This covers unchanged bridge integration;
  the Python suite was rerun after the final verifier changes.

On the integrated Harness candidate:

- python -B -m unittest discover -s components/ccg-workflow/plugins/ccg/skills/ccg-gptpro-bridge/tests -q:
  **74 passed**.
- node --test tests/ci-contract.test.mjs tests/readme-provenance.test.mjs:
  **8 passed**.
- node scripts/harness-adapter.mjs context: succeeded before implementation.
- node scripts/harness-adapter.mjs conflicts --ci --index: **14 passed, 0 blocking,
  0 warning, 5 informational** on the staged candidate. The HEAD-mode check correctly
  rejected the uncommitted candidate while HEAD still referenced the old snapshot.
- Existing parseGitTree + verifyMaterializedGitTree against the clean source commit:
  **799 files verified**, including file bytes, paths and executable modes. Manifest
  tree equals the actual source commit's tree. This is not the full PowerShell
  verify-sources gate.
- Full node scripts/run-tests.mjs was attempted before integration and produced
  failures in clean-install acceptance and guided-init fixtures. A focused repeat
  of clean-install acceptance failed with undefined subprocess output; direct
  subprocess checks confirm pwsh is unavailable (ENOENT). The full attempt was
  stopped after confirming missing platform prerequisites and repeated failures;
  there is **no passing full-suite total**. Not every guided-init failure has been
  diagnosed, and none is attributed to this patch without evidence.
- pwsh and go are absent in this executor. Full verify-sources, doctor, Pester and
  Go gates were **not run**, and full CCG Vitest was not rerun. No bypass or skip
  flag was added to satisfy these gates. The coupled release/update command was
  not run because it requires those gates and may manage installed runtime state.

## Remote CI facts for original PR head

Read through GitHub job and log APIs; these results belong to bb32c0f, not this candidate.

- Sidebar run https://github.com/jed-zed/trellis-ccg-harness/actions/runs/39802397671
  had one sidebar job, 119906373183. Setup/checkout/Node setup all succeeded.
  Node DOM/composer tests: **23 passed**. PowerShell offline tests: **335 passed,
  21 failed, 0 skipped**, exit 1. Therefore the current record is a real test-run
  failure, not 'No jobs were run' and not an unstarted runner.
- Repeated first errors identify Complete-FixturePreparedSendSnapshot at
  .agents/skills/chatgpt-pro-sidebar/tests/chatgpt-pro-sidebar.Tests.ps1:137:
  SendSelector already exists when Add-Member is called. Other cases report
  InternalError instead of the expected SelectedModeNotPro/RecoveryRequired/
  RetryNotSubmitted. This is evidence of fixture/runtime failures; a single common
  cause for all 21 failures has not been independently established.
- Harness CI run https://github.com/jed-zed/trellis-ccg-harness/actions/runs/39802397706
  also fails. Node 22 Ubuntu reaches CCG Vitest with **824 passed, 6 skipped**, but
  exits 1 on an unhandled 'Cache lock is busy' rejection. Windows/macOS Go jobs
  reach Go tests and fail. Node 20 Ubuntu, both Windows Node jobs, Linux Go and
  all three bootstrap/doctor jobs succeeded. These are separate existing issues,
  not evidence that the MCPX candidate regressed them or that GitHub infrastructure
  was unavailable.

## Handoff and safe merge conditions

Outcome: the reported bypass is reproduced and the candidate closes it under focused
verification; **full integration/release remains blocked**, so task is not archived
or marked fully completed. PR #58 and main are unchanged.

Before merging: review the source candidate and paired manifest/snapshot; run the
pinned-toolchain full source/provenance/doctor/required platform gates on the exact
candidate; resolve and rerun the original Sidebar failures and remaining Harness CI
red jobs. Re-run all newly wired Python regressions on the eventual merged revision.
Only a later explicitly authorized owned deployment transaction should update an
installed CLI/plugin. No required CI failure is waived by this task.
