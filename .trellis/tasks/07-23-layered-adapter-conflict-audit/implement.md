# Implementation Plan

1. Add `.harness/adapter.json` with ownership, model, state, hook, and Grok provider contracts.
2. Add a Node adapter module and CLI that:
   - resolves the active Trellis task;
   - emits redacted canonical context;
   - audits deterministic Trellis/CCG conflicts;
   - probes an OpenAI-compatible Grok API using environment-only credentials.
3. Add project-level Harness instructions outside the Trellis-managed `AGENTS.md` block.
4. Extend `package.json`, `scripts/doctor.ps1`, and CI with adapter checks.
5. Add Node built-in tests for authority, redaction, namespace collision, hook overlap, provider separation, and blocking exit behavior.
6. Record the user's explicit Grok opt-out, run Gemini read-only review, adapter tests, source verification, security/quality gates, and the full CCG test/build suite. Do not call Grok or Claude.
7. Validate the GPT Pro review against the local dirty tree and record the
   finding matrix under `research/`.
8. In the authoritative personal CCG checkout, use red-green-refactor cycles to:
   - reject wrapper candidates by trusted SHA-256 before chmod or execution;
   - pin executable third-party sources and remove automatic `sudo`;
   - merge/backup/own Codex-mode global state and make uninstall digest-safe;
   - disable public npm self-update;
   - propagate required init/doctor/update failures through exit status;
   - quote hook paths and fail closed on malformed settings;
   - prevent secret arguments and secret-bearing MCP mirror copies;
   - delegate/yield to Trellis in the Codex-mode hook.
9. Commit the personal CCG hardening, import its exact tracked tree into the
   Harness component, and update `harness.sources.json` commit/tree provenance.
10. Add root Python resolution, strict source verification, explicit doctor
    success status, and transaction-safe update/uninstall/rollback commands.
11. Promote component Windows/Go/offline gates into root CI and add macOS
    bootstrap/path/doctor coverage.
12. Add normal-clone/worktree hook fixtures plus bounded opt-in MCP smoke
    diagnostics.
13. Run targeted tests after every fix group, then run adapter tests, source
    verification, CCG lint/typecheck/tests/build, Harness doctor, quality,
    security, and final dirty-tree review.
14. Write a final conflict matrix and distinguish fixed, intentional, and any
    residual operator-only risks.
15. Generate `.agents/skills/harness-init` with the Skill Creator, add a
    complete constraint checklist and project-contract template, integrate the
    `grill-me` one-question gate and `trellis-spec-bootstrap` handoff, validate
    the Skill package, and cover its non-mutation/provider boundaries with
    offline tests.

## Minimal CCG plan extension: ordered collaboration policy

CCG evidence: Gemini completed a bounded read-only planning pass from a
secret-excluding snapshot. Claude and Grok remain disabled by this accepted
Trellis task. Codex owns the final plan, edits, tests, and review.

- [x] Add one canonical `harness-init` policy asset containing the ordered
  authority, Ponytail, Caveman, and `rg`/CodeGraph/fast-context routing rules.
- [x] Add a derived `HARNESS-COLLABORATION` block to root `AGENTS.md`; keep the
  existing Trellis and Harness blocks byte-preserved.
- [x] Extend `applyProjectContract()` to insert the same block atomically after
  approval, preserve unrelated `AGENTS.md` content, reject malformed/conflicting
  markers, and record block ownership.
- [x] Add focused red/green tests for missing/existing `AGENTS.md`, inheritance,
  collision preservation, ownership, and repeat apply.
- [x] Update initializer docs, run Trellis 2.2 plus CCG change/quality/security
  gates, then rerun Harness tests, doctor, conflicts, and source verification.

## PR #2 review repair: recoverable project-policy transaction

- [x] Add red tests for `AGENTS.md` drift after the initial read, failure after
  every commit step, hard process termination, deterministic recovery, and
  staging/lock cleanup.
- [x] Replace the split `.harness`/`AGENTS.md` rename sequence with one
  project-scoped transaction: exclusive owned lock, original digest and file
  identity, pending journal before mutation, verified backups, final CAS, and
  ownership committed last.
- [x] Upgrade ownership to schema v2 and distinguish an untouched legacy
  projection from a user-edited block, so PR #1 state and future policy
  revisions migrate without weakening overwrite protection.
- [x] Materialize the pinned project policy at
  `.harness/policies/collaboration-policy.md`, record its source/rendered
  digests, and make every generated `AGENTS.md` reference resolve without a
  prior Skill export.
- [x] Rerun focused initializer tests, the complete Harness suite, Trellis
  check, CCG change/quality/security gates, doctor, conflict audit, source
  verification, and CI before requesting another review.

## PR #2 final-review repair: authenticated recovery ownership

- [x] Add red regressions proving repository-authored transaction residue cannot
  replay against user files and a reused live PID cannot pin dead state.
- [x] Authenticate transaction owners, journals, and commit markers with an
  user-scoped key outside the target repository.
- [x] Bind owner liveness to PID plus process-instance identity on Linux,
  Windows, and macOS, with conservative fallback on unsupported platforms.
- [x] Rerun the full Harness and CCG quality/security gates, push the final Head,
  resolve the new review threads, and wait for all CI jobs.

## Approved Claude-clean and global Skill migration extension

- [x] Preserve the user's missing global/project `.claude/` state and restore
  only static `CLAUDE.md` provenance files outside `.claude/`.
- [x] RED: add CCG tests for a Codex config and route under `~/.codex/ccg/`,
  Codex plugin instructions without `~/.claude/.ccg`, and zero `.claude/`
  writes during Codex-mode install.
- [x] GREEN: add the packaged `ccg route` entry point, update Codex-mode
  install/doctor/plugin guidance, rebuild the personal CCG source, and install
  the tested CLI/plugin without editing plugin cache.
- [x] RED→GREEN: make Harness initialization and Trellis-upgrade coverage
  Codex-only; report Harness/CCG-owned `.claude/` residue as drift.
- [x] RED→GREEN: add ownership-aware global Skill repository/profile/manifest
  projection, recoverable backup and rollback, project contract revision,
  link-free project snapshots, and global `AGENTS.md` discovery block.
- [x] Initialize and commit `I:\ai\codex-skill-repository`, migrate the approved
  45 personal Skills without deleting `I:\ai\skills`, retain 14 global platform
  Skills, and select `ponytail` plus `caveman` for this project.
- [x] Run focused failure/recovery tests, full Harness/CCG/Go gates, doctor,
  source verification, context/conflict audit, and repeat idempotency checks.

### 2026-07-26 Claude-clean Skill migration verification

- Global and project `.claude/` directories remain absent. Installed CCG route,
  config, hook, and plugin surfaces use `.codex/` only; plugin cache contains no
  forbidden Claude runtime references.
- `I:\ai\codex-skill-repository` is clean on `main` at commit
  `86292a3bb702240659d6f535c4f8a7c20257ebb6`, contains 45 Skill directories,
  has no remote and no `node_modules`.
- Global audit is `ready` with 14 Skills. Project ownership is schema 3 and
  records link-free `caveman` and `ponytail` snapshots. Repeated apply returned
  `unchanged`; backup ID is
  `2026-07-26T16-00-09-659Z-e29eaa75-b7cd-409d-ba16-7fcda4a2c40f`.
- `pnpm harness:test`: 160 passed, 1 platform-specific permission test skipped.
  Bundled CCG: 453/453. Codex-native CCG source: 456/456. Both CCG trees passed
  lint, typecheck, build, and diff checks. Go short tests and build passed.
- `pnpm doctor`, fixed-commit `pnpm verify:sources`, adapter context, and
  conflicts passed; conflict audit reported 0 blocking, 0 warning, 2 info, and
  15 pass. Security scan reported 0 findings; quality scan had no errors.

## Approved publishable Codex-only release extension

The following release work extends the accepted Claude-clean migration; it does
not create a second task or plan authority.

- [x] Finish and release the Codex-only CCG changes as `3.3.2`. Align
  `package.json`, marketplace, plugin manifest, and Codex configuration
  metadata; run the CCG gates; push a reviewable branch; merge only after its
  CI is green; then tag the verified `main` commit.
- [x] Replace `components/ccg-workflow/` with the exact tracked tree from that
  merged CCG release and update `harness.sources.json` with its repository,
  commit, tree, version, and integrity evidence. Never snapshot generated or
  ignored runtime files.
- [x] Move `grill-me` into the 14 bundled public Harness platform Skills and
  change ownership/migration code so fresh projection does not require an
  external global Skill. Preserve the previous external-dependency statement
  above solely as historical verification for the earlier migration.
- [x] Publish the existing 45-Skill repository as an authenticated private
  personal catalog pending provenance/licence review. Repair catalog hygiene
  before publishing (including tracked package manifests and exclusion of
  generated bytecode), record its canonical remote, and ensure public Harness
  operation never requires it.
- [x] Add a guided setup contract: prefer the host's native structured-choice
  control with a recommended option; otherwise present one numbered TTY choice
  at a time. The catalog choice must be private catalog, local Git catalog, or
  skip. Non-interactive callers must provide explicit flags and fail closed on
  ambiguity.
- [x] Implement a resumable Global Init command that inventories installed and
  authenticated state, installs/verifies Trellis, CCG Codex-only CLI/plugin,
  and the 14 public platform Skills, and then handles the private/local/skip
  personal-catalog choice.
- [x] Add read-only status adapters for Codex, Gemini, Grok, and Claude Code
  CLIs with normalized installed/auth states. For missing tools offer install
  or skip; for installed unauthenticated tools offer supported assisted login
  or later. Do not accept credentials as command arguments or persist them.
- [x] Put every network, install, and login operation behind its own native-UI
  or numbered-TTY preview and approval. Add explicit non-interactive flags for
  automation and tests; never reuse a prior approval for a different action.
- [x] Default Claude Code to skipped and label its install/login choice as
  leaving the zero-`.claude` acceptance profile. Test that Harness and CCG
  still perform zero `.claude/` reads/writes when this external branch is
  selected or declined.
- [x] Implement Project Init as a separate phase: discover stack evidence,
  recommend relevant catalog Skills, run the one-question protocol for gaps,
  summarize all constraints, obtain explicit approval, apply the owned contract
  and link-free Skills, run spec bootstrap plus applicable gates, then
  `mark-ready`.
- [x] Add focused tests and documentation for clean global platform projection,
  the guided/fallback/non-interactive decision paths, catalog opt-out, and a
  temporary-home end-to-end installation that proves zero `.claude/` creation.
- [x] Run all Harness/CCG quality, security, provenance, doctor, context, and
  conflict gates; push Harness `main` only after remote CI is green; then create
  a version tag from the verified commit.

### Release acceptance record

- CCG release commit `fd8f6711ab57dcf9e64c24a88bfdbc2c42b84ae8`,
  tree `d6af2528ebb1cc19be03a402d3042de3d7e32e15`, annotated tag
  `v3.3.2`, and CI run `30222907974`: passed.
- Harness snapshot binds the same CCG commit/tree at version `3.3.2`;
  staged source verification remains a release-candidate gate.
- Bundled Trellis MCP guidance is non-executing by default and uses fixed
  GitNexus `1.6.9` and ABCoder `v0.3.1` identities with recorded package/module
  digests; no mutable `latest` selector remains in that setup path.
- The first live temporary-home run exposed Codex `config.toml` ownership drift
  when plugin registration followed `ccg codex-mode install`. Global Setup and
  clean-install now register the plugin first and let Codex mode seal the final
  configuration; focused order and interface tests cover the regression.
- The private catalog was published only after the public Harness release to
  private repository `jed-zed/codex-skill-repository`, branch `main`, commit
  `0ba0035c0d86f521f33ddd7341f846abc568bf76`. Its canonical Git-blob manifest
  SHA-256 is
  `0b62874c91a28c8ad3c01c4ee40c15d55faf01ea466d94e0ad1f0f79aadead98`;
  clean-clone acceptance found `45/45` Skills and no `.claude/`, `.pyc`,
  credential, symlink, or submodule. It remains private because third-party
  licensing and redistribution scope are not yet complete.
- Live clean-install cloned public commit
  `6e4d6fd16db5fa3460b8548a6277c0485f284cf3` into a fresh temporary user
  directory, ran all nine phases through `markReady`, and passed with
  `claudeState=absent-after-every-phase`, `claudeDirectoryCount=0`. Report
  `.ccg/tasks/public-global-setup/live-clean-install-report.json` has SHA-256
  `957bc42952382545113f1e65e736536ef712f44581c69efd7bfad1dae08e2a31`;
  the temporary root was removed after acceptance.
- Harness `main` commit `6e4d6fd16db5fa3460b8548a6277c0485f284cf3`
  passed CI run `30225527765` and is the peeled target of annotated tag
  `v0.2.0` (tag object `f88bfaab207b5c80c7db4d59a9370f15e4f23d36`).

## Verification

```powershell
node --test .\tests\harness-adapter.test.mjs
node --test .\tests\harness-init-skill.test.mjs
node --test .\tests\harness-init-cli.test.mjs
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
pwsh -NoProfile -File .\scripts\doctor.ps1
pnpm --dir .\components\ccg-workflow lint
pnpm --dir .\components\ccg-workflow typecheck
pnpm --dir .\components\ccg-workflow test
pnpm --dir .\components\ccg-workflow build
```

## Rollback point

Before staging, retain the original personal CCG commit and Harness component
tree as rollback anchors. Component replacement is allowed only from the new
clean personal commit. Never touch or stage the two endpoint-protection-blocked
security reference files.

## Completion evidence

- Harness root tests: 99 passed, 0 failed, including three real replacement
  hard-kill boundaries, source residue rejection, snapshot rotation, full-tree
  npm identity under canonicalized Windows parent paths, linked Skill-export
  rejection, exact contract idempotence, and shared Windows `py -3` resolution.
- Local conflict audit: 0 blocking, 0 warnings, 3 information findings, 15
  checks passed.
- The imported personal CCG source is bound to commit
  `84d9dd80de74daa1a8ab81e399fef49c47d2043a` and Git tree
  `c8afbd5a0b9766e1bd3a0c42fee3610388a65cae`.
- Personal CCG lint, typecheck, 453 tests across 30 files, build, diff check,
  change analysis, quality scan, and production security scan passed.
- Native Go wrapper test and build passed.
- Harness script quality scan passed with 0 errors and 0 warnings; security
  scans for scripts and `harness-init` returned 0 findings.
- The Skill Creator validator reported `Skill is valid!`.
- Windows endpoint protection never entered the trusted tree: final source
  verification used the exact staged Git tree with the two blocked paths left
  unmaterialized, while their authoritative index blobs remained unchanged.
- Personal CCG GitHub CI run `30095082023` passed its full Node 20/22 Linux
  and Windows matrix plus both Go jobs.
- Harness GitHub CI run `30095603243` passed all ten jobs: Node 20/22 on
  Linux and Windows, Go on Linux/Windows/macOS, and bootstrap/doctor on
  Linux/Windows/macOS.
- Grok and Claude were not invoked.

### Additional repairs

- The user-level Trellis workflow-state hook now yields when the current
  project already registers its own local workflow-state hook.
- Projects without local Codex hook wiring retain the global fallback.
- The Harness doctor verifies the precedence marker and reports an unguarded
  duplicate as a warning.
- Rollback interruption now restores both the current component and its current
  source manifest before surfacing the failed post-restore gate.
- Windows lifecycle transactions launch `npm` and `pnpm` through their
  trusted JavaScript entry points beside Node.js, avoiding `.cmd` resolution
  failures without enabling a command shell.

### Secondary review repairs

- [x] Add real hard-kill boundaries before the replacement journal, during
  staged copy, and before the first live rename; recover deterministically.
- [x] Refuse sparse exclusions and ignored live component state before update.
- [x] Rotate superseded rollback snapshots.
- [x] Fingerprint complete ordinary global package trees and refuse inexact
  first adoption/restoration.
- [x] Reject linked/junction Skill export parents and verify staged copies.
- [x] Reuse the shared Python resolver for adapter task context.
- [x] Validate exact contract ownership and schema identity on repeat apply.
- [x] Recheck Windows MCP secret ACLs at launch and terminate child trees.
- [x] Run final Harness/CCG gates, source verification, doctor, and CI.

### Final review repair: terminal cleanup and monotonic policy state

- [x] Add failing hard-kill tests for commit finalization, completed rollback
  cleanup, and lock release after atomic tombstoning; add partial-tombstone
  recovery coverage.
- [x] Replace in-place recursive deletion of active transaction/lock state with
  strict atomic GC tombstones and idempotent startup cleanup.
- [x] Add a POSIX chmod race regression, then bind mode, ctime, uid, and gid in
  discovery/CAS comparisons without weakening content preservation.
- [x] Journal existing project and schema fingerprints as read-only
  preconditions; revalidate at prepare, pre-install, pre-commit, and committed
  finalization, rolling back targets on drift.
- [x] Make policy version direction authoritative: migrate intact older
  versions, reject same-version content conflicts, and reject future-version
  downgrade attempts without mutation.
- [x] Update initializer documentation and PR #2 description, rerun focused and
  full Trellis/CCG gates plus CI, reply to and resolve the GitHub review
  threads, then return the PR to Ready.

### Approved self-initialization repair

- [x] RED→GREEN: cover first-time apply into an existing `.harness/` containing
  `adapter.json`; preserve every existing byte and retain collision failures
  for initializer-owned targets.
- [x] RED→GREEN: expose `mark-ready --repo-root <path>`, promote only an intact
  approved contract, update ownership atomically, and return unchanged for an
  intact ready contract.
- [x] Add drift and rollback coverage for contract and ownership changes.
- [x] Canonicalize the installed project Schema so ownership digests are
  independent of checkout line endings.
- [x] Migrate intact legacy noncanonical Schema projections transactionally and
  pin exact-byte-owned tracked projections to LF.
- [x] Update the initializer Skill/CLI documentation.
- [x] Apply the approved self-hosting contract, run offline Harness/CCG,
  provenance, quality, and security gates, then invoke `mark-ready`.

Verification on the clean `main` checkout:

- `node --test tests/harness-init-cli.test.mjs`: 61 passed, 1 Windows-hosted
  POSIX permission case skipped.
- `pnpm harness:test`: 154 passed, the same POSIX permission case skipped.
- `pnpm ccg:test`: 453/453 passed; CCG lint, typecheck, and build passed.
- `go test -short ./...` and `go build ./...` passed.
- Doctor, source verification, context, and conflict audit passed offline; the
  audit reported 0 blocking, 0 warning, 3 informational findings, and 15
  passed checks.
- CCG change and structural quality scans passed with 0 errors; 44
  non-blocking initializer complexity warnings remain. The security scan
  reported zero Critical, High, Medium, or Low findings.
- `mark-ready` produced contract SHA-256
  `1eb835f84bc71b7e325f33ac00738cc75c2ecc83f249e948b9d7938eb87b9d10`;
  ownership matches it exactly and a repeated command returned `unchanged`.

- The ordered collaboration policy is canonical in
  `.agents/skills/harness-init/assets/collaboration-policy.md`; root and newly
  initialized `AGENTS.md` blocks are tested derived projections.
- Harness root tests passed 94/94; CCG lint, typecheck, build, and 451 tests
  passed; Go test/build passed.
- CCG change analysis, quality scan, and security scan passed. Quality retained
  25 non-blocking complexity warnings: 24 in the enlarged portable initializer
  module after PR #1's project-Skill work and one in a long initializer test;
  two apply to the extended `applyProjectContract()` function.
- Harness doctor, source verification, task-bound context, and conflict audit
  passed with 0 blocking and 0 warnings.
- Concurrent PR #1 commits through `5b874af` were integrated in an isolated
  worktree. Six overlapping initializer/doc/test files were reconciled while
  retaining the PR's Skill repository and project-copy behavior; the original
  dirty checkout was not modified. PR #1's 10 remote CI jobs are green at this
  base commit, including `Go / ubuntu-latest`.
- Current project guide examples now use `rg`; generic Trellis Skill/template
  search examples are interpreted through the canonical router without
  modifying Trellis or plugin source.
- PR #2 review repair added a project-scoped initializer lock, SHA-256 plus
  file-identity CAS, pending journal, verified backups, ownership-last commit,
  and deterministic rollback/finalization after hard process termination.
- Ownership schema v2 records the pinned source and rendered block digests.
  PR #1 ownership, the PR #2 schema-v1 block form, an interrupted legacy split
  state, and an untouched older policy all have covered migrations; edited
  blocks or pinned sources still fail closed.
- Direct cross-repository apply now writes
  `.harness/policies/collaboration-policy.md`, so the generated canonical path
  exists without exporting `harness-init` first.
- Final review-repair verification passed: 35 focused initializer tests and
  111 complete Harness tests; Trellis context validation; CCG component lint,
  typecheck, 451 tests, and build; change analysis; security scan with zero
  findings; doctor; source verification; and conflict audit with 0 blocking,
  0 warning, 3 informational findings, and 15 passed checks.
- The CCG structural quality scan passed with 0 errors and 36 non-blocking
  warnings in the portable initializer module. Eleven warnings are added by
  the lock/journal/CAS/recovery paths required by this review; no gate,
  validation, backup, or recovery branch was removed to reduce that count.
- After PR #1 merged as `370f1f6`, PR #2 was rebased from `5b874af` onto the
  merged `main`. Seven overlapping initializer, task, documentation, and test
  files were reconciled without dropping PR #1's later hardening. In
  particular, ownership schema v2 now retains the installed project-schema
  SHA-256, legacy ownership with or without that field migrates only after the
  installed schema matches the distribution asset, and changed schema bytes
  still fail closed.
- Post-rebase local verification passed: 37 focused initializer tests, 122
  complete Harness tests, CCG lint/typecheck/build and 453 tests across 30
  files, source verification at CCG commit `84d9dd8` and tree `c8afbd5`,
  doctor, and conflict audit with 0 blocking, 0 warning, 3 informational
  findings, and 15 passed checks.
- Post-rebase CCG change and security scans passed with zero findings. The
  structural quality scan passed with 0 errors and 37 non-blocking complexity
  warnings in the portable initializer module. The first full CCG test run hit
  one Windows temporary-directory `ENOTEMPTY` cleanup race; the isolated 13-test
  file and the complete 453-test suite both passed on immediate rerun.
- The automatic external-intelligence pre-route was intentionally skipped:
  the accepted Trellis task forbids Grok for this work, while the local route
  is enabled and could invoke it. All CCG verification ran locally.
- Final-review local repair passed 43 focused initializer tests on Windows
  (42 passed and the POSIX-only `chmod 0600` case skipped), plus the complete
  Harness suite with 135 tests (134 passed, the same POSIX case skipped).
- CCG lint, typecheck, build, and 453 tests across 30 files passed. Native Go
  `go test -short ./...` and `go build` passed.
- CCG change analysis passed. Structural quality passed with 0 errors and 39
  non-blocking complexity warnings; the added transaction/version validation
  branches were retained instead of weakening the reviewed safety gates.
  Security scans for both `harness-init` and `scripts/` reported zero findings.
- Source verification, task-bound context, doctor, and conflict audit passed;
  the audit reports 0 blocking, 0 warning, 3 informational findings, and 15
  passed checks. Trellis 0.6.9 has no `trellis check` command, so the
  repository's context, doctor, tests, and source gates provide the supported
  equivalent validation.
- Repository visibility is now declared as `public` in
  `harness.sources.json` and checked against live GitHub state by doctor,
  matching the repository owner's explicit decision.
- Harness CI run `30172566509` passed all ten jobs on implementation Head
  `80a7ece`: Node 20/22 on Linux and Windows, Go on Linux/Windows/macOS, and
  bootstrap/doctor on Linux/Windows/macOS. The Linux jobs executed the POSIX
  permission-race regression; both Windows jobs passed the ACL-safe CCG suite.
- PR #2 targeted `main`; the two review threads addressed by `80a7ece` were
  resolved. A later review on `9a8e47f` added one P1 about unauthenticated
  repository-authored recovery residue and one P2 about PID reuse, which the
  subsequent follow-up fixed before the final Head `486d67e` merged as
  `6633876` on 2026-07-25.
- The follow-up local suite passes 139 Harness tests (138 passed, the
  Windows-hosted POSIX chmod case skipped), CCG lint/typecheck/build and
  453/453 tests, Go short tests/build, change analysis, and security scan with
  zero findings. Structural quality passes with 0 errors and 41 non-blocking
  complexity warnings; doctor, task context, source verification, and conflict
  audit also pass with 0 blocking and 0 warnings.
- Harness CI run `30173637878` passed all ten jobs on Head `291e16a`,
  including Linux process/permission coverage and both Windows ACL-safe Node
  matrices. Both new review threads have commit-linked replies and are resolved.
- Metadata-only Head `1b49e38` exposed a Windows Node 20 fallback-identity race:
  the concurrent-apply test accepted a second initializer after the platform
  query fell back. The fix compares the complete fallback process-instance
  identity for the current PID; ten repeated focused runs and the full local
  Harness suite pass before resubmission.
