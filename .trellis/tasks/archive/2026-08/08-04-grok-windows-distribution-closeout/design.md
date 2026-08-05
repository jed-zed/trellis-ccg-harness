# Design

## Boundaries and authorities

- Trellis owns this task and its acceptance state.
- The clean personal CCG checkout owns the source bytes and commit identity.
- `pnpm harness:update` owns candidate materialization, provenance generation, transaction behavior, and its built-in gates.
- This worktree owns the final reviewable diff and commit. The original `I:` checkout, global Trellis template, installed provider state, and unrelated dirty paths are read-only/out of scope.

## Bootstrap repair

Replace only the two Python-3.12-style nested multiline f-string wrappers in `_validate_jsonl` with ordinary prefix concatenation around `colored(...)`. Keep both warning payloads, colors, conditions, counters, and exit behavior unchanged. Do not modify `.trellis/.template-hashes.json`.

## Snapshot synchronization

The lifecycle entry point rejects any dirty target repository and has no preview/candidate-only flag. The current worktree cannot be cleaned without touching user-owned state. Use this bounded bridge:

1. Create a temporary detached sparse Git worktree from this branch's clean `HEAD`, excluding the two documented protected security-reference paths.
2. Run the canonical lifecycle command there with the explicit `ddfc70c` commit and clean personal source checkout.
3. Require the lifecycle transaction and its built-in CCG/Harness gates to finish successfully.
4. Export only the resulting Git diff for `components/ccg-workflow/**` and `harness.sources.json`; reject any other tracked path.
5. Apply that exact patch to this worktree. This transfers the owned transaction result without hand-copying a tree or inventing provenance fields.
6. Stage only the expected seven component paths plus `harness.sources.json` for index-based source verification. Never use `git add .` or stage the protected security-reference paths.
7. Re-run focused and full affected gates in this worktree, then inspect both the working-tree and staged diffs.

## Dirty-state protection

Record `git status --short` before every write. The protected baseline is the four watcher/GPT Pro files, four pre-existing Trellis task directories, and the two endpoint-protection-affected security-reference files. Compare the final status/diff against that baseline and the task-owned path allowlist.

## Provider and network behavior

Run the CCG intelligence route only as the configured intake gate. Do not authorize an external provider call. The CCG source checkout and local validation are sufficient for this change. The existing installed plugin already matches `ddfc70c`; do not reinstall or repeat the paid smoke unless later evidence proves the snapshot-installed runtime differs and Boss approves one bounded call.

## Rollback

- Abort before applying the generated patch if the temporary transaction or scope check fails.
- The lifecycle temporary worktree keeps its own rollback transaction during generation and is removed only after collecting the validated diff.
- Before commit, task-owned changes remain reviewable and reversible by exact path; unrelated dirty state is never used as rollback material.
- Do not use destructive resets, broad cleans, stashes, or checkout-based restoration.
