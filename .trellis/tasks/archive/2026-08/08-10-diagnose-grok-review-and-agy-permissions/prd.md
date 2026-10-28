# Diagnose Grok review failures and decide AGY review permissions

## Goal

Make the next authorized Grok local-review attempt diagnostically
useful by preserving its complete, untruncated backend stderr evidence, then use
that evidence to identify the real exit-1 cause. Implement the user's decision
that unattended disposable-snapshot Antigravity (AGY) review should enable its
upstream conditional `--skip-permissions` behavior by default.

## Background and confirmed facts

- The failed AGY review session
  `f4b130a8-4e90-4649-9172-345bd8d3f0fc` launched without
  `--dangerously-skip-permissions` and stopped at a headless command-permission
  gate before producing a report.
- In the accepted personal CCG 3.4.10 source,
  `plugins/ccg/skills/ccg-executor/scripts/invoke_provider_review.py` adds
  `--antigravity-review` but not `--skip-permissions`; `buildAntigravityArgs`
  adds `--dangerously-skip-permissions` only when `Config.SkipPermissions` is
  true.
- Grok local review already uses its upstream `--always-approve` behavior. The
  observed run exited with code 1 before a usable `agent_message` and terminal
  stop reached `finalizeGrokReview`. The missing `CCG_GROK_REVIEW_JSON` envelope
  is therefore a consequence, not the root cause.
- The wrapper's existing logger receives untruncated backend stdout/stderr, but
  `main.go` deletes that log on every exit after printing at most recent error
  summaries. Startup cleanup also removes dead-process logs, so automatic retry
  can erase the preceding attempt before it is inspected.
- The exact Grok stderr from the reported failure is no longer available. A new
  explicitly authorized invocation is required to establish the root cause.
- The current Harness worktree contains unrelated uncommitted user changes.
  They are protected and are not part of this task.
- On 2026-08-10, the user approved the offline implementation and authorized
  exactly one Grok live diagnostic invocation immediately after the offline
  implementation and checks complete. This authorization does not include an
  automatic retry, publication, Harness synchronization, or installation.
- In the same message, the user decided that AGY should enable
  `--skip-permissions` by default. On the next turn, `执行` confirmed the
  recommended scope: unattended disposable-snapshot review only. Ordinary
  frontend/backend/resume AGY calls retain their current conditional behavior.

## Requirements

### R1 — Opt-in failure evidence

Provide a narrowly scoped, opt-in diagnostic path for Grok local review that
preserves the existing wrapper log on failure instead of deleting it. The
default behavior for successful runs, ordinary Provider calls, and calls that
do not opt in must remain unchanged.

The retained artifact must:

- contain the complete untruncated backend stderr already written to the wrapper
  logger, together with enough wrapper context to identify the invocation;
- survive wrapper exit and any same-attempt result validation failure;
- expose its exact path to the caller before another wrapper invocation can
  remove it;
- remain ignored runtime evidence and never enter Git; and
- not print or persist credentials that were not already part of the existing
  wrapper log contract.

### R2 — Preserve failure semantics

Diagnostic retention must not change the child exit code, retry policy, Grok
permissions, target snapshot, terminal validation, result envelope, Provider
selection, or no-fallback behavior. No code may fabricate
`CCG_GROK_REVIEW_JSON` when the review did not complete.

### R3 — Controlled reproduction

The first live reproduction is one Grok local-review attempt using the same
CCG route and concrete target binding that failed previously. The user's
2026-08-10 approval authorizes exactly this one invocation after the offline
implementation and checks complete. Do not automatically retry before the
retained log has been copied or inspected.

### R4 — Root-cause classification

Use the retained evidence to distinguish at least:

- Provider process non-zero exit;
- stream/parser failure;
- missing usable `agent_message`;
- missing/error terminal stop; and
- post-response Grok envelope finalization failure.

Report the exact class and supporting evidence. If the new run succeeds or the
evidence is still insufficient, state that explicitly instead of inferring a
cause.

### R5 — AGY default permission policy

Compare the selected original/upstream CCG revision, the personal fork's final
child arguments, the snapshot-review helper, and the actual failed session, then
make the unattended disposable-snapshot review helper pass
`--skip-permissions`. Do not change ordinary frontend/backend/resume AGY calls
or the raw standalone `agy` CLI outside CCG.

The recommendation must account for these facts:

- Antigravity's bypass is upstream-conditional, not a universal default;
- the disposable snapshot limits copied input and default CWD but is not an OS
  sandbox;
- `--dangerously-skip-permissions` can authorize command behavior, absolute-path
  access, and network behavior beyond the copied snapshot; and
- the user has explicitly chosen default bypass, but the implementation must not
  silently expand it beyond the scope confirmed in the final plan.

Existing explicit false forms (`--skip-permissions=false` and
`--dangerously-skip-permissions=false`) remain unchanged on ordinary wrapper
paths. Other Providers and the raw `agy` CLI remain unchanged.

### R6 — Source and delivery boundaries

- Implement first in a clean authoritative checkout of the personal
  `jed-zed/ccg-gptpro-worflow` fork; do not edit the tracked Harness component as
  if it were the runtime source.
- Any Go wrapper change triggers the repository's version and six-platform
  digest contract, but versioning, commit, push, PR, release, `harness:update`,
  and local installation remain separate approval gates.
- A later Harness sync must use the supported provenance/update workflow and
  preserve all unrelated dirty work.

### R7 — Final personal-source convergence

Before the authorized Harness update, converge the latest published personal
CCG main with the GPT Pro URL-first source commit already accepted by the latest
Harness main. The final source must contain both `8514d29` and `28a428`; neither
side may replace the other. Audit other remote branches, open PRs, and local
dirty worktrees first, but include only changes already accepted into the
published CCG or latest Harness source provenance.

Publish the converged CCG as `3.4.12` and Codex plugin `3.4.12+codex.1`.
Because the accepted GPT Pro branch changes no Go build input, keep wrapper
version and six pinned digests at `5.12.11`. Then run formal `harness:update`
from the clean converged personal checkout and perform the separately authorized
local installation without Provider login or live Provider calls.

### R8 — Preserve complete Grok responses

An uncorrelated search `tool_call_update` is an evidence-quality problem, not
an invocation failure. If a usable terminal model response still arrives, keep
the update as unknown diagnostic evidence, exclude its sources from verified
evidence, and return the response as `received_unverified` for Codex to assess.

### R9 — Preserve Grok native update behavior

CCG must not inject `--no-auto-update` or force
`GROK_DISABLE_AUTOUPDATER=1` for diagnostics, external-intelligence ACP, or
bound local review. A user-supplied `GROK_DISABLE_AUTOUPDATER` value remains an
allowed explicit override. This changes update ownership only; Provider
permissions, result validation, target binding, and evidence classification stay
unchanged.

### R10 — Follow the Grok CLI default model unless explicitly pinned

Normal-depth Grok intelligence must not ship a fixed model identifier. When
`default_model` is absent or empty, CCG must omit `--model`, let the Grok CLI
select its current default, and record the actual ACP session model in evidence,
manifests, cache results, and route state. Only a non-empty user-configured model
may be passed through `--model` and enforced with exact requested-versus-actual
validation.

Deep research keeps its existing explicit-model requirement while enabled. Do
not replace the former `grok-4.5` pin with another versioned model, silently
migrate an existing user pin, or weaken the requirement that ACP expose exactly
one actual session model.

### R11 — Recover abandoned Grok cache locks

The Grok intelligence cache lock must remain exclusive while its owner process
is alive, but a lock published by a process that has exited must be reclaimed
automatically. Recovery must be race-safe: create one lock directory atomically,
bind its owner metadata to a unique token, claim inside that unchanged directory,
revalidate the token, and only then delete a confirmed abandoned lock before one
retry. A live, replaced, or unverifiable owner remains fail-closed and busy.

### R12 — Make companion search advisory

Frontend and backend routing must not automatically require external search for
ordinary local work. Codex may request search when current external facts would
materially help, but missing, unavailable, or failed companion evidence is
reported as advisory evidence and does not block the local Provider result.
Explicit user or accepted-task requirements for external evidence remain their
own requirements; no Provider fallback or hidden retry is added.

### R13 — Follow Provider-native model defaults

New CCG routing and helper configuration must not inject versioned Gemini or
Grok model names when the user has not configured one. Omit the Provider model
argument in that case and record the actual model reported by the Provider
transport when it is available. An explicitly configured model remains pinned
and is validated against the reported model where the transport exposes it.

Product-manager Claude intentionally remains explicitly pinned to `opus`.
Existing user-owned model configuration, including
`G:\\CodexData\\.codex\\ccg\\config.toml`, must not be rewritten, cleared, or
migrated by this work.

## Acceptance Criteria

- [x] An offline failing-backend test emits stderr longer than 4 KiB with unique
      beginning/middle/end markers and proves the opt-in retained artifact
      contains all markers without changing the non-zero exit code.
- [x] Tests prove default failure cleanup and successful-run cleanup remain
      unchanged when diagnostics are not requested.
- [x] A Grok local-review validation failure retains the log and reports its
      exact path without generating a false review envelope.
- [x] After separate authorization, one live Grok attempt is run without an
      automatic retry; its retained evidence is inspected before any subsequent
      wrapper call.
- [x] The Grok outcome is classified from retained evidence, or explicitly
      recorded as still unresolved if the attempt succeeds or remains
      inconclusive.
- [x] Tests prove unattended disposable-snapshot AGY review receives
      `--dangerously-skip-permissions` by default, while ordinary
      frontend/backend/resume calls and other Providers remain unchanged.
- [x] Raw logs, credentials, runtime state, and unrelated user changes are not
      committed.
- [x] The final CCG source contains both accepted histories, passes publication
      gates, and is the exact provenance used by Harness and the local install.
- [x] A complete terminal response survives an uncorrelated search update as
      `received_unverified`; the uncorrelated update contributes no verified
      source evidence.
- [x] Active Grok automation paths use the CLI's native update behavior unless
      the user explicitly supplies `GROK_DISABLE_AUTOUPDATER`.
- [x] A missing or empty normal `default_model` produces no `--model` argument,
      accepts and records the single actual ACP model, and still rejects a model
      mismatch when the user explicitly configures a non-empty model.
- [x] A dead Grok cache-lock owner is reclaimed and acquisition succeeds, while
      a live replacement is preserved and a third contender remains excluded.
- [x] Ordinary frontend/backend work can complete without companion search; an
      attempted advisory search failure is visible but non-blocking.
- [x] Unconfigured Gemini/Grok helper routes omit model flags and retain
      Provider-reported model identity when available; explicitly configured
      models remain pinned.
- [x] Product-manager Claude still passes `--model opus`, and the existing local
      CCG model configuration is byte-for-byte unchanged.

## Out of Scope

- Automatic Provider fallback, higher retry limits, or silent retries.
- Relaxing Grok target, terminal, result, or envelope validation.
- Changing Grok's native permission behavior or enabling external intelligence
  for local review.
- Raw standalone `agy` CLI configuration outside CCG.
- AGY invocation surfaces outside unattended disposable-snapshot review.
- Provider invocation, publication, Harness synchronization, or installation as
  part of the planning approval.

## Resolved User Decisions

- AGY default bypass applies only to unattended disposable-snapshot review.
- Ordinary frontend/backend/resume AGY calls preserve conditional permission
  behavior.
- One Grok live diagnostic invocation is authorized after offline implementation
  and checks; no automatic retry is authorized.
- Codex decides whether to use a complete Grok response; search-event correlation
  may lower it to `received_unverified` but may not relabel it as invocation failure.
- Grok CLI updates remain provider-native; CCG does not force the updater off.
- Normal Grok intelligence follows the CLI default model unless the user
  explicitly pins one; enabled deep research remains explicitly model-bound.
- Abandoned Grok cache locks are recovered automatically without stealing a
  lock from a live or unverifiable owner.
- Frontend/backend companion search is advisory and cannot block ordinary local
  work.
- Provider-native defaults replace shipped Gemini/Grok version pins; Claude
  product-manager remains explicitly `opus`, and local user model settings are
  preserved.
