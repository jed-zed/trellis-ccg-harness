# Acceptance report

## Result

The automated GPT Pro side-panel bridge is functionally accepted. All normal
CCG GPT Pro entry points now route through `chatgpt-pro-sidebar`; Codex remains
the sole workspace writer and final verifier. Authentication and account
challenges remain user-operated.

One real ChatGPT Pro review was submitted exactly once, completed in the Codex
Desktop side panel, woke this same Codex task through the Stop Hook, and was
imported into canonical CCG evidence. No CLI `resume` process and no automatic
resend were used.

A later live follow-up opened two real Codex Desktop windows, submitted two
different GPT Pro workstreams to two different conversations, and observed
both generations overlapping. Both responses were persisted and the repaired
Stop Hook fanned both terminal registrations into one new round in this same
Codex Desktop task. No CLI `resume` process and no automatic resend were used.

## Git and source provenance

| Repository | Branch | Commit / tree |
| --- | --- | --- |
| `jed-zed/codex-skill-repository` | `codex/publish-chatgpt-pro-sidebar` | `4537cf0a149f238d17cc82d1b424a3359dc06315` / `5baada96f039aa48cf5299a2db4f4d248722fbaa` |
| `jed-zed/ccg-gptpro-worflow` | `codex/automate-gptpro-sidebar-bridge` | `d168feaf6eba953feaaf16c6d9867b00ffd3faad` / `e0e280b942282092cbc4ed3d73ac0f697353f2f4` |
| `jed-zed/trellis-ccg-harness` | `codex/integrate-gptpro-sidebar-automation` | `156d26f1fd33e82f62c39e74a1a80cc621215a60` / `3bcf5482eeef4e38827f4de49caff902f0ca7b26` before this report-only follow-up |

The personal Skill and CCG branches were pushed before final Harness closeout.
The Harness branch was first pushed through acceptance commit `91ba27c`; the
subsequent delivery-state, Trellis archive, and journal commits are pushed in
the final closeout. No pull request, deployment, database migration, npm
publication, production configuration change, or real-user-data operation was
performed.

## Live ChatGPT Pro evidence

- Conversation:
  `https://chatgpt.com/c/6a6a4871-74f4-83ea-8c7b-30f0f418abbb`
- Bridge session:
  `20260729-123414-review-automated-sidebar-review`
- Watcher:
  `88931a80-69ea-4738-bc63-b0c3db36375d`
- Prompt SHA-256:
  `f8468fb097c60496b378ff9fdb840710e83c26d5f1c3d40a4cab7534c98a678c`
- Response SHA-256:
  `e1298908fb22793dc8b4a44657cd9125ca4000286d8b3bff28a5aecc9fb9de1a`
- Watch observations: `79`
- Import result: `CCG_GPTPRO_SIDEBAR_IMPORTED=1`
- Import acknowledgement:
  `round-1/sidebar/watch-continuation-ack.json`

During the original acceptance run only one eligible Codex Desktop side-panel
window was available, so multi-window parallel generation was not claimed at
that time. Multi-registration, terminal/pending fan-in, legacy-v1
compatibility, claim replay, and acknowledgement behavior were covered by
deterministic Pester tests before the later live follow-up below.

### Two-window live parallel follow-up

Two new Codex Desktop windows were opened from the same task and bound to
different side-panel runtime IDs. Workstream A was submitted while workstream B
was still reporting `generating=true`, proving that the two real ChatGPT
generations overlapped rather than running as a sequential queue.

| Workstream | Window runtime ID | Conversation | Prompt SHA-256 | Response SHA-256 | Characters |
| --- | --- | --- | --- | --- | ---: |
| A | `42.5311372` | `https://chatgpt.com/c/6a6accc2-ba4c-83ea-b2c5-fc1b22a07495` | `ca0b4965cab6d779b9ebc700ce0921bef3fda87bad74706b42b5fb6cde51f89a` | `c90d9ce6386185d5b2a12ea9b52bf9d71cfdaf219e667064b3af38d7b78c23fc` | 10137 |
| B | `42.3082742` | `https://chatgpt.com/c/6a6acc5b-5724-83ea-99bc-77548d11d1c6` | `9d0667c8511b9eee3742892105afff50affd3627c5ba41ea456e378986d8e397` | `b98d7cee89bb9ef11a96f2e36c9517b018d7372d6f89941df5a29d5565acffb0` | 9620 |

Workstream B finalized normally. Workstream A first recorded
`probe-failed` after one successful stopped observation because three
`ConcurrentUiOperation` mutex-contention results were incorrectly counted as
probe failures. Codex performed the allowed read-only recovery on the exact
bound conversation and finalized A without resubmitting anything. Both
response file hashes match their recorded `state.json` hashes.

The first real fan-in attempt at `2026-07-30T04:06:53Z` also exposed a separate
Stop Hook defect: one stale registration pointed at an evidence directory that
had already been removed, causing `FileNotFoundError` before A and B could be
claimed. The repaired handler skipped the unavailable registration, claimed A
and B together, and the official Codex Desktop Stop lifecycle then created the
next task round with both watcher IDs. Both continuations were acknowledged in
`watch-continuation-ack.json`; no Desktop composer automation or CLI resume was
used.

## GPT Pro findings and corrections

The external review classified the initial implementation as acceptable only
after corrections. Codex independently reproduced and fixed two valid issues:

1. A Stop Hook continuation claim could become a lost wake if Codex did not
   import the response before the Hook claim was considered consumed. The Hook
   now replays the bounded continuation until CCG writes
   `watch-continuation-ack.json`.
2. Windows CRLF prompt bytes could fail exact prompt-hash validation against
   LF-normalized CCG evidence. The importer now validates the canonical prompt
   bytes consistently, with regression coverage.

The remaining review concerns were checked against source and tests and were
either already enforced or not reproducible: send intent and named-mutex
serialization, automatic-resend prohibition, exact URL/window binding,
response-size limits, latest assistant-turn capture, and preservation of
pending watcher registrations.

During final runtime verification, Codex also found that the formal
`-PluginOnly` setup preview recognized an owned older CCG plugin but the
execution branch failed to pass that ownership into the upgrade transaction.
The resulting fail-closed error left the old plugin intact. Commit `bcb3acf`
passes the ownership state into the existing transactional installer and adds
a regression that upgrades an exact previous plugin. The real upgrade then
completed and Codex Desktop's plugin inventory reported `3.4.3+codex.1`.

The later two-window live run and its cleanup found three additional
implementation defects, delivered in personal Skill commits `e9d07c9` and
`4537cf0`:

3. The detached watcher now treats exit `32` with
   `ConcurrentUiOperation` as bounded mutex contention. It preserves the prior
   stopped observation and retries instead of converting three normal
   serialization collisions into `probe-failed`.
4. The Stop Hook now logs and skips a registration whose evidence directory is
   unavailable, then continues claiming other valid registrations. A stale
   historical registration can no longer abort the whole fan-in batch.
5. The watcher acknowledgement path now recognizes a matching historical v1
   claim that predates `watcherId`, but only when its v1 registration path,
   Codex task UUID, and terminal status all match. The old live test
   registration was acknowledged through this path, and a subsequent Hook
   check returned no continuation output.

## Validation

| Gate | Result |
| --- | --- |
| Personal Skill Pester suite | `114 passed, 0 failed` |
| CCG focused GPT Pro bridge tests | `39 passed, 0 failed` |
| CCG lint | passed |
| CCG typecheck | passed |
| CCG unit suite | `552 passed, 1 skipped, 0 failed` |
| CCG production build | passed |
| CCG package | `ccg-workflow-3.4.3.tgz`, 658685 bytes, SHA-256 `f020bd2f2abfcedf9ea5380ad499504785dbd7620215a8f53da881c0558e51af` |
| Harness focused adapter suite | `24 passed, 0 failed` |
| Harness install-script suite | `21 passed, 0 failed` |
| Harness full suite | `407 passed, 3 skipped, 0 failed` |
| Harness doctor | passed |
| Harness conflict audit | `0 blocking, 0 warning, 2 info, 18 passed` |
| Harness source verification | passed; CCG commit `59ef05f`, tree `bb4a9a9` |
| Go module tests | passed from `components/ccg-workflow/codeagent-wrapper` |
| Go module build | passed from `components/ccg-workflow/codeagent-wrapper` |
| `git diff --check` | passed |
| Skill remote CI, initial workflow | passed, run [`30512985204`](https://github.com/jed-zed/codex-skill-repository/actions/runs/30512985204) |
| Skill remote CI, parallel-watcher fix | passed, run [`30514946535`](https://github.com/jed-zed/codex-skill-repository/actions/runs/30514946535) |
| Skill remote CI, legacy-claim acknowledgement | passed, run [`30515322358`](https://github.com/jed-zed/codex-skill-repository/actions/runs/30515322358) |
| CCG remote CI | passed on Windows, Linux, and Go jobs, run [`30513024223`](https://github.com/jed-zed/ccg-gptpro-worflow/actions/runs/30513024223) |
| Harness remote CI | passed on Windows, Linux, macOS bootstrap, and Go jobs, run [`30513024050`](https://github.com/jed-zed/trellis-ccg-harness/actions/runs/30513024050) |

One resource-saturated parallel CCG test run reported a Vitest worker RPC
timeout after all 552 tests passed. It was not accepted as green. A later
standalone `pnpm ccg:test` run exited `0` with the result shown above.

The literal `go test -short ./...` command does not run from the Harness root
because the Go module is under
`components/ccg-workflow/codeagent-wrapper`. The applicable Trellis tooling
spec requires those commands from that module, and both module-scoped commands
passed.

## Source archive

- Path:
  `I:\ai\.codex-task-cache\019fa981-725e-7f02-93a7-bb1e1b7aefd3\source-package-20260729-1435\gptpro-sidebar-automation-source.zip`
- Size: `714832` bytes
- SHA-256:
  `40bea083306b19316b5308b12d2b2d2c6784d9515c0689ac10907287f92872ff`
- Files: `132` files, `155` ZIP entries
- Uncompressed staged bytes: `2511121`
- Forbidden archive paths: `0`
- Credential-pattern matches: `0`

The scan was packaging hygiene only. Per the user's direction, no broad
security review was performed or claimed.

## Remaining limits

- The live parallel run proves two side-panel conversations in this one
  Windows Desktop session. It does not prove an arbitrary number of windows,
  other display configurations, or future Codex/ChatGPT UI revisions.
- Remote CI proves deterministic code, packaging, and cross-platform
  contracts; it cannot prove a logged-in live side panel or Desktop Stop Hook.
  Those were verified separately in the current Windows Desktop session.
- All changes remain on pushed feature branches. No pull request, merge,
  deployment, release, package publication, or production change was made.
