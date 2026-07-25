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

- `.agents/skills/harness-init/assets/collaboration-policy.md` is the canonical
  reusable rule source.
- Root `AGENTS.md` contains an exact derived projection between
  `HARNESS-COLLABORATION` markers. Keep the Trellis-managed block, the
  project-specific Harness block, and user content outside those markers
  unchanged.
- After contract approval, `harness-init apply` projects the same asset into a
  new project's `AGENTS.md` and records its block digest in
  `.harness/ownership.json`.
- Missing `AGENTS.md` is created. Malformed, duplicate, conflicting, missing,
  or user-modified managed blocks fail closed instead of being overwritten.
- The policy's authority order resolves Trellis/CCG/Ponytail/Caveman overlap,
  and its search router selects `rg`, CodeGraph, or fast-context by question
  type without creating a CodeGraph index.

## Runtime Rules

- Codex is the sole workspace writer and uses `codex.dispatch_mode: inline`.
- Gemini is a bounded read-only helper.
- Claude is disabled by Harness policy.
- GPT Pro is manual-only and remains owned by the CCG bridge.
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
- Ordinary CI is offline. Live probes are explicit operator actions.

## Conflict Severity

- **Blocking:** source/version drift, tracked runtime state, unsafe task
  authority, non-inline dispatch, Claude enablement, provider credential
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
