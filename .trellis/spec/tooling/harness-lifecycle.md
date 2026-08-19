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
