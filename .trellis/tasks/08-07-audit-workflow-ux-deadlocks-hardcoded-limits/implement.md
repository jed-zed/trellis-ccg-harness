# Execution plan: workflow UX deadlock and hardcoded-limit audit

## 1. Freeze scope and runtime identity

- [x] Record current branch, dirty paths, Trellis version, tracked CCG snapshot,
      installed CCG CLI/plugin version, routing roles, and external-intelligence
      decision without exposing credentials.
- [x] Label all evidence as current worktree, tracked source snapshot, installed
      runtime, or specification-only.

## 2. Build state-transition inventory

- [x] Trace Trellis create → plan → start → current → finish → archive and hook
      behavior, including stale/degraded session paths.
- [x] Trace Harness context/conflicts and initializer lock/transaction/recovery
      paths.
- [x] Trace CCG role routing, companion evidence, Provider retry/timeout/fallback,
      product-manager authorization/present/respond/retry, and terminal states.
- [x] Trace GPT Pro preflight → send intent → invoke → acknowledgement → URL
      binding → watch → callback → acknowledge, including uncertain states.

## 3. Verify candidate findings

- [x] For every candidate, confirm a supported entry action, the exact blocking
      transition, current caller reachability, user-visible symptom, and recovery.
- [x] Demote template-only, obsolete-version, unreachable, or safety-required
      candidates to the appropriate non-defect section.
- [x] Check every fixed cap/allowlist/default for a consumed override and a
      documented invariant before calling it unnecessary.

## 4. Run narrow offline checks

- [x] Reproduce planning-task `harness:context` behavior and run
      `harness:conflicts --json`.
- [x] Run focused product-manager state/concurrency tests.
- [x] Run focused GPT Pro adapter tests that do not touch live UI or launch a
      watcher.
- [x] Run the focused Go timeout/config tests for confirmed wrapper constants.
- [x] Use static source/test evidence when a live check would require a Provider,
      credential, browser mutation, installation, or workspace write.

## 5. Produce and review the report

- [x] Write `research/workflow-ux-deadlock-hardcode-audit.md` with severity,
      reachability, evidence, recovery, and minimum fix for every finding.
- [x] Include separate `keep`, `hypothesis`, and Ponytail simplification sections.
- [x] Re-read every cited source anchor and ensure no finding depends only on a
      sub-agent summary or prior memory.
- [x] Run `node scripts/harness-adapter.mjs conflicts --json` before delivery and
      report any unrelated blocker without modifying it.

## Validation commands

```powershell
py -3.14 .\.trellis\scripts\task.py list
node .\scripts\harness-adapter.mjs conflicts --json
node --test .\tests\product-manager-state.test.mjs .\tests\product-manager-concurrency.test.mjs
pwsh -NoProfile -File .\.agents\skills\chatgpt-pro-sidebar\tests\chatgpt-pro-sidebar.Tests.ps1
cd .\components\ccg-workflow\codeagent-wrapper
go test -run "TestRunResolveTimeout|TestResolveMaxParallelWorkers" ./...
```

If a focused command name differs from the current test harness, inspect its
local test entrypoint and run the nearest existing offline equivalent; do not
install dependencies or broaden into live tests.

## Risks and rollback points

- GPT Pro files are already dirty from another task; audit them read-only and
  do not attribute their changes to this task.
- Installed CCG 3.4.6 behavior may differ from tracked 3.4.5 source; never merge
  the two evidence planes without an exact matching anchor.
- A deadlock claim has high false-positive cost because many hard stops protect
  exact-once or evidence integrity; require reachability plus missing recovery.
- Stop before any fix. Product changes require a separately approved task or a
  material revision of this plan followed by fresh approval.

## 6. Approved implementation batch: F1 and F3 only

- [x] Add a red CLI-process regression proving `--target` reaches
      `bindings.target`, then forward `args.target` at the existing route entry.
- [x] Change the timeout regression to require seconds-only values at and above
      the old threshold, then remove magnitude-based conversion.
- [x] Synchronize wrapper help, maintainer docs, and the Unreleased changelog;
      do not add a compatibility layer, new setting, or dependency.

## 7. Source verification

- [x] Run the focused Codex route CLI test.
- [x] Run `gofmt`, focused timeout/help tests, `go test -short ./...`, and
      `go build ./...` in the authoritative source checkout.
- [x] Run affected CCG lint/typecheck/tests/build if the focused gates pass.
- [x] Review the exact source diff and prove unrelated committed/source state
      was preserved.

## 8. Publication stop

- [x] Report that source is fixed and tested but the installed 3.4.6 runtime is
      unchanged until Boss separately approves source commit plus coupled
      Harness snapshot/install update.

## 9. Approved source and Harness publication

- [x] Rebase the two fixes onto a clean branch from the personal fork's current
      `main`, excluding the unmerged GPT Pro bridge branch.
- [x] Bump wrapper/plugin release identity, reproduce all six wrapper digests
      with Go 1.21.13 release flags, and run source lint, typecheck, tests, build,
      Go short tests, and Go build.
- [ ] Commit only the reviewed source diff, push the scoped branch, open the PR,
      and require CI before merging to `main` and publishing `preset` assets.
- [ ] Commit this task amendment, create a clean Harness publication worktree,
      and run formal `harness:update` against the accepted 40-character source
      commit.
- [ ] Install the matching CLI/plugin through the supported Harness flow; verify
      source commit/tree, CLI, plugin, wrapper version/digest, conflicts, and
      focused live `route --target` / `CODEX_TIMEOUT` behavior.
