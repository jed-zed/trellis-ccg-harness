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
- `install.ps1`: public, user-facing Global Setup. It previews and obtains
  explicit approval for exact Trellis/CCG installation, Codex mode, the
  snapshot-local Codex plugin, all 14 bundled platform Skills, catalog choice,
  and Global Init. Provider CLI install/login selections remain unexecuted
  guidance that needs a separate approval.
- `bootstrap.ps1`: internal toolchain bootstrap. It installs dependencies and
  optionally links the personal CCG CLI inside a rollback-capable ownership
  transaction; users normally enter through `pnpm setup`.
- `harness-init.mjs`: performs read-only discovery, persists an explicitly
  approved user Skill-repository profile, applies only a credential-free
  project contract plus the ownership-recorded collaboration-policy block in
  `AGENTS.md`, installs only the exact approved project Skill copies, and
  atomically promotes a verified approved contract to `ready`.
- `harness-lifecycle.mjs`: performs exact-version Trellis or commit-pinned CCG
  updates, rollback, crash recovery, and ownership-safe uninstall transactions.
- `lib/harness-gates.mjs`: runs the exact CCG, Go, and root test commands used
  by lifecycle transactions.
- `lib/harness-transaction.mjs`: provides exclusive locking, durable journals,
  component and managed-file snapshots, candidate validation, rollback,
  hard-process-interruption recovery, and superseded-snapshot rotation.
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
pnpm setup
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
node .\scripts\harness-init.mjs global-init --non-interactive --home-dir <absolute-user-home> --catalog-mode skip --provider-actions "codex=later,gemini=later,grok=later,claude=skip" --approved
node .\scripts\harness-init.mjs inspect --repo-root .
node .\scripts\harness-init.mjs project-init --repo-root . --home-dir <absolute-user-home> --contract <approved-contract.json> --no-project-skills --non-interactive --approved
node .\scripts\harness-init.mjs configure-skills --repository <absolute-path> --global-essential "grill-me,harness-init,trellis-before-dev,trellis-brainstorm,trellis-break-loop,trellis-channel,trellis-check,trellis-continue,trellis-finish-work,trellis-meta,trellis-session-insight,trellis-spec-bootstrap,trellis-start,trellis-update-spec" --approved
node .\scripts\harness-init.mjs catalog-skills
node .\scripts\harness-init.mjs install-skills --repo-root . --skills "<approved-names>" --approved
node .\scripts\harness-init.mjs skill-migration-plan --repo-root . --repository <absolute-path> --skills "<approved-names>"
node .\scripts\harness-init.mjs skill-migration-apply --repo-root . --repository <absolute-path> --skills "<approved-names>" --inventory-sha256 <sha256> --approved
node .\scripts\harness-init.mjs skill-migration-status --repo-root .
node .\scripts\harness-init.mjs skill-migration-rollback --repo-root . --backup-id <id> --approved
node .\scripts\harness-init.mjs mark-ready --repo-root .
pwsh -NoProfile -File .\scripts\clean-install-acceptance.ps1 -Live -HarnessRef v0.2.0 -ProjectContract .\tests\fixtures\public-baseline-approved-contract.json
pnpm harness:test
pwsh -NoProfile -File .\scripts\doctor.ps1
pnpm harness:update -- --trellis-version <exact-semantic-version>
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout <path>
pnpm harness:rollback
pnpm harness:recover
pnpm harness:uninstall
```

`pnpm setup` is Global Setup and runs Global Init. It never calls legacy
`ccg init`. Non-interactive execution intentionally requires the complete
catalog/provider flags plus `-Approved`, `-ApproveTrellis`, `-ApproveCcgCli`,
`-ApproveCodexMode`, `-ApproveCcgPlugin`, and `-ApproveGlobalInit`.
`bootstrap.ps1` remains available to lifecycle tooling and maintainers, but is
not the public installation flow.

CCG package and marketplace identity use the release base version, while the
plugin manifest and Harness ownership record use the exact `+codex.<build>`
version from that same snapshot. Codex inspection may expose either the exact
base version or that exact plugin build; setup accepts only those two values
from the recorded local marketplace/source. A different build, source path,
marketplace, duplicate, or ownership record fails closed. Codex cache
directories use the exact plugin-build version.

The optional Grok probe is explicit and reads credentials only from
`HARNESS_GROK_*` process environment variables.

The Skill repository profile is stored outside projects at
`~/.agents/harness/skill-repository.json`. Catalog discovery is read-only.
The repository must be dedicated and cannot overlap active global
`~/.agents/skills` or `~/.codex/skills` roots.
Project installation copies a bounded, link-free snapshot into
`.agents/skills/` and records source/profile/tree digests in
`.harness/project-skills.json`; it never installs an unapproved catalog entry
or silently overwrites user-owned paths. Ready-project revision records clean,
credential-free catalog remotes, preserves existing approved selection
reasons, and uses a neutral project-specific reason for newly selected Skills.

The platform migration seeds or validates a user-selected, credential-free Git
catalog of any bounded size, keeps all 14 Harness platform Skills global,
projects the repository path into an independently owned global `AGENTS.md`
block, revises an intact `ready` project through schema-v3 ownership when
project Skills are selected, and moves old globals only into a recoverable
backup. Planning and status are read-only; apply and rollback require explicit
approval and fail closed on digest drift.

Lifecycle operations never fetch from the public CCG upstream or a mutable npm
selector. CCG update accepts only the personal repository, a clean
authoritative checkout, a full commit, its matching tree, and a component
candidate materialized directly from Git blobs. Path/type/mode/blob validation
runs before mutation; frozen install, build, local/global CLI smoke, source-tree
validation, and root tests run again from the final component path. Trellis update accepts only
an exact semantic version, verifies its npm integrity, generates in a sparse
temporary worktree, and applies only the bounded Trellis-managed surface.

CCG replacement fails closed when the live component contains ignored state or
the authoritative source declares sparse exclusions. Only the rollback snapshot
referenced by the latest transaction is retained. Ordinary global npm packages
use full content-tree identities and a pre-existing ordinary Trellis package is
never adopted on first bootstrap because version-only reinstall cannot restore
local patches exactly.

Project-contract reapplication validates strict ownership, contract, and schema
digests. Standalone Skill export validates every target directory component and
copies a bounded, link-free tree, so `.agents/skills` links or junctions cannot
redirect writes outside the selected repository.
