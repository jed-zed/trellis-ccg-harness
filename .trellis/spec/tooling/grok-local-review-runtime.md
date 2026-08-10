# Grok Local Review Runtime

## 1. Scope / Trigger

This contract applies when CCG selects Grok for ordinary code review and binds
one or more local files. It does not apply to generic Grok tasks or Grok
external intelligence. Pure local review must not invoke the external-intelligence
route or apply its official-domain gate.

## 2. Signatures

```text
codeagent-wrapper --backend grok \
  --grok-review-target <workspace-relative-file> [...] \
  [--grok-model <model>] <task> [workdir]
```

`--grok-review-target` is repeatable. Its presence enables a fresh,
snapshot-only review session; its absence preserves ordinary Grok behavior.

## 3. Contracts

- Each target is a distinct regular, non-link file inside `workdir` after
  canonical resolution.
- Before provider launch, the wrapper opens each target, verifies the opened
  file is the same regular file that was validated, rejects non-UTF-8 input,
  and embeds only those bytes in an owner-only temporary prompt file.
- Grok runs from that temporary directory in a fresh session with its native
  Provider permissions. The wrapper passes only the prompt snapshot and uses
  the temporary directory as the default working directory; this is data
  minimization, not an OS sandbox, so native absolute-path and network
  capabilities remain unchanged. Provider tool use does not grant workspace or
  Trellis authority. Review mode passes `--no-auto-update` solely to prevent
  runtime mutation; it does not change tool permission policy.
- The system prompt is replaced with the snapshot-review contract, and the
  provider receives the prompt through `--prompt-file` rather than argv.
- Provider tool events are accepted and safely summarized. A successful
  terminal response is plain review prose; the wrapper appends exactly one final
  scope envelope:

```text
CCG_GROK_REVIEW_JSON:{"schemaVersion":1,"reviewedFiles":["path"],"findings":[]}
```

- `reviewedFiles` equals the normalized target set. The legacy `findings`
  field remains an empty compatibility field; findings live in the preceding
  report body. Codex remains the final verifier and only workspace writer.
- `GROK_MODEL` supplies the default model; an explicit `--grok-model` wins. An
  unavailable explicit model fails without fallback or automatic switching.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Absolute, escaping, missing, directory, duplicate, or linked target | Fail before provider launch |
| Target changes identity while the snapshot is created, or is not UTF-8 text | Fail before provider launch |
| Review target used with a non-Grok backend | Fail before provider launch |
| Review mode attempts to resume an existing session | Fail before provider launch |
| Provider/process failure | Preserve a non-zero provider error |
| Missing/error terminal stop reason | Fail even if prose exists |
| Provider reports a native tool call | Accept the event without exposing raw tool inputs or outputs |
| Successful terminal prose after snapshot preparation | Append the canonical envelope and succeed |
| Pure local review has no official-domain list | Continue without external-intelligence routing |

## 5. Good / Base / Bad Cases

- Good: two bound UTF-8 files are embedded in the isolated prompt, native tool
  events may occur, and both paths appear in the wrapper envelope.
- Base: no review-target flag; ordinary Grok semantics remain unchanged.
- Bad: a review tries to resume a prior session; the wrapper returns non-zero.
- Bad: the orchestrator runs external fact verification solely because local
  review has no official-domain list.

## 6. Tests Required

- Parse repeated target flags and reject invalid paths before provider launch.
- Assert the prompt contains target content but not an unbound neighboring
  file, and reject non-UTF-8 input.
- Assert review arguments preserve native permissions, suppress auto-update,
  use `--prompt-file`, and never resume.
- Cover a successful terminal response, accepted tool events, error stop
  reason, isolated CWD, and the wrapper-generated envelope.
- Assert every ordinary review surface skips Grok external intelligence and the
  domain gate for a pure local review.
- Run the complete Go test/build gates and affected CCG distribution tests.

## 7. Wrong vs Correct

Wrong: give Grok `read_file`/`grep` access to the full worktree and reject
out-of-scope reads only after their contents were already disclosed.

Correct: CCG snapshots only the bound files before launch, uses the temporary
directory as Grok's default working directory, preserves native Provider tools,
and appends the matching scope envelope after a successful terminal response.

Wrong: require the model to reproduce a byte-exact final JSON line.

Correct: let the wrapper generate validation metadata deterministically while
the model returns only the review report.

Wrong: require an official-domain whitelist for a diff-only review.

Correct: enable that whitelist only when the conclusion depends on a current
external fact.
