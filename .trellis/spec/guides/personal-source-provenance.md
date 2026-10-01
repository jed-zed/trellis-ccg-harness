# Personal Source Provenance

> Preserve the user's personal implementation as the authoritative source of the Harness.

## Harness definition

The Harness is the combined Trellis workflow layer and the user's personal CCG implementation. Root scripts, manifests, and CI are supporting integration glue, not a separate framework.

## Source hierarchy

1. The personal CCG fork and its verified local checkout are authoritative.
2. `components/ccg-workflow/` must match the personal Git tree recorded for the current bundled snapshot.
3. The original CCG repository is upstream provenance only and must never silently replace the personal tree.
4. Trellis project assets must come from the version recorded in `harness.sources.json`.

## Import and update rules

- Import only tracked files from the clean current HEAD of the selected personal CCG checkout.
- Treat CCG source, component snapshot, and source manifest as one atomic
  publication transaction. Install the matching CLI/plugin from the merged
  manifest as the following owned transaction; see
  [Harness Lifecycle Update](../tooling/harness-lifecycle.md).
- Verify the personal remote URL, current commit, Git tree, package version, and
  content digest before accepting an update.
- Refresh `harness.sources.json` on every coupled update. Its exact identifiers
  are the provenance fingerprint of the current snapshot, not a permanent version lock.
- Keep runtime evidence, model state, credentials, caches, build output, and nested Git metadata out of the repository.
- Use the installed personal CCG CLI/plugin as runtime integration. The exact component tree is provenance and update input, not a direct runtime helper path.
- Run source verification, project tests, quality checks, security checks, and the Harness doctor before publishing.
- Never weaken clean-tree or residue checks to accommodate locally protected
  files. Leave those worktree paths untouched and validate the intended index
  through a temporary detached worktree created from the exact Git tree.

## Fail-closed conditions

Stop the update when:

- the selected CCG source is not `jed-zed/ccg-gptpro-worflow`;
- the component Git tree differs from the manifest;
- the source checkout has unreviewed tracked changes;
- credentials or runtime evidence would enter the commit;
- a required quality or security gate fails.

## Explicit Trellis runtime customization

`.trellis/scripts/add_session.py` is generated from the locked Trellis 0.6.16
package, with a project-owned durable-finalization fix for intentionally
uncommitted sessions. Do not present that fix as unchanged upstream content.
Keep the package version/integrity and `.trellis/.template-hashes.json`
install-time baseline unchanged; the original Windows-generated script SHA-256
is `e2f46af58a6c8f651d45347467182bf622f0fd8c6cac9e0f36744393055ebb96`.
The verified npm asset SHA-256 is
`f61a452ec5f7eece8d7e0f0dd56ce5851166cbc83ca4822e30acbb36eeb5896f`;
its only generation differences are five `python3` to `python` documentation
command examples. These baseline digests do not describe the patched file.
The resulting hash difference lets Trellis detect the customization on later
updates. Review and preserve/reapply this fix when importing another runtime;
do not rewrite the baseline hash to hide the modification. Fresh projects
created directly from the upstream package do not inherit this local fix.

A successful skipped commit finalizes only after the exact journal entry and
its index row are durable. Unfinished entries remain resumable; completed
unkeyed requests denote new sessions. Use an explicit idempotency key to retry
an already-completed operation, including a lost success response. Unmarked
legacy entries remain pending and are recovered conservatively.

Session recording holds a per-developer native file lock from state discovery
and generation/number allocation through journal/index updates and finalization
or auto-commit. Concurrent calls in the same checkout therefore cannot replace
one another's successful records. Locks live under ignored `.trellis/.runtime/`
and are released on file close or process termination; do not delete the stable
lock files. Acquisition waits at most 30 seconds before failing without updating
the journal or index. Other tools or manual writes do not participate in this
lock, and separate worktrees still require the existing Git convergence policy.
