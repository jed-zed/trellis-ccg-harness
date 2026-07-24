# Personal Source Provenance

> Preserve the user's personal implementation as the authoritative source of the Harness.

## Harness definition

The Harness is the combined Trellis workflow layer and the user's personal CCG implementation. Root scripts, manifests, and CI are supporting integration glue, not a separate framework.

## Source hierarchy

1. The personal CCG fork and its verified local `main` checkout are authoritative.
2. `components/ccg-workflow/` must match the recorded personal Git tree exactly.
3. The original CCG repository is upstream provenance only and must never silently replace the personal tree.
4. Trellis project assets must come from the version recorded in `harness.sources.json`.

## Import and update rules

- Import only tracked files from a clean personal CCG commit.
- Verify the personal remote URL, commit, and Git tree before accepting an update.
- Refresh `harness.sources.json` whenever either component version changes.
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
