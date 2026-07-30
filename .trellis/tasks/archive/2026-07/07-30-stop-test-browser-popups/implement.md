# Implementation plan: stop test-only browser popups

## 1. Prepare authoritative source

- Create an isolated personal-CCG worktree and
  `codex/fix-test-browser-popups` branch from
  `7f512c9fcbb74527867ec4885aea3b42e1da2a66`.
- Confirm the source worktree is clean and the expected remote/provenance is
  present.

## 2. Add regression coverage first

- Add a focused Go test around `WebServer.Start()` and the browser opener.
- Make the test fail before implementation by proving the opener cannot be
  disabled for test execution.
- Ensure the test uses a local fake opener and never calls the operating-system
  browser command.

## 3. Implement the minimum source fix

- Add an injectable browser opener whose production default is `openBrowser`.
- Skip launching only when the test binary installs a nil/no-op opener.
- Preserve listener binding, SSE startup, logging, and server shutdown.

## 4. Verify authoritative source

From the personal CCG worktree:

```powershell
go test -short ./...
go build ./...
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- Inspect `git diff --stat` and the full diff.
- Run the applicable CCG change/quality gates.
- Present the source commit plan and wait for explicit commit approval.

## 5. Synchronize Harness

After the source commit exists and the source checkout is clean:

```powershell
pnpm harness:update -- --ccg-commit <40-char-source-commit> --source-checkout <clean-source-worktree>
```

- Verify that the transaction updates only the expected CCG snapshot,
  provenance, and Trellis task artifacts.
- Do not edit plugin cache or global runtime.

## 6. Final verification

```powershell
pnpm verify:sources
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
```

From `components/ccg-workflow/codeagent-wrapper`:

```powershell
go test -short ./...
go build ./...
```

- Confirm no `fake-cmd` browser tab appears during either source or snapshot
  verification.
- Run `node scripts/harness-adapter.mjs conflicts` before delivery.
- Review whether the test-isolation rule should be added to the tooling spec.

## Rollback points

1. Before the source commit: discard only the isolated source-worktree edits.
2. Before `harness:update`: keep Harness unchanged.
3. After `harness:update`: use the lifecycle rollback transaction or re-run the
   update against the previous pinned source commit.
