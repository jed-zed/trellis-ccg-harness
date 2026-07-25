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
- What absolute repository path contains reusable task and domain Skills?
- Which Skills are truly global essentials? Default to only `harness-init` and
  `grill-me`.
- What reusable selection guidance and explicit exclusions should be saved?
- Which small project-relevant Skill set is recommended, why is each Skill
  needed, and has the user explicitly approved the exact selection?
- Does every selected Skill have an owned `.agents/skills/<name>` target in the
  project contract?
- Does project installation use bounded, link-free copies with a digest
  manifest rather than mutable links?
- If global cleanup is desired, is it handled as a separate ownership-aware
  migration rather than an initialization side effect?

## Toolchain and Platforms

- Required languages, runtimes, versions, package managers, compilers, and
  shells.
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
- Are versions, commits, trees, checksums, and package integrity pinned?
- What validation must pass before replacement?
- What snapshot, transaction record, lock, rollback, and interruption behavior
  is required?
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
