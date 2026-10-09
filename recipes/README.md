# User-supplied local Codex recipes

`scripts/ccg-local-recipe.mjs` verifies an explicit private acceptance recipe.
Keep actual recipes and their source receipts, archive and wrapper paths,
offline cache locations, installation prefixes and execution reports outside
the repository. A recipe binds the scoped package and command, CLI and plugin
versions, source receipt, npm archive, native Codex marketplace and local
wrapper by their verified hashes. This repository does not distribute a
machine-specific recipe or imply that one is ready for another computer.

```powershell
node scripts/ccg-local-recipe.mjs verify --recipe "<absolute-path-to-your-recipe.json>"
node scripts/ccg-local-recipe.mjs dry-isolated-init --recipe "<absolute-path-to-your-recipe.json>" --report "<existing-private-evidence-directory>/recipe.report.json"
```

The second command performs real npm installation into a newly created private
prefix, then runs the installed scoped CLI version check and Codex-mode clean,
repeat and uninstall with the locally pinned wrapper. It removes the private
package and temporary state in `finally`. npm uses `--offline` and
`--ignore-scripts`; the existing npm content cache is copied into the temporary
cache. This verifies locally available artifacts and dependencies; it does not
prove a fresh registry installation. No provider, browser or model is called,
and no persistent PATH is changed.

The verifier requires the native `.codex-plugin/marketplace.json` and Codex
plugin manifest. Claude marketplace data is never a fallback. The runner
compares its synthetic Claude trees, upstream `ccg` package and alias sentinels,
and recorded existing runtime files before and after the private rehearsal.

The reusable runtime, installer, guards and tests remain unchanged from the
validated private Harness candidate. Public-source cleanup removes its two
machine-specific historical recipes and clears only the task worktree path;
it does not migrate live ownership or weaken provenance, leases or rollback.
Actual installation still needs its own reviewed private recipe and authority.
