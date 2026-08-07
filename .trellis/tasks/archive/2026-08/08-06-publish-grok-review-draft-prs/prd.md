# Publish Grok review fixes as draft PRs

## Goal

Publish the verified Grok local-review fix as two traceable draft pull requests
without reverting already-merged source or Harness changes.

## Confirmed Facts

- GitHub CLI `2.89.0` is authenticated as `jed-zed` with repository access.
- The clean source branch `codex/fix-grok-review-verification` contains exactly
  three task commits ending at `efef535e976e7d508650e0a575075689fdfd6237`.
- That source branch is based on `codex/pi-selectable-orchestrator`, whose draft
  PR #26 is still open; it is not based on current source `main`.
- Source draft PR #27 (`codex/repair-codex-provider-runtime`) contains the
  Windows Grok runtime and current provider-chain work. It overlaps this fix in
  12 changed files, including the wrapper parser/executor/config and installer.
- Harness `origin/main` already records source commit `ddfc70c...` from the
  merged Windows Grok distribution work. The local Harness fix records
  `efef535...`, which does not contain `ddfc70c...`.
- Therefore, opening the existing Harness commits directly against current
  `main` would present already-merged Grok runtime files as deletions/reverts.

## Requirements

- Create the source draft PR before the Harness draft PR.
- Each PR must contain only the intended integrated Grok-review change and its
  Trellis/provenance records; unrelated dirty Harness work stays untouched.
- Do not force-push, rewrite an existing remote branch, publish a release, or
  install a wrapper as part of PR creation.
- Use clean worktrees for any integration because the current Harness worktree
  contains unrelated parallel changes.
- A Harness PR may reference only a source commit that is present on the remote
  and whose tree includes the currently accepted Windows/provider runtime.

## Acceptance Criteria

- [x] One source draft PR exists with a documented base/dependency and no
      unrelated rollback.
- [x] One Harness draft PR exists after the source branch is remote-visible and
      its manifest identifies the integrated source commit/tree.
- [x] Both PR bodies explain root cause, scope, validation, dependency order,
      and any remaining merge prerequisite.
- [x] Required source and Harness checks pass on the exact PR heads.
- [x] Existing dirty files in the primary Harness worktree remain unchanged and
      uncommitted by this task.

## Out of Scope

- Merging either PR or marking it ready for review.
- Publishing release assets or installing `codeagent-wrapper`.
- Refactoring overlapping provider-runtime work beyond conflict resolution
  required to preserve both accepted behaviors.

## Key Decisions

- Boss approved a safe rebaseline instead of publishing the stale commits.
- The minimal source base is remote branch `codex/fix-windows-grok-cmd` at
  `ddfc70c09e2e06b158d0a972a677d2b02aedec21`, not the full provider-runtime PR
  #27 head. This exact commit is already recorded by Harness `origin/main`, so
  it preserves Windows Grok support without importing unrelated provider work.
- The source PR is stacked on `codex/fix-windows-grok-cmd`. The Harness PR is
  based on current `origin/main` and is regenerated from the new remote-visible
  source tip through the official lifecycle.
- Both PRs remain drafts. No force push, release publication, wrapper install,
  merge, or ready-for-review transition is authorized.
- Existing live Grok evidence may be cited, but this publication task does not
  make another paid/provider call. Automated regression and lifecycle gates are
  rerun on the integrated heads.

## Deferred Item

- After the stacked source base is integrated into source `main`, the source PR
  can be retargeted or rebased in a later explicitly approved action.

## Delivery Record

- Source draft PR: https://github.com/jed-zed/ccg-gptpro-worflow/pull/28
  - base: `codex/fix-windows-grok-cmd`
  - head: `codex/grok-review-verification-pr`
  - PR-created head: `a00f6ab0256532abcbabc9e035424f21030cb773`
  - source tree: `9ec10fea2f83eb7d6934f377462cfde190af858c`
- Harness draft PR: https://github.com/jed-zed/trellis-ccg-harness/pull/30
  - base: `main`
  - head: `codex/grok-review-verification-harness`
  - PR-created head: `48ca7b30c47e587ad84933e99286bcb12e84f8c1`
- Validation: reproducible six-target Go builds, source lint/typecheck/tests/build,
  security and change gates, official Harness lifecycle, 454 Harness tests,
  committed source verification, Doctor, and conflicts all passed.
- Post-review correction: source `212218f3e40ffdbab6b1af6d2c2d6ba79204d9c7`
  (`0a432a6ea1dd76642a2f54213ffd7feef0f81abe`) removes dynamic tool gateways
  before launch; the Harness snapshot was regenerated from that remote commit.
- Both PRs remain drafts. No release, wrapper install, merge, ready transition,
  force push, or paid provider call was performed.
