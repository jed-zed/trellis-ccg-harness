# Implementation Plan — Grok failure evidence and AGY review permission decision

## 1. Establish source identity and protect existing work

- [x] Record the clean authoritative personal CCG checkout, remote, commit,
      package version, and Git tree before editing.
- [x] Confirm the current Harness worktree's unrelated changes remain outside
      this task's diff.
- [x] Compare the selected upstream revision only as provenance evidence; do not
      replace fork-only behavior or GPT Pro changes.

## 2. Add an offline failing regression for log retention

- [x] Add one fake-backend/wrapper test that emits more than 4 KiB of distinctive
      stderr and exits non-zero.
- [x] Assert the explicit diagnostic input retains the wrapper log, reports its
      exact path, preserves the exit code, and contains beginning/middle/end
      stderr markers.
- [x] Assert a normal failing invocation still follows existing cleanup and a
      successful invocation does not retain a failure log.
- [x] Assert Grok review failure still produces no fabricated
      `CCG_GROK_REVIEW_JSON`.

## 3. Implement the minimum diagnostic control

- [x] Reuse the existing `Logger`; add only the narrow opt-in needed to preserve
      the current log on failure.
- [x] Keep default deletion and startup cleanup semantics unchanged.
- [x] Print an unambiguous retained-log path on failure and keep the existing
      failure exit code.
- [x] Update wrapper help/diagnostic documentation only where the new explicit
      input is user-visible.

## 4. Offline verification

- [x] Run the focused Go tests for logger cleanup, wrapper argument parsing,
      failure output, and Grok review finalization.
- [x] Run `go test -short ./...` and `go build ./...` in
      `codeagent-wrapper`.
- [x] Run the affected CCG distribution/parity tests without calling a real
      Provider.
- [x] Review the diff for credentials, runtime logs, unrelated changes, and
      accidental permission changes.

## 5. Controlled Grok reproduction — authorized once on 2026-08-10

- [x] Run one local-review attempt with concrete targets and diagnostic retention
      enabled; do not auto-retry.
- [x] The attempt succeeded, so no failure log was retained; capture the job
      output and session identity before any subsequent wrapper invocation.
- [x] Record only non-secret evidence and classify the observed boundary.
- [x] The failure was not reproduced; record that outcome and do not infer a
      historical cause.

## 6. Verify the resolved AGY review scope

- [x] Compare the official selected revision and personal fork invocation chain
      from review helper through final `agy` arguments.
- [x] Reproduce the permission-flag behavior offline with a fake AGY child; do
      not call AGY merely to answer an argument-propagation question.
- [x] Record the user-selected scope: unattended disposable-snapshot review only.
- [x] Include the non-OS-sandbox, absolute-path, command, and network risks.
- [x] Update the PRD/design/plan and obtain fresh approval (`执行`) before
      `task.py start`.

## 7. Implement the approved AGY default scope

- [x] Make the disposable-snapshot review helper pass the existing wrapper skip
      flag only for Antigravity; do not configure ordinary AGY calls or the
      standalone `agy` CLI.
- [x] Add CLI-to-child regression coverage proving the final `agy` args contain
      `--dangerously-skip-permissions` by default on the approved path.
- [x] Preserve existing explicit false opt-outs on ordinary wrapper paths.
- [x] Prove AGY calls outside snapshot review and all other Providers remain
      unchanged.

## Execution evidence — 2026-08-10

- Source baseline: personal remote `gptpro`, branch
  `codex/diagnose-grok-agy-review`, commit
  `0b308021bef7f1190a07be55286bef38fda1c826`, tree
  `00b1850d22556c8b338244fb26b19069ca90ffe4`, package `3.4.10`.
- The Harness worktree had 36 pre-existing/unrelated status entries plus this
  new task directory; CCG source edits stayed in the isolated source worktree.
- AGY propagation is covered from the Python review helper's
  `--skip-permissions` through wrapper parsing to final
  `agy --dangerously-skip-permissions`. No live AGY call was required.
- The one authorized Grok review used the local changed wrapper with
  `CODEAGENT_RETAIN_LOG_ON_FAILURE=1`, retained `--no-auto-update`, bound
  `codeagent-wrapper/backend.go`, completed 1,512 events, returned exit 0, and
  produced session `019fedb4-b1fc-77b1-adcf-8a2413be0ff9`. Success cleanup
  removed the transient wrapper log as designed.
- This run disproves the current hypothesis that Grok 0.2.118 rejects
  `--no-auto-update`; direct `version`/`models` parser probes also returned 0.
  The historical exit-1 cause remains unknown because that run did not retain
  raw stderr. Streaming native-tool events did produce non-fatal parser warning
  lines in the successful run, so a future non-zero run must be diagnosed from
  the newly retained full log rather than inferred from this correlation.
- Focused Go, Python, and plugin parity tests passed; `go test -short ./...` and
  `go build ./...` passed. The release validation rerun completed cleanly with
  lint, typecheck, build, 603 passing Vitest tests (3 skipped), and all 8 Python
  snapshot tests. Earlier Windows runner jitter was not converted into a product
  change.

## 8. Version, publication, Harness sync, and installation gates

- [x] If Go changed, prepare the required wrapper version bump and six
      authoritative platform digests; do not publish yet.
- [x] Stop for separate source-commit approval.
- [x] Stop for separate push/PR approval.
- [x] Stop for separate release/publication approval and verify CI assets.
- [x] Stop for separate formal `harness:update` approval, then verify provenance
      and Harness gates in a clean integration worktree.
- [x] Stop for separate local installation approval and run final doctor checks.

## Validation commands

Run from the authoritative CCG checkout unless stated otherwise:

```powershell
Push-Location .\codeagent-wrapper
go test -short ./...
go build ./...
Pop-Location
pnpm test
```

Run only the focused CCG tests identified by the actual diff before the broad
`pnpm test`; do not call live Providers during offline validation. After a later
Harness update, run the Harness gates recorded in `.harness/project.json` and
`pnpm verify:sources` from the clean integration checkout.

## Rollback points

- After step 3: revert only the diagnostic-control hunk and focused tests.
- After step 5: delete ignored raw evidence after recording the non-secret root
  cause; no source rollback is required for an inconclusive live attempt.
- After step 7: revert only the AGY default hunk and its regression if the scope
  decision changes.
- Publication, Harness sync, and installation each use their own separately
  approved rollback path.

## Publication evidence — 2026-08-10

- Released source versions: CCG `3.4.11`, Codex plugin `3.4.11+codex.1`, and
  wrapper `5.12.11`.
- Source commit `1068c21` was pushed to personal remote `gptpro`; PR #38 passed
  all 7 checks and merged to `main` as
  `8514d29a4c3934c05c3c199441a0450bcaaffdcd`.
- The merge-triggered CI completed successfully across all 6 jobs. The separate
  contributor-list workflow failed with a third-party action `Not Found` and did
  not participate in source, test, build, or publication gates.
- The `preset` GitHub prerelease was recreated by CI. All six downloaded assets
  matched the pinned SHA-256 values, and the Windows x64 asset reported wrapper
  version `5.12.11`.
- Cloudflare R2 synchronization was skipped because publish credentials were not
  configured. Public npm publication was intentionally not performed.
- At this publication checkpoint, formal Harness update and local installation
  remained separate, unapproved gates; section 9 records their later completion.

## 9. Converge latest GPT Pro source and complete delivery

- [x] Audit personal CCG remote branches, PR states, latest Harness provenance,
      and local dirty worktrees for accepted-but-unmerged changes.
- [x] Select only `28a428` in addition to latest `gptpro/main`; it contains the
      accepted PR #34 history. Exclude patch-equivalent merged branches, stale
      historical branches, open dependency PRs, and protected dirty worktrees.
- [x] Merge `28a428` into latest personal main, resolve only the two overlapping
      files, and bump CCG/plugin to `3.4.12` / `3.4.12+codex.1`.
- [x] Run local quality/security/release gates, commit, push, create and merge the
      CCG PR, and verify personal main at `317b6846` with tree `90af4911`.
- [x] From latest Harness main, run formal `harness:update` using that exact clean
      personal commit and verify provenance, GPT Pro paths, and Harness gates.
- [x] Complete the approved non-interactive local installation without Provider
      calls (`codex/gemini/grok=later`, `claude=skip`) and verify CCG `3.4.12`,
      plugin `3.4.12+codex.1`, wrapper `5.12.11`, doctor, conflicts, sources, and
      Skill-platform ownership. Push Harness branch `codex/sync-ccg-3.4.12`
      through commit `a3aaa10`.

## 10. Preserve complete Grok responses

- [x] Stop rejecting an uncorrelated search update as an invocation failure.
- [x] Preserve the update in `unknownEvents`, exclude it from verified search
      evidence, and return a complete terminal response as `received_unverified`.
- [x] Run the focused event, runner, and template/plugin parity tests (79 passed).

## 11. Restore Grok native update behavior

- [x] Remove `--no-auto-update` from bound local review, diagnostics, ACP, and
      isolated help probes in the authoritative personal source.
- [x] Stop forcing `GROK_DISABLE_AUTOUPDATER=1` while preserving an explicit
      user-supplied value through the existing allowlist.
- [x] Keep plugin/template mirrors byte-identical and add focused argument,
      environment, event, runner, and distribution regression coverage.

## Execution evidence — 2026-08-12

- Authoritative personal source: `jed-zed/ccg-gptpro-worflow`, branch
  `codex/remove-grok-no-auto-update`, base commit `7d81508c`.
- Focused Vitest: 5 files, 127 tests passed. TypeScript lint, typecheck, and
  build passed. `go test -short ./...` and `go build ./...` passed.
- Plugin/template Grok runtime files are byte-identical. Change analysis found
  no documentation/test gaps; security scans found no Critical, High, Medium,
  or Low findings in the Grok runtime or Go wrapper.
- The other machine's complete Grok 0.2.112 raw event stream is not present in
  this workspace. The regression reproduces the confirmed missing-start event
  shape and proves that a complete terminal response becomes
  `received_unverified` with no promoted source. A real cross-machine smoke
  remains a separate post-publication authorization gate.
- The automatic Grok intake gate was not re-invoked during this batch because
  its failing event correlation is the exact code under repair and the accepted
  plan reserves live Provider smoke for a later independent gate.

## 12. Prepare release versions and reproducible wrapper digests

- [x] Bump CCG/package and both marketplace projections to `3.4.13`, the Codex
      plugin to `3.4.13+codex.1`, and the wrapper/install contract to `5.12.12`.
- [x] Keep historical release records unchanged while updating active version
      documentation and the Codex config template.
- [x] Reproduce the GitHub Actions build from an LF detached worktree with Go
      `1.21.13`, `CGO_ENABLED=0`, `-buildvcs=false`, `-trimpath`, and
      `-ldflags='-s -w'`; rebuild all six targets after pinning and require every
      computed SHA-256 to match the installer contract.
- [x] Verify `go test -short ./...`, `go build ./...`, wrapper `--version`, the
      affected Vitest suites, TypeScript typecheck, build, and `git diff --check`.
- [x] Stop before source commit, push, PR, release, Harness update, or install.

### Prepared wrapper SHA-256 — 2026-08-12

- `codeagent-wrapper-darwin-amd64`:
  `83bd23fa3fb84820b11bc7879c77ff6908c597feb3fdad8a10d33456970a48d2`
- `codeagent-wrapper-darwin-arm64`:
  `4cec1a312f709158e3d4177507c7dbf7e665b7b35ce5d6b10b167618d466bcee`
- `codeagent-wrapper-linux-amd64`:
  `194dafebb287bd51d749b12676942be4091b0b0e164df9cd4158bdf9533b0b02`
- `codeagent-wrapper-linux-arm64`:
  `3d7cdfd26b21d9af791d4b1943341491093da69635a322a7f9bab528519c54ed`
- `codeagent-wrapper-windows-amd64.exe`:
  `50a135d76ddae73cebc02b7f25b8bef4ffb407c861642eb48d4a7bfd285ba60e`
- `codeagent-wrapper-windows-arm64.exe`:
  `a9afd41d79209bfa198bf9242a41cd8e55f8211433745e8447e18dec5067c397`

### Version-preparation verification — 2026-08-12

- Final six-target rebuild: all six installer pins reported `MATCH`; the Windows
  amd64 artifact reported `codeagent-wrapper version 5.12.12`.
- Affected Vitest run: 144 passed, 1 platform-specific test skipped. The first
  parity run exposed the stale `templates/codex/ccg-config.toml` version; after
  correcting that release field, the focused parity suite passed 11/11.
- `pnpm.cmd typecheck`, `pnpm.cmd build`, `go test -short ./...`,
  `go build ./...`, and `git diff --check` passed. The build emitted only the
  pre-existing stale Browserslist database advisory.
- Personal remote `gptpro/main` still resolves to base commit `7d81508c`; no
  source commit, push, PR, release, Harness update, installation, or live
  Provider call occurred in this preparation batch.

## 13. Source commit — 2026-08-12

- [x] Stage exactly the 33 tracked CCG source files from the approved batch;
      staged scope had 0 unstaged files and 0 untracked files.
- [x] Run the CCG commit helper on the staged scope. It reported no gate
      failures; the accepted warnings were existing file-size, complexity, and
      long-line advisories outside this minimal behavior fix.
- [x] Create commit `d5476fd` (`fix(grok): accept uncorrelated search updates`).
- [x] Verify the CCG worktree is clean and the branch is exactly one commit
      ahead of `gptpro/main` at `7d81508c`.
- [x] Stop before push, PR creation, release, Harness update, installation, or
      live Provider invocation.

## 14. Push and Draft PR — 2026-08-12

- [x] Verify the CCG worktree is clean, `gptpro/main` remains at `7d81508c`,
      GitHub authentication is active, and no existing PR uses the source branch.
- [x] Push `codex/remove-grok-no-auto-update` to personal remote `gptpro`; remote
      head is exactly `d5476fd2886ad4d70bfceb62c9ae804147eba687`.
- [x] Create Draft PR #41, `main <- codex/remove-grok-no-auto-update`:
      `https://github.com/jed-zed/ccg-gptpro-worflow/pull/41`.
- [x] Verify PR #41 is `OPEN`, `isDraft=true`, `MERGEABLE`, and bound to the
      exact pushed head. Initial `build` check is in progress, so the current
      merge state is `UNSTABLE` rather than a completed validation result.
- [x] Stop before Ready, merge, release, Harness update, installation, or live
      Provider invocation; each remains a separate gate.

## 15. Repair release digests and rerun CI — 2026-08-12

- [x] Replace only the six stale wrapper SHA-256 values in
      `src/utils/installer.ts`; make no behavior, version, or unrelated source
      change.
- [x] Rebuild all six targets from the exact committed LF Git tree with Go
      `1.21.13` and the GitHub Actions flags; all six artifacts match the
      installer pins and Windows amd64 reports wrapper `5.12.12`.
- [x] Commit the correction as `09aefbec` (`fix(release): correct wrapper
      digests`) and push it to `gptpro/codex/remove-grok-no-auto-update`.
- [x] Verify Draft PR #41 points exactly to
      `09aefbec4df95bd22116e76ab63dcb7061aa9c89`, is mergeable with a clean merge
      state, and all seven exact-head GitHub checks pass.
- [x] Stop before Ready, merge, release, Harness update, installation, or live
      Provider invocation; each remains a separate gate.

## 16. Mark PR ready — 2026-08-12

- [x] Reconfirm PR #41 remains bound to exact head
      `09aefbec4df95bd22116e76ab63dcb7061aa9c89`, with all seven checks successful
      and merge state `MERGEABLE / CLEAN`.
- [x] Apply the user's separate authorization to change PR #41 from Draft to
      Ready for review.
- [x] Verify PR #41 remains open with `isDraft=false`; do not merge, publish,
      update Harness, install locally, or invoke a live Provider.

## 17. Merge, release, Harness sync, installation, and live Grok verification — 2026-08-12

- [x] Merge PR #41 only after all seven exact-head checks passed. GitHub reports
      `state=MERGED`, `mergedAt=2026-08-12T21:20:08Z`, and merge commit
      `4dc995d14c5d2f963f7ce75bf46ad6bf4072348f`.
- [x] Verify the merge-triggered CI matrix passed all six source/test jobs and
      the `preset` prerelease was recreated with all six wrapper assets. Every
      downloaded asset matched the 3.4.13 installer pins; Windows amd64 reported
      wrapper `5.12.12`.
- [x] Run formal `harness:update` from clean CCG commit `4dc995d` / Git tree
      `26ea2916c977209d4eb1619561dff4a5964fc60d`. Both CCG gate rounds passed
      (622 tests passed, 3 skipped), all Go gates passed, and Harness reported
      453 tests passed, 3 skipped, 0 failed.
- [x] Commit the exact 37-file Harness projection as `4543180`
      (`chore(harness): sync CCG 3.4.13`) and push branch
      `codex/sync-ccg-3.4.13`; the clean branch equals its upstream.
- [x] Install the managed local runtime from the clean Harness/CCG snapshots.
      Final identity is CCG `3.4.13`, plugin `3.4.13+codex.1`, and wrapper
      `5.12.12`; source provenance, Harness doctor, conflict audit, Codex doctor,
      and 15-platform-Skill ownership all passed. No Provider was installed or
      logged in during installation.
- [x] Account for the existing supported local layout where
      `C:\\Users\\29933\\.codex` is a Junction to `G:\\CodexData\\.codex`: the
      installer itself rejects the linked path, so complete Codex-mode and final
      doctor verification against the real `CODEX_HOME` without modifying the
      Junction or user data.
- [x] Run one authorized real Grok WebSearch verification. Normal depth failed
      before search because configuration requested `grok-4.5` while ACP bound
      the CLI default `grok-4.6`; no user config was changed. Reusing the already
      configured deep model `grok-4.6` succeeded through the formal installed
      CLI entry with exit 0, status `verified`, two WebSearches, one X search,
      evidence SHA-256
      `20000af21348031bbb63a411ad01d7ce74a98cbe1265426ccea4098aee484915`,
      and manifest SHA-256
      `5eb5d085386748f22557e6cf9f586b779eb21908e5faa580982b79b0c0ce3176`.
      The private raw stream from the first successful execution contains the
      previously problematic `tool_call_update` events but no
      `Uncorrelated search tool_call_update` error, proving the 3.4.13
      correlation change on this machine. The installed Skill must be invoked
      through the real `G:\\CodexData\\.codex` path on this Junction-based
      machine so its direct-entry URL identity matches.

## 18. Follow the Grok CLI default model — approved 2026-08-13

- [x] Change new/default normal-depth configuration from the versioned
      `grok-4.5` pin to an empty/unconfigured value; do not pin `grok-4.6`.
- [x] Omit `--model` in ACP when no normal model is configured, while preserving
      explicit model validation and the enabled deep-research model requirement.
- [x] Require and record exactly one actual ACP session model; compare it to the
      requested model only when the request is non-empty.
- [x] Propagate the actual model into evidence, manifest, command result, cache,
      paid doctor, and automatic-route validation.
- [x] Keep plugin/template runtime mirrors identical and update only focused
      config, ACP, runner, routing, distribution, and live-smoke tests.
- [x] Run offline focused tests, lint, typecheck, build, and Trellis checks; stop
      before commit, push, publication, Harness update, installation, or live
      Provider invocation.

## 19. Recover cache locks, make search advisory, and remove shipped model pins — approved 2026-08-13

- [x] Publish Grok cache locks through atomic directory creation, bind cleanup to
      a unique owner token, and reclaim only after an in-directory claim plus a
      second identity check without vacating the canonical path.
- [x] Add focused dead-owner, legacy-owner, live-replacement, and third-contender
      lock tests while retaining plugin/template byte parity.
- [x] Remove mandatory companion-search wording and behavior from ordinary
      frontend/backend flows; keep attempted search status visible and
      non-blocking without fallback or extra retries.
- [x] Remove shipped Gemini/Grok versioned model fallbacks from configuration
      generation and helper arguments; omit model flags when unconfigured and
      retain reported model identity where available.
- [x] Preserve the product-manager Claude `opus` pin and prove the user-owned
      local config file is unchanged.
- [x] Run focused tests, lint, typecheck, build, Trellis checks, and diff review;
      stop before commit, push, publication, Harness update, installation, or
      live Provider invocation.

Verification: focused cache/parity Vitest passed 31/31; full Vitest passed 630
with three intentional skips; ESLint, TypeScript typecheck, unbuild, mirror
parity, and `git diff --check` passed. A dedicated read-only review identified
and removed the initial tombstone restoration window before commit. The local
CCG config SHA-256 remained
`32487324a9f5fffad4335a7ae839645638754fd029cb5b7e9b5ec524640f88b4`.

## 20. Release, Harness synchronization, local install, and closeout — approved 2026-08-13

- [x] Release CCG `3.4.14` through PR #43 and merge exact commit
      `9d94210f5a9132eb0637c9db3303760bf5c93c5f`; verify the post-merge six-job
      CI matrix and the six wrapper preset assets.
- [x] Run formal `harness:update` from that clean source, commit the exact
      projection as `484eca129a0ccf8e0d59d2083993bd318920fb55`, merge Harness PR #41 as
      `f82709d5fb5a556766271362614a0268fd5a86b3`, and verify the ten-job main CI.
- [x] Install global CCG `3.4.14`, Codex plugin `3.4.14+codex.1`, wrapper
      `5.12.12`, and verify CCG doctor, Harness doctor, conflict audit, and
      source provenance with zero blocking findings.
- [x] Preserve the user-owned CCG configuration. The installer-generated
      intermediate was retained under the local temp directory for diagnosis,
      the pre-install backup was restored, and the final SHA-256 exactly matches
      `32487324a9f5fffad4335a7ae839645638754fd029cb5b7e9b5ec524640f88b4`.
- [x] Do not install or log in any Provider, do not invoke a Provider, and do not
      stage unrelated root-worktree changes or runtime evidence.
