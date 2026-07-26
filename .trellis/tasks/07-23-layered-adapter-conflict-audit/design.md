# Design: Layered Harness Adapter

## Architecture

```text
Trellis lifecycle layer
  task / PRD / design / implementation plan / spec / finish
            |
            v
Harness integration adapter
  canonical context / policy / conflict audit / version contract / provider boundary
            |
            v
CCG intelligence layer
  Codex / Gemini / Grok / GPT Pro / quality gates
```

The complete Trellis + personal CCG combination is the Harness. The middle layer is only its internal adapter, not a third framework.

## Authority contract

| Concern | Authority | Adapter behavior |
|---|---|---|
| Task identity and status | Trellis | Resolve via `.trellis/scripts/task.py current`; expose a read-only canonical context |
| Requirements and plans | Trellis task directory | Pass paths/digests to CCG; never let CCG overwrite lifecycle files |
| Model routing and evidence | CCG | Keep evidence under ignored CCG runtime paths |
| Personal implementation | Personal CCG Git tree | Verify against `harness.sources.json` |
| Runtime CCG | Installed CLI/plugin | Require the same version as the personal source manifest |
| Cross-layer policy | Harness adapter | Fail closed on blocking drift and redact all credentials |

## Model policy

- Codex is the sole workspace owner.
- Gemini is a bounded read-only analysis/review helper.
- Grok is an optional external intelligence helper and is disabled by default until a working provider is configured.
- Claude is disabled by default in this Harness and explicitly disabled for this task.
- GPT Pro remains an explicit manual evidence route.

## Claude-clean Codex boundary

The prior “generated Claude assets are present but inert” disposition is
superseded by the user's approved isolation requirement. Healthy Codex-mode
state has no Harness- or CCG-owned files under user-level or project-level
`.claude/`.

- Trellis projects in this distribution project platform assets only to
  `.agents/` and `.codex/`.
- Codex-native CCG configuration lives under `~/.codex/ccg/`; route execution
  is exposed by the installed CCG CLI/plugin package instead of a
  `~/.claude/.ccg/engine/...` path.
- Codex plugin instructions use that stable CLI route and explicitly keep
  Claude disabled. They do not call Claude wrappers.
- Legacy Claude-mode source can remain for compatibility outside this Harness,
  but no Codex-mode command imports it as runtime state or creates `.claude/`.
- Conflict audit treats Harness/CCG-owned `.claude/` residue as drift, while
  preserving unrelated user-owned content in projects that are not being
  cleaned by an explicitly approved migration.

## Grok provider boundary

Two adapters are intentionally distinct:

1. `official-grok-cli-acp` uses the CCG official CLI transport and `XAI_API_KEY` or isolated browser OAuth.
2. `openai-compatible-grok-api` uses `HARNESS_GROK_BASE_URL` and `HARNESS_GROK_API_KEY`.

The second adapter may probe models and chat availability only when invoked explicitly with environment credentials. It must not claim Web/X evidence support unless a live request returns source-backed evidence. A missing or disabled Grok provider is non-blocking. No key or bearer header may enter output, logs, Git, task files, or error messages.

## Conflict policy

Findings use `blocking`, `warning`, or `info`.

- Blocking: source/version authority drift, tracked runtime state, missing canonical task, forbidden model route, provider credential confusion.
- Warning: user/project hook overlap, unavailable optional API, missing optional plugin cache.
- Info: inert nested workflow files and other non-runtime references.

The conflict command exits `2` when any blocking finding exists and `0` otherwise.

## Hook policy

The project Trellis `UserPromptSubmit` hook remains project-local. CCG is invoked through the plugin/adapter and does not require a second project hook. User-level hook overlap is detected and reported, but the Harness does not rewrite user configuration automatically.

The user-level Trellis hook is a fallback for workspaces without project-local
Codex hook wiring. When a project registers its own
`.codex/hooks/inject-workflow-state.py`, the global fallback detects it and
exits without output. The adapter verifies the precedence marker so a future
global-hook update cannot silently reintroduce duplicate context.

The personal CCG Codex-mode hook must also detect `.trellis/`. It may delegate
to Trellis when no project hook is available, or yield when the project hook is
authoritative, but it must never emit `.ccg/tasks`, Claude, or CCG lifecycle
instructions inside a Trellis project.

## Personal CCG supply-chain boundary

`third-party-sources.json` is the reviewed source inventory for executable
downloads and npm-backed MCP tools. Wrapper assets come only from the personal
fork's `preset` release and are bound to the six recorded SHA-256 digests.
Download candidates remain non-executable until their digest matches. Version
execution is a secondary compatibility check after integrity, never the trust
decision.

Npm-backed executable selectors are exact versions. Automatic `sudo` is
forbidden. Secret-bearing MCP entries are not mirrored across runtimes; each
runtime resolves its own environment reference or requires explicit local
configuration.

## Codex-mode ownership transaction

Shared global files use managed blocks or structured entry merging. Dedicated
files are installed with:

1. an original-byte backup when a collision exists;
2. a recorded original digest and installed digest;
3. an ownership manifest inside `~/.codex/.ccg/`;
4. atomic writes;
5. uninstall that removes/restores only when the current installed digest still
   matches, otherwise reports the user modification and leaves it untouched.

Malformed shared configuration fails closed and preserves original bytes.

## Harness update transaction

The root Harness, not embedded CCG npm update code, owns component upgrades:

1. resolve Python and required tools without assuming a single executable name;
2. fetch the personal CCG repository at an explicit commit;
3. verify authoritative remote, commit, clean tracked tree, and Git tree;
4. stage replacement content in a private temporary directory;
5. run source, lint, typecheck, test, build, adapter, doctor, and security gates;
6. atomically replace component/runtime state and retain a rollback snapshot;
7. commit a machine-readable transaction record only after success.

Uninstall removes only Harness-owned installed state. Rollback restores the last
verified snapshot and never rewrites unrelated user configuration.

The replacement journal is durable before any snapshot/staging side effect.
Recovery distinguishes live-only, snapshot-only, and live-plus-snapshot states
from content identities instead of requiring a snapshot that may not exist yet.
Sparse exclusions and any ignored live component path are unsupported and fail
closed before replacement. Once a newer transaction commits, its predecessor's
snapshot is no longer rollback-eligible and is removed.

Ordinary global npm packages are fingerprinted by their full content tree.
Harness will not first-adopt a pre-existing ordinary Trellis package because a
version selector cannot reproduce local patches byte-for-byte. CCG links remain
restorable by canonical source path.

## Project initialization Skill

`.agents/skills/harness-init` is the project-owned adoption entry point. It is
kept outside the personal CCG component so lifecycle/bootstrap policy remains a
Harness concern and Trellis upgrades cannot silently replace it.

The Skill uses a two-phase contract:

1. **Discovery and grilling (read-only):** inspect repository structure,
   instructions, manifests, existing specs, Git state, hooks, CI, and provider
   configuration; separate confirmed facts from unresolved user decisions; then
   apply the `grill-me` protocol one question at a time.
2. **Approved initialization:** only after explicit approval, materialize a
   secret-free `.harness/project.json`, initialize or reconcile Trellis/CCG
   project assets, invoke `trellis-spec-bootstrap` for code-backed guidelines,
   and run offline doctor/conflict gates.

The contract template records business purpose, ownership authorities,
toolchain, quality gates, security boundaries, provider policy, provenance,
update, rollback, and CI requirements. Credentials and secret values are never
contract fields. Grok, Claude, GPT Pro, paid calls, network calls, and global
configuration changes require separate explicit authorization.

Idempotent contract apply requires the exact Harness owner, managed path set,
contract digest, and installed schema digest. Skill export validates each
directory component beneath `.agents/skills`, copies a bounded link-free
snapshot, verifies the staged tree identity, and rechecks the target before its
atomic rename.

## Ordered collaboration policy

`.agents/skills/harness-init/assets/collaboration-policy.md` is the canonical
source for the reusable Trellis/CCG/Ponytail/Caveman/search contract. Root
`AGENTS.md` contains a generated projection between dedicated
`HARNESS-COLLABORATION` markers; the existing Trellis-managed and
project-specific Harness blocks remain independent.

The initializer reads the same asset after contract approval and inserts one
derived block into the target `AGENTS.md`. It preserves all content outside the
dedicated markers, rejects malformed or conflicting pre-existing markers, and
records the block digest in `.harness/ownership.json`. A repeated apply is
unchanged only when the project contract and managed block still match.

The policy resolves existing search overlap by choosing one first tool per
question: `rg` for exact text, CodeGraph for indexed code relationships, and
fast-context for semantic discovery or unindexed projects. A second semantic
tool is a gap-filling step, not a default parallel call. The policy never
creates a CodeGraph index and keeps ace-tool disabled unless Harness explicitly
changes that decision. Generic legacy `grep` examples in Trellis Skills are
search intent rather than a tool mandate; accepted task-specific commands still
win and must be reported if they conflict. Current project guide examples use
`rg`.

Ponytail `full` may minimize only code inside higher-order requirements and
gates. Caveman may compress only routine conversation. Neither can remove
required artifact content, evidence, validation, security, accessibility,
error handling, or acceptance criteria.

### Recoverable policy projection transaction

Project initialization treats `AGENTS.md` and the owned `.harness` files as one
logical transaction. Before changing a target it records the original SHA-256,
file identity, mode, verified backup, intended SHA-256, and transaction owner
in a pending journal under an ignored project-local staging directory. An
owned project lock serializes initializers. Immediately before replacement the
initializer re-reads the target and compares both digest and identity; drift
fails closed without overwriting the concurrent content.

Project-local recovery metadata is not trusted by itself. The initializer
creates a user-scoped key outside the target repository at
`~/.harness-init/project-transaction.key` and authenticates each owner, journal,
and commit marker. Missing, legacy, or modified provenance stops recovery before
any target replay and preserves the residue for manual review. Owner metadata
also records a process-instance identity: Linux uses boot ID plus `/proc` start
ticks, Windows uses process creation ticks, and macOS uses process start time.
PID liveness is accepted only when that identity still matches.

Each target is installed without overwrite, and
`.harness/ownership.json` is committed last. A committed marker distinguishes
a complete transaction from a pending one. On the next apply, a dead lock
owner triggers deterministic cleanup: committed transactions are verified and
finalized; pending transactions restore verified backups in reverse order.
Unexpected target bytes are preserved and reported instead of being deleted.

Successful commit, completed rollback, and lock release never recursively
delete an active directory in place. They first atomically rename it to a
strict UUID-bearing Harness GC tombstone; recursive deletion is then
idempotent, and the next initializer removes partial tombstones without
depending on files inside them. Candidate, transaction, and lock namespaces
remain distinct so recovery cannot reinterpret a tombstone as active state.

File fingerprints bind content plus POSIX mode, ctime, uid, and gid in addition
to inode/device/size/timestamps. Existing project contracts and installed
schemas are journaled as read-only preconditions during policy migration and
upgrade. Preconditions are checked while preparing the journal, before the
first replacement, before the commit marker, and again before committed
finalization; drift rolls back changed targets while preserving the concurrent
file. ACLs, extended attributes, and Windows security descriptors are outside
the portable projection guarantee and are documented as unsupported metadata.

Ownership schema v2 records the project policy version, marker format version,
the pinned source path and SHA-256, and the rendered block SHA-256. Migration
accepts PR #1 ownership only when it is Harness-owned, the contract matches,
and no collaboration marker exists. Later policy upgrades are allowed only
when the current block still matches the digest recorded by the previous
ownership manifest. Policy versions are monotonic: a lower intact version may
upgrade, an equal-version digest conflict is rejected, and a version newer than
the initializer is never downgraded. Any mismatch remains a user-edit conflict.

The distribution asset remains the upstream policy source. Every initialized
project receives an owned pinned copy at
`.harness/policies/collaboration-policy.md`; the generated `AGENTS.md` block
references that guaranteed local path. This pinned copy is a managed
projection, not a second independently edited policy source.

## Self-initialization and readiness promotion

First-time apply may reuse an existing safe `.harness/` directory only when
all initializer-owned targets are absent. Existing entries such as
`.harness/adapter.json` remain user-owned, are not added to the ownership
manifest, and are preserved byte-for-byte. A collision at any owned target
keeps the existing fail-closed behavior.

After required gates pass, `harness-init mark-ready --repo-root <path>` reads
the installed approved contract and schema-v2 ownership manifest, validates
the complete owned policy projection, and changes only `status` to `ready`.
The contract and ownership manifest are replaced in one authenticated
project-policy transaction with digest and identity preconditions. Concurrent
drift rolls back; an intact ready contract returns unchanged.

## Global Skill platform

The Harness repository is canonical for all 14 public platform Skills:
the 13 Trellis/Harness Skills plus `grill-me`. The initializer projects those
owned copies globally through an ownership manifest and recoverable
transaction. A clean machine must never depend on a pre-existing external
`grill-me` installation.

All other reusable personal Skills reside in the separate
`I:\ai\codex-skill-repository` catalog. Until every Skill's provenance and
licence permits redistribution, its release repository is private. The Harness
core remains public and fully usable without the catalog. Global discovery
records an opted-in catalog in a dedicated managed block in `~/.codex/AGENTS.md`;
the profile is stored under `~/.agents/harness/`. Existing global copies are
moved to a recoverable backup only after staged byte verification.

Project selection is an explicit revision of the ready project contract.
Selected Skills are copied as ordinary files into `.agents/skills/`, with
source and installed digests in `.harness/project-skills.json`. Links,
junctions, collisions, user-modified owned files, stale contract identity, and
concurrent drift fail closed. The current project selects `ponytail` and
`caveman`.

### Interactive selection contract

The supported guided initializer asks one unresolved decision at a time. When
the host exposes a native structured-choice UI, it must use that UI and mark
the recommended choice. A terminal-only invocation falls back to a numbered
TTY prompt. Non-interactive invocations must pass explicit source and Skill
selection flags; they never infer consent or silently choose a personal
catalog.

Guided setup is split into two independently resumable phases:

1. **Global Init:** inventory first, then install and verify the global Harness
   platform. It covers Trellis, the CCG Codex-only CLI/plugin, all 14 bundled
   platform Skills, and the personal Skill catalog decision. It also probes the
   installed/authenticated state of the Codex, Gemini, Grok, and Claude Code
   CLIs. A missing tool receives an install/skip choice; an installed but
   unauthenticated tool receives a login-now/later choice and safe assistance.
   Each network request, installation, and authentication launch is its own
   previewed approval boundary. One approval never authorizes later actions.
2. **Project Init:** inspect repository facts and technology selections, propose
   only relevant project Skills, resolve remaining decisions one at a time,
   display the complete secret-free constraint summary, and require approval
   before contract or project mutation. Apply then runs the owned transaction,
   project Skill snapshots, code-backed spec handoff, doctor/conflict checks,
   applicable quality/security gates, and readiness promotion.

Status probing is read-only and must distinguish `not installed`, `installed
but authentication unknown`, `installed unauthenticated`, `authenticated`, and
`skipped`. Login helpers may open the vendor's supported interactive flow but
must not request, persist, or print tokens. Offline/non-interactive operation
can supply explicit desired states and receives a deterministic residual-action
report rather than an implicit login attempt.

Claude Code is a special optional branch and is skipped by default because its
own installer or login flow may create `~/.claude/`. Explicitly choosing that
branch leaves the zero-`.claude` acceptance profile. This exception authorizes
only the external Claude tool's own behavior: Harness and CCG remain forbidden
from reading, creating, restoring, or writing `.claude/` paths in all profiles.

The personal catalog decision has exactly three branches: use the configured
authenticated private catalog, select an existing local Git catalog, or skip
optional personal Skills. Project Skill selection follows only after the
catalog decision and is copied as link-free owned snapshots. This preserves a
fully functional public Harness baseline while allowing the owner to reproduce
the private personal environment.

### Release provenance

CCG Codex-only changes are published as `3.3.2` only when package, plugin, and
Codex configuration version declarations agree. The Harness imports that exact
committed tracked tree and records its commit/tree identity in
`harness.sources.json`. Harness `main` and release tags are pushed only after
the corresponding local gates and remote CI are green.

> Historical note: earlier migration evidence accurately described `grill-me`
> as an external global dependency at that time. It is retained below as
> historical evidence; this section supersedes it for the release contract.

## CI boundary

The root workflow owns all executable gates. Nested component workflows are
reference material only. The matrix covers Ubuntu and Windows with Node 20/22,
macOS bootstrap/path/doctor tests, Go build/test on supported hosts, and
PowerShell source/doctor checks. Paid model routes remain disabled.

## Rollback

Root adapter changes remain additive. Personal CCG changes are first made in
the authoritative personal checkout, committed there, and then imported as an
exact tracked tree with an updated Harness manifest. The two
endpoint-protection-blocked reference files are never read, modified, restored,
or staged from the local working tree.

## Clean-install acceptance boundary

The release gate creates a new, empty temporary user home and runs the
documented bootstrap plus guided/non-interactive initializer path against that
home. It asserts the expected `.agents/`, `.codex/`, ownership manifests, and
selected project snapshots, and asserts that neither the temporary home nor
the initialized project contains `.claude/`. The test may use an explicit
test-only home override; production defaults continue to use the actual user
home.
