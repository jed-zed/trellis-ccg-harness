# Harness Scripts

## Purpose

This module contains the root integration scripts for the Trellis + personal
CCG Harness. It exists to keep lifecycle authority, personal source provenance,
runtime model policy, and provider boundaries deterministic.

## Responsibilities

- `harness-adapter.mjs`: exposes canonical context, conflict audit, explicit
  OpenAI-compatible Grok probes, and the Trellis-attached product-manager
  status/review/presentation/response boundary.
- `lib/harness-adapter/`: implements redaction, safe subprocess execution,
  Trellis context resolution, conflict checks, and provider probing.
- `doctor.ps1`: combines machine prerequisites, personal source provenance,
  adapter conflict checks, remote identity, and repository privacy.
- `verify-sources.ps1`: verifies Trellis/CCG versions and the exact personal CCG
  Git tree, authoritative checkout, dirty state, and optional staged index
  without trusting unreadable working-tree files.
- `install.ps1`: public, user-facing Global Setup. It previews and obtains
  explicit approval for exact Trellis/CCG installation, Codex mode, the
  snapshot-local Codex plugin, all 13 bundled platform Skills, catalog choice,
  and Global Init. Provider CLI install/login selections remain unexecuted
  guidance that needs a separate approval. Installation is always manual from
  official documentation. A later `provider-action-plan` plus interactive,
  default-cancel `provider-action-run` displays fixed Codex or Grok auth-only
  guidance but never starts a Provider CLI. Gemini is manual-only; Claude is
  never probed or executed.

Third-party Skills, plugins, and MCP/CLI candidates are not part of those 13
bundled copies. `harness-init.mjs third-party-plan` presents four groups with
no candidate selected by default; a fixed source digest and an explicit
per-candidate approval are required before installation. It recommends
Ponytail, Caveman, Context7, fast-context, and CodeGraph where applicable
without preselecting or installing them.
The final interactive confirmation prints the canonical `planSha256`, approved
package/command roots, subprocess configuration roots, and exact command
identities. Non-interactive Global or Project Init that selects any
third-party candidate must additionally pass
`--third-party-plan-sha256 <reviewed-planSha256>`.
Approved MCPs use a Harness-owned runtime launcher rather than a direct package
entrypoint. Every start revalidates the pinned manifest, ownership, package
lock, tree fingerprint, and executable entrypoint. Host registration stays
manual-pending because Codex has no atomic create-only MCP registration API.
Network approval is split by purpose. `--allow-catalog-network` authorizes only
the selected personal-catalog clone. `--allow-third-party-network` authorizes
only acquisition of already selected, pinned third-party candidates.
Interactive initialization asks the latter after candidate selection, displays
the candidate sources and manifest digest, defaults to `no`, and drops only
the declined network candidates while core initialization continues.
- `bootstrap.ps1`: internal toolchain bootstrap. It installs dependencies and
  optionally package-installs the personal CCG CLI as a real global directory
  with a self-contained nested dependency tree inside a rollback-capable
  ownership transaction; the compatibility switch is still named `-LinkCcg`,
  and users normally enter through `pnpm setup`.
- `harness-init.mjs`: performs read-only discovery, persists an explicitly
  approved user Skill-repository profile, applies only a credential-free
  project contract plus the ownership-recorded collaboration-policy block in
  `AGENTS.md`, installs only the exact approved project Skill copies, and
  atomically promotes a verified approved contract to `ready`.
- `harness-lifecycle.mjs`: performs exact-version Trellis updates or coupled CCG
  bundle updates from a clean checkout's current HEAD, records the current
  snapshot source fingerprint, and provides rollback, crash recovery, and
  ownership-safe uninstall transactions.
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
node .\scripts\harness-adapter.mjs pm status
node .\scripts\harness-adapter.mjs pm present --state-revision <revision-from-status>
node .\scripts\harness-adapter.mjs pm respond --response "验收通过" --state-revision <revision-from-present>
node .\scripts\harness-init.mjs third-party-plan --home-dir <absolute-user-home>
node .\scripts\harness-init.mjs global-init --non-interactive --home-dir <absolute-user-home> --catalog-mode skip --provider-actions "codex=later,gemini=later,grok=later,claude=skip" --third-party-global-skills none --third-party-global-plugins none --third-party-mcp-cli none --third-party-source-sha256 <sha256-from-third-party-plan> --approved
node .\scripts\harness-init.mjs provider-action-plan --home-dir <absolute-user-home> --repo-root <absolute-project> --provider codex --action login
node .\scripts\harness-init.mjs provider-action-run --home-dir <absolute-user-home> --repo-root <absolute-project> --provider codex --action login --plan-sha256 <reviewed-planSha256> --approved
node .\scripts\harness-init.mjs inspect --repo-root .
node .\scripts\harness-init.mjs project-init --repo-root . --home-dir <absolute-user-home> --contract <approved-contract.json> --no-project-skills --third-party-project-skills none --third-party-source-sha256 <sha256-from-third-party-plan> --non-interactive --approved
node .\scripts\harness-init.mjs configure-skills --repository <absolute-path> --global-essential "harness-init,trellis-before-dev,trellis-brainstorm,trellis-break-loop,trellis-channel,trellis-check,trellis-continue,trellis-finish-work,trellis-meta,trellis-session-insight,trellis-spec-bootstrap,trellis-start,trellis-update-spec" --approved
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
pnpm harness:update -- --source-checkout <clean-personal-ccg-checkout>
# Optional audit replay:
pnpm harness:update -- --ccg-commit <40-character-commit> --source-checkout <path>
pnpm harness:rollback
pnpm harness:recover
pnpm harness:uninstall
```

`pm status` always returns tracked `latestAdvice`, including the Provider's
statement, findings, risks, process adjustments, and recommended next action,
even after a gate response clears `currentGate`. A hard gate must be passed
through `pm present` first. Codex then restates that exact advice to the user
and stops; only a fresh explicit response may be applied with `pm respond`.
Previous blanket approvals cannot answer a new gate.

For an interactive project, begin with a `draft` contract whose project,
toolchain, quality, security, and provider constraints are complete. `project-init`
then reports detected technology and recommendations, asks every catalog and
third-party project Skill as an explicit `no`/`yes` choice, and only after the
final approval atomically promotes the same contract to `approved`. The promoted
contract records the manifest digest, exact selections, selection reasons, and
managed paths before installation starts. Passing an already `approved` contract
only confirms and executes its recorded selections; non-interactive mode accepts
only that exact approved contract. `security.strictDataBoundary` becomes an
explicit boolean in an approved contract. Its effective value is the contract
value OR `--strict-data-boundary`, so a later command line can only tighten the
boundary and cannot re-enable a source the approved contract forbids.

`pnpm setup` is Global Setup and runs Global Init. It never calls legacy
`ccg init`. Non-interactive execution intentionally requires the complete
catalog/provider flags plus `-Approved`, `-ApproveTrellis`, `-ApproveCcgCli`,
`-ApproveCodexMode`, `-ApproveCcgPlugin`, and `-ApproveGlobalInit`.
`bootstrap.ps1` remains available to lifecycle tooling and maintainers, but is
not the public installation flow.

`provider-action-run` refuses non-interactive execution and asks a second
`cancel`/`show-guide` question whose recommended answer is `cancel`. The plan
binds a fixed auth-only command identity for review, but Harness never starts
the Provider CLI. It stores no provider output or authentication material.
All Provider installs and logins are manual-only. Provider status and approved
third-party command helpers use verified absolute bindings with an explicit
minimal environment rooted in the plan's home/config paths; they strip
`NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `DYLD_*`, ambient `GIT_*`, and
unrelated variables. Harness never probes or invokes Claude and never creates
or mutates `.claude`.

Global Setup accepts `-CcgSourceCheckout <absolute-path>` when the immutable
manifest commit is not yet reachable from the recorded remote. Bootstrap uses
that clean checkout for provenance only, permits exactly the preflight-observed
plugin identity during the install transition, and runs strict doctor again
after the target plugin and Codex mode are installed.

An existing schema-v1/v2 Skill-platform migration ownership file is a separate
supported Global Init identity. It is accepted read-only only when all 13
managed target paths and tree digests remain intact; Global Init does not
rewrite its backup chain, preserved external Skills, or project audit fields.

CCG package and marketplace identity use the release base version, while the
plugin manifest and Harness ownership record use the exact `+codex.<build>`
version from that same snapshot. Codex inspection may expose either the exact
base version or that exact plugin build; setup accepts only those two values
from the recorded local marketplace/source. Setup may replace an older exact
Harness-owned identity only when its immutable source remains available for
rollback; an unowned different build, source path, marketplace, duplicate, or
ownership record fails closed. Codex cache directories use the exact
plugin-build version.

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
catalog of any bounded size, keeps all 13 built-in Harness platform Skills global,
projects the repository path into an independently owned global `AGENTS.md`
block, revises an intact `ready` project through schema-v3 ownership when
project Skills are selected, and moves old globals only into a recoverable
backup. Planning and status are read-only; apply and rollback require explicit
approval and fail closed on digest drift.

Legacy global `grill-me` directories are not part of the 13-core projection:
the migration leaves them untouched. A new `grill-me` install is instead an
explicitly approved third-party bundle with pinned source and ownership record.

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

Third-party transactions publish new targets create-only. When an owned target
must be replaced or removed, the implementation must atomically claim that
exact object into the transaction area before validation or cleanup. Any claim,
publish, restore, or ownership collision fails closed and preserves both sides
plus diagnostics for manual recovery; it must not recursively delete an
unclaimed path based on an earlier observation. CodeGraph installation never
runs `codegraph init`.
