# Fix PR 26 project Skill ownership

## Goal

Make Draft PR #26 safe to merge by fixing the confirmed project-Skill ownership
regression and adding the smallest checks that prevent the same split-brain state.

## Background

- PR #26 adds only `codebase-design` and `writing-great-skills` as approved
  third-party project Skills.
- The reviewed PR head is `a2e7d9a80be31bc114d35356c99d8b90b15ac110`.
- CI is green, but the manually supplied GPT Pro review found one merge blocker.
- Codex independently confirmed that `reviseReadyProjectSkills` removes every
  `.agents/skills/` path from `workflow.managedProjectPaths`, then restores only
  catalog-selected paths. With an empty catalog selection, it therefore drops
  the two third-party-owned Skill paths while their selection and provenance
  ledger remain present.
- The catalog ledger and third-party ledger are intentionally separate. Their
  coexistence is not itself a defect; the missing cross-ledger consistency check
  allowed the confirmed regression to pass validation.
- The existing GPT Pro watcher edits and task under
  `08-04-fix-gptpro-watcher-launch` are unrelated and must remain untouched.

## Requirements

- Preserve third-party-managed Skill paths when `reviseReadyProjectSkills`
  changes the catalog project-Skill selection.
- Remove only paths owned by the previous catalog manifest before adding the
  newly selected catalog paths; do not infer ownership from the broad
  `.agents/skills/` prefix.
- Add regression coverage for both empty and non-empty revised catalog
  selections while third-party project Skills remain selected and managed.
- Add a focused static conflict check that detects catalog/third-party ledger
  path overlap or a selected third-party installation missing from managed
  project paths.
- Pin every installed third-party project Skill to LF and prove its checked-out
  tree hash matches the recorded ownership hash.
- Fail closed when a selected installation is missing, empty, or malformed.
- Persist each installed Skill's normalized `targetPath` and use it for conflict
  checks, with the legacy name-derived path retained only as a compatibility
  fallback for existing schema-v1 ledgers.
- Reuse the current manifests, validators, and test patterns. Add no dependency,
  ownership abstraction, migration framework, or new ledger.
- Keep all watcher files and the unrelated watcher task out of the commit.

## Acceptance Criteria

- [x] Revising catalog project Skills to an empty selection preserves both
      approved third-party Skill paths in `workflow.managedProjectPaths`.
- [x] Revising catalog project Skills to a non-empty selection preserves the
      third-party paths and adds only the new catalog-owned paths.
- [x] Catalog paths removed from the revised selection no longer remain managed.
- [x] Static conflict validation fails closed when catalog and third-party
      ledgers claim the same Skill path.
- [x] Static conflict validation fails closed when a selected third-party Skill
      installation path is absent from `workflow.managedProjectPaths`.
- [x] Existing valid PR #26 contract and ledgers pass the conflict check.
- [x] A selected installation with missing, empty, or malformed `paths` fails
      the conflict check.
- [x] An installation whose name differs from `targetPath` is checked using the
      recorded target path.
- [x] The two approved Skill directories are pinned to LF and their current
      tree hashes equal `.harness/third-party-installations.json`.
- [x] Focused tests, full Harness tests, source verification, conflict checks,
      and `git diff --check` pass.
- [ ] The fix is committed only with task-owned product/test files, pushed to
      `codex/harness-recommended-project-skills`, and PR #26 is re-reviewed.

## Key Decisions

- Fix the root ownership calculation in `reviseReadyProjectSkills`; do not add
  special cases at individual callers.
- Use the previous catalog manifest as the authority for which catalog paths may
  be removed. This preserves third-party paths without teaching the revision
  function a second ledger format.
- Limit cross-ledger validation to path ownership invariants needed to block the
  confirmed defects. Full tree scanning remains a test-time root contract, not
  a runtime conflict-audit cost.

## Out of Scope

- Changing the two approved Skills or adding any of the other seven candidates.
- Changing the GPT Pro sidebar watcher or its tests/task.
- Adding `CONTEXT.md`, changing `DESIGN-IT-TWICE.md`, or addressing conditional
  multi-agent assumptions from the review.
- Recomputing every third-party tree hash during each runtime conflict audit.
- Merging PR #26 or marking the Draft PR ready without a separate final decision.

## Risks and Rollback

- Risk: an overly broad filter could retain stale catalog paths. Regression tests
  must prove deselected catalog paths are removed while third-party paths remain.
- Risk: a broad audit could reject intentionally dormant empty catalog metadata.
  The new check must target only overlapping claims and missing selected
  third-party managed paths.
- Rollback is one fix commit on the PR branch; unrelated dirty files are excluded
  by explicit-path staging.

## Artifact Status

- Lightweight task: this converged PRD is sufficient; no separate `design.md` or
  `implement.md` is needed.
- Blocking product/scope questions: none.
- Implementation requires Boss to approve this updated final plan in a new reply.
