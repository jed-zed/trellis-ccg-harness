# Trellis and CCG Conflict Matrix

This matrix describes the integration conflicts found while adopting the
layered Harness adapter. The Harness is Trellis plus the personal CCG
implementation; the adapter is only their internal boundary.

| Conflict | Severity | Evidence | Disposition |
|---|---|---|---|
| Dual task and plan authority | Blocking | Trellis stores lifecycle state under `.trellis/tasks/`; older CCG bridges only accepted `.ccg/tasks/` | Fixed: Trellis is canonical; the bridge accepts the Trellis task directly and isolates helper evidence under task-local `.ccg-evidence/` without mutating Trellis lifecycle fields |
| Personal source versus runtime implementation | Blocking | `components/ccg-workflow/` is an exact personal Git tree, while installed CLI/plugin state is user-local | Fixed: the snapshot is provenance; runtime must use the matching installed CLI/plugin |
| Claude product-manager boundary versus workspace ownership | Blocking | Claude may review product evidence with native permissions, but must never inherit canonical workspace or lifecycle authority | Fixed: Codex is the sole canonical writer; Claude sees a bounded disposable snapshot whose tool use grants no canonical authority. Project transport defaults to local; explicit environment-only SSH v2 never falls back |
| Grok credential and transport ambiguity | Blocking | Official ACP uses `XAI_API_KEY`; compatible gateways use different authentication and capabilities | Fixed: official ACP and compatible API adapters use distinct environment namespaces |
| Trellis inline dispatch versus CCG team execution | Blocking | Trellis is configured with `codex.dispatch_mode: inline`; CCG team commands assume delegated agents | Fixed: the Harness uses inline Codex; team commands are not the default execution route |
| Tracked runtime evidence | Blocking | CCG caches, evidence, OAuth state, logs, and model output are mutable and may contain sensitive data | Fixed: conflict audit fails when forbidden runtime paths are tracked |
| Package and version drift | Blocking | Trellis, CCG, pnpm, component identity, and personal Git tree have separate version sources | Fixed: the adapter audits them against `harness.sources.json` and `.harness/adapter.json` |
| Direct execution from the CCG source snapshot | Warning | Source-package helper behavior can differ from the installed plugin runtime | Fixed by policy: source helpers are not the Harness runtime |
| Project and user `UserPromptSubmit` hooks | Warning | Both scopes register the Trellis workflow-state hook | Fixed locally: the user-level fallback detects the project hook and yields; the audit verifies the precedence marker |
| Grok provider unavailable | Warning | Tested third-party gateways did not provide a working authenticated Grok inference and search channel | Deferred: Grok is disabled and optional, so ordinary work remains unblocked |
| Harness/Trellis/CCG assets under project `.claude/` | Blocking | They reconnect Codex initialization to the Claude runtime surface | Fixed: Codex-native initialization and Trellis upgrades retain only `.agents/` and `.codex/`; the audit blocks recognized residue |
| Unrecognized user-owned project `.claude/` content | Info | It may belong to a separate user workflow | Preserved: the Harness reports it but never deletes it automatically |
| Nested CCG GitHub workflows | Info | The personal source snapshot includes its own `.github/workflows/` | Intentional provenance; only root workflows execute in this repository |
| Command names | Info | Trellis and CCG expose separate command families | No collision: `trellis` and `ccg` remain distinct namespaces |

Run the current machine-readable audit with:

```powershell
node .\scripts\harness-adapter.mjs conflicts
```
