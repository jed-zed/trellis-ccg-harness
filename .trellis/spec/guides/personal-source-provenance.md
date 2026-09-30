# Personal Source Provenance

> Preserve the user's personal implementation as the authoritative source of the Harness.

## Harness definition

The Harness is the combined Trellis workflow layer and the user's personal CCG implementation. Root scripts, manifests, and CI are supporting integration glue, not a separate framework.

## Source hierarchy

1. The personal CCG fork and its verified local checkout are authoritative.
2. `components/ccg-workflow/` must match the personal Git tree recorded for the current bundled snapshot.
3. The original CCG repository is upstream provenance only and must never silently replace the personal tree.
4. Trellis project assets must come from the version recorded in `harness.sources.json`.

## Installed Trellis CLI

- `harness.sources.json.trellis.version` identifies the bundled project assets; it does not pin an already-installed global Trellis CLI.
- `scripts/doctor.ps1` reports the available CLI version and accepts a difference from the project-assets version. A missing or failing CLI remains an availability error.
- `scripts/bootstrap.ps1` installs the recorded version only when Trellis is absent. An existing CLI is kept; a failing CLI reports an error instead of triggering reinstall or downgrade.
- `scripts/install.ps1` verifies availability after setup and reads the final version line, ignoring startup update notices. Regression cases in `tests/doctor.test.mjs` and `tests/install-script.test.mjs` cover CLI 0.6.16 with project assets 0.6.9.
- Do not infer installation permission or incompatibility solely from a version difference. Exact source-tree and manifest provenance checks below remain authoritative.

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
