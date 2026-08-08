# Design: publish Grok unverified read-only intake

## Boundaries

- CCG PR #33 is the only source change.
- The Harness snapshot is derived from the accepted CCG commit and must never be
  hand-edited.
- The existing `I:/ai/trellis-ccg-harness` dirty worktree is out of scope.
- No live Grok, GPT Pro, Claude, Gemini, or credential-dependent check is part
  of publication.

## Publication flow

```text
CCG PR #33 CI green
-> merge to personal fork main
-> resolve accepted 40-char commit and Git tree
-> clean Harness harness:update transaction
-> Harness tests/conflicts
-> supported local install
-> exact CLI/plugin/source identity verification
-> Harness PR and merge
```

The Go wrapper is unchanged, so the existing `5.12.6` release asset digests stay
authoritative. Only the Codex plugin build suffix advances to `codex.3`.

## Rollback

Before Harness merge, drop the clean publication branch. After merge, revert the
Harness publication commit and run the supported update/install flow against the
previous recorded CCG commit. Do not patch plugin caches or manifests manually.
