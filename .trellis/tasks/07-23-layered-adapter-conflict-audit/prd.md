# Adopt layered adapter and audit Trellis CCG conflicts

## Goal

Adopt the recommended layered-adapter architecture without losing the complete personal CCG source snapshot, then strictly detect and document conflicts between Trellis and CCG. Trellis remains the lifecycle authority, CCG remains the model/evidence authority, and the Harness adapter becomes the only supported bridge between them.

## Requirements

- Keep `components/ccg-workflow/` byte-identical to the recorded personal CCG Git tree.
- Add a committed, secret-free Harness adapter contract with explicit ownership, state, model, hook, and provider policies.
- Keep GitHub visibility `public` as explicitly chosen by the repository owner,
  and validate that live state against `harness.sources.json`.
- Treat `.trellis/tasks/<task>/` as the canonical task and plan authority.
- Treat `.ccg/tasks/` and `.codex/ccg/` as ignored runtime evidence only.
- Run CCG from the installed CLI/plugin version matching `harness.sources.json`; do not execute source-tree helper scripts as the runtime integration path.
- Default to inline Codex execution and disable Claude for this Harness workflow. Gemini remains an allowed helper. Grok support stays available but is disabled by default and must not block the workflow while no working provider is configured.
- Keep the custom OpenAI-compatible Grok API adapter separate from the official Grok CLI/ACP adapter. Never reinterpret `GROK_API_KEY` as `XAI_API_KEY`.
- Read the custom Grok base URL and key from process environment only; never persist or print the key.
- Detect version drift, source drift, task/plan authority drift, command namespace collisions, hook overlap, dispatch conflicts, provider confusion, tracked runtime state, and package-manager drift.
- Extend the Harness doctor and CI with deterministic offline adapter tests.
- Produce a conflict matrix with severity, evidence, current disposition, and recommended action.
- Treat the GPT Pro whole-project review as new blocking evidence and remediate
  every locally confirmed Critical/Major finding before merge.
- Make downloaded wrapper execution fail closed: use only the personal release,
  bind every platform asset to a trusted SHA-256 digest, and verify bytes before
  setting executable permissions or creating a process.
- Pin executable MCP/npm dependencies, remove automatic privilege escalation,
  and keep a machine-readable source/integrity inventory.
- Make Codex-mode installation reversible and ownership-aware: merge shared
  files, back up collisions, record installed digests, and never remove
  user-modified content.
- Disable the embedded public `ccg-workflow@latest` self-update path in the
  personal distribution. Harness updates must use the personal repository,
  explicit commit/tree verification, full gates, atomic replacement, and a
  rollback snapshot.
- Make `init`, `doctor`, update verification, and root scripts return reliable
  non-zero statuses on required failures.
- Quote generated hook paths and cover Windows paths containing spaces and
  non-ASCII characters.
- Keep secrets out of process arguments and cross-runtime MCP mirroring; apply
  owner-only permissions to managed secret material and backups.
- Add root Ubuntu, Windows, macOS, Node 20/22, Go, PowerShell doctor, and offline
  contract gates.
- Make CCG's global Codex hook yield or delegate to Trellis whenever `.trellis/`
  is present, so Trellis remains the sole lifecycle authority.
- Add a project-owned `harness-init` Skill as the first entry point for adopting
  the Harness. It must inspect repository evidence before asking questions,
  use the `grill-me` one-question protocol for unresolved user decisions, and
  forbid environment mutation until the user approves the complete constraint
  summary.
- Make the initializer capture business, repository, architecture, toolchain,
  quality, security, provider, hook, provenance, CI, update, and rollback
  constraints in a secret-free project contract, then route code-backed
  guideline generation through `trellis-spec-bootstrap`.
- Allow first-time initialization to add owned contract files inside an
  existing safe `.harness/` directory without overwriting its user-owned
  `adapter.json` or any other pre-existing entry.
- Add an ownership-aware `mark-ready` transition that changes only an approved
  contract's status after required gates pass, updates the recorded contract
  digest atomically, and fails closed on ownership or concurrent-file drift.
- Add one ordered collaboration policy for Trellis, CCG, Ponytail `full`,
  Caveman, `rg`, fast-context, and CodeGraph. System/user instructions,
  accepted Trellis artifacts, architecture, and required CCG gates remain
  authoritative in that order; lower layers may not weaken higher ones.
- Keep Ponytail limited to minimizing implementation inside accepted behavior,
  artifacts, tests, reviews, documentation, security, accessibility, error
  handling, and quality gates. Keep Caveman limited to routine conversation;
  exact technical evidence and structured artifacts remain complete.
- Route exact names and text to `rg`, indexed symbol/call/impact questions to
  CodeGraph, and natural-language discovery or unindexed repositories to
  fast-context. Use a second semantic tool only for a stated gap, check
  `codegraph status` when freshness is uncertain, respect data-egress policy,
  and keep ace-tool disabled unless Harness explicitly restores it.
- Make the policy active in this repository and automatically inherited by
  newly initialized projects through the existing `harness-init` source and
  ownership-aware apply path. Preserve Trellis-managed and user-owned
  `AGENTS.md` content.
- Keep Codex-native Harness and CCG operation completely independent from
  user-level and project-level `.claude/` directories. Codex-mode install,
  routing, doctor, initialization, and plugin instructions must not create,
  restore, read as a runtime dependency, or write `~/.claude/` or project
  `.claude/`.
- Put the Codex CCG runtime configuration and route entry point under
  `~/.codex/ccg/` or the installed Codex plugin/CLI package. Legacy
  Claude-oriented CCG commands may remain available to other users, but the
  Harness and Codex-mode paths must never invoke them.
- Initialize Trellis project integrations for this distribution through
  `.agents/` and `.codex/` only. The absence of generated project `.claude/`
  assets is the expected healthy state.
- Bundle only the 13 Harness/Trellis core Skills in the public distribution.
  `grill-me` is third-party software and must never be projected by default.
- Offer the pinned `grill-me` plus `grilling` pair as one optional global
  dependency unit. A declined dependency skips the pair without blocking core
  initialization. An approved upgrade from the legacy self-contained
  `grill-me` is atomic and refuses user-modified content.
- Publish the 45 personal Skills as a separate private catalog until each
  Skill's provenance and licence permit public redistribution. The public
  Harness baseline must work without that catalog; authenticated users may opt
  into it, use another local Git catalog, or skip it.
- Migrate selected personal Skills into project-local link-free owned snapshots
  only after an explicit source and selection decision.
- Split guided initialization into two explicit phases. Global Init installs
  and verifies the Harness-wide runtime; Project Init discovers one repository,
  recommends project Skills from its technology choices, captures its complete
  constraints, obtains approval, and applies the contract plus required gates.
- During Global Init, inspect installed and authenticated state for the Codex,
  Gemini, Grok, and Claude Code CLIs without mutating them. Offer installation
  for missing optional/required tools and assisted login for installed but
  unauthenticated tools, with separate explicit approval before every network,
  installation, or login action.
- Skip Claude Code by default because installing or authenticating it may create
  `~/.claude/`. Opting into Claude authentication exits the zero-`.claude`
  acceptance profile, but Harness and CCG still may not read or write any
  `.claude/` path.
- Make global Skill projection, project selection revision, backup, rollback,
  and global `AGENTS.md` repository discovery ownership-aware, transactional,
  idempotent, and fail-closed on user edits or concurrent drift.

## Approved third-party initialization consent extension

This section supersedes the earlier fixed `14 global / 45 catalog / 2 project`
release assumptions. Their completed migration evidence remains historical;
future initialization follows this contract.

- Core initialization remains `harness-init + Trellis + CCG` and is fully
  usable when every third-party candidate is declined.
- The initializer presents four separate groups: global Skills, global
  plugins, project Skills, and MCP/CLI. Every third-party item is unselected by
  default and requires a candidate-specific approval bound to the exact source
  manifest digest.
- Global Skill candidates are one atomic `grill-me + grilling` unit from
  `mattpocock/skills` commit
  `ed37663cc5fbef691ddfecd080dff42f7e7e350d`, plus Caveman `v1.9.1`
  from `JuliusBrussee/caveman` commit
  `0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0`. They are recommended
  separately and remain unselected until the user explicitly approves them.
- Global plugin candidate: Ponytail `4.8.4` from commit
  `bc9ee949d5f439e8b9f3bb92c6d6d3d1e6ebd324`. Plugin installation, lifecycle
  hook trust, and global `full` default are three independent approvals.
- Project candidates from the same pinned Matt Skills commit are
  `diagnosing-bugs`, `tdd`, `codebase-design`,
  `resolving-merge-conflicts`, `writing-great-skills`, `prototype`,
  `improve-codebase-architecture`, and `domain-modeling`.
  `writing-great-skills` is recommended only for Harness/Skill maintenance.
  `improve-codebase-architecture` must disclose and obtain approval for
  `codebase-design`, `grilling`, and `domain-modeling` as dependencies.
- MCP/CLI candidates are separate from Skills:
  `@colbymchenry/codegraph@1.5.0` at commit
  `ea72e1b190921232aa7bd02e96bef5bbe4fe0ab6`,
  `fast-context-mcp@1.5.2` at commit
  `3595cfcb2cf1c50660351165cdb71101d0996747`, and ripgrep `15.2.0` at
  commit `e89fff89ac9af12e8d4ce9d5fd07beb408ca730f`.
  CodeGraph installation never authorizes `codegraph init`. fast-context
  warns that query text, repository trees, and local search results are sent
  to Windsurf; strict-data-boundary projects leave it unselected.
- Matt Pocock candidates outside the approved subset — `ask-matt`,
  `setup-matt-pocock-skills`, `grill-with-docs`, `triage`, `to-spec`,
  `to-tickets`, `implement`, `wayfinder`, `code-review`, `research`,
  `handoff`, and `teach` are excluded from the install catalog.
- Each preview includes purpose, repository, exact source path and immutable
  revision, licence, scope, dependencies, write paths, scripts/hooks/
  executables/network behavior, data-egress risk, and update/rollback/
  uninstall behavior.
- Source acquisition and installation use immutable commit/version/integrity
  facts only. `main`, `latest`, and `@latest` are forbidden as execution
  selectors.
- Approval records are secret-free and are written to the approved project
  contract and ownership/source manifests. Third-party source, plugin cache,
  MCP source, and Skill contents are never edited by Harness.
- Installation reuses the authenticated transaction, CAS drift checks,
  journal, backup, ownership-last commit, recovery, and rollback mechanisms.
  Existing exact installations are unchanged; source, target, or user-edit
  drift fails closed.
- Ponytail, Caveman, fast-context, and CodeGraph are visibly recommended in
  their correct groups. Recommendations never preselect a candidate or count
  as approval; an explicit yes is required before installation.

## Acceptance Criteria

- [x] `node scripts/harness-adapter.mjs context` emits a redacted canonical context bound to the active Trellis task.
- [x] `node scripts/harness-adapter.mjs conflicts` returns deterministic findings and a non-zero exit only for blocking conflicts.
- [x] The adapter refuses Claude and never exposes API key values.
- [x] The custom Grok API probe validates `/v1/models` and reports chat/search availability without storing credentials; missing or disabled Grok remains an optional, non-blocking state.
- [x] Personal CCG Git tree verification returns `8fcfd2b70efa6a2aa07b692911cbafc85616522c`
  for commit `88222edd298dc4254d7fd7151f48682618063139`.
- [x] Adapter unit tests, CCG lint/typecheck/tests/build, Harness doctor, and
  GitHub CI pass. Personal CCG run `30095082023` and Harness run
  `30095603243` passed across their full Linux, Windows, macOS, Node, Go,
  bootstrap, doctor, provenance, and offline-security matrices.
- [x] Documentation clearly distinguishes the whole Harness from its internal integration adapter.
- [x] A wrong wrapper digest is rejected before the candidate is executable or
  invoked; all six personal release digests are covered by tests.
- [x] No automatic `sudo`, mutable MCP package selector, token-bearing command
  argument, or public CCG self-update remains in an executable path.
- [x] Codex-mode install/uninstall round-trips pre-existing global AGENTS/hooks
  and preserves user modifications.
- [x] `ccg init`, `ccg doctor`, Harness doctor, and update transactions expose
  machine-reliable failure status and rollback evidence.
- [x] Source verification binds repository, commit, tree, index, unstaged, and
  untracked component state.
- [x] Root update, uninstall, and rollback transactions have interruption and
  user-configuration-preservation tests.
- [x] Normal-clone and worktree hook fixtures prove that CCG never introduces
  `.ccg/tasks` lifecycle guidance inside a Trellis project.
- [x] `harness-init` is discoverable from `.agents/skills/`, asks at most one
  unresolved decision per turn with a recommendation and trade-off, and never
  asks for facts already available in the repository.
- [x] Harness initialization writes no project/global state until explicit
  approval, produces a complete secret-free project contract, and finishes
  with offline doctor/conflict verification plus a clear residual-risk handoff.
- [x] Replacement recovery passes real hard-kill tests before journal creation,
  during staged copy, and immediately before the first live-component rename.
- [x] Sparse exclusions and ignored live component state fail closed before
  replacement; only the latest rollback snapshot remains after repeated update.
- [x] Ordinary global package identity covers the complete tree and first-time
  adoption refuses an inexact pre-existing baseline.
- [x] `harness-init` export rejects linked target parents, and repeated contract
  apply verifies exact ownership plus contract/schema digests.
- [x] Adapter context reuses the shared Python resolver including Windows
  `py -3`; the CCG MCP launcher rechecks Windows ACLs and terminates full child
  trees.
- [x] One canonical collaboration-policy asset defines the full authority,
  Ponytail, Caveman, and search-routing contract.
- [x] Root `AGENTS.md` contains a derived, clearly marked collaboration block
  without changing the Trellis-managed block or existing Harness block.
- [x] `harness-init apply` creates or preserves `AGENTS.md`, adds exactly one
  owned collaboration block, rejects malformed/conflicting blocks, and remains
  idempotent.
- [x] Exported `harness-init` Skills include the canonical policy asset, so new
  projects inherit it without installing or modifying external Skills or MCPs.
- [x] Focused initializer tests plus Harness change, quality, security, doctor,
  conflict, and source gates pass.
- [x] A concurrent `AGENTS.md` edit after discovery is detected and preserved;
  initialization fails instead of silently overwriting it.
- [x] Every interrupted commit step is recoverable after normal failure and
  hard process termination, with no orphaned initializer files after recovery.
- [x] PR #1 ownership and an untouched older policy projection migrate to
  ownership schema v2; a user-edited managed block still fails closed.
- [x] Direct cross-repository apply, without exporting the Skill first, creates
  the local canonical path named by the generated `AGENTS.md` block.
- [x] Completed transaction, rollback, and lock directories enter an atomic
  tombstone state before recursive deletion; interrupted cleanup resumes
  without requiring partially deleted internal metadata.
- [x] Project-policy CAS detects POSIX mode, ctime, uid, and gid drift and
  preserves concurrent permission tightening; unsupported ACL/xattr metadata
  boundaries are explicit.
- [x] Existing `project.json` and `project.schema.json` fingerprints are
  journaled as read-only transaction preconditions and revalidated before
  replacement, before commit, and during finalization.
- [x] Policy upgrades are monotonic: older supported versions may upgrade only
  from intact projections, same-version digest conflicts fail closed, and an
  initializer never downgrades a newer project policy.
- [x] Repository-authored transaction residue cannot authenticate as Harness
  recovery state and is rejected before project files are replayed.
- [x] Lock and transaction owners bind PID to a process-instance identity so a
  reused live PID does not block hard-interruption recovery.
- [x] A repository with an existing `.harness/adapter.json` can complete
  first-time contract apply while preserving the adapter byte-for-byte; any
  pre-existing initializer-owned target still fails closed.
- [x] `harness-init mark-ready` atomically promotes an intact approved contract
  and its ownership digest, is idempotent after success, and refuses contract,
  schema, policy, block, or ownership drift without mutation.
- [x] Codex-mode CCG install, route, doctor, plugin guidance, and Harness
  initialization pass tests proving they do not create or depend on any
  `.claude/` directory.
- [x] The project remains functional with root `.claude/` absent, while
  `.agents/`, `.codex/`, Trellis hooks, Skills, and adapter gates pass.
- [x] The 14 platform Skills are globally available from owned Harness
  projections, the 45 personal Skills are recoverably migrated to the local
  Skill repository, and `ponytail` plus `caveman` are installed in this project
  as ordinary link-free snapshots.
- [x] Repeated global/project Skill apply is unchanged; edited projections,
  linked sources, invalid ready revisions, transaction interruption, and
  concurrent drift fail closed or recover deterministically.
- [x] The released Codex-only CCG is versioned `3.3.2`, all user-facing
  package/plugin/config metadata agrees, and the Harness snapshot plus
  `harness.sources.json` bind its exact committed tree.
- [ ] A fresh Harness installation projects exactly the 13 bundled
  Harness/Trellis core Skills. Declining all third-party candidates installs no
  `grill-me`, `grilling`, Caveman, Ponytail, project Skill, MCP, CLI, hook, or global
  Ponytail default and still completes ordinary initialization.
- [ ] Initial setup offers host-native structured choices where the host
  supports them; the TTY fallback presents numbered one-at-a-time choices, and
  automation has explicit non-interactive flags with no implicit selection.
- [ ] Global Init reports installation and authentication status for Codex,
  Gemini, Grok, and Claude Code; installs/verifies Trellis, the CCG Codex-only
  CLI/plugin, and all 13 core platform Skills; then presents separate,
  default-unselected global Skill, global plugin, and MCP/CLI approval groups.
- [ ] Every network access, tool installation, and authentication action has a
  distinct preview and approval. Declining one optional action leaves a clear
  skipped/residual status instead of blocking unrelated offline setup.
- [ ] Claude Code is skipped by default. If the user explicitly selects its
  installation or login, the result is marked outside the zero-`.claude`
  acceptance profile while the Harness/CCG no-`.claude` invariant remains.
- [ ] Project Init derives recommended project Skills from repository evidence
  and confirmed technology choices, obtains approval for the complete project
  constraint summary plus every disclosed dependency, writes the approved
  third-party selections into the owned contract, and runs the required
  doctor, conflict, quality, security, and readiness gates.
- [x] Interactive Project Init accepts a complete non-Skill draft contract,
  presents default-unselected catalog and project-third-party choices, and only
  after final approval atomically compiles the source digest, exact selections,
  reasons, and managed paths into the approved contract before installation.
  An approved contract only permits confirmation of its recorded selection;
  non-interactive mode continues to consume an exact approved contract.
- [ ] Focused tests cover reject-all, partial approval, dependency approval and
  rejection, repeat execution, legacy `grill-me` atomic migration, user-edit
  drift, hard interruption recovery, unavailable external sources, Ponytail
  hook rejection independent of plugin installation, missing CodeGraph index,
  and fast-context rejection for strict data boundaries.
- [ ] Setup offers three personal-catalog choices: the authenticated private
  catalog, an existing local Git catalog, or skip. Its default/public baseline
  does not require the private catalog.
- [ ] A clean-install acceptance run under a new temporary user home completes
  the supported bootstrap and initialization flow and proves no user-level or
  project `.claude/` directory was created.
- [ ] Harness and CCG changes are pushed only after all required local and
  remote CI gates are green; release tags are created from the verified `main`
  commits.
- [x] PR #2 description, review threads, and verification evidence matched its
  final post-fix Head `486d67e`; the PR merged to `main` as `6633876` on
  2026-07-25.

## Constraints

- Do not call Claude during planning, implementation, review, or verification.
- Do not restore or create `C:\Users\29933\.claude` or project `.claude/`.
- Do not call Grok during this implementation; retain only the optional provider contract and offline tests.
- Do not use Caveman conversational compression for this task.
- Do not merge the implementation branch. Push it and create a Draft PR.
- Do not modify or restage the two Windows endpoint-protection false-positive files.
- Do not write the supplied API key to Git, task artifacts, shell history, logs, or test fixtures.
- Ordinary CI remains offline and does not call paid models.

## Out of Scope

- Removing the personal CCG snapshot from the public repository.
- Replacing the CCG official Grok CLI/ACP implementation.
- Mutating unrelated user-level Codex content outside ownership-aware managed
  blocks and manifest entries.
- Enabling or restoring Claude assets generated by Trellis.
- Editing Ponytail/Caveman Skills, CodeGraph/fast-context MCPs, plugin caches,
  or the two protected CCG security reference files. Canonical personal CCG
  source may change only for the approved Codex decoupling and must be rebuilt,
  tested, and installed through supported package/plugin paths.
- Automatically creating or refreshing a CodeGraph index.
