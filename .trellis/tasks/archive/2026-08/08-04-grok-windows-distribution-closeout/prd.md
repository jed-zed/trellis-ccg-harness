# Close out Grok Windows distribution snapshot

## Goal

Finish the distribution-side closeout for the verified Grok native-Windows executable fix. Restore the Trellis task CLI on the repository's supported default Python, then update the Harness-owned personal CCG snapshot from `a57cddd3577d48d9a07def766e54ab1ad7beabb5` to `ddfc70c09e2e06b158d0a972a677d2b02aedec21` without touching unrelated work.

## Background

- The authoritative personal CCG checkout is `C:\Users\29933\.codex\worktrees\fix-windows-grok-cmd`, clean at `ddfc70c09e2e06b158d0a972a677d2b02aedec21` on `codex/fix-windows-grok-cmd`.
- `ddfc70c` directly descends from the currently recorded `a57cddd`, has Git tree `4d914cdd03fd8e66a58a4d7555698b9045d3f903`, and keeps package version `3.4.5`.
- The source commit changes seven Grok distribution/runtime-test files. The source worktree already passed its focused, full, lint, typecheck, build, CCG quality, and security gates.
- `harness.sources.json` currently records `a57cddd` and tree `c534f316c9461795527d6d55933e9d282498c661`.
- Default `python` is 3.11.2. The Trellis 0.6.9 generated `task_context.py` used nested multiline f-strings that failed to parse on Python 3.11. The project-local runtime is an allowed customization; global npm templates and `.trellis/.template-hashes.json` are outside this task's write boundary.
- The supported CCG update command requires a completely clean Harness repository. This worktree intentionally contains protected unrelated dirty paths, so the canonical update must run in a clean temporary sparse worktree and its exact Git diff must then be applied and revalidated in this worktree.

## Requirements

1. Preserve the two existing context-validation warning messages and semantics while making `task_context.py` parse on the repository's supported Python 3.9+ range.
2. Use Trellis as the only task, requirement, plan, and lifecycle authority; keep CCG runtime evidence ignored and non-canonical.
3. Use the Harness-owned lifecycle command with the clean personal checkout and explicit full commit; do not hand-copy the CCG tree or hand-edit provenance digests.
4. Update only the tracked CCG snapshot and its coupled `harness.sources.json` provenance fingerprint to `ddfc70c` / `4d914cdd03fd8e66a58a4d7555698b9045d3f903`.
5. Keep the original `I:\ai\trellis-ccg-harness` read-only. All final patches, task artifacts, validation, staging, and commits belong to this worktree.
6. Do not modify, stage, or include any pre-existing dirty watcher files, pre-existing Trellis task directories, or the protected security-reference files.
7. Do not read or print credentials. Do not call paid/live providers unless a later validation proves it is necessary and Boss separately approves that exact call.
8. Do not push or open a pull request. Present one commit plan before any commit.

## Acceptance Criteria

- [x] Default Python passes `py_compile` for `task_context.py`, `task.py`, and `get_context.py`; `task.py list`, `get_context.py`, and a context-validation warning smoke all run successfully.
- [x] The canonical Trellis task exists, its reviewed artifacts are complete, and `task.py start` changes it to `in_progress` only after Boss approves the final planning summary.
- [x] The lifecycle input checkout is clean, has the expected personal remote, and resolves the explicit commit/tree/version stated above.
- [x] The owned lifecycle transaction succeeds in a clean sparse worktree and reports the expected commit/tree.
- [x] This worktree's intended component/index content matches the exact tracked source tree with only the repository's documented sparse exclusions.
- [x] `harness.sources.json` records `ddfc70c`, tree `4d914cdd03fd8e66a58a4d7555698b9045d3f903`, version `3.4.5`, and a refreshed capture time produced by the lifecycle transaction.
- [x] Focused Grok distribution tests and affected Harness/source gates pass; staged `harness:conflicts --index` reports no blocking or warning findings attributable to this task.
- [x] Every pre-existing dirty path remains unmodified by this task and is excluded from staging/commit.
- [x] A scoped commit plan is presented before committing; nothing is pushed.

## Out of Scope

- Modifying the global Trellis npm package or upstream Trellis source.
- Writing to the original `I:\ai\trellis-ccg-harness` checkout.
- Changing watcher/GPT Pro work, unrelated Trellis tasks, security-reference files, provider configuration, credentials, or login state.
- Reinstalling provider CLIs, re-running the paid live Grok smoke without a demonstrated need and fresh approval, pushing, or opening a PR.

## Deferred Risk

The installed Trellis 0.6.9 template retains the Python-3.11-incompatible warning syntax. This task keeps the project-local runtime fixed, and the unchanged template hash intentionally makes a future `trellis update` recognize it as a local modification. An upstream/global template repair is separate work outside the corrected worktree boundary.
