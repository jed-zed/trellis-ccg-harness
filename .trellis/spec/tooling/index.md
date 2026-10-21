# Harness Tooling Specifications

> Executable contracts for the repository's Node.js, PowerShell, and Go
> lifecycle tooling.

## Scope

This repository is a tooling project, not a frontend or database application.
Root scripts own bootstrap, source verification, lifecycle operations, and
Harness initialization. The tracked CCG component remains an exact source
snapshot and is verified through root commands.

## Specifications

| Specification | Applies when |
|---|---|
| [Harness Lifecycle Update](./harness-lifecycle.md) | Changing CCG snapshot update, rollback, bootstrap ordering, or runtime verification |
| [Harness Initializer](./harness-initializer.md) | Changing contract apply, project ownership, or readiness promotion |
| [Product Manager Review](./product-manager-review.md) | Changing reviewer providers, task projection, evidence, gates, or lifecycle integration |
| [ChatGPT Pro Agent Browser V2](./chatgpt-pro-agent-browser-v2.md) | Changing external Chrome discovery, exact-once behavior, or RootWait monitoring |
| [ChatGPT Pro Browser V2](./chatgpt-pro-sidebar-v2.md) | Changing the active GPT Pro transport, atomic RootWait, or send/response binding |
| [ChatGPT Pro Sidebar UIA](./chatgpt-pro-sidebar-uia.md) | Maintaining historical UIA helpers and evidence only |
| [Codex Provider Runtime](./codex-provider-runtime.md) | Changing Codex home resolution, routing, wrapper verification, doctor, or clean-install acceptance |
| [Grok Local Review Runtime](./grok-local-review-runtime.md) | Changing Grok local-review target binding, tool evidence, or result validation |

## Entry Points and Maintenance Ownership

| Concern | Entry and implementation | Boundary |
|---|---|---|
| User-level installation | `package.json` -> `scripts/install.ps1`; internal `bootstrap.ps1` | Global Setup changes user installations; it is not project inspection. |
| Project initialization | `scripts/harness-init.mjs` -> `.agents/skills/harness-init/scripts/harness-init-core.mjs` | Contract validation, apply, readiness and project ownership live in the core, not the CLI wrapper. |
| Context, conflicts, PM and explicit probes | `scripts/harness-adapter.mjs` -> `scripts/lib/harness-adapter/` | Trellis owns task state; installed CCG owns provider execution. See the relevant specification above. |
| Coupled update / rollback / recovery / uninstall | `scripts/harness-lifecycle.mjs` -> `scripts/lib/harness-lifecycle.mjs`, `harness-transaction.mjs`, `harness-gates.mjs`, `harness-fs.mjs` | These are side-effecting operations, not verification shortcuts. Recovery can run the Harness tests. |

Module details remain in [scripts/README.md](../../../scripts/README.md).
`harness.sources.json` identifies the bundled sources; the tracked
`components/ccg-workflow/` tree is a source snapshot, not an independent local
fork or the integration runtime. Component changes require the existing
[personal-source workflow](../guides/personal-source-provenance.md).

The root `AGENTS.md` has a Trellis-managed block and a
`HARNESS-COLLABORATION` projection. The latter comes from
`.agents/skills/harness-init/assets/collaboration-policy.md` via the owned
`.harness/policies/collaboration-policy.md` snapshot; `syncProjectPolicy` in
the initializer core maintains that relationship and ownership metadata.
Project-only notes belong outside managed blocks. `.harness/ownership.json`
and `.harness/project-skills.json` identify owned files and selected copies;
a directory being present under `.agents/skills/` does not by itself authorize
editing a global projection, a third-party Skill or its maintenance source.

## Verified Implementation Boundaries

These are source-inspection facts, not proof that every CLI path or installed
provider has been exercised.

- In the initializer core, `validateProjectContract` checks object structure,
  secret-looking fields, schema version, status, authorities, workflow, Skills,
  providers, product-manager and security fields. Its default permits draft
  validation. `applyProjectContract` explicitly uses `requireApproved: true`,
  requiring `status: approved` and no unresolved decisions before preparing
  writes. A successful `validate` command alone is not approval or readiness.
- `runProjectTransaction` checks recorded preconditions before target writes
  and before its commit marker, then verifies committed state. Those ownership,
  lock and transaction guarantees apply to this initializer path. Direct JSON
  writes, unrelated scripts and arbitrary provider output do not inherit them.
  `markProjectReady` is a separate ownership-checked transition; keep its
  [existing readiness contract](./harness-initializer.md).
- `scripts/lib/harness-fs.mjs` (`assertLexicallyInside`,
  `ensureSafeDirectoryChain`, `assertSafeRegularFileOrAbsent`, `safeAtomicWrite`)
  checks containment and rejects symlink/junction components on its protected
  write paths. Adapter `context.mjs:loadTask` instead uses the lexical
  `process.mjs:assertInside` check for the task root; that check alone does not
  prove link safety or validate every field in `task.json`.
- `buildCanonicalContext` treats only `NO_ACTIVE_TASK` as `task: null`;
  malformed task state and other resolution errors propagate. Context redaction
  uses `redaction.mjs`; it does not establish that all repository files or
  arbitrary provider output are credential-free.
- For the explicit compatible-Grok probe only, `probe.mjs:normalizeBaseUrl`
  rejects embedded credentials and requires HTTPS except the implemented
  local-host allowlist; `requestJson` rejects redirects. `countSearchEvidence`
  requires a web-search tool call plus annotations/citations. HTTP success or
  a model list alone does not prove search capability. This is not a contract
  for all CCG provider transports.

## Errors, Retry and Recovery Responsibility

- `scripts/harness-init.mjs` reports a rejected CLI call and exits with code 1.
  `runProjectTransaction` attempts rollback on an uncommitted failure and
  propagates the error; failed rollback raises an `AggregateError` naming the
  recovery directory. A failure after committed-state validation is also
  propagated. Do not claim every failure restored all state or retry apply
  blindly.
- Project recovery is `recoverProjectTransactions` in the initializer core.
  Component lifecycle recovery is `recoverInterruptedTransaction` in
  `scripts/lib/harness-transaction.mjs`, exposed by `pnpm harness:recover`.
  Locks, journals and commit records determine recovery; these are distinct
  operations, not a universal exactly-once/idempotency service. Inspect the
  original operation's recorded state before deciding on an authorized retry.
- Adapter `process.mjs:runCommandAsync` defaults to a 30-second timeout and
  1 MiB combined output capture, terminates on those limits and returns an
  error result. The synchronous `runCommand` does not acquire that timeout
  guarantee. The installed-CCG version probe in `conflict-runtime.mjs` tries
  another command candidate only on `ENOENT`; it is not a generic failure retry.
- Compatible-Grok `requestJson` uses one abort timer per request and clears it
  in `finally`. It reports HTTP/network outcomes; invalid JSON leaves a null
  payload rather than necessarily rejecting the response. The probe uses the
  configured timeout (180000 ms fallback), has no automatic request retry and
  no result-query/idempotency interface. This does not establish PM retry
  behavior; read [Product Manager Review](./product-manager-review.md) for that
  separate installed-provider contract. The Windows CI test retry below is
  test-runner policy, not production retry behavior.

## Supported Scope and Evidence Limits

- Root `package.json` declares Node.js `>=20` and pins `pnpm@10.17.1`;
  [README prerequisites](../../../README.md) specify Python 3.9+ and
  PowerShell 7+. These are declared requirements, not proof of testing every
  newer runtime. `harness.sources.json` pins bundled Trellis/CCG provenance,
  not the currently installed global CLI. See
  [installed Trellis handling](../guides/personal-source-provenance.md).
- [Root CI](../../../.github/workflows/ci.yml) configures Harness/CCG Node
  gates on Ubuntu and Windows with Node 20/22 and Python 3.12. Go and
  bootstrap/doctor jobs cover Ubuntu, Windows and macOS; they do not extend
  the full Node test matrix to macOS. The Go module declares `go 1.21`, while
  CI selects Go 1.26.5; neither proves all intermediate versions passed.
- Offline tests and configuration reads cannot prove live provider login,
  paid inference, remote CI success or an installed desktop session's behavior.

## Pre-Development Checklist

- For an actual development task, read its applicable `prd.md`, `design.md`
  and `implement.md` when present. Follow workflow request triage; read-only
  questions need no task, and an explicit task-state opt-out remains effective.
- Read only the relevant specification above. Before lifecycle behavior
  changes, also read `.harness/adapter.json`, `harness.sources.json` and the
  affected script; preserve owned state and transaction preconditions.
- Add a failing regression before changing initializer behavior. Documentation
  clarification alone does not require initializer mutation or a new test suite.

## Quality Check

For rules/documentation-only changes, inspect the actual scoped diff, check
referenced paths/symbols/commands and run `git diff --check -- <changed-paths>`.
The existing `node --test tests/ci-contract.test.mjs tests/readme-provenance.test.mjs`
checks CI text and README/source-manifest consistency without installation or
provider calls; it is not a runtime acceptance test for edited rules.

For executable behavior changes, run the affected focused regression first
(for initializer changes: `node --test tests/harness-init-cli.test.mjs`), then
the applicable existing offline gates. Do not run the entire installation or
build chain merely because this index lists it. Required CI remains unchanged:

| Existing command (from repository root unless stated) | Conditions and purpose |
|---|---|
| `pnpm harness:test` | Runs all root `tests/*.test.mjs` via `scripts/run-tests.mjs`; not a docs-only selector. |
| `node scripts/harness-adapter.mjs conflicts --ci` | Required static CI conflict audit; excludes installed runtime/user-state inspection. |
| `pnpm verify:sources` | Source provenance gate; not just a syntax check. |
| `pnpm --dir ./components/ccg-workflow install --frozen-lockfile` | CI dependency preparation; installation needs its own authorization. |
| `pnpm --dir ./components/ccg-workflow audit:prod` | Linux / Node 22 dependency audit; network-dependent. |
| `pnpm ccg:lint`, `pnpm ccg:typecheck`, `pnpm ccg:test`, `pnpm ccg:build` | Component quality gates. Windows CI uses `pnpm --dir ./components/ccg-workflow exec vitest run --no-file-parallelism --retry 1` for tests. |
| `go build .`, `go test -short ./...` | Run in `components/ccg-workflow/codeagent-wrapper`; Go matrix above. |
| `node --test ./tests/install-script.test.mjs` | CI public-setup test uses isolated HOME/USERPROFILE/CODEX_HOME/npm prefix; do not run setup against the real user state for a doc change. |
| `pwsh -NoProfile -File ./scripts/bootstrap.ps1 -LinkCcg`, `ccg --version`, `pnpm harness:uninstall` | CI platform bootstrap/doctor sequence mutates isolated runner installations. |

Windows / Node 22 also runs the named Grok offline security and CCG PowerShell
doctor JSON contracts in `ci.yml`. Those job steps remain authoritative.
`pnpm doctor` and `pnpm harness:conflicts` additionally inspect local user/runtime
state; they are not lightweight documentation checks. A successful local check
does not certify GitHub branch-protection settings or the latest remote run.

### Known Execution Conflict: File-Hash Prohibition

Current global rules prohibit file-hash calculation/comparison. Existing
initializer, lifecycle and full acceptance paths depend on such security
checks. Adapter `context.mjs:collectArtifacts` and `collectProductManagerSummary`
hash task files when present; `conflict-static.mjs:checkProductManagerManagedAssets`
compares owned contract/schema hashes even with `conflicts --ci`.
`doctor` invokes conflict/source checks, and full Harness tests include hashing.
Do not execute a dependent command, remove the check or use a skip flag to
bypass it. Record that gate as blocked/unverified and continue independent
authorized work. This documents the conflict; it does not waive CI or authorize
changes to global rules or security code.

For read-only startup context, the existing
`python -B -X utf8 ./.trellis/scripts/get_context.py --json`, `--mode phase` and
`--mode packages` interfaces avoid the adapter's artifact hashes. JSON mode also
avoids `session_context.py:output_text`'s installed-Trellis update probe and
runtime marker write. These reads do not satisfy the blocked adapter gates.

## Documentation Verification (2026-10-21)

- This pass changed only root `AGENTS.md` outside its managed blocks and this
  existing index. Both are ordinary project files; the AGENTS pre-existing
  bytes and index's existing specification list were preserved.
- On local Windows with Node 24.14.0 / Python 3.11.2, the three read-only
  Trellis context modes above loaded successfully. All 17 local Markdown links
  resolved; scoped `git diff --check` passed.
- `node --test tests/ci-contract.test.mjs tests/readme-provenance.test.mjs`:
  7 passed, 0 failed, 0 skipped. These checks inspect existing CI/README facts.
- A fresh read-only agent followed AGENTS to this index and correctly separated
  validation, approval/readiness and documentation checks. This is limited
  navigation evidence, not a desktop-session or implicit-Skill invocation test.
- No full suite, adapter/doctor gate, installation, live Provider call or remote
  CI was executed. Hash-dependent checks remain blocked as described above;
  no global configuration defect was established by this documentation pass.
- To undo only this pass, remove the leading AGENTS section `本仓库入口` and
  reverse this index's entry/boundary/check additions and checklist replacement
  against the pre-session contents. Do not restore either whole file to HEAD:
  both already contained unrelated uncommitted changes.
