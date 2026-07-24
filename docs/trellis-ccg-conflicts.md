# Trellis and CCG Conflict Matrix

This matrix describes the integration conflicts found while adopting the
layered Harness adapter. The Harness is Trellis plus the personal CCG
implementation; the adapter is only their internal boundary.

| Conflict | Severity | Evidence | Disposition |
|---|---|---|---|
| Dual task and plan authority | Blocking | Trellis stores lifecycle state under `.trellis/tasks/`; CCG can create `.ccg/tasks/` and `.codex/ccg/` evidence | Fixed: Trellis is canonical; CCG paths are ignored runtime evidence |
| Personal source versus runtime implementation | Blocking | `components/ccg-workflow/` is an exact personal Git tree, while installed CLI/plugin state is user-local | Fixed: the snapshot is provenance; runtime must use the matching installed CLI/plugin |
| Claude parity rules versus project policy | Blocking | CCG can use Claude as a helper, but this Harness explicitly forbids it | Fixed: Codex is the sole writer and Claude is disabled by the adapter contract |
| Grok credential and transport ambiguity | Blocking | Official ACP uses `XAI_API_KEY`; compatible gateways use different authentication and capabilities | Fixed: official ACP and compatible API adapters use distinct environment namespaces |
| Trellis inline dispatch versus CCG team execution | Blocking | Trellis is configured with `codex.dispatch_mode: inline`; CCG team commands assume delegated agents | Fixed: the Harness uses inline Codex; team commands are not the default execution route |
| Tracked runtime evidence | Blocking | CCG caches, evidence, OAuth state, logs, and model output are mutable and may contain sensitive data | Fixed: conflict audit fails when forbidden runtime paths are tracked |
| Package and version drift | Blocking | Trellis, CCG, pnpm, component identity, and personal Git tree have separate version sources | Fixed: the adapter audits them against `harness.sources.json` and `.harness/adapter.json` |
| Direct execution from the CCG source snapshot | Warning | Source-package helper behavior can differ from the installed plugin runtime | Fixed by policy: source helpers are not the Harness runtime |
| Project and user `UserPromptSubmit` hooks | Warning | Both scopes register the Trellis workflow-state hook | Fixed locally: the user-level fallback detects the project hook and yields; the audit verifies the precedence marker |
| Grok provider unavailable | Warning | Tested third-party gateways did not provide a working authenticated Grok inference and search channel | Deferred: Grok is disabled and optional, so ordinary work remains unblocked |
| Generated `.claude/` project assets | Info | Trellis generates multi-platform assets | Intentional and inert while Claude is disabled |
| Nested CCG GitHub workflows | Info | The personal source snapshot includes its own `.github/workflows/` | Intentional provenance; only root workflows execute in this repository |
| Command names | Info | Trellis and CCG expose separate command families | No collision: `trellis` and `ccg` remain distinct namespaces |

Run the current machine-readable audit with:

```powershell
node .\scripts\harness-adapter.mjs conflicts
```
