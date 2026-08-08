# Design

## Scope and authorities

This task changes only the personal CCG Product Manager timeout contract. The
authoritative source is `jed-zed/ccg-gptpro-worflow`; the Harness
`components/ccg-workflow` tree, source manifest, installed npm package, and
Codex plugin cache are derived surfaces.

The original CCG duration is copied as `7200 seconds = 7_200_000 ms`. Product
Manager keeps its existing fixed per-attempt wall-clock timer. No retry,
fallback, routing, tool, output, or authorization behavior changes.

## Source contract

The source change is intentionally small:

1. `src/utils/config.ts`
   - default `timeout_ms` becomes `7_200_000`;
   - the accepted upper bound becomes the same two-hour limit;
   - the existing 1000 ms minimum and generic integer/range validation remain.
2. `src/utils/__tests__/config.test.ts`
   - assert the new default;
   - assert the exact two-hour boundary is accepted;
   - assert `7_200_001` is rejected.
3. `templates/codex/ccg-config.toml`
   - generated installs use `timeout_ms = 7200000`.
4. `CHANGELOG.md`
   - record the user-visible default change under Unreleased.

No package, marketplace, Codex plugin, or Go wrapper version is bumped. The
change does not touch `codeagent-wrapper/**` or `src/utils/installer.ts`, so it
does not require a wrapper preset release. The Harness update binds the new
source commit and Git tree even though the package version remains `3.4.6`.

## End-to-end flow

```text
personal source default/template/tests
-> independent source branch and PR
-> source CI and merge commit/tree
-> clean Harness worktree
-> formal harness:update from the exact source commit/tree
-> generated component snapshot + harness.sources.json
-> canonical Product Manager spec update
-> Harness review, tests, PR, and merge
-> supported non-interactive Global Setup from the verified source checkout
-> backed-up field-only user config change to 7200000
-> offline product-manager status verification
```

The current explicit user config will not inherit a new default automatically.
It is changed only after the new runtime is installed, because the old runtime
rejects values above 600000 ms.

## Coordination boundary

The existing `08-07-audit-workflow-ux-deadlocks-hardcoded-limits` task owns a
pending Harness update for source commit `8f6d981`. Its dirty publication
worktree is not reused or modified here.

The Product Manager source PR may proceed independently from `8f6d981`.
Before this task runs `harness:update`, the earlier Harness update must already
be merged so the Product Manager transaction contains only its own source
delta. If the pinned Harness commit still predates `8f6d981`, this task stops at
that dependency instead of combining unrelated changes.

## Installation boundary

Global installation uses the supported full setup because plugin-only setup
cannot replace a same-version CCG CLI. Non-interactive setup receives all
required core approval flags from the final user-approved plan, while optional
catalog and Provider actions are fixed to `skip` and `keep` respectively. It
does not install, log in to, or invoke any Provider.

## Rollback

- Source and Harness changes remain separate revertable commits/PRs.
- `harness:update` retains its transaction rollback snapshot; use
  `pnpm harness:rollback` only for that recorded transaction.
- Back up `C:/Users/29933/.codex/ccg/config.toml` before the field-only edit.
  Restore that backup if runtime verification fails.
- Never patch or manually restore npm package directories, generated snapshots,
  wrapper binaries, plugin caches, or manifests.

