# MCPX batch read provenance finding

## Scope / Trigger
Real read(items=[...]) event 2255 succeeded but its top-level path is empty.
## Signatures
Bridge requests now require read(view="file", path="one exact allowed file", mode="full").
No MCPX API, authorization, session ACL or server implementation was changed.
## Contracts
Each read must correlate marker, remote session, workspace, actual request interval and exact path.
## Validation / Error Matrix
Pathless batch -> MCPX_BATCH_READ_PATH_EVIDENCE_UNAVAILABLE; preserve failure, do not infer paths.
## Good / Base / Bad Cases
Good: separate paths 2307/2309/2311/2313/2317 and 2358/2362/2366. Bad: pathless 2255.
## Tests Required
39 Python offline checks pass; actual Pro and final Extra High reads prove corrected prompt use.
## Wrong vs Correct
Wrong: fill event.path from the model claim or Codex preflight. Correct: retain original event and
validate a separately identified bounded recheck with real service-recorded paths.

Spec-update judgment: reusable rule is recorded in the actual installed RUNTIME_CONTRACT.md and
gptpro_mcpx.py with regression. No repository business API or source/spec contract was changed;
this project-local acceptance note preserves the diagnostic without unrelated shared-spec edits.
