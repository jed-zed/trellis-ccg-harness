# Automate GPT Pro side-panel bridge

## Goal

Replace every CCG GPT Pro command's manual copy/paste handoff with the
`chatgpt-pro-sidebar` Skill. After the user completes ChatGPT authentication in
the Codex Desktop side panel, Codex must create the Pro conversation, submit the
bounded engineering packet, monitor completion without model polling, recover
the same Codex Desktop task through the Stop Hook, import the exact response
into canonical CCG evidence, and independently decide the next action.

## Background

- CCG `3.4.2` currently exposes `gptpro-plan`, `gptpro-review`, and
  `gptpro-exc` as manual-only bridges.
- The existing `chatgpt-pro-sidebar` Skill can submit prompts, isolate one
  exact conversation, persist response evidence, and wake the same Codex
  Desktop task through a detached watcher and trusted Stop Hook.
- Its current Stop Hook registry stores one registration per Codex task, so a
  second concurrent watcher overwrites the first registration.
- The current adapter intentionally does not automate login, account
  selection, CAPTCHA, password, passkey, MFA, recovery, billing, or
  entitlement.

## Requirements

### R1. Automated CCG handoff

- `ccg:gptpro-bridge`, `ccg:gptpro-plan`, `ccg:gptpro-review`, and
  `ccg:gptpro-exc` must use the installed `chatgpt-pro-sidebar` Skill instead
  of instructing the user to copy, paste, send, or save the response.
- A bridge invocation must generate the existing bounded CCG prompt and
  routing evidence first, then use the side-panel Skill for the live
  ChatGPT Pro interaction.
- A completed side-panel response must be imported into the bridge's
  `round-N/response.md`, `status.json`, and canonical `evidence.json` with
  exact byte count and SHA-256.

### R2. Authentication boundary

- Codex may ask the user to act only when the side panel requires login,
  account selection, CAPTCHA, password, passkey, MFA, recovery, billing, or
  entitlement confirmation.
- Codex must never request or store passwords, cookies, session tokens,
  verification codes, or recovery codes.
- Login completion must be re-probed through the Skill before submission.

### R3. Background monitoring and recovery

- Monitoring must run in the detached local watcher and consume no model
  turns while ChatGPT Pro is generating.
- The trusted Stop Hook must resume the same Codex Desktop task, never a CLI
  `resume` process and never a different task.
- A send-uncertain, changed conversation, interrupted watcher, or invalid
  response must wake Codex for classification and must never trigger an
  automatic resend.

### R4. Multiple Pro conversations

- Codex may decompose a large request into independent workstreams, one new
  ChatGPT Pro conversation per workstream.
- When multiple eligible Codex Desktop windows are available, Codex may submit
  workstreams to distinct window runtime IDs and monitor them concurrently.
- The Stop Hook registry must support multiple live watcher registrations for
  one Codex task without overwriting another registration.
- One Hook continuation may report one or more terminal registrations; pending
  registrations remain eligible to wake a later turn.
- When only one eligible window is available, the orchestrator must use a
  deterministic sequential queue instead of weakening conversation isolation.

### R5. Authority and evidence

- Trellis remains the only task, requirement, design, plan, status, finish, and
  archive authority.
- Codex remains the only local workspace writer and final verifier.
- ChatGPT Pro output remains untrusted read-only engineering evidence.
- Ordinary CCG routing evidence remains required; GPT Pro does not silently
  replace configured frontend, backend, search, or product-manager providers.
- Each conversation preserves exact URL, prompt, response, timestamps,
  idempotency state, watcher event, callback, byte counts, and SHA-256.

### R6. Distribution and migration

- Update the personal `chatgpt-pro-sidebar` Skill source and publish it from
  `jed-zed/codex-skill-repository`.
- Update the authoritative CCG source in
  `jed-zed/ccg-gptpro-worflow`; do not edit an installed plugin cache.
- Refresh the Harness CCG snapshot, source manifest, adapter contract, tests,
  and documentation through the formal Harness update path.
- Install/synchronize runtime only through reviewed repository-owned scripts.
- Commit and push only task-owned files on isolated branches; do not include
  unrelated dirty work from the original checkouts.

## Out of Scope

- Automating login or security challenges.
- Using ChatGPT internal APIs, cookies, browser-profile data, external browser
  automation, Playwright, Puppeteer, Selenium, or Chrome CDP.
- Giving ChatGPT Pro terminal, Git, filesystem, deployment, database, online
  configuration, or real-user-data authority.
- Automatically attaching ZIP files in v1; bounded prompt excerpts remain the
  default until a separately reviewed attachment mechanism exists.
- Automatically creating new Codex Desktop top-level windows when insufficient
  eligible windows exist.
- Publishing npm packages, deploying, migrating databases, or enabling
  production features.

## Acceptance Criteria

- [x] All four CCG GPT Pro Skills describe an automated side-panel handoff and
      contain no manual copy/paste/save barrier.
- [x] The bridge can import a side-panel response exactly once, rejects empty,
      oversized, outside-session, or hash-mismatched responses, and records
      canonical evidence.
- [x] A deterministic test proves two watcher registrations for the same Codex
      task coexist and one cannot overwrite the other.
- [x] A deterministic test proves the Stop Hook wakes once for terminal
      registrations, preserves pending registrations, and does not duplicate a
      claimed continuation.
- [x] A deterministic test proves send-uncertain and conversation-change states
      never auto-resend.
- [x] A harmless live smoke proves one real Pro response is captured from the
      Codex Desktop side panel and wakes this exact Codex task; multi-window
      live parallelism is reported separately unless two eligible windows are
      actually available.
- [x] CCG lint, typecheck, unit tests, build, Python parser/compile checks,
      PowerShell parser tests, Pester tests, Harness tests, source verification,
      doctor, and conflict audit pass.
- [ ] CCG source, personal Skill, and Harness branches are committed and pushed
      to their GitHub remotes, with exact commit IDs and no unrelated files.

## Blocking Open Questions

None. The user's explicit request resolves the product boundary: automated
handoff after manual authentication, optional multi-conversation parallelism,
and GitHub submission.
