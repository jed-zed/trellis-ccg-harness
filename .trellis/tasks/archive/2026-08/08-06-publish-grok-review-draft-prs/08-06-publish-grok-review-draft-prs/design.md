# Design: publish Grok review fixes as draft PRs

## Source correction

The wrapper validates and opens each declared target, confirms file identity,
rejects non-UTF-8 bytes, and writes only the bound content to an owner-only
temporary prompt. Grok starts in that private directory with tools, web, MCP,
memory, planning, subagents, writes, and auto-update disabled. It returns prose;
the wrapper appends the deterministic scope envelope. No post-disclosure
fallback remains.

The source correction is commit
`091773ac77e1b1147ebf67335a3503b3df4ce60a` on draft PR #28, based on
`codex/fix-windows-grok-cmd`.

## Harness integration

The official `harness:update` transaction imported the clean, remote-visible
source commit and recorded Git tree
`ca2b2ac3b6b6dd6373e274d7870acb5013b897c4`. The component delta was compared
path-by-path and blob-by-blob with the source delta. Two sparse-excluded security
references were retained because their old and new Git blobs were identical;
they were not included as unrelated deletions.

Harness snapshot commit `b30a6b83174ccf07c0c25192e5a3ed291665d452`
is published on draft PR #30, targeting `main` and depending on source PR #28.

## Validation

- Source and materialized snapshot: lint, typecheck, 584 passed / 1 skipped,
  build, and Go tests/build.
- Source release binaries: six targets built twice with matching SHA-256 values.
- Harness: 451 root tests passed, three Windows symlink-permission skips, zero
  failures; staged and committed source verification, doctor, and conflicts
  passed with no blocking or warning result.
- CCG change, quality, and security gates had no failure; generic complexity
  warnings were not converted into unrelated refactors.

## Publication and rollback

Both branches were pushed by ordinary fast-forward updates. No force-push,
release, install, merge, or ready transition is authorized. If follow-up is
needed, add a new reviewed commit; do not rewrite these published heads.
