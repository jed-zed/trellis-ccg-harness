# Audit workflow UX deadlocks and hardcoded limits

## Goal

Audit the current Trellis + CCG + Harness workflow for reachable states that
can block a user indefinitely or require undocumented recovery, and for
hardcoded restrictions that reduce usability without a current safety,
integrity, or explicit product requirement.

The result must let Boss distinguish defects worth fixing from deliberate
fail-closed boundaries that should remain.

## Background

- The repository is a layered workflow: Trellis owns task lifecycle, CCG owns
  provider orchestration and evidence, and the Harness adapter owns cross-layer
  policy and conflict reporting.
- The worktree already contains unrelated uncommitted changes. The completed
  audit was read-only except for its own Trellis planning/report artifacts and
  ignored `.ccg/` evidence.

## Confirmed Facts

- `task.py create` created this task in `planning` without an active-session
  pointer, as required by the current phase contract. In that state,
  `node scripts/harness-adapter.mjs context` exits `2` with
  `NO_ACTIVE_TASK`, while root `AGENTS.md` says to run it before model work.
- The shell command `python` is Python 3.11.2. Current Trellis task code uses
  newer f-string parsing and fails before command dispatch under 3.11; the
  installed `py -3.14` succeeds.
- `harness.sources.json` records the tracked CCG source snapshot as 3.4.5;
  `harness-adapter conflicts` confirms that snapshot and reports the installed
  CCG CLI/plugin as 3.4.6 / 3.4.6+codex.1 with no blocking conflict. The audit
  must therefore label source-snapshot findings separately from installed-
  runtime findings.
- The CCG external-intelligence intake route returned `enabled: false` and did
  not invoke any external Provider for this task.
- Six bounded read-only review slices produced candidate evidence. Their
  conclusions remain candidates until the main session verifies the relevant
  current source and reachability.

## Requirements

### R1. User-impacting deadlock audit

- Trace task, provider, review, watcher, lock, timeout, retry, approval, and
  archive state transitions end to end.
- Report only reachable blocking paths. For each finding, identify entry
  conditions, terminal or looping state, user-visible symptom, existing escape
  hatch, and exact file/symbol/test evidence.
- Separate a permanent deadlock from a bounded timeout, explicit approval gate,
  fail-closed safety stop, recoverable error, and stale documentation.

### R2. Hardcoded-limit audit

- Inspect fixed provider allowlists, retry/timeout/count/size caps, platform and
  interpreter assumptions, path and executable selection, task-state gates,
  snapshot filters, and exact-string/UI selectors.
- Flag a fixed value only when it creates a demonstrated usability or
  compatibility cost and lacks a current requirement, safety invariant, or
  supported override.
- Preserve deliberate least-privilege, exact-once, secret filtering, ownership,
  and data-loss protections unless evidence shows they are broader than their
  stated threat boundary.

### R3. Evidence and prioritization

- Rank confirmed findings by user impact and likelihood; keep hypotheses in a
  separate section.
- Cite repository-relative `file:line`, symbol or state names, and the narrowest
  reproducible check for every confirmed finding.
- Recommend the minimum root-cause change for each confirmed issue, but do not
  implement fixes in this task without a separate explicit approval.

### R4. Approved F1 route-target fix

- On 2026-08-07 Boss explicitly approved implementing F1 and F3 only.
- The `ccg route` CLI must forward an accepted `--target` path into
  `runWorkflowRoute` so the persisted binding contains the target path, digest,
  and byte count.
- A CLI-level regression must fail on the pre-fix behavior; direct
  `runWorkflowRoute({ target })` coverage alone is insufficient.

### R5. Approved F3 timeout-unit fix

- `CODEX_TIMEOUT` bare integer values must use one documented unit: seconds.
- Adjacent values `10000` and `10001` must remain adjacent timeout durations;
  no magnitude-based unit guessing is allowed.
- CLI help, maintainer documentation, and focused Go tests must agree on
  seconds and the 7200-second default.

### R6. Approved coupled publication

- On 2026-08-07 Boss approved committing and publishing F1 and F3.
- Publish from a clean branch based on the authoritative personal fork's
  current `main`; do not include the separate unmerged GPT Pro bridge branch.
- Bump the changed Go wrapper to `5.12.6`, pin all six Go 1.21.13 CI artifact
  digests, and let the repository's `main` CI replace the `preset` release.
  Do not upload release assets manually.
- After the source commit is accepted, use the formal clean-tree
  `harness:update` transaction to refresh the tracked snapshot and manifest,
  then install and verify the matching CLI and `3.4.6+codex.2` plugin.

## Acceptance Criteria

- [x] The report covers Trellis lifecycle, Harness adapter/initializer,
      CCG routing and review gates, product-manager gates, Grok/Gemini/Pi
      provider execution, and the GPT Pro sidebar bridge.
- [x] Every confirmed deadlock or hardcoded-limit finding includes a reachable
      path, user impact, evidence anchor, and recovery status.
- [x] Intentional safety/product constraints are listed separately and are not
      mislabeled as defects.
- [x] Speculative risks are clearly labeled and include the missing evidence
      needed to promote them to confirmed findings.
- [x] Existing unrelated worktree changes are not modified.
- [x] During the audit phase, before the separate R4/R5 approval, no live send,
      paid provider call, credential access, installation, destructive
      operation, commit, push, or product-code edit was performed.
- [x] The authoritative personal CCG source forwards CLI `--target` and a
      CLI-process regression proves the persisted binding.
- [x] `CODEX_TIMEOUT` is seconds-only in implementation, help, maintainer docs,
      and tests; `10000` and `10001` resolve to their exact second values.
- [x] Focused TypeScript and Go tests pass without a Provider, credential,
      install, commit, push, or manual snapshot edit.
- [ ] The source commit is pushed through a scoped PR and its required CI passes.
- [ ] The published `5.12.6` wrapper assets match all six pinned digests.
- [ ] The Harness snapshot, source manifest, installed CLI, and installed plugin
      are updated through supported commands and report one matching identity.

## Out of Scope

- Implementing findings other than the explicitly approved F1 and F3.
- Manually editing `components/ccg-workflow`, plugin caches, global installs, or
  source manifests; the approved publication must use supported transactions.
- Proving live third-party availability or exercising real credentials.
- Treating stylistic preferences, conservative safety checks, or dormant code
  as user-impacting defects without a reachable current path.
