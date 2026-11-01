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

CODEAGENT_RETAIN_LOG_ON_FAILURE=1 codeagent-wrapper --backend grok \
  --grok-review-target <workspace-relative-file> [...] \
  <task> [workdir]
```

`--grok-review-target` is repeatable. Its presence enables a fresh,
snapshot-only review session; its absence preserves ordinary Grok behavior.

## 3. Contracts

- Each target is a distinct regular, non-link file inside `workdir` after
  canonical resolution.
- Before provider launch, the wrapper opens each target, verifies the opened
  file is the same regular file that was validated, rejects non-UTF-8 input,
  and embeds only those bytes in an owner-only temporary prompt file.
- Grok runs from that temporary directory in a fresh session with the selected
  official baseline's normal `--always-approve` permission behavior. The fork
  must not add a separate no-tool profile, forced compatibility shutdown, empty
  MCP requirement, or post-run rejection solely because Grok used a tool.
- Review mode keeps the installed Grok CLI's native update behavior. CCG does
  not inject `--no-auto-update`; update ownership remains with the Provider CLI.
- `CODEAGENT_RETAIN_LOG_ON_FAILURE=1` opts one Grok invocation into complete
  wrapper-log retention only when its final result is non-zero. The wrapper
  closes the logger, retains the current file, and prints the exact path before
  returning the unchanged failure code. Success and default cleanup are
  unchanged, and the input has no effect on non-Grok backends.
- The system prompt keeps the snapshot-review task and data framing without
  adding permission-only instructions, and the provider receives it through
  `--prompt-file` rather than argv.
- A successful terminal response is plain review prose; the wrapper appends
  exactly one final scope envelope:

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
| Opted-in provider/process or review validation failure | Retain the complete wrapper log and report its exact path without changing the failure |
| Opted-in successful review | Remove the transient wrapper log through normal success cleanup |
| Missing/error terminal stop reason | Fail even if prose exists |
| Provider reports tool use allowed by the inherited Grok permission contract | Continue; tool use alone is not a validation failure |
| Successful terminal prose after snapshot preparation | Append the canonical envelope and succeed |
| Pure local review has no official-domain list | Continue without external-intelligence routing |

## 5. Good / Base / Bad Cases

- Good: two bound UTF-8 files are embedded in the isolated prompt, Grok may use
  its inherited tools, and both bound paths appear in the wrapper envelope.
- Good: an opted-in non-zero review retains the full raw diagnostic log locally,
  reports the path, and emits no success envelope.
- Base: no review-target flag; ordinary Grok semantics remain unchanged.
- Bad: a review tries to resume a prior session, loses the target/session
  binding, or returns no usable terminal result.
- Bad: the orchestrator runs external fact verification solely because local
  review has no official-domain list.

## 6. Tests Required

- Parse repeated target flags and reject invalid paths before provider launch.
- Assert the prompt contains target content but not an unbound neighboring
  file, and reject non-UTF-8 input.
- Assert review arguments use the selected official baseline's Grok permission
  behavior, use `--prompt-file`, never resume, and do not inject
  `--no-auto-update`.
- Cover successful terminal responses with and without tool events, error stop
  reason, isolated CWD, and the wrapper-generated envelope. Tool use by itself
  must not make the result fail.
- Cover opted-in non-zero review output larger than the console tail and assert
  the retained log contains beginning/middle/end markers, while success,
  default failure, and non-Grok cleanup remain unchanged.
- Assert every ordinary review surface skips Grok external intelligence and the
  domain gate for a pure local review.
- Run the complete Go test/build gates and affected CCG distribution tests.

## 7. Wrong vs Correct

Wrong: apply a fork-specific no-tool profile or reject a complete review solely
because Grok used an inherited tool.

Correct: CCG binds the requested target bytes into the review prompt, runs Grok
with the official permission contract, validates the terminal result and target
identity, and appends the matching scope envelope.

Wrong: infer a Grok root cause from a truncated tail or retain every Provider log.

Correct: explicitly opt one Grok diagnostic into complete failure-log retention,
inspect the reported path, and keep all default cleanup behavior unchanged.

Wrong: require the model to reproduce a byte-exact final JSON line.

Correct: let the wrapper generate validation metadata deterministically while
the model returns only the review report.

Wrong: require an official-domain whitelist for a diff-only review.

Correct: enable that whitelist only when the conclusion depends on a current
external fact.

Wrong: silently freeze the installed Grok CLI during automated review while
allowing machines to drift across incompatible versions.

Correct: preserve Grok's native updater behavior unless the user explicitly
sets `GROK_DISABLE_AUTOUPDATER`.
