# Consolidate bridge features and PR58 fixes

## Accepted scope
User 2026-10-23 explicitly requested collecting changes into current branch, preserving unique global bridge features, integrating the other repair branch, verifying first, and no commit/push/global overwrite. The active `10-23-gptpro-safe-diagnostics` task and its writes are excluded.

## Acceptance
- Preserve current dirty ownership-handoff files, tests and task records byte-for-byte.
- Integrate the committed delta bb32c0f..35be883 from codex/fix-pr58-mcpx-window without creating commits, changing branch or staging.
- Keep the CCG component and harness.sources.json from the same committed candidate; do not hand-edit provenance-owned component source.
- Reconcile installed browser bridge thinking-mode/ownership features with current source attachment/reextract behavior. Exclude backup/cache/runtime evidence. Use frozen pre-diagnostic input for overlapping files.
- Do not change live diagnostic task or its source/tests until the writer is confirmed stopped. Prepare an isolated, tested candidate meanwhile; any remaining live conflict must be reported, never silently overwritten.
- Verify integrated candidate with focused bridge/MCPX tests and applicable existing offline gates; distinguish local tests from remote CI and real browser acceptance.
- No global installation, ownership handoff, commit, push, merge publication, browser/provider call or unrelated old-worktree cleanup.
