# Implementation plan: publish Grok review fixes as draft PRs

1. Record and activate this Trellis plan.
   - Commit only this task's planning artifacts from the mixed Harness worktree.
   - Load `trellis-before-dev`; preserve every unrelated dirty path.

2. Create the clean source integration worktree.
   - Base it on `gptpro/codex/fix-windows-grok-cmd` at `ddfc70c...`.
   - Create branch `codex/grok-review-verification-pr`.
   - Cherry-pick `a1580b2`, `7f574a8`, and `efef535` in order.
   - Resolve only direct conflicts; inspect the complete resulting diff against
     the base for unrelated provider/Pi changes.

3. Regenerate source release metadata if integration changes wrapper bytes.
   - Build six OS/architecture binaries twice with the repository's pinned Go
     toolchain and exact release flags.
   - Require byte-identical SHA-256 per target, then update only the existing
     version/digest assertions and documentation.

4. Validate and publish the source branch.
   - Run Go tests, lint, typecheck, Vitest, build, diff checks, and the existing
     CCG quality/security gates required by the changed tool boundary.
   - Confirm branch/base/commit range and no existing head PR.
   - Push with upstream tracking and create a draft PR targeting
     `codex/fix-windows-grok-cmd`.

5. Create the clean Harness integration worktree.
   - Base it on current `origin/main`; create
     `codex/grok-review-verification-harness`.
   - Run official `harness:update` with the exact pushed source commit and clean
     source worktree.
   - Add only the Grok review code-spec and task provenance needed for the PR.

6. Validate and publish the Harness branch.
   - Verify snapshot/source tree equality, run Harness lifecycle/tests, doctor,
     conflicts, and staged source verification.
   - Inspect the complete diff against `origin/main`; reject any rollback of
     Windows Grok or unrelated task/provider state.
   - Commit, push with upstream tracking, and create a draft PR targeting
     `main`, linking the source draft PR as a dependency.

7. Finish Trellis state.
   - Record both PR URLs and exact branch heads in the task artifacts.
   - Run `trellis-check`, archive this task, record the session, and push only
     the resulting task-local follow-up commits to the Harness PR branch.

## Stop conditions

- Stop if cherry-pick resolution would drop either Windows native resolution or
  strict local-review evidence.
- Stop if reproducible wrapper hashes differ between identical builds.
- Stop if either PR diff contains unrelated provider, Pi, task, journal, or
  primary-worktree changes.
- Stop rather than force-push, publish a release, install a wrapper, or make a
  paid provider call.
