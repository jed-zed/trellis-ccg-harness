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
- `harness-init.mjs`: performs read-only discovery, persists an explicitly
  approved user Skill-repository profile, applies only a credential-free
  project contract, and installs only the exact approved project Skill copies.
- `harness-lifecycle.mjs`: performs exact-version Trellis or commit-pinned CCG
  updates, rollback, crash recovery, and ownership-safe uninstall transactions.
- `lib/harness-gates.mjs`: runs the exact CCG, Go, and root test commands used
  by lifecycle transactions.
- `lib/harness-transaction.mjs`: provides exclusive locking, durable journals,
  component and managed-file snapshots, candidate validation, rollback, and
  hard-process-interruption recovery.
- `python-resolver.mjs` / `python-hook-runner.mjs`: resolve Python 3.9+ across
  `python3`, `python`, and Windows `py -3` without shell interpolation.

The module does not own Trellis tasks, CCG evidence, model credentials, or the
personal CCG source implementation.

## Dependencies

- Node.js 20 or newer, using built-in modules only.
- Python 3.9 or newer for Trellis task resolution.
- PowerShell 7 for bootstrap, doctor, and source verification.
- Git for source and tracked-runtime checks.
- Go for the mandatory wrapper test/build gate.
- The installed personal `ccg` CLI/plugin for model workflows.

## Quick Use

```powershell
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
node .\scripts\harness-init.mjs inspect --repo-root .
node .\scripts\harness-init.mjs configure-skills --repository <absolute-path> --global-essential "harness-init,grill-me" --approved
node .\scripts\harness-init.mjs catalog-skills
node .\scripts\harness-init.mjs install-skills --repo-root . --skills "<approved-names>" --approved
pnpm harness:test
pwsh -NoProfile -File .\scripts\doctor.ps1
pnpm harness:update -- --trellis-version <exact-semantic-version>
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout <path>
pnpm harness:rollback
pnpm harness:recover
pnpm harness:uninstall
```

The optional Grok probe is explicit and reads credentials only from
`HARNESS_GROK_*` process environment variables.

The Skill repository profile is stored outside projects at
`~/.agents/harness/skill-repository.json`. Catalog discovery is read-only.
The repository must be dedicated and cannot overlap active global
`~/.agents/skills` or `~/.codex/skills` roots.
Project installation copies a bounded, link-free snapshot into
`.agents/skills/` and records source/profile/tree digests in
`.harness/project-skills.json`; it never installs an unapproved catalog entry
or silently overwrites user-owned paths.

Lifecycle operations never fetch from the public CCG upstream or a mutable npm
selector. CCG update accepts only the personal repository, a clean
authoritative checkout, a full commit, its matching tree, and a component
candidate materialized directly from Git blobs. Path/type/mode/blob validation
runs before mutation; frozen install, build, local/global CLI smoke, source-tree
validation, and root tests run again from the final component path. Trellis update accepts only
an exact semantic version, verifies its npm integrity, generates in a sparse
temporary worktree, and applies only the bounded Trellis-managed surface.
