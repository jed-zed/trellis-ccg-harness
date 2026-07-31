# Harness Initialization Constraint Checklist

Use this checklist during read-only discovery. Repository evidence answers
technical facts; the user answers only intent, scope, compatibility, and risk
decisions that remain unresolved.

## Business and Scope

- What user or business outcome does the project deliver?
- Is this a new project, an existing repository adoption, or a Harness repair?
- Which packages, services, repositories, and deployment environments are in
  scope?
- What is explicitly out of scope for the initial Harness?

## Repository and Source Authority

- What is the canonical repository and default branch?
- Are submodules, worktrees, generated snapshots, vendored code, or nested Git
  repositories present?
- Which files are generated, user-owned, or managed by an installer?
- Are external source repository, commit, tree, checksum, license, and
  visibility constraints recorded?

## Architecture and Ownership

- What are the real package, service, frontend, backend, data, and deployment
  boundaries?
- Which system owns tasks, requirements, specs, model routing, evidence, code
  writes, release decisions, and runtime state?
- Which paths are canonical, derived, ignored, or forbidden to track?

## Workflow and Specifications

- Where do PRDs, designs, implementation plans, architecture decisions, and
  coding specifications live?
- Which changes require planning and explicit approval?
- How are tasks started, resumed, checked, finished, and archived?
- Which existing conventions should `trellis-spec-bootstrap` extract from code?

## Skill Profile and Placement

- Is this the first Harness initialization, or is a saved user Skill repository
  profile already available?
- What explicit Git catalog path or approved clone source contains reusable task
  and domain Skills, if any?
- Does the global baseline contain exactly the 15 built-in Harness/Trellis
  platform Skills, with ownership-managed projections only for those 15
  sources? `grill-me`, Caveman, Ponytail, Context7, CodeGraph, and fast-context
  are third-party candidates: recommend the relevant group, keep it unselected
  by default, and require an explicit yes before installation.
- Does the final interactive third-party confirmation show the canonical plan
  SHA-256, approved package and command roots, subprocess configuration roots,
  and every bound command identity?
- If non-interactive initialization selects any third-party candidate, does it
  require the exact reviewed `--third-party-plan-sha256` in addition to the
  source-manifest digest?
- What reusable selection guidance and explicit exclusions should be saved?
- Which small project-relevant Skill set is recommended, why is each Skill
  needed, and has the user explicitly approved the exact selection?
- Does every selected Skill have an owned `.agents/skills/<name>` target in the
  project contract?
- Does project installation use bounded, link-free copies with a digest
  manifest rather than mutable links?
- If global cleanup is desired, does a read-only inventory bind the 15 built-in
  platform Skills, preserve any legacy third-party Skills, and record the explicit catalog identity and user-approved project
  Skill subset (which may be empty) before an ownership-aware migration?
- Is the selected catalog an explicit Git working tree with recorded branch,
  commit, tree, clean state, remotes, and link-free Skill trees? Its Skill
  count and layout are catalog-defined rather than Harness-defined.
- Are the backup manifest, global managed block, project schema-v3 ownership,
  audit, and rollback identities intact?

## Toolchain and Platforms

- Required languages, runtimes, versions, package managers, compilers, and
  shells.
- Which optional provider CLIs are installed, which installation requests must
  remain official-documentation/manual-only, and which Codex/Gemini/Grok login
  guidance has a separately reviewed plan digest and second explicit approval?
  Claude installation/login remains default-skipped and Harness initialization
  never probes or executes it. A separately selected product-manager Provider
  may invoke an already installed Claude only with explicit per-call approval
  and a no-tool, no-write, non-persistent execution boundary.
- Do all executable status/source/action helpers use a verified absolute
  command binding and an explicit minimal environment rooted in the approved
  home/config locations, with `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`,
  `DYLD_*`, ambient `GIT_*`, and unrelated variables removed?
- Supported operating systems and architecture matrix.
- Canonical install, build, lint, format, typecheck, test, package, and release
  commands.
- Offline requirements and optional external dependencies.

## Quality and CI

- Required local quality gates and definition of done.
- Unit, integration, end-to-end, migration, compatibility, and security test
  expectations.
- CI platforms, runtime versions, required checks, artifacts, and time limits.
- Whether paid models or network services are forbidden in ordinary CI.

## Security, Data, and Secrets

- Data classification, privacy, retention, logging, audit, and compliance
  constraints.
- Authentication, authorization, encryption, input, command, file, and network
  boundaries.
- Approved secret stores and environment-variable names; never secret values.
- Paths and outputs that must never be committed.

## Models and Providers

- Which providers are enabled, optional, manual-only, or disabled?
- Which model may write to the workspace?
- Which providers may use the network or incur charges, and under what explicit
  approval?
- What fail-closed evidence, redaction, timeout, and fallback rules apply?

## Hooks and Global Configuration

- Which project hook is authoritative for each event?
- How do global hooks yield to project-local hooks?
- Are global configuration changes allowed? If so, which exact paths require
  backup, ownership records, digest checks, and uninstall restoration?
- How are malformed shared configs handled without data loss?

## Updates, Rollback, and Uninstall

- Which source is allowed for Trellis, CCG, Harness, and dependency updates?
- Does each coupled package update record the current version, commit, tree,
  checksum, and package integrity as a snapshot provenance fingerprint?
- What validation must pass before replacement?
- What snapshot, transaction record, lock, rollback, and interruption behavior
  is required?
- Do mutations use create-only publication or atomically claim the exact owned
  object before validation/removal, and preserve both sides plus diagnostics
  when a concurrent or user-owned collision prevents safe completion?
- What owned state may uninstall remove, and what user state must it preserve?

## Completion Review

- All confirmed facts have repository evidence.
- All user-owned blocking decisions are resolved.
- The proposed file/global changes are explicit.
- The user approved the latest complete summary.
- The saved Skill repository profile is valid or its replacement was approved.
- The exact project Skill selection and reasons match the managed project paths.
- The final project contract contains no credentials or placeholder decisions.
- Doctor, conflict, source, quality, security, and CI gates are recorded.
