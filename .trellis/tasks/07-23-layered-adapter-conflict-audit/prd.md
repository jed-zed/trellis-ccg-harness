# Adopt layered adapter and audit Trellis CCG conflicts

## Goal

Adopt the recommended layered-adapter architecture without losing the complete personal CCG source snapshot, then strictly detect and document conflicts between Trellis and CCG. Trellis remains the lifecycle authority, CCG remains the model/evidence authority, and the Harness adapter becomes the only supported bridge between them.

## Requirements

- Keep `components/ccg-workflow/` byte-identical to the recorded personal CCG Git tree.
- Add a committed, secret-free Harness adapter contract with explicit ownership, state, model, hook, and provider policies.
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

## Acceptance Criteria

- [x] `node scripts/harness-adapter.mjs context` emits a redacted canonical context bound to the active Trellis task.
- [x] `node scripts/harness-adapter.mjs conflicts` returns deterministic findings and a non-zero exit only for blocking conflicts.
- [x] The adapter refuses Claude and never exposes API key values.
- [x] The custom Grok API probe validates `/v1/models` and reports chat/search availability without storing credentials; missing or disabled Grok remains an optional, non-blocking state.
- [x] Personal CCG Git tree verification returns `65997b917a3d24bd24cd06d272661f3137c8fd46`
  for commit `ff425b115410f7fc508116655825647422419b57`.
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

## Constraints

- Do not call Claude during planning, implementation, review, or verification.
- Do not call Grok during this implementation; retain only the optional provider contract and offline tests.
- Do not modify or restage the two Windows endpoint-protection false-positive files.
- Do not write the supplied API key to Git, task artifacts, shell history, logs, or test fixtures.
- Ordinary CI remains offline and does not call paid models.

## Out of Scope

- Removing the personal CCG snapshot from the private repository.
- Replacing the CCG official Grok CLI/ACP implementation.
- Mutating unrelated user-level Codex content outside ownership-aware managed
  blocks and manifest entries.
- Enabling Claude assets generated by Trellis.
