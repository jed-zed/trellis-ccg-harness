# Harness Scripts

## Purpose

This module contains the root integration scripts for the Trellis + personal
CCG Harness. It exists to keep lifecycle authority, personal source provenance,
runtime model policy, and provider boundaries deterministic.

## Responsibilities

- `harness-adapter.mjs`: exposes canonical context, conflict audit, and explicit
  OpenAI-compatible Grok probe commands.
- `lib/harness-adapter/`: implements redaction, safe subprocess execution,
  Trellis context resolution, conflict checks, and provider probing.
- `doctor.ps1`: combines machine prerequisites, personal source provenance,
  adapter conflict checks, remote identity, and repository privacy.
- `verify-sources.ps1`: verifies Trellis/CCG versions and the exact personal CCG
  Git tree, authoritative checkout, dirty state, and optional staged index
  without trusting unreadable working-tree files.
- `bootstrap.ps1`: installs dependencies and optionally links the personal CCG
  CLI inside a rollback-capable ownership transaction.
- `harness-lifecycle.mjs`: performs commit-pinned update, rollback, and
  ownership-safe uninstall transactions.
- `lib/harness-gates.mjs`: runs the exact CCG, Go, and root test commands used
  by lifecycle transactions.
- `lib/harness-transaction.mjs`: provides exclusive locking, snapshots,
  candidate validation, atomic replacement, and interruption recovery.
- `python-resolver.mjs` / `python-hook-runner.mjs`: resolve Python 3.9+ across
  `python3`, `python`, and Windows `py -3` without shell interpolation.

The module does not own Trellis tasks, CCG evidence, model credentials, or the
personal CCG source implementation.

## Dependencies

- Node.js 20 or newer, using built-in modules only.
- Python 3.9 or newer for Trellis task resolution.
- PowerShell 7 for bootstrap, doctor, and source verification.
- Git for source and tracked-runtime checks.
- The installed personal `ccg` CLI/plugin for model workflows.

## Quick Use

```powershell
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
pnpm harness:test
pwsh -NoProfile -File .\scripts\doctor.ps1
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout <path>
pnpm harness:rollback
pnpm harness:uninstall
```

The optional Grok probe is explicit and reads credentials only from
`HARNESS_GROK_*` process environment variables.

Lifecycle operations never fetch from the public CCG upstream or a mutable npm
selector. Update accepts only the personal repository, a clean authoritative
checkout, a full commit, its matching tree, and a component candidate that
passes CCG plus root Harness gates.
