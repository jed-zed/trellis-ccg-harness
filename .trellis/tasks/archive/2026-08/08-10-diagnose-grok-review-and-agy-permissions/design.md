# Design — Grok failure evidence and AGY review permission decision

## Boundaries

The authoritative implementation source is a clean checkout of the personal CCG
fork. The Harness task owns requirements and delivery tracking; the tracked
`components/ccg-workflow` tree is updated only through a separately approved
`harness:update` after the CCG change is published.

The current Harness worktree's unrelated changes are not inputs or targets.
Runtime evidence stays under ignored paths or an explicitly reported temporary
file and is never committed.

## Grok diagnostic data flow

```text
Grok child stderr
  -> existing unfiltered, unlimited wrapper Logger
  -> existing exit/result classification
  -> opt-in failure-retention decision
  -> exact retained-log path printed to caller
  -> inspect/copy before any retry
  -> root-cause classification
```

Reuse the current logger instead of adding a second logging subsystem. The
minimum product change is one explicit diagnostic input that prevents deletion
of the current wrapper log only when the invocation fails. It must not make
retention the default and must not alter process output or result validation.

The retained wrapper log is the evidence source because it already receives the
backend stderr before the 4 KiB error-tail reduction and before console noise
filtering. The implementation must distinguish the retained-path message from
the existing `(deleted)` message.

## Reproduction protocol

1. Build and verify the diagnostic-capable wrapper offline with a fake Grok
   process.
2. Obtain a fresh explicit authorization for one live Grok call.
3. Invoke the ordinary local-review route with concrete targets and the
   diagnostic input enabled.
4. Do not retry automatically.
5. Copy/read the retained log immediately, record hashes and non-secret failure
   evidence under the task's ignored evidence directory, then classify the
   failure.
6. Only after evidence capture decide whether another live attempt is useful.

If the live attempt succeeds, retain the successful report normally and record
that the historical failure was not reproduced; do not manufacture a cause.

## Failure classification contract

The diagnostic report maps evidence to the first owning boundary:

| Evidence | Classification |
|---|---|
| Child process returns non-zero before usable output | Provider process failure |
| Stream parser returns an error | Stream/parser failure |
| Process completes but no model message is present | Missing usable message |
| Model message exists but terminal stop is missing/error | Terminal-state failure |
| Model message and terminal stop exist but finalization fails | Review finalization failure |

`CCG_GROK_REVIEW_JSON` remains wrapper-generated only after a valid terminal
response. Its absence never becomes the primary root cause by itself.

## AGY review permission scope

The AGY review helper currently chooses native conditional permissions and does
not opt into bypass. The user selected default bypass only for unattended
disposable-snapshot review. The evidence comparison covers:

- the selected upstream revision's automated-review invocation;
- the personal fork's parser, `TaskSpec`, `Config`, and final `agy` args;
- the failed session's actual command and requested command capability; and
- the snapshot's real boundary (copied-input/CWD isolation, not OS sandboxing).

The helper passes the wrapper's existing `--skip-permissions` flag only when
`--backend antigravity` is selected for this snapshot-review entrypoint. The
wrapper continues to propagate that existing flag to the final child args as
`--dangerously-skip-permissions`. Ordinary frontend/backend/resume AGY calls and
the standalone `agy` CLI remain unchanged.

No new permission abstraction or Provider fallback is added, and no default
outside the selected CCG Antigravity scope is changed.

## Compatibility and security

- Default wrapper log cleanup stays byte-for-byte compatible without the
  diagnostic input.
- Diagnostic retention preserves raw Provider output and may contain reviewed
  source. The caller must keep it in ignored storage, inspect it locally, and
  remove it after diagnosis.
- Credentials and inherited environment values must not be added to the log.
- Grok native permissions, target snapshot preparation, stop validation, and
  envelope generation remain unchanged.
- AGY bypass is limited to unattended disposable-snapshot review and does not
  imply an OS sandbox or workspace authority.

## Final source convergence

The final update starts from latest personal `gptpro/main` and merges the exact
GPT Pro URL-first commit recorded by latest Harness main. Only the two genuine
overlap files are resolved manually; all other accepted bytes come from their
own side. Open PRs, stale remote branches, dirty worktrees, and Harness-only
sidebar assets are not opportunistically copied into CCG.

The converged CCG commit becomes the single source for package/plugin version,
the Harness component tree, `harness.sources.json`, and local installation.
Wrapper `5.12.11` remains unchanged because the additional accepted history has
no `codeagent-wrapper/` changes.

## Grok response ownership

Search events enter verified evidence only when their start and update correlate.
An update without a recognized start remains in `unknownEvents`; it does not
abort normalization. If the terminal model response is otherwise complete, the
runner returns it as `received_unverified` so Codex, the final verifier, decides
whether it is useful.

## Grok update ownership

Diagnostics, external-intelligence ACP, and bound local review launch the
installed Grok CLI without CCG's former `--no-auto-update` argument. The exact
environment still uses its narrow allowlist, but it no longer manufactures
`GROK_DISABLE_AUTOUPDATER=1`; an explicit user value may pass through. No new
version manager, fallback, or compatibility layer is added.

## Grok model selection ownership

Normal-depth model selection is optional at the CCG boundary. An absent or empty
`default_model` flows through command and runner state as no requested model;
the ACP launcher omits `--model`, and the single model reported by ACP session
updates becomes the canonical actual model for evidence and manifests. A
non-empty configured model remains an explicit request and must exactly match
the ACP-reported model.

Automatic-route fingerprints distinguish the CLI-default selection mode without
inventing a versioned model, while completed route validation binds the actual
model recorded in the result and manifest. Enabled deep research continues to
require `deep_research_model` and therefore keeps exact matching.

## Cache-lock recovery

Cache writers continue to serialize on one lock path per fingerprint. Each
contender atomically creates the lock directory and writes a unique owner token
to `owner.json`. On a collision it checks the recorded PID: a live or
unverifiable owner remains busy. A dead owner is reclaimed only after the
reclaimer creates an exclusive child claim while the canonical directory still
occupies the lock path, then rereads the owner token. Only an unchanged dead
owner is removed and acquisition is retried once. A replaced live owner remains
untouched, and a third contender cannot enter through a temporarily empty path.
Legacy owner metadata without a token is assigned a stable identity and remains
reclaimable. This uses filesystem-native exclusive directory creation without a
lock service or timeout knob.

## Advisory companion search

Frontend/backend execution owns its local result independently of external
search. Search is requested only when Codex judges current external evidence
useful or an explicit requirement calls for it. Automatic companion evidence
uses preferred/advisory semantics: success is attached to the result, while
unavailability or failure is reported without changing an otherwise valid
local result into a blocked result. Explicit evidence requirements remain
visible and are not silently waived.

## Provider model defaults

Installer templates, interactive defaults, and helper launchers represent an
unconfigured Gemini or Grok model as an empty value. Empty means omit the model
flag and delegate selection to the Provider CLI; it never means substitute a
new versioned constant. Provider-emitted model metadata is retained in runtime
state where the transport exposes it, and a non-empty configured value remains
the requested pin.

Product-manager Claude is the deliberate exception and keeps the explicit
`opus` pin required by its contract. This source change does not edit or
migrate any user-owned local CCG configuration.

## Rollback

Before publication, revert the small diagnostic-input/cleanup hunk and its tests.
After publication, restore the previous pinned wrapper version and six digests,
then use the supported Harness rollback/update path. Raw diagnostic evidence is
non-canonical and can be deleted after the root cause is recorded.
