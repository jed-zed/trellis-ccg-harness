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
- [x] PR #2 description, review threads, verification evidence, and Ready state
  match the final post-fix Head.

## Constraints

- Do not call Claude during planning, implementation, review, or verification.
- Do not call Grok during this implementation; retain only the optional provider contract and offline tests.
- Do not modify or restage the two Windows endpoint-protection false-positive files.
- Do not write the supplied API key to Git, task artifacts, shell history, logs, or test fixtures.
- Ordinary CI remains offline and does not call paid models.

## Out of Scope

- Removing the personal CCG snapshot from the public repository.
- Replacing the CCG official Grok CLI/ACP implementation.
- Mutating unrelated user-level Codex content outside ownership-aware managed
  blocks and manifest entries.
- Enabling Claude assets generated by Trellis.
- Editing Ponytail/Caveman Skills, CodeGraph/fast-context MCPs, plugin caches,
  or the recorded personal CCG component snapshot.
- Automatically creating or refreshing a CodeGraph index.
