# Publish Grok review fixes as draft PRs

## Goal

Publish the corrected Grok local-review boundary as two traceable draft pull
requests without reverting the accepted Windows/provider runtime or importing
unrelated Harness work.

## Confirmed final state

- Source draft PR: https://github.com/jed-zed/ccg-gptpro-worflow/pull/28
- Source head: `091773ac77e1b1147ebf67335a3503b3df4ce60a`
- Harness draft PR: https://github.com/jed-zed/trellis-ccg-harness/pull/30
- Harness snapshot commit: `b30a6b83174ccf07c0c25192e5a3ed291665d452`
- Harness manifest source tree: `ca2b2ac3b6b6dd6373e274d7870acb5013b897c4`
- Both pull requests remain open drafts. No merge, release, install, retarget,
  force-push, or ready-for-review transition occurred.

## Requirements

- Review mode snapshots only declared UTF-8 regular files before launch.
- Grok runs tool-less from the private snapshot directory in a fresh session.
- The wrapper, not the model, appends the normalized scope envelope.
- Any tool event, resume attempt, bad stop reason, target race, or invalid input
  fails closed.
- Ordinary Grok and Grok external-intelligence routing remain separate.
- The Harness snapshot is generated only through the official lifecycle and is
  bound to the remote-visible personal source commit and Git tree.

## Acceptance criteria

- [x] Source draft PR #28 contains the snapshot-only correction and preserves
      the Windows native Grok runtime from its stacked base.
- [x] Harness draft PR #30 records source `091773a` and tree `ca2b2ac…` through
      the official update lifecycle.
- [x] Both PR descriptions state the root cause, final boundary, dependency,
      validation, and deferred merge/release work.
- [x] Source lint, typecheck, 584 tests, build, Go tests/build, security gates,
      and six-target reproducible binary checks pass.
- [x] Harness source/snapshot gates, 584 component tests, 451 root tests with
      three host-permission skips, doctor, and conflict audit pass.
- [x] The final Harness component delta matches all 10 source paths and blobs;
      no unrelated security-template deletion or primary-worktree change enters
      either PR.

## Key decisions

- The source PR remains stacked on `codex/fix-windows-grok-cmd`; integration or
  later retargeting is deferred.
- The rejected post-disclosure Read/Grep/ListDir evidence design is not retained
  as a fallback or compatibility path.
- Generic quality warnings do not justify unrelated refactoring or new docs.

## Out of scope

- Merging or marking either PR ready.
- Publishing release assets or installing the wrapper.
- Changing provider/Pi/product-manager work outside this review boundary.
