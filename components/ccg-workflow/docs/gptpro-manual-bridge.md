# GPT Pro Sidebar Bridge

The filename is retained for link compatibility. The bridge is no longer a normal manual
copy/paste handoff. `/ccg:gptpro-plan`, `/ccg:gptpro-review`, and `/ccg:gptpro-exc` use the installed
`chatgpt-pro-sidebar` Skill to communicate with the user's already logged-in ChatGPT Pro session in
the Codex Desktop side panel.

Ordinary CCG routing runs first. ChatGPT Pro is appended as untrusted, read-only task evidence;
Codex remains the sole workspace writer and final verification owner.

## Layout

Runtime source is packaged under:

```text
templates/engine/tools/gptpro/
```

The Codex plugin copy is:

```text
plugins/ccg/skills/ccg-gptpro-bridge/
```

The required personal Skill is installed at:

```text
~/.codex/skills/chatgpt-pro-sidebar/
```

Native CCG task evidence:

```text
.ccg/tasks/<task-id>/gptpro/<session-id>/
  status.json
  round-1/
    prompt.md
    response.md
    sidebar/
      state.json
      evidence.json
      watch-event.json
      response.md
```

For Trellis-owned tasks, pass `.trellis/tasks/<task-id>` through `--task-dir`. All adapter evidence
stays under:

```text
.trellis/tasks/<task-id>/.ccg-evidence/gptpro/<session-id>/
.trellis/tasks/<task-id>/.ccg-evidence/evidence.json
```

The bridge never creates a parallel `.ccg/tasks/<task-id>` for a Trellis task and never writes CCG
gate fields into Trellis `task.json`.

## Automated Contract

1. Create the CCG bridge session and its bounded `prompt.md`.
2. Use only the installed `chatgpt-pro-sidebar` Skill for side-panel status, new conversation,
   prompt submission, response capture, and detached monitoring.
3. Register the watcher with the exact current `CODEX_THREAD_ID`; model-driven polling is forbidden.
4. The official Stop Hook continues the same Codex Desktop task after completion or interruption.
5. Import only a completed watcher result:

```text
python gptpro_bridge.py \
  --import-session <session-dir> \
  --import-sidebar-evidence <session-dir>/<round>/sidebar \
  --expected-codex-thread-id <CODEX_THREAD_ID>
```

6. Continue only when `CCG_GPTPRO_SIDEBAR_IMPORTED=1`.

The importer validates:

- the current bridge round and exact prompt hash;
- live Windows UIA evidence and a completed watcher;
- the exact ChatGPT conversation URL;
- response, URL, and evidence SHA-256 values;
- the exact Codex task ID;
- `automaticResendAllowed=false`;
- `externalOutputIsUntrusted=true`;
- `codexIsSoleWorkspaceWriter=true`.

Re-importing identical evidence is idempotent. Different response content cannot overwrite an
already imported round.

## Multiple Conversations

Independent complex workstreams use separate CCG sessions and ChatGPT Pro conversations. If multiple
existing Codex Desktop windows are available, bind one conversation per selected `windowRuntimeId`,
submit each prompt through serialized UIA operations, and let the generations and detached watchers
run concurrently. With one window, queue conversations sequentially.

The Stop Hook stores one registration per watcher and fans all terminal registrations from the same
pass into one same-task continuation. Pending registrations remain for later continuation turns.

## Boundaries

- Login, account selection, CAPTCHA, password, passkey, MFA, recovery, billing, and entitlement are
  always manual user actions.
- No DOM scraping, browser-internal API, external browser, cookies, tokens, or profile data.
- No automatic resend after an uncertain submission.
- GPT Pro never writes workspace files, runs Git, or owns delivery.
- Fixture tests do not prove a live ChatGPT Pro interaction.
- The legacy localhost preview remains only for backward-compatible diagnostics; CCG GPT Pro Skills
  do not use it for normal handoffs.

## Evidence Item

Successful import appends:

```text
provider=gptpro
role=<plan|review|execution-companion>
policy=automated-sidebar
transport=chatgpt-pro-sidebar
available=true
artifactFile=gptpro/<session-id>/<round>/response.md
artifactSha256=<sha256>
conversationUrl=<exact ChatGPT conversation URL>
codexThreadId=<exact Codex task UUID>
automaticResendAllowed=false
externalOutputIsUntrusted=true
codexIsSoleWorkspaceWriter=true
```

`package.json.files` already includes `templates/engine/`; release validation must still inspect the
packed file list before publishing.
