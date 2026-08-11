# GPT Pro Sidebar Bridge

The filename is retained for link compatibility. The bridge is no longer a normal manual
copy/paste handoff. `/ccg:gptpro-plan`, `/ccg:gptpro-review`, and `/ccg:gptpro-exc` use the installed
`chatgpt-pro-sidebar` Skill to communicate with the user's already logged-in ChatGPT Pro session in
an approved external Chrome tab through `agent-browser-cli-v2`.

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

Resolve the required personal Skill from the active project first:

```text
<project-root>/.agents/skills/chatgpt-pro-sidebar/
```

Only when the project copy is absent, fall back to:

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
2. Use only the installed `chatgpt-pro-sidebar` Skill for browser status, new conversation,
   prompt submission, response capture, and local monitoring.
3. Invoke watcher `run-root` once with the prompt, empty evidence directory, unique idempotency key,
   and exact current `CODEX_THREAD_ID`. It sends once, starts the watcher immediately, and keeps the
   same root turn blocked until terminal evidence; model-driven polling and Stop Hook are forbidden.
4. Import only a completed watcher result:

```text
python gptpro_bridge.py \
  --import-session <session-dir> \
  --import-sidebar-evidence <session-dir>/<round>/sidebar \
  --expected-codex-thread-id <CODEX_THREAD_ID>
```

5. Continue only when `CCG_GPTPRO_SIDEBAR_IMPORTED=1`.

The importer validates:

- the current bridge round and exact prompt hash;
- live `agent-browser-cli-v2` evidence and a completed watcher;
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
connected external Chrome tabs are available, bind each conversation to its exact
browser/profile/tab/session/URL identity. A single root task waits on one active RootWait at a time;
use separate Codex tasks for concurrent workstreams or queue them sequentially.

The watcher performs local polling without invoking a model turn. The same root turn stays blocked
inside `run-root` until terminal evidence is available; no Hook or model watcher resumes the task.

## Boundaries

- Login, account selection, CAPTCHA, password, passkey, MFA, recovery, billing, and entitlement are
  always manual user actions.
- No arbitrary DOM, browser-internal API, cookies, tokens, or profile secrets. Only the installed
  Skill's fixed structural DOM contract may run through `agent-browser-cli-v2`.
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
