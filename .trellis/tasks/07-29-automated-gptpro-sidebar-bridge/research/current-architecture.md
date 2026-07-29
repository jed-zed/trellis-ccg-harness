# Current architecture evidence

## Authoritative repositories

- CCG source: `I:\ai\ccg-workflow-gptpro-sidebar-automation`
  - branch: `codex/automate-gptpro-sidebar-bridge`
  - base: `gptpro/main`
  - base commit: `fe3935722abda6c734ecbb784da0011789d11a63`
  - package: `ccg-workflow@3.4.2`
- Harness: `I:\ai\trellis-ccg-harness-gptpro-sidebar-automation`
  - branch: `codex/integrate-gptpro-sidebar-automation`
  - base: `origin/main`
  - base commit: `677ea35e9533bff676a8f1c133b72dc0ad2866d8`
- Personal Skill repository:
  `I:\ai\codex-skill-repository-gptpro-sidebar`
  - branch: `codex/publish-chatgpt-pro-sidebar`
  - base: `origin/main`
  - base commit: `0ba0035c0d86f521f33ddd7341f846abc568bf76`

The original checkouts are dirty and are preserved untouched.

## Existing CCG bridge

- Shared Skill:
  `plugins/ccg/skills/ccg-gptpro-bridge/SKILL.md`
- Mode Skills:
  `plugins/ccg/skills/ccg-gptpro-plan/SKILL.md`,
  `plugins/ccg/skills/ccg-gptpro-review/SKILL.md`, and
  `plugins/ccg/skills/ccg-gptpro-exc/SKILL.md`
- Artifact runtime:
  `templates/engine/tools/gptpro/gptpro_bridge.py`
- Plugin copy:
  `plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py`
- Regression suite:
  `src/utils/__tests__/gptproBridge.test.ts`

The Python bridge already owns bounded prompt construction, Trellis task
adaptation, routing/Gemini/Grok provenance, response byte limits, hashes, and
canonical evidence append. Its missing contract is a non-HTTP, exact-once
response import suitable for the side-panel Skill.

## Existing side-panel Skill

Source is currently an uncommitted task result in
`I:\ai\codex-skill-repository\chatgpt-pro-sidebar`; the installed copy is under
`C:\Users\29933\.codex\skills\chatgpt-pro-sidebar`.

Important files:

- `scripts/chatgpt-pro-sidebar.ps1`: UIA status/new-chat/send/wait/response/run.
- `scripts/chatgpt-pro-sidebar-watch.ps1`: detached zero-model watcher.
- `scripts/chatgpt-pro-sidebar-stop-hook.py`: trusted Codex Desktop Stop Hook.
- `tests/`: deterministic UIA, watcher, and Hook regression suites.

The adapter binds a submission to one exact conversation URL, one
`windowRuntimeId`, one prompt hash, and one durable idempotency reservation.
It never uses clipboard, synthesized keystrokes, browser-internal APIs, or
automatic resend.

## Confirmed concurrency defect

`Get-WatchStopHookRegistrationPath` currently returns:

```text
%LOCALAPPDATA%\ChatGptProSidebar\stop-hook-v1\<thread-id>.json
```

`Register-WatchStopHook` atomically rewrites that file. Therefore two watcher
starts for the same Codex task cannot coexist: the second registration replaces
the first. The Stop Hook also reads only that one file.

The safe migration is a versioned per-thread registration directory containing
one file per watcher/evidence identity, with legacy single-file read support.
Claims remain evidence-local and exact-once.

## Live probe

Two read-only calls to the installed Skill returned:

```json
{"code":21,"category":"EmbeddedDocumentMissing","details":{"visibleDocumentCount":0,"geometricCandidateCount":0}}
```

No prompt was submitted. This is retained as a live environment issue and does
not count as a successful ChatGPT Pro interaction.
