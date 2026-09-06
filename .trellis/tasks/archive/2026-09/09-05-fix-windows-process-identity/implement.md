# Implementation and validation

1. Create this task, project the accepted plan into its artifacts, and run
   `task.py start` under Boss's explicit approval. Codex implements inline.
2. Revise this same task under Boss's native Win32 approval, retaining the
   rejected PowerShell 7 evidence. Adapt the Windows-only guarded regression
   using the real Global Init and initializer cases; verify red before repair.
3. Add a shared native query through the existing Python resolver, relocate the
   resolver into the portable Skill with a root re-export, and route both Windows
   callers through it. Preserve identity format, unknown-owner safety and bounds.
4. Run the guarded regression, original failing cases, initializer, approval,
   live-owner and PID-reuse tests. Stop and diagnose if the candidate fails.
5. Review the exact diff, bind validator/native/resolver dependencies in both
   source-verification modes, and document the native query contract. Run
   security and source-integrity checks, including dependency-tampering tests.
6. Commit the independent repair after verification. Synchronize source commit
   `6252515c5359a7e704296ad1ac39d7624d244543` through:

   `CI=true TRELLIS_CONTEXT_ID=codex-pr49-windows-process-identity node scripts/harness-lifecycle.mjs update --ccg-commit 6252515c5359a7e704296ad1ac39d7624d244543 --source-checkout G:/CodexWorktrees/ccg-cleanup-test-pid-collision`

7. Require all source/snapshot lint, typecheck, tests and builds; full Harness
   tests; Go tests/build; `doctor`, `verify:sources`, `harness:conflicts`, and
   `git diff --check`. Do not bypass failed gates.
8. Record results and use Trellis tools for completion/journal state. Publish
   the final integration head normally to Harness PR #49, verify fresh CI is
   for that exact head, and merge only when all checks pass and the head still
   matches. Retain branches, worktrees and backups.

Applicable specifications: `.trellis/spec/tooling/harness-initializer.md`,
`.trellis/spec/tooling/harness-lifecycle.md`, and personal-source provenance.
