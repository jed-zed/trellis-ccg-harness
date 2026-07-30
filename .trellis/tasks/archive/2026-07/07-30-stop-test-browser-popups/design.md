# Design: test-only browser launch isolation

## Authority and source flow

The authoritative implementation lives in the personal CCG repository, not in
the Harness snapshot. Create an isolated personal-CCG worktree and branch from
the currently pinned commit
`7f512c9fcbb74527867ec4885aea3b42e1da2a66`. After verification and explicit
commit approval, use that clean commit as the input to `pnpm harness:update`.

```text
personal CCG isolated worktree
  -> focused Go fix and regression tests
  -> source verification and approved source commit
  -> Harness harness:update transaction
  -> updated components/ccg-workflow + harness.sources.json
  -> Harness and CCG gates
```

## Selected implementation

Introduce a small injectable browser-launch function in `server.go` whose
production default remains the existing `openBrowser` implementation.
`WebServer.Start()` calls the injected function only when it is non-nil.

The Go test binary installs a test-only nil/no-op opener before tests run. A
focused server test covers both enabled and disabled behavior without launching
an actual browser.

This keeps production semantics unchanged while making the test process
hermetic.

## Rejected alternatives

- **Disable the whole WebServer in tests**: would reduce coverage of the
  non-lite streaming path and hide server regressions.
- **Detect `.test.exe` in production code**: couples runtime behavior to Go's
  test-binary naming convention.
- **Add an environment variable or user-facing CLI flag**: expands the public
  runtime contract for a test-isolation defect.
- **Patch only `scripts/lib/harness-gates.mjs`**: would leave direct
  `go test ./...` runs capable of opening tabs.
- **Edit the Harness snapshot directly**: violates source provenance and would
  be overwritten by the next formal update.

## Compatibility and rollback

- Production default: unchanged, browser still opens.
- Test default: browser launcher disabled inside the test binary only.
- Network boundary: remains `127.0.0.1:0`.
- Rollback: revert the focused personal-source commit, then run the formal
  Harness update against the previous pinned commit.

## Risks

- A global test hook can leak between tests. Keep the default test opener
  disabled and restore temporary focused-test overrides with `t.Cleanup`.
- The Harness update runs Go tests twice. Both source and materialized snapshot
  must carry the fix before claiming the popup is resolved.
- `harness:update` requires a clean committed source checkout, so source commit
  approval is a separate hard gate before snapshot synchronization.
