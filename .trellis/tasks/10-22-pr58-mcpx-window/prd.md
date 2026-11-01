# PR #58 MCPX evidence-window repair

## Authorized scope and plan

User requested independent reproduction of review discussion_r4350091547 at Harness
bb32c0f6421ca8b4a079e636eae2ac50b0d7f748, a minimal isolated-branch fix, regression
coverage of full browser windows/repeated intents/escaped reads and writes/template
parity/completed-state handling, and a factual investigation of Sidebar CI.
Preserve Codex ownership, model routing, personal configuration and installed versions.
No live provider, MCPX production, installation, deployment or merge is part of this task.

The initial lightweight repair used the sequence below; the expanded CI scope
now uses implement.md as its authoritative execution plan, with design.md
defining the retained safety boundaries. The initial sequence was:
inspect caller and runtime contract; reproduce on the pinned source; fix the shared
verifier in both distributions; challenge the candidate with an independent read-only
review; rerun focused suites; construct a provenance-consistent Harness candidate;
record CI facts and remaining integration gates. Local implementation and tests are
covered by the user's explicit Action request. Candidate branches are for review only.

## Acceptance and implementation

Resume authorization (2026-10-22): user requested continuation from the handoff
and explicitly selected "修复夹具并重跑离线测试（推荐）" after presentation of
the Sidebar fixture defect. This adds only the common test-fixture repair and
offline regression run. Original assertions, production browser behavior, source
version and installed environment remain unchanged. Local Pester reproduced the
original 335 passed / 21 failed result before the repair. Normalize the prefilled
SendSelector through the helper's existing SendCount rule with Add-Member -Force;
the other three helper-added properties are absent from its inputs.

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

### Windows resume evidence (2026-10-22)

Original PR head and both remote candidate heads were re-read via GitHub and
remain bb32c0f, a274b40 and 57adff77 respectively. The Harness candidate has no
Actions runs. Work is isolated from the dirty original checkout in
I:/ai/pr58-mcpx-validation-harness; source baseline is
I:/ai/pr58-mcpx-validation-ccg and expanded CI work is in
I:/ai/pr58-mcpx-ci-source. No installed CLI/plugin/configuration was changed.

- Local Python 3.11.2: integrated bridge suite 74 passed; byte comparison of the
  plugin/template implementation passed.
- Sidebar baseline Pester 5.7.1: 335 passed, 21 failed, matching CI. The initial
  logging wrapper did not propagate that failure exit code; the Pester counts,
  not wrapper status, establish this failure. After the one-line fixture repair:
  356 passed, 0 failed, exit 0 with explicit result-count checks. Node DOM suite:
  23 passed. PowerShell AST parse passed.
- Full verify-sources.ps1 with AuthoritativeCheckout passed after configuring the
  isolated clone's required gptpro remote alias. No provenance pins were changed.
- Static conflicts --ci: 14 passed, 0 blocking, 0 warnings. Harness doctor passed
  with 16 adapter passes and no blocking/warning findings. Doctor is read-only
  installed-state evidence, not an installation or live Provider acceptance.
- Source baseline: pnpm 10.17.1 frozen install, lint, typecheck and build passed.
  Full Windows Vitest (--no-file-parallelism --retry 1): 827 passed, 3 skipped,
  exit 0. Node here is 24.14.0; this does not replace CI Node 20/22 evidence.
- Source baseline Go 1.26.5: build and go test -short ./... passed (45.576s).
  This machine's long temporary path does not reproduce CI's 8.3 path condition.
- Complete Harness offline suite: 589 passed, 1 skipped, 0 failed, exit 0
  (590 tests, 2084.58 seconds). This is the isolated a274b40 source snapshot plus
  the Sidebar fixture repair; the new CCG repairs have not yet been imported.

Sidebar investigation used a read-only Luna leaf; the coordinator reproduced
the failures and verified the frozen one-line repair. A second read-only leaf
located the other CI failures. Coordinator spot-check corrected its macOS
summary: the logs contain BOTH /var/folders link-path rejection and explicit
managed-preferences rejection. Those are separate cases to retain in regression.

Raw local logs remain in ignored .ccg/pr58-validation/ in Harness and the
source baseline's *-validation.log files. The later source implementation and
integrated revision must have their own applicable results before completion.

### Expanded CCG CI repairs

The user explicitly approved the three remaining CI repairs in this chat. Two
Sol leaves worked in I:/ai/pr58-mcpx-ci-source with disjoint ownership; their
source changes were frozen and accepted after coordinator diff inspection.

- Cache test: immediately observe the contender with Promise.allSettled, retain
  rejected/busy and no-action/live-owner assertions, and await started work before
  restoring the process.kill mock. Production cache code is unchanged. Actual
  withCacheLock under strict unhandled-rejection mode failed with delayed
  observation and passed with immediate observation. Focused Vitest: 21 passed;
  ESLint and full TypeScript check passed. Native Windows baseline was also 21/21,
  so the controlled timing reproduction, not a claimed spontaneous local failure,
  establishes this race. Logs: .ccg/cache-ci/.
- Go: expand Windows 8.3 names using GetLongPathName before comparing to the
  symlink-resolved path. Real file/parent symlinks and junctions remain rejected.
  A real Windows short-name fixture failed before the fix and passed afterward.
  macOS test fixtures use physical temporary roots; tests explicitly require the
  unchanged managed-preferences rejection while retaining collector/argv coverage.
  Focused tests, Windows build and full short suite passed with Go 1.26.5 (33.165s).
  Darwin arm64 test binary cross-compiled; it was not executed. Logs: .ccg/go-ci/.
- Existing wrapper release security binds exact source, version and six actual
  binary pins. The new Go implementation therefore needs local candidate version
  5.12.14-personal.20261022.1 and the existing Go 1.26.2 dual-build recipe. This
  preparation does not publish assets or change installed versions. The CCG
  package version remains 3.4.16-localarchive.7. Full release verification still
  requires the actual committed source tree and matching generated artifacts.

The frozen baseline clone used Windows automatic CRLF checkout. An exploratory
verify-wrapper-release check correctly rejected those bytes before any source-tree
change. An attempted checkout-index restoration did not change those bytes. The
coordinator then restored all 53 unchanged tracked wrapper files directly from
git show HEAD:file bytes, excluding every modified file; the Go edits are LF.
Both six-platform artifact sets were rebuilt after that correction. All six pairs
are byte-identical, and the installer pins now describe those final artifacts.
The installer retains its original unaffected bytes; its diff is only the version
and six pins. This preserves the exact-bytes gate rather than weakening it.

The prepared wrapper tree is 1bc6f0dae923862a4db3c52675103caa64dd65fc,
computed from a separate temporary Git index including the new Windows regression
file. It is a prospective tree, not a committed-source claim. Both native Windows
amd64 artifacts report the new version. Installer tests: 66 passed. Final combined
build, package tests (4), worker tests (17), and package content check (299 entries,
no missing/unexpected files or findings) passed. Final full Windows Vitest on
Node 24.14.0 / pnpm 10.17.1: 827 passed, 3 skipped, exit 0 (301.35 seconds).
Artifacts and preparation logs remain under .ccg/wrapper-candidate/ in the isolated
source. No binary release, installation, commit or push has been performed.

Outcome: the reported bypass is reproduced and the candidate closes it under focused
verification; **full integration/release remains blocked**, so task is not archived
or marked fully completed. PR #58 and main are unchanged.

Before merging: review the source candidate and paired manifest/snapshot; run the
pinned-toolchain full source/provenance/doctor/required platform gates on the exact
candidate; resolve and rerun the original Sidebar failures and remaining Harness CI
red jobs. Re-run all newly wired Python regressions on the eventual merged revision.
Only a later explicitly authorized owned deployment transaction should update an
installed CLI/plugin. No required CI failure is waived by this task.

### Authorized candidate publication (2026-10-22)

The user explicitly approved committing and pushing both existing candidate
branches and running offline CI, excluding changes to PR #58/main, binary release,
merge and deployment. Source commit 64625401abe2f8342dabf95708e3811dc3c70468
has root tree 134d66982cce1379902088f79ab07a27f9dd2b76. Its exact release
validator passed for all 59 tracked wrapper files, Go 1.26.2 and both six-platform
artifact sets. Harness imports only the nine changed committed source files and
updates the manifest to that real commit/tree.

Windows autocrlf made the source development worktree appear dirty to the provenance
gate despite matching wrapper bytes. A fresh isolated clone with autocrlf disabled
at I:/ai/pr58-mcpx-committed-source is clean and supplies the authoritative checkout.
The integrated staged verify-sources gate passed; conflicts --ci --index passed
with 16 checks, zero blocking/warnings; CI/provenance contracts passed 8/8.
The full Harness baseline and final CCG tests above are reused for unchanged
behavior; remote CI will test the exact integrated candidate and required platforms.
Final CI results remain pending; this record does not claim release/install readiness.
