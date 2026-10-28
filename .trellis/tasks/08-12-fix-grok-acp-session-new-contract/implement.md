# Implementation Plan — Grok ACP `session/new` compatibility repair

## 1. Isolate the authoritative source

- [x] Record `gptpro/main` commit, tree, version, remotes, and clean status.
- [x] Create a dedicated clean `codex/fix-grok-acp-session-new-contract`
      branch/worktree from that exact commit; do not modify existing dirty
      Harness worktrees or installed/cache projections.
- [x] Reconfirm the two CCG runtime projections are byte-identical before edit.

## 2. Add the failing offline contract check

- [x] Update the existing fake-server expectation to require
      `{ cwd: realpath(cwd), mcpServers: [] }`.
- [x] Run only the focused ACP test and confirm it fails against the current
      `{ cwd }` implementation for the expected reason.

## 3. Apply the minimum source repair

- [x] Restore `request('session/new', { cwd, mcpServers: [] })` in both
      source-owned runtime projections.
- [x] Keep Provider-native MCP event acceptance, permissions, authentication,
      handshake-only behavior, prompt flow, and no-fallback behavior unchanged.
- [x] Run the focused ACP test and the projection/parity tests.

## 4. Make the real handshake gate explicit

- [x] Split the existing `doctor --grok` invocation into a separately named
      prompt-free ACP handshake step in `.github/workflows/grok-live-smoke.yml`;
      leave the paid Web/X smoke manual and otherwise unchanged.
- [x] Extend `src/utils/__tests__/pluginParity.test.ts` to require that real
      handshake step and keep the workflow manual.
- [x] Correct the stale current-contract sentence in
      `docs/verification/grok-cli-contract-windows.md`; do not invent a new live
      result before the authorized run.

## 5. Offline verification and review

- [x] Run focused tests:

      `pnpm test -- src/utils/__tests__/grokIntelligenceAcp.test.ts`

      `pnpm test -- src/utils/__tests__/pluginParity.test.ts`

- [x] Run repository gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
      `pnpm build`.
- [x] Review the exact diff for projection parity, workflow semantics, secrets,
      generated/cache edits, and unrelated changes.
- [x] Run the applicable CCG quality, impact, and documentation-sync gates for
      the final diff; this protocol/authentication boundary also requires the
      configured security gate.

## Offline execution evidence — 2026-08-12

- Authoritative baseline: personal `gptpro/main`
  `317b6846c1f0d59d66affc4029bad80774483243`, tree
  `90af4911e47f676b3a355b5d2e899c83a285e4f3`, CCG `3.4.12`.
- Isolated worktree:
  `I:/ai/ccg-gptpro-worflow-fix-grok-acp-session-new`, branch
  `codex/fix-grok-acp-session-new-contract`.
- Before the runtime edit, the focused ACP test failed only at the exact
  `observedSession` assertion: received `{ cwd }`, expected
  `{ cwd, mcpServers: [] }`; the other 29 tests passed.
- After the two one-line runtime edits, the focused ACP test passed 30/30. The
  Provider-native `nonempty-mcp` and `mcp-tool` cases remained green.
- Workflow parity failed before the named handshake step was added, then passed
  11/11 after the split.
- Full offline gates: ESLint passed; TypeScript `--noEmit` passed; build passed;
  Vitest passed 44 files with 1 skipped, 621 tests with 3 skipped.
- CCG local analyzers: change analysis `passed=true` (28 additions, 7
  deletions); quality scans `passed=true` with only existing file-size,
  complexity, and long-line notices; security scans reported zero findings for
  the ACP client and Grok workflow.
- The two runtime projections remain byte-identical after the repair, SHA-256
  `f3b669d8c0a5be8b85591af0e4baf4f82a62142c650b01f4b7ea1cd366928633`.
- At this offline checkpoint, no Grok CLI, model prompt, install, Harness sync,
  commit, push, PR, or release was run. The real handshake remained at step 6's
  separate authorization gate.

## 6. Real Grok handshake — separate authorization

- [x] Stop and obtain explicit authorization to start the real Grok CLI.
- [x] Record `grok --version`, then run exactly one prompt-free source-checkout
      handshake with `pnpm exec tsx src/cli.ts doctor --grok`; do not run
      `--grok-live` and do not retry automatically.
- [x] Verify `session/new` succeeds, `paidModelPromptSent=false`, and no model
      prompt was sent. If it fails, preserve the exact non-secret error and stop.
- [x] On success, append a dated compatibility record to the existing Windows
      contract document and rerun its affected checks.

### Real handshake evidence — 2026-08-12

- User authorization covered one prompt-free real Grok call only. The executed
  source entry was `tsx src/cli.ts doctor --grok`; `--grok-live` was not run and
  no retry occurred.
- `grok --version` reported `grok 0.2.118 (1e1687c1cf)`.
- The Grok subcheck reported
  `Grok local ACP ✓ ... auth=cached_token; paidPrompt=false`, proving the patched
  `session/new { cwd, mcpServers: [] }` request completed without the prior
  `Invalid params` rejection and without a model prompt.
- The aggregate doctor command exited 1 because six broader legacy Claude
  installation/policy checks failed. These were already out of scope and did
  not invalidate the explicit successful Grok ACP result.

## 7. Delivery gates — each separately approved

- [x] Obtain source commit approval; stage only owned CCG files and commit.
- [x] Obtain push approval and verify the exact remote branch head.
- [x] Obtain PR approval; create the PR against personal `main`, then verify the
      exact head and required checks.
- [ ] If release is approved, bump to the next CCG patch and matching Codex
      plugin `+codex.1`, run release gates, and verify published provenance. Do
      not bump the unchanged Go wrapper.
- [x] Obtain Harness-sync approval; from a clean Harness integration worktree,
      run `pnpm harness:update -- --source-checkout <clean-ccg-checkout>`, then
      `pnpm verify:sources`, Harness conflicts, doctor, and required tests.
- [x] Obtain local-install approval; install from the verified source/snapshot
      without Provider login or model prompts, then run final `ccg doctor --grok`
      only if that live handshake is explicitly reauthorized.

### Source commit evidence — 2026-08-12

- The user separately authorized a local source commit only.
- Commit `e82ee364a25ab9690899dffe9349618d753b7a5b`
  (`fix(grok): restore ACP session request contract`) contains exactly the six
  planned CCG files and tree `e02bc530b75aba884b5b09ac9f004e99ff032469`.
- At this commit checkpoint, the source worktree was clean and the branch was
  one commit ahead of `gptpro/main`; no push, PR, release, Harness sync, or
  installation had occurred.

### Source push evidence — 2026-08-12

- The user separately authorized push only.
- Remote `gptpro` is
  `https://github.com/jed-zed/ccg-gptpro-worflow.git`.
- Remote branch `codex/fix-grok-acp-session-new-contract` was created and
  `git ls-remote` resolved it exactly to
  `e82ee364a25ab9690899dffe9349618d753b7a5b`.
- The local branch now tracks that remote branch with a clean worktree. No PR,
  release, Harness sync, or installation occurred.

### Source PR and merge evidence — 2026-08-12

- The user explicitly authorized direct merge after approving the plan,
  implementation, real prompt-free handshake, source commit, and push.
- Ready PR [#40](https://github.com/jed-zed/ccg-gptpro-worflow/pull/40)
  targeted personal `main` at exact head
  `e82ee364a25ab9690899dffe9349618d753b7a5b`.
- All six required CI checks passed: Node 20 and 22 tests on Ubuntu and Windows,
  plus Go builds on Ubuntu and Windows. The merge gate reported `CLEAN`.
- PR #40 merged at `2026-08-12T14:50:04Z`; remote `main` now resolves to merge
  commit `7d81508c69f2786d89d31cbcd48591299d9e7398`.
- No release, Harness sync, global installation, Provider login, or model prompt
  was performed.

### Harness synchronization evidence — 2026-08-12

- The user explicitly authorized Harness synchronization and local installation,
  while the presented batch excluded commits, pushes, publication, Provider
  login, model prompts, and another real Grok handshake.
- Clean authoritative CCG worktree
  `I:/ai/ccg-gptpro-worflow-grok-acp-install` was detached at merged commit
  `7d81508c69f2786d89d31cbcd48591299d9e7398`, tree
  `e02bc530b75aba884b5b09ac9f004e99ff032469`.
- Clean Harness integration worktree
  `I:/ai/trellis-ccg-harness-grok-acp-install` started at `origin/main`
  `90f74a536d10ae3026ade7f4a867bef2877a0281`.
- The supported lifecycle update completed as transaction
  `2026-08-12T15-44-57-822Z-073b0c24-8dac-4566-bc1c-793395391b7c` and changed
  only the six expected CCG files plus `harness.sources.json`.
- CCG source and final snapshot each passed lint, typecheck, build, and Vitest
  with 621 passed / 3 skipped. Go wrapper tests passed. Harness tests passed
  453 / 3 skipped. Staged-tree source verification, indexed conflicts
  (0 blocking / 0 warning), and indexed Harness doctor all passed against the
  exact merged commit/tree; the index was then restored to unstaged state.
- Installation did not begin because the supported installer requires the
  synchronized snapshot to be committed first. The current authorization
  explicitly excluded commits, so the next gate is a local Harness commit only;
  no push is implied.

### Local Harness commit and installation evidence — 2026-08-12

- After the user explicitly approved retaining the seven synchronized files,
  local Harness commit `035799474f221dc7e70c32399306b78c77706a2c`
  (`chore: update ccg workflow`) was created with exactly those files. It was not
  pushed.
- The configured local Harness checkout
  `I:/ai/trellis-ccg-harness-ccg-3.4.12-sync` was fast-forwarded to the same
  commit. Its pre-existing untracked `pnpm-lock.yaml` was preserved untouched.
- Rollback material was saved at
  `I:/ai/backups/ccg-grok-acp-before-install-20260812-1620` before installation.
- The supported Harness bootstrap installed CCG `3.4.12` from merged personal
  source commit `7d81508c69f2786d89d31cbcd48591299d9e7398`, tree
  `e02bc530b75aba884b5b09ac9f004e99ff032469`. The local Codex plugin cache was
  then refreshed to `3.4.12+codex.1` from the synchronized Harness snapshot.
- The Harness source copy, global npm package, Harness plugin copy, and active
  plugin cache ACP clients are byte-identical, SHA-256
  `f3b669d8c0a5be8b85591af0e4baf4f82a62142c650b01f4b7ea1cd366928633`, and all
  contain `request('session/new', { cwd, mcpServers: [] })`.
- `ccg doctor --platform codex` passed when `CODEX_HOME` was resolved to the
  Junction target `G:/CodexData/.codex`; Harness doctor and adapter conflicts
  passed with 0 blocking and 0 warnings. No Provider login, model prompt, push,
  release, or post-install real Grok handshake was performed.

## Rollback points

- After step 3: revert only the two request-shape hunks and focused assertion.
- After step 4: revert only the workflow split, parity assertion, and stale-doc
  correction.
- After publication: use a normal source revert and supported Harness rollback;
  never repair an installed package or plugin cache in place.
