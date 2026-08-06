# Design: Pi selectable CCG provider

## Boundaries

The change spans the authoritative personal CCG source, its verified Harness
snapshot, and the installed local runtime. Trellis owns this task and its
acceptance criteria. CCG owns provider routing. Pi receives no workspace-write
authority. Pi uses the shared role-routing registry without a special
product-manager ban; the separate product-manager execution contract is not
expanded in this task.

## Provider registration

Add `pi` to the existing `REGISTERED_MODEL_TYPES` source of truth. Reuse all
derived routing validation, `ccg routing get/set`, init choices, and menu
choices. Do not introduce a parallel provider list or change role defaults.

Update only hard-coded provider prose/help that is not derived from the
registry. Do not add a role-compatibility matrix. Product-manager's dedicated
execution-provider implementation remains a separate concern.

## Wrapper backend

Add a small `PiBackend` alongside the existing Go backends:

- command: `pi`;
- new session: `--mode json`, with the prompt supplied only through stdin;
- resume: `--session <id>`, with the prompt supplied only through stdin;
- working directory: always set `cmd.Dir` to the caller-provided `WorkDir` for
  Pi new and resume processes so session lookup remains project-local;
- project trust/resources: `--no-approve`, `--no-extensions`, `--no-skills`,
  `--no-prompt-templates`, `--no-context-files`;
- tool boundary: `--tools read,grep,find,ls`;
- session persistence remains enabled so the wrapper can return and reuse the
  emitted session ID.

Pi's official docs state that tool selection is not an OS sandbox. The
read-only allowlist is therefore a capability reduction consistent with the
Harness contract, not a claim of full process isolation.

## JSONL parsing

Extend the existing unified parser rather than add a second process pipeline.
Recognize:

- session header: `{type:"session", id:"..."}`;
- assistant completion: `message_end` or `turn_end` with
  `message.role="assistant"` and text content blocks;
- completion: `agent_end`;
- optional `message_update.assistantMessageEvent` text deltas for progress/UI.

Prefer the completed assistant message as the authoritative final result to
avoid duplicate delta accumulation. Preserve unknown events and tool events as
ignored input unless an existing callback needs them. Interpret the nested Pi
assistant `stopReason`: `error` and `aborted` fail closed, clear any prior
candidate message, and surface `errorMessage`; `toolUse` is intermediate and
cannot become the final successful result; `stop` is successful. Streaming
`message_update` remains optional because `message_end` is authoritative.

## Provenance and rollout

1. Implement and test in `I:\ai\ccg-gptpro-worflow`.
2. Obtain the workflow-required commit approval for the authoritative source.
3. Import only the clean tracked committed tree into `components/ccg-workflow`.
4. Refresh `harness.sources.json` commit/tree identifiers and verify exact
   source/snapshot equality.
5. Run full Harness/CCG gates.
6. Back up and update the installed local CCG plugin/runtime only after the
   source and snapshot are verified. Pi itself remains uninstalled.

Rollback is the reverse coupled update: restore the prior installed runtime,
manifest identifiers, component snapshot, and authoritative source commit.
