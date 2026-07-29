# Design: automated GPT Pro side-panel bridge

## 1. Architecture

The migration keeps three independently versioned layers with one-way
authority:

```text
Trellis task
  -> CCG prompt/evidence bridge
  -> installed chatgpt-pro-sidebar Skill
  -> Codex Desktop side-panel UIA
  -> detached watcher
  -> trusted Stop Hook
  -> same Codex Desktop task
  -> CCG exact-once response import
  -> Codex review and local implementation
```

- Trellis remains the canonical task and plan authority.
- CCG owns bounded prompts, routing provenance, canonical model evidence, and
  the orchestration instructions.
- The personal Skill owns Windows UI Automation, exact conversation isolation,
  idempotent submission, detached monitoring, and Desktop continuation.
- Codex owns every workspace edit and final decision.

The CCG plugin depends on the stable user installation path
`~/.codex/skills/chatgpt-pro-sidebar`. It must fail closed with an actionable
missing-Skill diagnostic. The Skill remains in its personal repository instead
of being duplicated into the CCG plugin, so UIA and Hook code has one source of
truth and a stable trusted Hook command path.

## 2. CCG bridge contract

### 2.1 Session creation

The existing Python bridge remains the prompt/evidence owner. A new automated
session records:

- `transport=codex-desktop-sidebar-skill`
- `manual_copy_required=false`
- `sidepanel_automation=true`
- `dom_extraction=false`
- `cookie_storage=false`
- `auto_submit=true`
- `auto_output_read=true`

The CCG Skill creates side-panel evidence below the current bridge round:

```text
<session>/round-N/
  prompt.md
  response.md
  sidebar/
    prompt.md
    response.md
    state.json
    evidence.json
    url.txt
    watch-state.json
    watch-event.json
    watch-callback.json
    watch-stop-hook.claim
```

### 2.2 Exact-once import

Add an import-only CLI path that loads an existing bridge session and validates
the side-panel evidence directory. It must not create another prompt or
conversation.

Validation binds:

- side-panel evidence directory is under the current round;
- `tool=chatgpt-pro-sidebar`, `transport=windows-uia`, and `live=true`;
- exact side-panel prompt bytes match the current CCG prompt SHA-256;
- response is non-empty and within the existing byte limit;
- response SHA-256 matches both `state.json` and `evidence.json`;
- conversation URL is exact, canonical, and matches the bound-at-send URL;
- submission explicitly records `automaticResendAllowed=false`;
- watcher event is terminal `completed` for the requested Codex task;
- optional expected Codex thread ID matches the watcher event;
- evidence authority keeps Codex as sole workspace writer.

The first valid import writes canonical `round-N/response.md`, marks the round
complete, stores transport metadata, and appends a CCG evidence item with
`policy=automated-sidepanel`. Re-import of identical evidence is a no-op success;
a different response for an already completed round fails.

## 3. Multi-watcher Stop Hook registry

### 3.1 Layout

New registrations use:

```text
%LOCALAPPDATA%\ChatGptProSidebar\stop-hook-v2\
  <thread-id>\
    <watcher-id>.json
```

The watcher ID is already a UUID generated for one evidence directory. The
registration file records the evidence directory, deadline, state/event/claim
filenames, and Codex thread ID. Registration publication uses the existing
atomic temp-file replace helper.

For one compatibility cycle, the Hook also reads the legacy
`stop-hook-v1/<thread-id>.json` registration. New watcher launches never write
legacy files.

### 3.2 Hook fan-in

At a Stop event, the Hook:

1. Resolves all unclaimed registrations for the current Codex thread.
2. Ignores registrations already marked continuation-requested or whose
   evidence-local claim exists.
3. Polls all pending registrations until one or more become terminal or the
   earliest bounded deadline is reached.
4. Claims every currently terminal registration by creating its
   evidence-local claim file with `O_EXCL`.
5. Writes one callback per claimed evidence directory.
6. Emits one bounded `decision=block` reason listing all newly terminal event
   paths.
7. Leaves non-terminal registrations unchanged for the next Stop event.

The Hook never deletes evidence. Registration cleanup is limited to a claimed
registration file after the callback is durably written; legacy behavior stays
read-compatible.

### 3.3 Race invariants

- Registration must exist before Codex ends the launch turn.
- Atomic registration publication prevents partial JSON reads.
- Evidence-local `O_EXCL` claims are the only continuation idempotency
  authority.
- The Hook performs a final terminal sweep immediately before returning a
  timeout continuation.
- A terminal registration discovered during the suspend gap is observed by
  the same Stop Hook invocation.
- One pending watcher cannot block reporting another terminal watcher.

## 4. Multi-conversation orchestration

The shared CCG bridge Skill may split a large request only when workstreams are
independent and have separately testable deliverables.

- One workstream maps to one bridge session and one new ChatGPT Pro
  conversation.
- Each concurrent workstream must bind a different `windowRuntimeId`.
- UIA send operations remain serialized by the existing named mutex; generation
  and watchers run concurrently after submission.
- If fewer eligible windows exist than workstreams, remaining workstreams stay
  in a deterministic queue. The system does not switch a monitored window to a
  different conversation.
- Each conversation keeps a maximum of two question rounds.

## 5. Compatibility and migration

- Update the personal Skill first and verify its deterministic tests.
- Install the reviewed Skill tree to the stable user Skill path only after
  source tests pass.
- Update CCG Skills, Python bridge, docs, templates, and tests together.
- Refresh the Harness snapshot only from a clean, committed CCG checkout.
- Update Harness adapter fields from `manualOnly=true` to the explicit
  side-panel protocol and teach conflicts/tests to validate the new boundary.
- Keep old CCG manual response preview endpoints for backward-compatible
  artifact inspection, but CCG Skills no longer select that transport.

## 6. Rollback

- Skill rollback: reinstall the previous reviewed Skill tree and restore its
  existing trusted Hook command path.
- CCG rollback: revert the CCG feature commit; the legacy manual preview remains
  in the prior release.
- Harness rollback: use the Harness transaction rollback before any live
  snapshot drift.
- No rollback path deletes task evidence or idempotency reservations.

## 7. Planning evidence

- Codex local architecture inspection:
  `research/current-architecture.md`
- Grok contract route:
  `.codex/ccg/automated-gptpro-sidebar-bridge/status.json`
- Gemini read-only plan:
  `.ccg-evidence/planning/gemini-response.response.txt`
  - SHA-256:
    `eecc460f8539273b17aa89cacc9df1c7589072d6461ee35a16b201d8c9a8b22b`
- ChatGPT Pro design review was attempted through the installed side-panel
  Skill, but two read-only status probes failed with
  `EmbeddedDocumentMissing`; no prompt was submitted. A live Pro review remains
  a pre-delivery gate after the adapter can again prove the visible document.
