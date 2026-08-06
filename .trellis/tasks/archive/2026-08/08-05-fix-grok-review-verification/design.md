# Design: Grok review model and read verification

## Scope

This task fixes one machine-level configuration override and one generic Grok
review correctness gap. It does not alter Grok external intelligence or build a
shared provider-event framework.

The two fixes stay in one task because the model correction is a small runtime
prerequisite for the same end-to-end Grok review acceptance test; splitting it
would add lifecycle overhead without an independently deliverable artifact.

## Current flow and root causes

```text
/ccg:review
  -> backend routing = grok
  -> codeagent-wrapper --backend grok
  -> GROK_MODEL environment override
  -> grok --output-format streaming-json
  -> parser keeps text/thought/end only
  -> executor accepts any non-empty text after exit 0
```

Root cause 1 is outside repository defaults: the user environment contains
`GROK_MODEL=grok-4.3`, while the CCG config and available model are 4.5.

Root cause 2 is a missing review postcondition. Grok streaming JSON already
contains ACP `session/update` tool events. The current parser ignores those
events, so a generic answer can pass without reading the bound file.

## Model correction

Set the user-scoped `GROK_MODEL` value to `grok-4.5`. Do not change repository
defaults and do not add fallback. Verification reads the User scope directly
and runs the wrapper with an explicit 4.5 argument in the current Codex process,
whose inherited environment cannot be refreshed without restarting the app.

Rollback restores the previous user-scoped value `grok-4.3`.

## Review activation contract

Add one repeatable, review-specific wrapper argument:

```text
--grok-review-target <workspace-relative-file>
```

At least one occurrence enables Grok review validation. The CCG review Skill
passes only the minimal set of files the review must inspect. Targets must be
regular files inside the declared workdir after canonical path resolution;
empty, absolute, missing, directory, link/reparse, and escaping targets fail
before the provider starts.

No target flag means the existing generic Grok behavior remains unchanged.

## Read-only Grok review process

When review targets are present, build Grok arguments from the existing backend
adapter but replace broad `--always-approve` behavior with a review-only tool
surface:

- allow only `read_file`, `grep`, and `list_dir`;
- disable WebSearch/WebFetch;
- deny edit/write, terminal, MCP, memory, plan, and subagent actions;
- keep the selected model explicit;
- keep the real workspace read-only from the provider's product contract;
  Codex remains the only writer.

The ordinary non-review Grok adapter remains unchanged.

## ACP event validation

Extend the existing Grok branch in `parser.go` only far enough to recognize
native ACP `session/update` records:

- `tool_call` identifies the tool call ID and tool variant;
- `tool_call_update` supplies `kind`, `rawInput`, and later `status=completed`;
- `_x.ai/session/update` with `turn_completed` supplies the terminal stop reason.

Correlate records by `toolCallId`. A bound file is satisfied only when the same
call ID has both:

1. `rawInput.variant=ReadFile` with `target_file` resolving exactly to the
   bound file, or `rawInput.variant=Grep` with `path` resolving exactly to the
   bound file; and
2. a later `status=completed` update.

Broad Grep paths, glob-only searches, failed/incomplete calls, and reads of
other files do not count. Every bound file must be satisfied.

Outside Grok review mode, these additional events remain informational and do
not change existing success semantics.

## Final response contract

Reuse CCG's existing marker-plus-JSON pattern. The Grok reviewer prompt must end
with one compact envelope:

```text
CCG_GROK_REVIEW_JSON:{"schemaVersion":1,"reviewedFiles":["path"],"findings":[]}
```

`reviewedFiles` must equal the normalized bound target set. `findings` may be
empty and remains review evidence for Codex, not an authorization to write.
Malformed/missing JSON, a mismatched file set, missing read evidence, or an
error terminal stop reason returns a specific non-zero wrapper error even when
the process exited 0 and emitted prose.

## Source ownership and files

Product edits are made first in a new isolated worktree of
`I:\ai\ccg-gptpro-worflow`, based on the Harness-pinned commit
`a57cddd3577d48d9a07def766e54ab1ad7beabb5`. The current source checkout stays
untouched because its later commits overlap the same wrapper and Skill files.

Expected authoritative-source product files are limited to:

- `components/ccg-workflow/codeagent-wrapper/config.go`
- `components/ccg-workflow/codeagent-wrapper/backend.go`
- `components/ccg-workflow/codeagent-wrapper/parser.go`
- `components/ccg-workflow/codeagent-wrapper/executor.go`
- `components/ccg-workflow/codeagent-wrapper/main.go`
- existing focused Go test files beside those sources
- `components/ccg-workflow/templates/prompts/grok/reviewer.md`
- `components/ccg-workflow/plugins/ccg/skills/ccg-review/SKILL.md`

The paths above are relative to the Harness snapshot; their source-worktree
counterparts omit the `components/ccg-workflow/` prefix. After the source
commit is separately approved, `harness:update` owns the snapshot refresh and
the corresponding `harness.sources.json` update. The existing local plugin
cache is refreshed only by `plugins/ccg/scripts/sync-local-plugin-cache.ps1`
from the same approved source tree and verified by the plugin doctor digest.

Use existing test files unless a single dedicated Grok review test file is
materially clearer. Do not add a package, dependency, config section, cache,
retry layer, or provider abstraction.

## Failure behavior

Fail closed with one direct cause: invalid target, unavailable explicit model,
missing target read evidence, invalid review envelope, provider/process error,
or error stop reason. Preserve the provider's original unavailable-model error.
No automatic model switch, provider fallback, retry expansion, or synthetic
success is allowed.

## Verification and rollback

- Unit tests prove multi-file all-required behavior, unrelated-read rejection,
  completed-call correlation, invalid envelope rejection, and error stop reason.
- Existing non-review Grok and external-intelligence tests prove isolation.
- One bounded live smoke uses synthetic non-secret files, Grok 4.5, no WebSearch,
  and verifies all target evidence plus zero workspace changes.
- Rollback removes only the task-created isolated worktree/branch before a
  source commit, or uses the Harness lifecycle rollback after snapshot
  activation. It restores the previous plugin cache from the prior approved
  source and restores the previous user environment value. No credentials or
  session files are copied or modified.

## Implemented outcome

- The authoritative source branch contains three task-only commits ending at
  `efef535e976e7d508650e0a575075689fdfd6237` (tree
  `76abb07458baa6f04feedf20424376c4b144bf6c`) and publishes wrapper metadata as
  version `5.12.5`.
- The live Grok 4.5 stream used top-level `tool_call`/`tool_call_update` records,
  so the focused parser handles that observed shape as well as the planned ACP
  `session/update` shape, using the same `toolCallId` correlation and no generic
  event abstraction.
- A two-file live smoke completed using only `read_file`, `grep`, and
  `list_dir`; both target hashes were unchanged and the exact review envelope
  was accepted.
- Official `harness:update` regenerated the CCG snapshot and bound
  `harness.sources.json` to the commit/tree above. The canonical plugin-cache
  sync produced the same SHA-256 tree digest for source and cache.
- A locally installed `codeagent-wrapper` executable is still absent. Publishing
  or installing the newly pinned binary is a separate release action and is not
  part of this task.
