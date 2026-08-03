# Implementation plan

1. Reconfirm both repositories are clean and that the authoritative CCG
   commit/tree matches `harness.sources.json`.
2. In the authoritative CCG checkout, add failing focused tests for:
   - routing `frontend -> pi` with unchanged defaults;
   - Pi backend selection and argument construction;
   - Pi JSONL session/final-message parsing;
   - missing/unknown backend behavior remaining unchanged.
3. Add the minimal TypeScript registry and hard-coded help/template updates.
4. Add `PiBackend`, register it, wire direct prompt handling, and extend the
   unified parser for Pi events.
5. Run focused tests, TypeScript lint/typecheck/test/build, and Go short tests
   plus build in the authoritative checkout.
6. Present the authoritative-source commit plan and wait for Boss's separate
   commit approval; do not push.
7. Synchronize the clean committed source tree into the Harness component and
   update `harness.sources.json` through the repository's provenance flow.
8. Run `verify:sources`, CCG gates, Harness tests, doctor, context/conflicts,
   Go tests/build, and the required security/quality checks.
9. Present the Harness commit plan and wait for Boss's separate commit
   approval; do not push.
10. After source/snapshot verification, back up and update the installed local
    CCG runtime/plugin, then verify `ccg routing set/get frontend pi` without
    selecting Pi as the active default or invoking its absent executable.

## Rollback points

- Before source commit: restore only the task-owned authoritative-source files.
- Before snapshot import: retain the old manifest and exact component tree.
- Before installed-runtime update: create a timestamped backup and restore it
  if routing/config/plugin checks fail.

## Validation commands

Use the focused package test commands discovered from the authoritative
checkout, then from the Harness repository run:

```powershell
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
```

From `components/ccg-workflow/codeagent-wrapper` also run:

```powershell
go test -short ./...
go build ./...
```
