# Implementation plan: Grok review model and read verification

## Preconditions

- Keep the task in `planning` until Boss explicitly approves this final plan.
- Before editing, load `trellis-before-dev` and relevant tooling/security specs.
- Preserve all unrelated dirty worktree changes.
- Record the existing User-scope `GROK_MODEL` value for rollback; do not read or
  print credentials.
- Do not edit the provenance-bound Harness snapshot directly. Create an
  isolated authoritative-source worktree from
  `a57cddd3577d48d9a07def766e54ab1ad7beabb5` and leave all existing source
  worktrees untouched.

## Steps

1. Establish the isolated authoritative-source baseline.
   - Create one task branch/worktree from the Harness-pinned commit, not from
     the unrelated current authoritative-source HEAD.
   - Verify the isolated tree is clean, uses the personal `gptpro` remote, and
     matches the pinned source tree before editing.

2. Add focused failing Go tests for the two observed review failures.
   - Reproduce exit 0 plus generic prose with no bound-file read.
   - Reproduce reads of unrelated files only.
   - Cover two bound files where only one is read.
   - Cover completed matching `ReadFile`/file-exact `Grep` plus a valid envelope.
   - Cover error terminal stop reason with partial text.

3. Add the minimal review-target CLI contract.
   - Parse repeatable `--grok-review-target` values into `Config`/`TaskSpec`.
   - Validate and normalize targets against the workdir before provider launch.
   - Do not change calls that omit the flag.

4. Restrict only Grok review-mode arguments.
   - Replace `--always-approve` with the existing CLI's read-only allow/deny
     flags when review targets are present.
   - Disable WebSearch/WebFetch, terminal, edits, MCP, memory, plan, and
     subagents.
   - Preserve ordinary Grok adapter arguments outside review mode.

5. Capture and validate existing ACP review evidence.
   - Extend the Grok parser for `session/update` tool call/update and terminal
     events without building a generic event framework.
   - Correlate by call ID and require a completed exact-file event for every
     bound target.
   - Reject error stop reasons and missing/incomplete/mismatched evidence.

6. Add and validate the final review envelope.
   - Update the existing Grok reviewer prompt with the compact marker contract.
   - Require exact reviewed-file set equality and schema version 1.
   - Update the CCG Review Skill to pass the minimal bound file list and treat
     validator failure as missing provider review evidence.

7. Correct the machine-level model override.
   - Set User-scope `GROK_MODEL` from `grok-4.3` to `grok-4.5`.
   - Verify CCG config and `grok models` still agree on 4.5.
   - Do not modify repository defaults or add model discovery/fallback.

8. Run focused and required source gates.
   - `cd components/ccg-workflow/codeagent-wrapper && go test ./...`
   - Run the smallest affected Vitest/installer parity tests if the Skill or
     prompt template participates in generated assets.
   - Run Harness conflict/parity checks required by the repository.
   - Run CCG change, quality, and security gates because this changes tool,
     command, filesystem, and network boundaries.
   - Inspect the full diff and remove anything not mapped to R1-R4.

9. Commit and synchronize provenance only through explicit gates.
   - Present the isolated authoritative-source commit plan and wait for Boss's
     commit approval; do not push.
   - From the resulting clean committed worktree, run `harness:update` with
     the exact 40-character source commit so it atomically refreshes the CCG
     snapshot and `harness.sources.json`.
   - Run source equality and Harness gates, then present the Harness commit
     plan separately.
   - Refresh the existing local CCG plugin cache only with the canonical sync
     script from the approved source tree and verify the source/cache digest;
     never edit the cache directly.

10. Run one bounded live acceptance smoke after the matching runtime is active.
   - Use Grok 4.5 and two synthetic non-secret bound files.
   - Assert no WebSearch, terminal, edit, MCP, or subagent event occurs.
   - Assert both exact targets have completed read evidence and the envelope
     matches them.
   - Hash before/after and delete only the synthetic ignored smoke artifacts.

## Stop conditions

- Stop rather than fallback if Grok 4.5 is unavailable.
- Stop if the observed ACP event schema differs from the local verified shape;
  update the plan before widening parsing.
- Stop if read-only CLI flags cannot run headlessly without granting broader
  permissions; do not restore `--always-approve` in review mode.
- Stop if generated-source ownership is ambiguous; resolve canonical ownership
  before editing duplicate assets.
- Stop if the isolated source baseline is not exactly the Harness-pinned tree,
  or if `harness:update` would import unrelated source commits.

## Rollback

- Before commit, remove only the task-created isolated worktree/branch to
  discard source edits; after activation, use the Harness lifecycle rollback
  rather than hand-editing the snapshot or manifest.
- Restore the prior User-scope `GROK_MODEL=grok-4.3` only if rollback is
  requested.
- Restore the previous plugin cache only from its prior approved source tree.
- Remove only synthetic ignored smoke artifacts created by this task.
- Do not delete or reset unrelated user changes.
