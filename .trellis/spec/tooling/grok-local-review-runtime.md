# Grok Local Review Runtime

## 1. Scope / Trigger

This contract applies when CCG selects Grok for ordinary code review and binds
one or more local files. It does not apply to generic Grok tasks or Grok
external intelligence.

## 2. Signatures

```text
codeagent-wrapper --backend grok \
  --grok-review-target <workspace-relative-file> [...] \
  [--grok-model <model>] <task> [workdir]
```

`--grok-review-target` is repeatable. Its presence enables strict review
validation; its absence preserves ordinary Grok behavior.

## 3. Contracts

- Each target is a distinct regular, non-link file inside `workdir` after
  canonical resolution.
- Review mode allows only `read_file`, `grep`, and `list_dir`, and disables web
  search, terminal, writes, MCP, memory, planning, and subagents.
- Review launch removes the dynamic `search_tool` and `use_tool` gateways with
  `--disallowed-tools`; post-run rejection is not a substitute for prevention.
- Grok tool records are correlated by `toolCallId`. The wrapper accepts both
  ACP `session/update` records (`sessionUpdate=tool_call|tool_call_update`) and
  Grok's top-level streaming records (`type=tool_call|tool_call_update`).
- A target is satisfied only by a completed exact `ReadFile.target_file` or
  file-exact `Grep.path` call. ACP names come from `rawInput.variant`; top-level
  streaming names come from `toolName`.
- Every target must be satisfied independently. `ListDir`, unrelated paths,
  broad searches, and incomplete calls do not count.
- Successful output ends with exactly one final envelope:

```text
CCG_GROK_REVIEW_JSON:{"schemaVersion":1,"reviewedFiles":["path"],"findings":[]}
```

- `reviewedFiles` equals the normalized target set. Codex remains the final
  verifier and only workspace writer.
- `GROK_MODEL` supplies the default model; an explicit `--grok-model` wins. An
  unavailable explicit model fails without fallback or automatic switching.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Absolute, escaping, missing, directory, duplicate, or linked target | Fail before provider launch |
| Review target used with a non-Grok backend | Fail before provider launch |
| Provider/process failure | Preserve a non-zero provider error |
| Missing/error terminal stop reason | Fail even if prose exists |
| Unknown/forbidden reported tool variant | Fail |
| Missing completed exact evidence for any target | Fail and name missing targets |
| Missing, malformed, duplicated, trailing, or mismatched envelope | Fail |
| All exact evidence and the envelope are valid | Succeed |

## 5. Good / Base / Bad Cases

- Good: two bound files each have completed exact evidence and both appear in
  the envelope.
- Base: no review-target flag; ordinary Grok semantics remain unchanged.
- Bad: Grok emits useful prose after reading only one of two bound files; the
  wrapper returns non-zero.

## 6. Tests Required

- Parse repeated target flags and reject invalid paths before provider launch.
- Assert review arguments omit broad approval and remove dynamic tool gateways.
- Correlate ACP and top-level streaming metadata/completion updates by the same
  `toolCallId`.
- Cover no read, unrelated read, one-of-two, valid ReadFile plus exact Grep,
  invalid envelope, and error stop reason.
- Run the complete Go test/build gates and affected CCG distribution tests.

## 7. Wrong vs Correct

Wrong: accept exit 0 plus non-empty review prose, or reuse the external-search
profile as a fallback.

Correct: bind the minimal concrete file set, require completed exact local-read
evidence and the matching final envelope, then let Codex verify the findings.
