# Harness Lifecycle Update Contract

## 1. Scope / Trigger

This contract applies when `harness:update` replaces the personal CCG snapshot
and `harness.sources.json`. Source publication and host installation are two
ordered transactions: update publishes an auditable candidate; bootstrap and
Codex mode install the merged candidate afterward.

## 2. Signatures

```powershell
pnpm harness:update --ccg-commit <40-char-sha> --source-checkout <absolute-clean-checkout>

pwsh -NoProfile -File scripts/bootstrap.ps1 -LinkCcg `
  -CcgSetupTargetVersion <manifest-version> `
  -CcgSetupPreviousPluginVersion <previous-version> `
  -AuthoritativeCcgCheckout <absolute-clean-checkout>
```

Internal update calls use these contracts:

```js
runHarnessDoctor(repoRoot)
runActivatedCcgCliSmokes(repoRoot, componentRoot, {
  verifyManagedRuntime: false,
})
```

Rollback omits the option and therefore retains
`verifyManagedRuntime: true`.

## 3. Contracts

- The personal scoped package is `@jed-zed/ccg-codex-workflow` with the single
  `ccg-codex` bin. Package/bin/version and authoritative commit/tree are one
  identity. A legacy `ccg-link` requires an explicit hash-bound namespace
  migration plan; retain its old entry and bytes until a separate stock
  recipient plan formally releases ownership. No automatic takeover occurs.
- Pinned local archive setup validates the TGZ hash and package/bin/version
  before opening its transaction, then installs offline with scripts disabled.
  Default local-directory setup remains a separate compatibility path.
- Global Setup forwards an explicit hash-bound agent preservation plan and
  local wrapper to Codex mode. Existing ownership uses read-only verification
  unless one of these reviewed migration inputs explicitly requests install.

- Before mutation, update requires a clean Harness worktree, no pending
  transaction, an exact clean personal CCG checkout, and an ordinary doctor
  pass against the currently published manifest and installed baseline.
- `readTargetCcgVersion` still validates the target package name and semantic
  version before candidate preparation.
- The replacement transaction atomically couples the target source tree,
  `components/ccg-workflow`, and `harness.sources.json`.
- Final update verification runs CCG/Go gates, materialized-tree validation,
  snapshot-local CLI smoke, and Harness tests. It does not install or require
  the unpublished target global CLI/plugin.
- On Windows, the CCG Vitest gate runs the complete suite serially in the
  thread pool with a 60-second per-test limit because native process-tree
  cleanup can exceed the source suite's scheduling and child-process worker-RPC
  budgets. No test or assertion is skipped.
- After the Harness manifest is merged, bootstrap and Codex mode must install
  the exact target global CLI/plugin before final acceptance.

No environment key relaxes these rules. `CODEX_HOME` and provider actions are
installation concerns, not snapshot-update inputs.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Harness worktree is dirty before update | Reject before mutation |
| Installed baseline differs from the current manifest | Ordinary doctor rejects before mutation |
| Target checkout, package, commit, or tree is invalid | Reject before candidate activation |
| Snapshot-local CLI or final tree differs from the target | Roll back the replacement transaction |
| Target global CLI/plugin is absent during update | Allowed; installation remains pending |
| Doctor reports anything beyond the pending target CLI/plugin after update | Reject the release candidate |
| Bootstrap target differs from the merged manifest | Reject installation |

## 5. Good / Base / Bad Cases

- Good: current `3.4.14` runtime matches the current manifest, update publishes
  a verified `3.4.15` snapshot, then G5 installs `3.4.15` and its matching
  plugin from the merged manifest.
- Base: update targets the same version/tree and all ordinary baseline checks
  still run; no special runtime bypass is introduced.
- Bad: preinstall the target by bypassing Harness ownership, weaken the clean
  check, or require the unpublished runtime before its manifest can exist.

## 6. Tests Required

- Trellis updates must exercise the real project `task.py --help` in the
  Harness suite. Syntax-only checks missed an actual 0.6.16 import failure when
  `--skip-all` retained the locally repaired 0.6.9 `common/task_context.py`.
  Merge the reviewed upstream module through the candidate transaction; do not
  add a fake helper or bypass the gate.

- `tests/ci-contract.test.mjs` must assert that CCG update calls the ordinary
  doctor and disables only the managed-runtime part of final update smoke.
- `tests/harness-lifecycle.test.mjs` must keep target-version parsing,
  ownership, rollback, and packaged-runtime checks intact.
- `pnpm harness:test`, doctor, source verification, and conflict audit must pass
  before a lifecycle change is committed.

## 7. Wrong vs Correct

Wrong: bind update preflight to the target version. This requires the target
runtime/plugin before bootstrap can accept the still-old manifest.

```js
runHarnessDoctor(repoRoot, { ccgUpdateTargetVersion: targetVersion })
```

Correct: validate the installed current baseline, then validate the target
inside the snapshot transaction and install it only after publication.

```js
readTargetCcgVersion(resolved, source, manifest)
runHarnessDoctor(repoRoot)
```


## Explicit Codex package identity

Runtime resolution binds an allowlisted package name to its declared single bin:
`ccg-workflow` -> `ccg`, or `@jed-zed/ccg-codex-workflow` -> `ccg-codex`.
Source package, version and bin must agree before installer mutation. Scoped
package paths include their namespace; owned uninstall uses the recorded exact
package and never falls back to the old alias. Ownership continuity refuses
implicit cross-namespace migration. CLI version parsing preserves prerelease/build suffixes.

### Reviewed legacy namespace migration

`ccg-runtime-migration-plan --repo-root <repo>` requires an explicit absolute
`NPM_CONFIG_PREFIX`, an intact owned packaged `ccg-workflow`, its existing npm
aliases, the promoted scoped source identity, and an absent scoped package and
aliases. It prints deterministic JSON binding repository, prefix, source and
ownership digests, exact legacy runtime, and both sets of command files.
`bootstrap-begin --manage-ccg --ccg-migration-plan <file>
--ccg-migration-plan-sha256 <sha256>` rebuilds that exact plan before writing.
Source, receipt, package, or alias drift rejects the migration; a foreign scoped
target is never adopted.

After the real package installation, `bootstrap-runtime-checkpoint` pins the
installed runtime and aliases before later setup steps. Namespace completion
requires that unchanged checkpoint. Its atomic ownership projection retains the
old entry as `ccg-legacy-retained` and creates the new scoped `ccg-link` without
rewriting the old installed fingerprint or claiming the old package as scoped.
An abort holds uncheckpointed or user-edited scoped state. Ordinary bootstrap
also supports checkpoints; callers without a namespace transition remain
compatible. Uninstall removes only matching active owned runtime and aliases;
the legacy slot remains a separately managed handoff baseline.

Before the separate stock-Claude npm file transaction, create
`ccg-legacy-disposition-plan --recipient-plan <stock-plan.json>
--recipient-plan-sha256 <sha256>`. The recipient must be the exact
`ccg-stock-npm-prefix-file-plan` for the same prefix, with immutable stage and
baseline hashes. Apply with `ccg-legacy-disposition --ccg-migration-plan <file>
--ccg-migration-plan-sha256 <sha256>`. This verifies the retained package and
aliases, then atomically records `released-for-stock-claude` and both plan hashes.
It changes no runtime bytes and makes no claim that stock is already installed.
The historical slot is excluded from subsequent personal-runtime observations,
so a separately receipted stock takeover cannot make scoped reinitialization
fail. Reapplying the exact disposition is unchanged.

### Pinned package archive bootstrap

`install.ps1` and `bootstrap.ps1` may accept `-CcgPackageArchive <absolute.tgz>`
and `-CcgPackageArchiveSha256 <sha256>`. Before any ownership transaction,
`ccg-runtime.mjs --repo-root <repo> --archive <path> --sha256 <digest>` verifies
the bounded regular archive, hash, traversal/link/duplicate-safe entries, CLI
entrypoint, and exact source package/bin/version. The archive branch installs
with offline npm, ignored scripts, no audit/funding, and nested dependency
layout. It uses built archive bytes rather than requiring `dist` in the clean
Git snapshot. The existing directory bootstrap remains available when no
archive is supplied.

Personal mutation entry points reject explicit `CLAUDECODE=1` or
`CCG_HOST=claude` before initialization, migration, bootstrap or lifecycle writes.
This is a host boundary, not a filesystem sandbox. Existing `.claude` byte guards
remain required. Read-only inspection/audit paths remain available.

The explicit local candidate acceptance recipe in `recipes/` pins the source
positive receipt, CLI archive, native Codex plugin/marketplace and wrapper. Missing
or mismatched pins fail before temporary installation. Its dry-isolated-init uses
actual scoped package bytes, a fresh private prefix/home and copied existing
dependency cache with offline npm and ignored scripts. Historical component
provenance is retained; acceptance does not imply automatic installed ownership
migration or full Harness source promotion.
