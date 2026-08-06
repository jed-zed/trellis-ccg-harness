# Implementation record: publish Grok review fixes as draft PRs

1. Rebased the reviewed source work onto `codex/fix-windows-grok-cmd` in a clean
   worktree and created draft source PR #28.
2. Rebuilt six wrapper targets twice with Go 1.21.13 and recorded only matching
   reproducible digests.
3. Replaced the rejected provider-read evidence path with one pre-launch,
   snapshot-only, tool-less review boundary.
4. Added focused regressions for unbound-file exclusion, invalid paths,
   non-UTF-8 input, file identity races, isolated CWD, fresh sessions, tool-call
   rejection, cleanup, and wrapper-generated envelopes.
5. Committed and pushed source head
   `091773ac77e1b1147ebf67335a3503b3df4ce60a` after explicit approval.
6. Reran the official Harness update against that remote-visible commit,
   validated the complete component and Harness gates, and published snapshot
   commit `b30a6b83174ccf07c0c25192e5a3ed291665d452` to draft PR #30.
7. Updated both PR descriptions to the final security design and recorded this
   Trellis task without importing primary-worktree parallel changes.
8. Archive this task and record the session after the task/spec commit passes
   `trellis-check` and is pushed.

## Final boundaries

- Source PR #28 remains stacked and draft.
- Harness PR #30 remains draft and depends on source PR #28.
- No model/provider call, release, install, merge, retarget, or force-push was
  performed during publication.
