# Implementation plan

## Phase A. Publish and extend the personal Skill

- [ ] Copy the previously validated `chatgpt-pro-sidebar` source into the clean
      `codex/publish-chatgpt-pro-sidebar` worktree without modifying the dirty
      original checkout.
- [ ] Remove only the obsolete prohibition against CCG integration; preserve
      all authentication, authority, browser, idempotency, and resend
      boundaries.
- [ ] Migrate watcher registrations to `stop-hook-v2/<thread>/<watcher>.json`
      with legacy v1 read compatibility.
- [ ] Implement fan-in Stop Hook behavior for multiple terminal and pending
      registrations.
- [ ] Add deterministic watcher and Hook tests for coexistence, fan-in,
      pending preservation, claims, and legacy compatibility.
- [ ] Run PowerShell parser checks, Python compile, and the complete Pester
      suite.
- [ ] Recompute the catalog Skill/tree hashes and validate the manifest.

## Phase B. Update authoritative CCG

- [ ] Add exact-once side-panel evidence import to both distributed copies of
      `gptpro_bridge.py`.
- [ ] Add regression fixtures for valid import, identical re-import, prompt
      mismatch, response mismatch, outside-round path, wrong thread, nonterminal
      watcher, and altered completed round.
- [ ] Rewrite shared and mode GPT Pro Skills, command templates, plugin command
      copies, strategies, Hook breadcrumbs, README, architecture docs, and
      release notes from manual-only to side-panel automation.
- [ ] Document dependency discovery, authentication pause, sequential fallback,
      multi-window orchestration, and no-resend behavior.
- [ ] Bump the CCG patch version and keep package, plugin, and marketplace
      versions aligned.
- [ ] Run Python compile, focused GPT Pro tests, plugin parity, lint, typecheck,
      full unit tests, build, and `npm pack --dry-run` inspection.

## Phase C. Refresh Harness

- [ ] Update Harness policy, adapter contract, README, conflict checks, and
      tests from `manualOnly` to `codex-desktop-sidebar-skill`.
- [ ] Commit the clean CCG source first.
- [ ] Run the formal Harness CCG update from that exact clean commit.
- [ ] Verify `harness.sources.json`, component Git tree, and staged source tree.
- [ ] Run Harness context, focused adapter tests, full Harness tests, doctor,
      conflicts, source verification, and embedded CCG gates.

## Phase D. Live evidence and independent review

- [ ] Install/synchronize the reviewed personal Skill and CCG plugin through
      their formal paths.
- [ ] Retry the side-panel status probe. Pause only if authentication or a
      security challenge is required.
- [ ] Submit one harmless real GPT Pro review of the implemented diff, start the
      detached watcher, and verify same-task Stop Hook continuation.
- [ ] If at least two eligible Codex windows exist, run two independent short
      Pro conversations concurrently and verify fan-in behavior. Otherwise
      record deterministic multi-registration evidence plus the live
      single-window limitation without claiming live parallel validation.
- [ ] Apply any valid Pro findings locally, rerun focused and full gates, and
      preserve the conversation links and hashes.

## Phase E. GitHub delivery

- [ ] Review each isolated worktree diff and exclude all unrelated files.
- [ ] Commit and push the personal Skill branch.
- [ ] Commit and push the CCG branch.
- [ ] Commit and push the Harness branch.
- [ ] Create pull requests only if the repositories' branch policy or current
      remote state requires review instead of direct branch delivery.
- [ ] Record branch, commit, remote URL, test evidence, remaining live limits,
      and exact deployment state.

## Validation commands

```powershell
# Personal Skill
Invoke-Pester -Path .\chatgpt-pro-sidebar\tests -Output Detailed

# CCG
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run

# Harness
node .\scripts\harness-adapter.mjs context
node --test .\tests\harness-adapter.test.mjs
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
```

## Rollback points

- Stop after Phase A if multi-registration tests fail.
- Stop after Phase B if CCG import provenance or package parity fails.
- Stop before Harness update unless the CCG checkout is clean and committed.
- Stop before GitHub push unless all task-owned diffs and required gates have
  been independently reviewed.
