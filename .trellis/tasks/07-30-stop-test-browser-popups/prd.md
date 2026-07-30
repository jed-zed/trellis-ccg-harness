# Stop test-only browser popups

## Goal

Stop `codeagent-wrapper` Go tests and Harness CCG verification gates from
opening short-lived `127.0.0.1` Live Output tabs, while preserving the normal
browser preview for real non-lite CCG executions.

## Background

- `codeagent-wrapper/server.go:69` binds the Live Output server to an ephemeral
  IPv4 loopback port.
- `codeagent-wrapper/server.go:90` unconditionally launches the default browser
  after the server starts.
- executor tests set `codexCommand = "fake-cmd"` (for example,
  `codeagent-wrapper/main_test.go:729`) while still exercising the non-lite
  server path, which produces `fake-cmd - Live Output` tabs.
- `scripts/lib/harness-gates.mjs:37` runs `go test ./...`.
- `scripts/harness-lifecycle.mjs:599` and
  `scripts/harness-lifecycle.mjs:682` run the CCG gates for both the
  authoritative source candidate and the materialized Harness snapshot, which
  explains the repeated pair of tabs.
- Browser history confirmed a `fake-cmd - Live Output` visit on an ephemeral
  loopback port; after the test process exited, neither reported port had a
  listening process.

## Requirements

1. A Go test binary must not invoke the platform browser launcher when it
   starts the Live Output server.
2. Real non-lite `codeagent-wrapper` execution must continue to open the
   default browser automatically.
3. The Live Output server, SSE behavior, loopback-only binding, session
   lifecycle, and lite-mode behavior must remain unchanged.
4. The fix must include a regression test at the browser-launch boundary.
5. The authoritative personal CCG source must be changed first in an isolated
   worktree based on the currently pinned source commit
   `7f512c9fcbb74527867ec4885aea3b42e1da2a66`.
6. The Harness-owned `components/ccg-workflow/` snapshot must be refreshed only
   through the repository's formal `harness:update` transaction from a clean,
   committed authoritative source checkout.
7. Do not directly edit the installed CCG CLI, Codex plugin cache, or global
   runtime as part of this task.

## Acceptance Criteria

- [ ] Running `go test -short ./...` under `codeagent-wrapper` opens no browser
      tab and executes no platform browser-launch command.
- [ ] A focused unit test proves the production browser opener remains wired
      into `WebServer.Start()` when enabled.
- [ ] A focused unit test proves a test-disabled opener is not invoked.
- [ ] `go test -short ./...` and `go build ./...` pass in the authoritative CCG
      source worktree.
- [ ] The authoritative CCG source diff is limited to the browser-launch hook
      and its regression coverage.
- [ ] After approved source commits, `pnpm harness:update` imports the exact
      tracked tree and updates `harness.sources.json` provenance.
- [ ] Harness source verification, focused Harness tests, CCG lint/typecheck/
      test/build, Go tests/build, doctor, and conflict checks pass without
      creating `fake-cmd` browser tabs.
- [ ] Normal real CCG/Gemini Live Output preview behavior remains enabled.

## Out of Scope

- Redesigning the Live Output UI, SSE protocol, or completion behavior.
- Disabling legitimate Gemini/CCG preview windows.
- Adding a user-facing `--no-browser` CLI option to `codeagent-wrapper`.
- Updating or installing the global CCG runtime/plugin.

## Open Questions

None. The user requested removal of the repeated test-only popups and the
repository evidence fixes the compatibility boundary.
