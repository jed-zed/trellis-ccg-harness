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

## Grok provider boundary

Two adapters are intentionally distinct:

1. `official-grok-cli-acp` uses the CCG official CLI transport and `XAI_API_KEY` or isolated browser OAuth.
2. `openai-compatible-grok-api` uses `HARNESS_GROK_BASE_URL` and `HARNESS_GROK_API_KEY`.

The second adapter may probe models and chat availability only when invoked explicitly with environment credentials. It must not claim Web/X evidence support unless a live request returns source-backed evidence. A missing or disabled Grok provider is non-blocking. No key or bearer header may enter output, logs, Git, task files, or error messages.

## Conflict policy

Findings use `blocking`, `warning`, or `info`.

- Blocking: source/version authority drift, tracked runtime state, missing canonical task, forbidden model route, provider credential confusion.
- Warning: user/project hook overlap, unavailable optional API, missing optional plugin cache.
- Info: intentional generated assets or inert nested workflow files.

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
