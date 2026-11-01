# Implementation plan

- [x] Run `trellis-before-dev`, confirm this task is active, and snapshot the
      pre-existing dirty worktree so unrelated files remain untouched.
- [x] Add focused Pester assertions for a direct `-File` worker launch, safe
      spaced/apostrophe path handling, explicit `-NoWake`, one hidden process,
      and absence of encoded-command or execution-policy bypass markers.
- [x] Replace the encoded worker-command builder and production launcher with
      the smallest Windows PowerShell 5.1-compatible direct-file argument list.
- [x] Remove unnecessary execution-policy overrides from adapter child calls.
- [x] Change the mutex test child from an encoded command to a temporary `.ps1`
      file under `$TestDrive`.
- [x] Run Windows PowerShell parser checks and the complete Skill Pester suite.
      If Pester 5 is not available locally, use the repository's documented
      environment or report the missing gate; do not install globally without
      approval.
- [x] Run the isolated, bounded `-NoWake` smoke test and inspect state, event,
      process lifetime, and Kaspersky's latest detection record.
- [x] Run focused security review, source grep, `git diff --check`, relevant
      repository tests, and `node scripts/harness-adapter.mjs conflicts`.
- [x] Back up and synchronize the validated watcher and any required Skill test
      files to `C:\Users\29933\.agents\skills\chatgpt-pro-sidebar`, then verify
      exact SHA-256 equality. Do not touch other copies.
- [x] Present the diff and validation results. Ask separately before any commit,
      push, Kaspersky exclusion removal, reboot, or destructive cleanup.
