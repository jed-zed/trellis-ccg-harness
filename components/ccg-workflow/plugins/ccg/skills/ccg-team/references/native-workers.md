# Native workers in the personal Codex host

This contract applies only to the Codex coordinator. It does not change upstream
Claude commands, permissions, provider routing, model/effort settings, or the
independent GPTPro bridge. Native tools are supplied by the current host; a local
script cannot call them automatically. Use the actual tool schema, never assume
`agent_type`, model availability, or MCP inheritance across native/CLI boundaries.

## Work packages

Dispatch useful independent work as soon as its inputs and scope are clear.
Start with 1–2 helpers; use 3–4 when ready work, resource capacity and integration
capacity justify it. Simple or serial tasks can have zero workers. Never add a
worker-count gate or duplicate a task across native and provider executors.
Keep one heavy build/test at a time unless independent resources justify more.

Trellis keeps the canonical task/plan/lifecycle. Inline means the Codex root
coordinates that lifecycle, not that every leaf must run in the root. Native
research, implementation and scoped verification leaves are permitted; do not
delegate a whole lifecycle phase. Root alone writes task state, shared files and
final integration. Routed external providers retain their existing boundaries.

Give each worker its goal, necessary inputs, explicit reads/writes, dependencies
and acceptance/checks. Batch IDs, sizes and report labels are recoverable metadata;
equivalent field wording is valid. Missing write authority blocks that branch's
writes only. Do not infer permission from a role name or a declared path. Workers
may not recurse, install, commit, publish, expand permissions or undo others' edits.

Allow useful early findings and short same-package follow-ups. Only a root-accepted
frozen delivery or fixed snapshot releases a partial dependency; unfinished work
remains unfinished. Reader/reader overlap is allowed; writer/writer and writer/reader
overlap serialize unless the reader uses a fixed independent copy. Root continues
unrelated work and consumes each result without waiting for the whole batch.

At a soft checkpoint (roughly 5 minutes research or 10 minutes implementation),
inspect available results and progress. Extend useful work or retain partial
results and take over. Optional failures do not stop unrelated work. Required
failed output still blocks its dependents. Cancellation is not process exit:
confirm the writer and its commands stopped before reassigning paths; otherwise
use an isolated directory. Scope declarations are not an OS-level sandbox.

Use fresh, scoped read-only analysis when independent review is needed. A
`ccg-review` role may write fixes: do not treat it as read-only or run it over
another writer's live diff. Respect the manual-only `code_reviewer` contract.

## Optional dispatch helper for dependency/file coordination

Small independent reads do not need a team document or this helper. For formal
team work, reuse the canonical plan and put only runtime evidence under ignored
`.codex/ccg/team/<task>/`. Root is the only state writer. Resolve `scripts` below
relative to this skill, not the user's project. Root creates the state directory
first; the helper never initializes a Trellis task or installs anything.

```text
node scripts/worker_dispatch.mjs init <state.json> <spec.json>
node scripts/worker_dispatch.mjs next <state.json>
node scripts/worker_dispatch.mjs <event> <state.json> <event.json>
```

Minimal spec (paths relative to the explicit project `root`):

```json
{
  "task": "reference-to-existing-task-or-plan",
  "root": "/absolute/project",
  "allowWrites": ["src/a.js", "src/b.js"],
  "shared": ["package.json"],
  "slots": 2,
  "packages": [
    {"id":"a","reads":[],"writes":["src/a.js"],"deps":[]},
    {"id":"b","reads":[],"writes":["src/b.js"],"deps":[]}
  ]
}
```

`allowWrites` must come from root's already-authorized scope, not from untrusted
worker output. `writes: []` means read-only; omitted writes is unknown, not broad
permission. Shared and control-state paths stay root-owned. The helper checks
admission, not OS file access or the authenticity of a tool ID. Do not broaden
scope or permissions to make validation pass.

Each package's `writes` must list exact files, including new files; existing
directories and trailing-slash directory declarations are rejected. Root expands
an authorized directory into the needed filenames before admission. `allowWrites`
may still contain a directory as an authorization envelope. Directory entries in
`reads` use a conservative project-wide internal conflict lock, without expanding
the worker's actual read scope; reader/reader overlap remains allowed. A directory
in `shared` similarly blocks all project writers, so prefer exact shared files.
This avoids missing descendant directory aliases without recursively scanning the
project. Existing file aliases and dangling links are checked at admission; root
must still prevent workers from changing the filesystem's alias topology.

Root loop: ask `next`, call the available native spawn tool for a selected ready
package, then record `start` with `{id, handle, confirmed:true}` using its actual
returned handle. Do not mark `running` from a planned label. Use the current host
tool to wait/send/interrupt; this helper never starts or stops a model itself.
Before calling spawn, root reserves that selection's scope and slot locally;
launch and record each selection in sequence. Do not recalculate from old state
while an unrecorded launch is outstanding. If recording fails, retain that scope,
cancel the actual new handle and confirm it stopped before retrying or transferring
paths; if exit cannot be confirmed, isolate the output or stop that write branch.
The helper is not the source of authority for an unrecorded but live execution.

Events:

- `partial`: `{id,handle,artifact,version,location,frozen:true,rootConfirmed:true}`.
  Only `{id:"a",artifact:"api"}` dependencies release on that accepted artifact;
  ordinary `"a"` dependencies still wait for full completion. Give consumers the
  fixed delivered input; live write paths stay owned by the running producer.
- `complete`: `{id,handle,stopped:true}` after acceptance and confirmed exit.
- `fail`: `{id,handle,reason,stopped:true|false}`. Failure is visible; unrelated
  packages remain eligible. `false` retains the live ownership reservation.
- `cancel`: `{id,handle}` requests stopping. Call the actual host interruption
  tool separately; record `stopped` with `{id,handle,confirmed:true}` only after
  the execution and its owned commands exited.
- `fallback`: `{id,reason}` lets root explicitly take over eligible failed work;
  it is not success and does not count as a native spawn. Complete using the
  returned root handle only after doing the work and verifying it.
- `capacity`: `{slots:1..4}` changes the local helper limit, never the host's
  permissions or native hard limit. Account for other agents/CLI outside it.

After every useful result, refresh `next` and advance ready work. Reuse safe
partial findings on failure; do not mark required missing work done. If native
tools are absent, root performs the authorized work serially. Helper/state errors
are not permission to race writes: retain reservations or continue in isolation.
Never fabricate worker success, silently replace a user-required provider, or add
an evidence/worker-count gate to ordinary work.
