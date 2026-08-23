# Root salvage boundary evidence

## Confirmed baseline

- Root HEAD: `d6fa26d6b7e8454d7cb985c06c48bd3e5b277305`.
- Main/integration base: `ab9c2597054fbafb0353024a1593fea3798a7e8d`.
- Divergence from base: 14 root-only commits and 120 main-only commits.
- Dirty files: 0 staged, 26 modified, 98 untracked, 124 unique paths.

## Confirmed superseded mechanisms

- Root GPT Pro files use Codex Desktop UIA and retain Stop Hook continuation.
- Main uses external Chrome, `agent-browser-cli-v2`, pure RootWait, and explicit
  batch/slot contracts; it deletes the old Stop Hook.
- Root Harness initializer policy is older than main.
- Root CCG component changes are stale managed snapshots superseded by the
  authoritative CCG 3.4.15 synchronization on main.

These mechanisms are backup-only historical evidence. Reintroducing them would
violate the main-first integration requirement.

## Known default exclusions

- `components/ccg-workflow/**` and `harness.sources.json`;
- provider runtime/skill scripts and tests;
- `.trellis/spec/tooling/chatgpt-pro-sidebar-uia.md`;
- root active copy of the already archived architecture re-audit task;
- empty generated `pnpm-lock.yaml`;
- user-owned `.agents/skills/grill-me/SKILL.md`.

Candidate independent documents and non-duplicated Trellis evidence still need
content-level comparison against `ab9c259` before inclusion.

## Content-level salvage decision

### Include

Only the completed 2026-08-18 CCG 3.4.15 provenance chain is both absent from
`ab9c259` and still directly consistent with its managed source identity:

- `08-18-integrate-antigravity-model-ccg` records PR #47, CCG merge
  `02bb7e1958c94c4b2e2dc739d797ea4613042da0`, tree
  `c4845443e799a1d3b115e740a99c87614684d197`, and the 3.4.15 release gates.
- `08-18-sync-harness-ccg-local` records the parent decision and complete
  three-stage provenance/install task tree.
- `08-18-sync-harness-from-ccg` records the supported lifecycle update and
  Harness PR #44 evidence.
- `08-18-install-synced-ccg-local` records the verified local installation,
  backup, ownership, and rollback evidence for CLI 3.4.15, plugin
  3.4.15+codex.1, and wrapper 5.12.13.

For each archive, include only `task.json`, `prd.md`, `design.md`, and
`implement.md`. Their `check.jsonl` and `implement.jsonl` contain only seed
templates and carry no evidence.

### Backup only

- The root `08-06-publish-grok-review-draft-prs` task is already present on
  main as a completed archive; main has the same design/implementation bytes
  and a richer delivery record.
- The root workflow-audit archive is already present on main with identical
  research and substantially fuller PRD/design/implementation records.
- `08-10-diagnose-grok-review-and-agy-permissions`, 08-04 UIA/watcher tasks,
  08-12/08-14 Grok tasks, and the old provider-runtime specs are tied to
  superseded CCG/provider mechanisms.
- The active root copy of the architecture re-audit duplicates main's completed
  archive and must not be reintroduced.
- `08-20-harness-fast-lane-workflow` is unresolved planning WIP with a blocking
  Provider-authorization question, not completed or validated evidence.
- `08-07-fix-ccg-web-preview-invocation` is valid historical work but was
  previously excluded from unrelated closeout commits and describes superseded
  3.4.8 runtime behavior. It remains recoverable from the external backup.
- `08-07-align-product-manager-timeout` has a newer canonical main copy; the
  root copy has seed-only context and older PRD/implementation state.
- `CONTEXT.md` and the ADR duplicate managed `AGENTS.md` policy and would create
  a second policy authority. The old UIA/provider specs, `grill-me` Skill, and
  empty root `pnpm-lock.yaml` are also backup-only.

No root journal or index file is copied. The current integration task will use
Trellis archive/session tools to generate its own canonical workspace records.
