# Design: publish Grok review fixes as draft PRs

## Boundaries

This task performs a two-repository integration and publication. It changes no
product behavior beyond preserving the already accepted Grok review fix while
rebasing it onto the source tree currently represented by Harness `main`.

The primary dirty Harness worktree remains task authority only. All source and
Harness integration happens in new clean worktrees.

## Source integration

Create `codex/grok-review-verification-pr` from remote
`gptpro/codex/fix-windows-grok-cmd` (`ddfc70c...`). Apply the three reviewed
source commits in order:

1. `a1580b2` — bound local review evidence;
2. `7f574a8` — observed top-level Grok streaming events;
3. `efef535` — version, documentation, tests, and release digests.

Resolve only conflicts required to preserve both the native Windows executable
resolver and strict local-review evidence. Keep version `5.12.5`, rebuild all
six wrapper targets twice with the pinned Go toolchain, and replace installer
digests only with byte-reproducible outputs.

The source draft PR targets `codex/fix-windows-grok-cmd`. This makes the diff
contain only the local-review fix while clearly declaring its stacked base.

## Harness integration

After the source branch is pushed, create
`codex/grok-review-verification-harness` from fresh `origin/main`. Run the
official `harness:update` lifecycle with the exact integrated source commit and
clean source worktree. Do not hand-edit `components/ccg-workflow/` or
`harness.sources.json`.

Carry forward only the Grok review task/spec records needed to explain the
change. Do not import unrelated primary-worktree changes or reuse the stale
Harness snapshot commit.

The Harness draft PR targets `main` and declares the source draft PR as a hard
dependency.

## Publication contract

- Push only the two new branches with upstream tracking; never force push.
- Confirm no existing PR uses either head branch before creation.
- Create draft PRs with root cause, scope, dependency, checks, and deferred
  retarget/release notes.
- Use `gh` because authentication and repository identity are already verified.

## Rollback

Before push, remove only the new clean worktree/branch. After push but before PR
creation, delete only the newly pushed branch with explicit user approval; do
not rewrite it. After PR creation, close/delete nothing automatically—report
the URLs and leave both drafts intact.
