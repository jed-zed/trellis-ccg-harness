# Layered Harness Adapter

> Keep Trellis lifecycle state and CCG model runtime separate while presenting
> one coherent Harness.

## Definition

The Harness is the combined Trellis workflow layer and the user's personal CCG
implementation. The root adapter is internal integration glue, not a third
framework.

## Authority

| Concern | Authority |
|---|---|
| Task identity, status, requirements, design, plan, specs, completion | Trellis |
| Model orchestration, evidence helpers, GPT Pro, quality gates | Installed personal CCG CLI/plugin |
| Personal CCG source identity | `harness.sources.json` plus the component Git tree |
| Cross-layer policy, redacted context, provider separation, conflict audit | Harness adapter |

Do not write lifecycle state from CCG back into `.trellis/tasks/`. CCG runtime
state under `.ccg/` and `.codex/ccg/` is evidence only and must remain ignored.

## Collaboration Policy Projection

- `.agents/skills/harness-init/assets/collaboration-policy.md` is the
  distribution's upstream reusable rule source. Each initialized project gets
  an owned policy snapshot at `.harness/policies/collaboration-policy.md`.
- Root `AGENTS.md` contains an exact derived projection between
  `HARNESS-COLLABORATION` markers. Keep the Trellis-managed block, the
  project-specific Harness block, and user content outside those markers
  unchanged.
- After contract approval, `harness-init apply` transactionally writes the
  owned policy snapshot, projects it into the new project's `AGENTS.md`, and records
  source and rendered digests in schema-v2 `.harness/ownership.json`.
- Missing `AGENTS.md` is created. Malformed, duplicate, conflicting, missing,
  or user-modified managed blocks fail closed instead of being overwritten.
- The apply transaction uses an owned project lock, original digest, identity,
  permission mode, a pending journal, verified backups, read-only
  contract/schema preconditions, final CAS checks, and ownership-last commit
  order. It rechecks preconditions before installation, before commit, and
  during committed finalization.
- Transaction owners, journals, and commit markers are authenticated with a
  user-scoped key outside the target repository at
  `~/.harness-init/project-transaction.key`. Repository-authored or legacy
  residue without valid provenance is preserved and rejected before any replay.
  Owner liveness binds PID to the process start/boot identity where the platform
  exposes it, preventing PID reuse from making stale state permanently live.
- Completed transactions and released locks are atomically renamed to a strict
  `.harness-init-gc-*` tombstone namespace before recursive removal. A later
  run may delete a structurally valid tombstone without relying on partially
  deleted internal metadata, rolls back an interrupted pending transaction,
  or finalizes a verified committed one.
- PR #1 ownership without `managedBlocks` migrates only when no collaboration
  markers exist. A lower policy revision upgrades only when the current block
  and owned policy snapshot match their recorded digests; a newer version is never
  downgraded, and same-version content drift fails closed.
- Portable CAS identity includes POSIX mode, change time, UID, and GID where
  the platform exposes them. ACLs, extended attributes, and Windows security
  descriptors require separate platform-specific verification.
- The policy's authority order resolves Trellis/CCG/Ponytail/Caveman overlap,
  and its search router selects `rg`, CodeGraph, or fast-context by question
  type without creating a CodeGraph index.

## Initialization State Transitions

- Before changing apply or readiness behavior, identify every user-owned and
  initializer-owned path and decide which bytes are transaction inputs versus
  targets.
- Keep a new installation at `approved` until all required gates pass; only
  then promote it to `ready`.
- Follow the executable command, validation, rollback, and test contract in
  [Harness Initializer Contract](../tooling/harness-initializer.md).

## Runtime Rules

- Codex is the sole workspace writer and uses `codex.dispatch_mode: inline`.
- Gemini is a bounded read-only helper.
- Claude may be the explicitly selected product-manager provider. It is
  non-persistent, sees only a bounded task-local snapshot, may use only file
  read/search primitives, and never owns workspace or lifecycle writes.
- GPT Pro is automated read-only evidence owned by the installed CCG bridge;
  browser work stays inside the `chatgpt-pro-sidebar` Skill over
  `agent-browser-cli-v2`, and continuation stays local through
  `codex-root-wait`.
- Grok is optional and disabled until a working provider is configured.
- A user-level Trellis workflow-state hook must yield whenever the project
  registers its local equivalent; the adapter contract marker makes this
  precedence auditable.
- Execute CCG through the installed CLI/plugin version recorded in the source
  manifest. Never use `components/ccg-workflow/` as the integration runtime.

## Provider Rules

- Official Grok CLI/ACP uses `XAI_API_KEY` or isolated browser login.
- Compatible Grok APIs use only `HARNESS_GROK_*`.
- GPT Pro provider configuration uses only `HARNESS_GPTPRO_*`.
- Credential namespaces must remain distinct.
- No provider may be marked search-capable without a search tool call plus
  citation or annotation evidence.
- Grok snapshots deny `.codex` by default. Only an explicit `--plan` binding may
  admit one top-level `.codex/ccg/plans/*.md` file; basename denials and
  `.ccgignore` still take precedence.
- Product-manager snapshots reuse the same strict filtering core with
  `2000 / 2 MiB / 64 MiB` caps. Project `claudeTransport` defaults to `local`;
  explicit `ssh` uses environment-only connection details and never falls back.
- Ordinary CI is offline. Live probes are explicit operator actions.

## Conflict Severity

- **Blocking:** source/version drift, tracked runtime state, unsafe task
  authority, non-inline dispatch, writable or tool-enabled Claude execution, provider credential
  overlap, or command namespace collision.
- **Warning:** missing local setup, optional provider outage, or unguarded
  duplicate Trellis prompt-state hooks.
- **Info:** intentionally inert generated assets or nested component CI.

Blocking conflicts exit with code 2. Warnings and information remain visible
but do not block ordinary work.

## Required Checks

```powershell
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
node --test .\tests\harness-adapter.test.mjs
pwsh -NoProfile -File .\scripts\doctor.ps1
```
