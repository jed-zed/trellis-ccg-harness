# Design: workflow UX deadlock and hardcoded-limit audit

## Architecture and boundaries

The audit treats the workflow as four linked planes:

1. **Trellis lifecycle** — task creation, planning, activation, current-task
   binding, completion, archive, and prompt-state hooks.
2. **Harness integration** — canonical context, conflict detection,
   initializer transactions, locks, ownership, and product-manager projection.
3. **CCG runtime** — installed plugin/CLI routing, external-intelligence gate,
   Provider execution, retries, terminal-state parsing, and review gates. The
   tracked `components/ccg-workflow` tree is provenance unless the installed
   runtime can be shown to use the same behavior.
4. **Side bridges** — GPT Pro UIA exact-once send/watch/acknowledge flow and
   bounded Provider wrappers for Grok, Gemini, Antigravity, and Pi.

No plane may be judged in isolation when another plane owns the next state
transition or recovery action.

## Evidence model

Evidence is ranked in this order:

1. Reproduced read-only command behavior in the current checkout.
2. Current executable source plus a reachable caller and matching tests.
3. Current installed Skill/rule text when the workflow is prompt-enforced.
4. Specifications and task history, used to identify intended behavior.
5. Prior memory, used only as a search lead and re-verified before a finding.

Every finding records whether it applies to the current worktree, tracked
3.4.5 source snapshot, installed 3.4.6 runtime, or more than one of them.

## Deadlock decision rule

A path is a confirmed UX deadlock or equivalent blocking defect only when all
of the following hold:

- a supported user action can reach the state;
- the normal workflow exposes no valid next transition, bounded terminal
  result, or documented safe recovery command;
- retrying the documented action cannot make progress without hidden/manual
  state surgery, unrelated external recovery, or bypassing an authority gate;
- the behavior is not an explicit user-approval, exact-once, ownership,
  credential, data-loss, or evidence-integrity invariant.

Bounded waits, explicit hard gates, and fail-closed stops are reported as UX
friction only when the operator recovery path is missing or misleading.

## Hardcoded-limit decision rule

For each fixed value or allowlist, record:

- current value and every source of truth;
- whether a supported override exists and is actually consumed;
- the reachable user cost at the boundary;
- the stated safety, integrity, cost, compatibility, or product reason;
- the minimum change: delete, centralize, document, make configurable, or keep.

A constant is not a defect merely because it is fixed. Secret filters,
canonical-path checks, exact-once reservations, CAS revisions, loopback binds,
and transactional ownership checks default to **keep** unless the constraint is
broader than its threat boundary.

## Output contract

Execution will create one task-local report under `research/` containing:

- executive answer and severity summary;
- confirmed blocking defects;
- unnecessary hardcoded limits;
- intentional constraints that should remain;
- hypotheses and missing evidence;
- minimum root-cause fixes, ordered by user value and dependency.

The audit phase changed no product file. Boss later selected F1 and F3 for a
narrow implementation amendment in this same task.

## Approved implementation amendment

The clean publication worktree
`I:/ai/ccg-gptpro-worflow-route-timeout-publish` is based on the personal
fork's current `gptpro/main`, and that remote matches the manifest authority.
The project snapshot, installed npm package, wrapper binary, and plugin cache
are derived surfaces and must not be patched directly.

### F1 data flow

```text
ccg CLI argv --target
-> route.mjs parseArgs().target
-> main() runWorkflowRoute({ target })
-> collectBindings()
-> bindings.target path/sha256/bytes
-> route state input digest
```

The only implementation change is forwarding `args.target` at the existing
CLI/runtime boundary. Extend the existing Codex route CLI subprocess test so it
exercises the real parser and persisted output.

### F3 data flow

```text
CODEX_TIMEOUT bare positive integer
-> resolveTimeout() seconds
-> Config.Timeout
-> context.WithTimeout(timeout * time.Second)
```

Remove the magnitude heuristic instead of replacing it with another threshold.
README already documents seconds; update wrapper help and maintainer docs to the
same contract. Existing invalid/zero fallback behavior stays unchanged.

### Publication boundary

Boss approved the coupled publication on 2026-08-07. Use a clean source branch
based on the personal fork's current `main`; the unmerged GPT Pro bridge branch
is not part of this change. The Go edit requires wrapper `5.12.6` plus all six
digests generated with the release workflow's Go 1.21.13 flags. The Codex
plugin build becomes `3.4.6+codex.2` so installation cannot silently retain the
old plugin bytes.

After the source PR and `preset` release CI succeed, run the formal clean-tree
`harness:update` transaction. Do not manually copy the component, edit the
manifest, upload release binaries, or overwrite a plugin cache. Install the
result through the supported Harness setup and require matching source commit,
tree, CLI, plugin, wrapper version, and wrapper digest evidence.

## Compatibility and operational notes

- Use `py -3.14` for Trellis commands in this checkout.
- Do not start live Providers, GPT Pro sends/watchers, or credential-dependent
  checks. Only the approved supported Harness install flow may update runtime.
- Preserve the current dirty worktree and identify findings based on uncommitted
  files as `current-worktree`, not as merged baseline behavior.
- If a static finding depends on third-party availability or a current model
  name, leave it unconfirmed instead of inferring live status.

## Rollback

The source diff is confined to the route boundary, timeout parser, release
identity, matching tests, and documentation. Before source publication it can
be dropped as one branch; after publication, revert the source commit and run
the same coupled Harness update/install path against the reverted commit.
