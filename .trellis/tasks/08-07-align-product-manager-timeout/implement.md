# Implementation Plan

## 1. Preflight and isolated worktrees

- [x] Confirm the personal source main checkout is clean and contains merged
      baseline `8f6d981`.
- [x] Create an isolated source worktree/branch
      `codex/align-product-manager-timeout`; do not touch the dirty primary
      source checkout or the existing route-timeout publication worktrees.
- [x] Confirm the current Harness root and all unrelated worktrees remain
      unchanged.

## 2. Source red/green change

- [x] Add the three focused configuration assertions first: new default,
      accepted exact maximum, and rejected value above the maximum.
- [x] Run the focused test and record the expected pre-fix failure:
      `pnpm exec vitest run src/utils/__tests__/config.test.ts`.
- [x] Change only the source default/range, template value, and Unreleased
      changelog entry described in `design.md`.
- [x] Re-run the focused test, then inspect the exact diff.
- [x] Run source gates without a live Provider:

```powershell
pnpm lint
pnpm typecheck
pnpm audit:prod
pnpm test -- --coverage
pnpm build
```

## 3. Source publication

- [x] Commit only the four source-owned files with a focused conventional
      commit.
- [x] Push the source branch, create a ready PR against personal `main`, wait
      for the Ubuntu/Windows Node 20/22 CI matrix, and resolve only failures
      caused by this change.
- [x] Merge the green PR and record the full merge commit and Git tree.
- [x] Do not create a Go wrapper preset release or bump package/plugin versions.

## 4. Harness dependency gate and update

- [x] Verify the earlier F1/F3 Harness update is merged and
      `harness.sources.json` already pins source commit `8f6d981` or later.
      Stop without mutation if that prerequisite is not met.
- [x] Create a new clean Harness worktree/branch from the updated Harness main.
- [x] From the clean Harness worktree run:

```powershell
pnpm harness:update -- --ccg-commit <40-character-source-merge-commit> --source-checkout <clean-personal-source-checkout>
```

- [x] Review the generated component and manifest diff; require the source
      delta to contain only this Product Manager timeout change plus generated
      provenance fields.
- [x] Update `.trellis/spec/tooling/product-manager-review.md` to
      `timeout_ms = 7200000` and bring this task's planning artifacts into the
      isolated Harness branch after `harness:update` has passed its clean-tree
      preflight.

## 5. Harness verification and publication

- [x] Run the affected offline Product Manager and Harness checks:

```powershell
node --test tests/product-manager-state.test.mjs
node --test tests/product-manager-concurrency.test.mjs
node --test tests/product-manager-e2e.test.mjs
node --test tests/harness-adapter.test.mjs
node --test tests/harness-init-cli.test.mjs
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
pnpm harness:test
pnpm verify:sources
pnpm doctor
pnpm harness:conflicts
```

- [ ] Commit the bounded Harness snapshot/manifest/spec/task diff, push a
      separate branch, open a ready PR, wait for required CI, and merge it.

## 6. Supported runtime installation

- [ ] Use a clean checkout of the merged Harness commit and the clean personal
      source checkout. Run the supported non-interactive full setup with no
      optional Provider or catalog action:

```powershell
pnpm setup -- `
  -NonInteractive `
  -HomeDir C:\Users\29933 `
  -Approved `
  -ApproveTrellis `
  -ApproveCcgCli `
  -ApproveCodexMode `
  -ApproveCcgPlugin `
  -ApproveGlobalInit `
  -CatalogMode skip `
  -ProviderActions 'codex=keep,gemini=keep,grok=keep,claude=keep' `
  -CcgSourceCheckout <clean-personal-source-checkout>
```

- [ ] Confirm setup reports matching source commit/tree, CLI, plugin identity,
      and unchanged Provider login/install state.

## 7. Active config and final acceptance

- [ ] Copy `C:/Users/29933/.codex/ccg/config.toml` to a timestamped sibling
      backup and verify the copy before editing.
- [ ] Change only `product_manager.timeout_ms` from its observed current value
      to `7200000`; preserve routing, retries, output limits, and unrelated
      configuration.
- [ ] Run offline acceptance:

```powershell
ccg --version
ccg product-manager status --json --config C:\Users\29933\.codex\ccg\config.toml
pnpm doctor
pnpm harness:conflicts
```

- [ ] Require status to report `timeout_ms = 7200000`, `max_retries = 1`, the
      existing selected Provider, and no network/credential/login side effect.
- [ ] Inspect final diffs and working-tree status; report any external CI or
      prerequisite still pending instead of claiming end-to-end completion.

## Execution Notes

- Personal source PR [#32](https://github.com/jed-zed/ccg-gptpro-worflow/pull/32)
  merged as `440dfa496ec73c7da1fab6fb1f1811a57a652d5b`, Git tree
  `1527cc4c75572eb631104a926eb2b30e6836a339`.
- Source lint, typecheck, production dependency audit, build, focused tests, and
  full coverage suite passed; the suite reported 594 passed and 3 skipped.
- Prerequisite Harness PR
  [#32](https://github.com/jed-zed/trellis-ccg-harness/pull/32) merged as
  `d43b61841e438d34e05dcf69536730776cbbc2fa`, and its manifest pins source
  commit `8f6d981bac05257e7bc6333bfb6ccbbb5d62fe05`.
- Formal `harness:update` completed in transaction
  `2026-08-07T23-27-55-774Z-23115ed1-f239-4006-ae02-952a1a255445` and bound
  source commit `440dfa496ec73c7da1fab6fb1f1811a57a652d5b` with Git tree
  `1527cc4c75572eb631104a926eb2b30e6836a339`.
- Focused Product Manager/Harness tests, CCG lint/typecheck/test/build, the full
  Harness suite, source verification, doctor, and conflict checks passed. The
  full CCG suite reported 594 passed and 3 skipped; the full Harness suite
  reported 452 passed and 3 skipped.
