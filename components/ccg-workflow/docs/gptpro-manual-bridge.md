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

Resolve the required personal Skill in this order:

```text
<project-root>/.agents/skills/chatgpt-pro-sidebar/
~/.codex/skills/chatgpt-pro-sidebar/
~/.agents/skills/chatgpt-pro-sidebar/
```

When `CODEX_HOME` is configured, use `<CODEX_HOME>/skills/chatgpt-pro-sidebar/` for the second candidate.
Continue to the next candidate only when `SKILL.md` is absent. An existing but unreadable Skill,
an incomplete installation, or unavailable scripts must fail closed. Derive both scripts from the
same resolved Skill directory; never combine files from different installations.

The independent `chatgpt-pro-sidebar` Skill is bundled and deployed by Harness, not by the CCG
npm package or CCG plugin. Use your existing approved Harness Global Init
(`scripts/harness-init.mjs global-init`), or your approved Skill installer, to install
the complete Skill directory into one of the locations above. Repair an existing higher-priority
installation before relying on a lower-priority copy. Reinstalling CCG does not install this dependency.

In the approved Harness checkout, follow `scripts/README.md` for the Global Init contract. Its
non-interactive path first produces a third-party source plan, then applies the reviewed source digest:

```text
node scripts/harness-init.mjs third-party-plan --home-dir <absolute-user-home>
node scripts/harness-init.mjs global-init --non-interactive --home-dir <absolute-user-home> --catalog-mode skip --provider-actions "codex=later,gemini=later,grok=later,claude=skip" --third-party-global-skills none --third-party-global-plugins none --third-party-mcp-cli none --third-party-source-sha256 <reviewed-sha256-from-plan> --approved
```

Substitute the actual user home and reviewed digest, and preserve the user's existing approval scope.
Global Init projects the bundled platform Skills, including sidebar, to the user's global Skills
directory. The full `scripts/install.ps1` setup performs broader installation; its plugin-only mode
skips Global Init and therefore does not deploy sidebar. If Harness reports owned source drift, follow
its repair guidance before retrying.

Run `ccg doctor --gptpro` for a read-only local dependency check. Without `--platform`, this checks
only sidebar files and does not load or migrate CCG configuration. With `--platform codex` or
`--platform claude`, it also checks that platform and makes missing or broken sidebar files a failure.
Ordinary doctor reports an unavailable sidebar as an optional warning. The plugin equivalent is
`plugins/ccg/scripts/doctor.ps1 -GptPro -Json`; `-ProjectRoot`, `-CodexHome`, and `-UserHome` can select
explicit roots for local checks.

The file contract covers readable, nonempty `SKILL.md`, `scripts/chatgpt-pro-sidebar.ps1`,
`scripts/chatgpt-pro-sidebar-watch.ps1`, and the two JavaScript files directly referenced by the
adapter: `scripts/chatgpt-pro-agent-browser-v2.js` and `scripts/chatgpt-pro-agent-browser-select-pro.js`.
`installed` means these local files are complete. It does not verify the external `agent-browser-cli`
backend, browser extension, approved tab, Pro login, or a live response. Doctor does not launch or
install those components.

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

## Scorecard Output Contracts

Each GPT Pro mode requires scoring in the same automated sidebar response, within its existing output sections:

| Mode | Required score output |
| --- | --- |
| `plan` | `Requirement Completeness` with `需求完整性评分（0-10）` using the 3/3/2/2 dimensions and `Planning Readiness Scorecard` with five 20-point dimensions, inside `Go-NoGo`. |
| `review` | `VALIDATION REPORT` with `TOTAL SCORE: XX/100` inside `Required Tests`; frontend/UI-heavy reviews also require `FRONTEND VALIDATION REPORT`. |
| `exc` | Mandatory `Implementation Readiness Scorecard` inside `Verification` for plan fit, implementation completeness, verification readiness, risk handling, and adoption recommendation, each out of 20 with a total out of 100, even for weak evidence. |

Scores cite visible task context, actual routed evidence, diffs, and verification summaries. Missing evidence lowers scores. GPT Pro cross-scores ordinary Codex findings and available routed provider findings; Gemini is included only when it actually ran. Codex uses the more conservative score and blocker judgment when evidence disagrees.

Requirement completeness below 7 asks for missing details before plan creation or revision; 7 or above continues planning only. GPT Pro scores remain read-only advisory second-opinion evidence and do not authorize execution or Provider calls, override Codex verification, or bypass existing approval gates.

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
