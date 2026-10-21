# Codex Provider Runtime Contract

## 1. Scope / Trigger

This contract applies when changing the installed Codex-native CCG commands,
provider routing, the Go wrapper, doctor checks, or clean-install acceptance.

## 2. Signatures

```text
ccg routing get <role> --json
ccg routing set <role> <provider>
ccg doctor
ccg update
ccg uninstall
ccg wrapper --backend antigravity --antigravity-review [--skip-permissions] <task> [workdir]
ccg wrapper --backend grok --grok-review-target <file> [...] <task> [workdir]
CODEAGENT_RETAIN_LOG_ON_FAILURE=1 ccg wrapper --backend grok --grok-review-target <file> [...] <task> [workdir]
ccg route --phase final-verify [--official-domain <domain> ...] [...]
invoke_provider_review.py --backend <claude|antigravity> --workdir <root> --target <file> [...]
[intelligence].default_model = "" | "<explicit-model>"
withCacheLock({ cacheRoot, key, clock }, action)
```

`CODEX_HOME` selects the Codex home used by routing, wrapper, doctor, update,
and uninstall. When unset, commands use the platform-default Codex home.

## 3. Contracts

- All Codex-native commands resolve one shared Codex home; no command may
  silently read or write a different home.
- Doctor verifies the installed wrapper's pinned SHA-256 and reported version.
  Missing, unreadable, mismatched, or stale wrappers fail closed.
- Release digests come only from an authoritative real Git checkout that
  reproduces GitHub Actions checkout semantics, with setup-go 1.21.13 and the
  release build flags. Archive materializations and arbitrary working trees are
  not pin sources because they have not reproduced the CI byte stream reliably,
  independent of source line endings.
- A merge or rebase that changes any tracked Go build input after digests were
  produced creates a new wrapper byte identity. It requires a fresh wrapper
  version and six authoritative rebuilds; neither side's existing version and
  digest pins may be published for the combined tree.
- Invalid persisted routing leaves configuration bytes unchanged and reports
  the exact repair command: `ccg routing set <role> <default-provider>`.
- `routing set` validates and replaces only the selected role. Other invalid
  role entries remain unchanged so operators can repair multiple bad routes
  through repeated commands instead of one all-or-nothing normalization.
- Claude is a valid explicit selection for `frontend`, `backend`, and
  `product-manager`, including managed top-level and per-task routing. Defaults
  stay unchanged; Claude is not an automatic fallback or search Provider.
- Every upstream Provider inherits the exact selected official revision's
  permission behavior across ordinary and fork-only paths: Codex approval/
  sandbox bypass, Claude permission bypass and setting-source behavior, Grok
  `--always-approve`, Gemini `-y`, and Antigravity's conditional permission
  bypass. Pi uses native `--mode json --approve` without fork `--no-*` or tool
  restrictions. GPT Pro is the unchanged read-only exception.
- The single-task wrapper must preserve the parsed Antigravity
  `SkipPermissions` value through `TaskSpec` and the execution `Config`; the
  final child-process arguments, not an earlier preview, define compliance.
- The unattended disposable-snapshot review helper passes `--skip-permissions`
  by default only when its selected backend is Antigravity. Ordinary frontend,
  backend, resume, direct wrapper, and standalone `agy` calls retain the
  existing conditional behavior.
- `CODEAGENT_RETAIN_LOG_ON_FAILURE=1` is a Grok-only diagnostic input. A non-zero
  Grok wrapper result closes and retains the complete current wrapper log and
  prints its exact path. Successful Grok calls, non-Grok calls, and calls without
  the input keep existing cleanup. Retention never changes the child/result exit
  code, retry policy, validation, target binding, or review envelope.
- Retained logs are ignored local evidence that may contain reviewed source or
  Provider diagnostics. They are inspected locally and never committed.
- Provider sessions remain isolated by role and provider. Recovery of an
  interrupted session must not fabricate success or switch providers.
- Clean-install acceptance is offline and uses fake providers and a fake
  browser opener. It must not depend on credentials or paid network calls.
- Grok intake has three primary outcomes: `invocation_failed` when no usable
  terminal response arrives, `received_unverified` when a response arrives
  without qualifying verification, and `verified` when qualification succeeds.
  Validation labels a receipt; it does not turn a received response into a
  failed call or block downstream GPT Pro intake.
- External `intel` and `verify` may run without a predeclared official domain.
  The source remains `official_unknown`, and a domain returned by Grok never
  becomes trusted merely because it appeared in search output.
- Built-in WebSearch is optional. `preferred` X search is Grok's decision and
  is never promoted to `required` by incident mode. Missing requested Web/X
  evidence yields `received_unverified`, not an invocation failure.
- External intelligence and local review keep their snapshot, binding, state,
  evidence, and output contracts, but inherit Grok's official permission
  behavior. Tool use alone cannot turn a usable terminal response into failure.
- A search `tool_call_update` without a recognized matching start remains
  unverified diagnostic data. It contributes no source evidence, but it must not
  discard an otherwise complete terminal response; return that response as
  `received_unverified` for Codex to assess.
- A correlated completed WebSearch action with `query` or `sources` is a search
  result and must retain strict non-empty `query` plus array `sources` validation.
  A completed action with neither field but with `url` or `pattern` is an
  auxiliary Web action: mark its call complete, retain the notification as
  unknown diagnostics, and never add it to normalized searches or source evidence.
- Grok diagnostics, external-intelligence ACP, and bound local review preserve
  the installed CLI's native updater behavior. CCG does not inject
  `--no-auto-update` or manufacture `GROK_DISABLE_AUTOUPDATER=1`; an explicit
  user-supplied value remains allowed through the exact environment.
- An absent or empty normal `default_model` omits `--model` and follows the Grok
  CLI default. ACP must report exactly one actual session model, and CCG records
  it in evidence, manifests, cache results, and route state. A non-empty model is
  passed explicitly and must exactly match the actual model; enabled deep
  research remains explicitly model-bound.
- Cache locks use one atomically created directory per fingerprint and bind its
  `owner.json` to a unique owner token. A valid dead PID is reclaimed only after
  an in-directory exclusive claim and a second owner-token check; the canonical
  lock path is never vacated before that check. A live, replaced, or unverifiable
  owner remains busy and fail-closed, and legacy owner metadata remains
  reclaimable.
- Frontend/backend companion search is advisory. The controller invokes it only
  when current external facts would materially help, records `failed` or
  `not_applicable`, and continues an otherwise valid local result. Only an
  explicit semantic route is required and may block on exit `2`, `3`, or `4`.
- Unconfigured ordinary Gemini and Grok routing omits model flags and follows
  the Provider CLI default. When transport metadata exposes the actual model,
  CCG records it; an explicit model is passed and must match. Product-manager
  Codex and Gemini follow the same rule, while product-manager Claude remains
  explicitly pinned to `opus`.
- Provider-review snapshots copy each approved file only after the opened file
  descriptor's final platform path exactly matches the approved canonical path.
  Unsupported descriptor-path verification, a parent directory replaced by a
  symlink/junction, or any identity/size/timestamp drift fails closed before bytes
  enter the snapshot.
- Snapshot byte caps apply to the metadata observed after open and to the copy
  loop itself, not only to a pre-open `lstat`. The final copied byte count must
  equal the stable descriptor size and remain within both per-file and total caps.
- A disposable snapshot bounds copied input and default CWD; it is writable and
  is not an OS sandbox. Reviewer prompts must state that boundary while retaining
  the behavioral instruction not to write files.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| `CODEX_HOME` points to an isolated home | Every command reads and writes only that home |
| Wrapper digest or version differs from the pin | Doctor fails with the wrapper mismatch |
| Persisted role/provider is invalid | Command fails with the exact `routing set` repair and preserves bytes |
| Two or more persisted role/providers are invalid | Each targeted `routing set` succeeds independently and leaves the other invalid role unchanged |
| Managed task explicitly selects `frontend: claude` or `backend: claude` | Launch Claude with the official permission contract; do not change defaults or fallback |
| Legacy direct wrapper selects a Claude task | Preserve existing compatibility behavior |
| Antigravity execution is selected | Preserve the selected official revision's conditional permission behavior |
| Antigravity review includes `--skip-permissions` | Final `agy` arguments include `--dangerously-skip-permissions` |
| Unattended disposable-snapshot Antigravity review starts | The helper includes `--skip-permissions`; ordinary AGY surfaces remain unchanged |
| Opted-in Grok review exits non-zero | Retain the complete wrapper log, print its exact path, and preserve the non-zero exit |
| Opted-in Grok review succeeds | Delete the transient wrapper log through the existing success cleanup |
| Non-Grok failure sets the Grok retention input | Ignore the Grok-only retention input and preserve ordinary cleanup |
| Browser preview request is exercised offline | Fake opener receives the generated local preview target |
| Provider process is hard-killed | Resume uses the same provider/session contract |
| Update or uninstall runs in acceptance | Only the isolated test installation changes |
| Grok returns no usable terminal response | Record `invocation_failed`; do not claim a response was received |
| Grok returns terminal prose without qualifying evidence | Record and forward `received_unverified` with exit 0 |
| Grok returns a qualifying source-bound package | Record and forward `verified` |
| External `verify` has no predeclared official domain | Continue with `official_unknown`; do not promote returned hosts |
| External `verify` has a valid predeclared domain | Include it in the bounded prompt and validate evidence against it |
| Preferred X search is absent, including incident mode | Preserve the receipt; do not promote the policy or block |
| Explicitly required Web/X evidence is absent | Preserve the receipt as `received_unverified` |
| Grok uses an inherited tool during review/intelligence | Continue business validation; do not fail solely because of tool use |
| Complete Grok response includes an uncorrelated search update | Preserve the update as unknown diagnostics, exclude its sources, and return `received_unverified` |
| Correlated completed WebSearch action has `type/url` or `pattern/type/url` but no `query`/`sources` | Mark the call complete, preserve the notification as unknown diagnostics, and add no search evidence |
| WebSearch result has an empty/missing `query` or non-array `sources` | Fail strict normalization; do not reinterpret it as an auxiliary action |
| Grok automation starts without an explicit updater override | Do not inject a flag or environment value; use native CLI behavior |
| User explicitly supplies `GROK_DISABLE_AUTOUPDATER` | Preserve the value through the exact environment allowlist |
| Normal `default_model` is absent or empty | Omit `--model`, require one ACP actual model, and record that model |
| Normal `default_model` is non-empty | Pass `--model <value>` and reject any ACP actual-model mismatch |
| Deep research is enabled without a model | Reject configuration before Provider execution |
| Cache lock owner PID is confirmed dead | Claim inside the unchanged lock directory, revalidate the owner token, remove it, and retry acquisition once |
| Cache lock owner is live, replaced, malformed, or unverifiable | Report busy without deleting or stealing the lock |
| Automatic companion search fails | Record `advisory_failed`/`failed`, preserve the Provider exit for diagnostics, and return success to ordinary local work |
| Explicit semantic route fails | Preserve the non-zero result and block that explicitly required evidence path |
| Gemini/Grok model is unconfigured | Omit the model flag and use the CLI default; record actual transport identity when available |
| Product-manager Claude model override is absent | Pass `--model opus` exactly |
| Pure local code review has no domain | Do not enable the external domain gate |
| Approved target parent is swapped to a symlink/junction before recursion | Resolve the opened descriptor outside the approved path, copy no bytes, and fail the exact review |
| Approved file grows after `lstat` or while copying | Enforce the remaining byte budget, remove any partial target, and fail the exact review |

## 5. Good / Base / Bad Cases

- Good: isolated install routes each role, opens an Antigravity preview, resumes
  Grok after interruption, passes doctor, updates, and uninstalls offline.
- Good: Antigravity matches its official conditional permission arguments, and
  an explicitly selected managed Claude frontend/backend task can start without
  changing the default route.
- Good: an unattended Antigravity snapshot review bypasses headless permission
  prompts, while a normal Antigravity frontend task still requires the existing
  explicit opt-in.
- Good: one opted-in failing Grok review preserves beginning, middle, and end
  stderr markers in the reported log without fabricating a review envelope.
- Base: a valid installation with no active provider session passes doctor.
- Base: a complete Grok response without search or a claims envelope is retained
  as `received_unverified`; `intel`/`verify` without a domain keeps sources
  `official_unknown` and never promotes returned domains.
- Good: search-result, URL, and Pattern actions coexist in one completed stream;
  only the search-result action contributes query/source evidence.
- Base: normal external intelligence leaves `default_model` empty, follows the
  CLI default without a model argument, and records the returned session model.
- Base: ordinary frontend/backend work records advisory search as
  `not_applicable` or `failed` and continues without an external-network gate.
- Good: a dead cache owner is reclaimed once, while a concurrent replacement
  and a third contender remain excluded and the live lock is never removed.
- Bad: a stale wrapper or invalid route fails clearly without config mutation,
  fallback, network access, or a false success result.
- Bad: report a received response as `invocation_failed`, or reject it only
  because preferred X search or qualifying evidence is absent.
- Bad: allow a Provider to bypass task/output/schema/user-gate validation merely
  because its native tool permissions are enabled.
- Bad: replace a retired model pin with a newer hard-coded pin, or fabricate an
  actual model when ACP did not report exactly one.
- Bad: trust a directory check or pre-open file size after opening a path again,
  or describe a writable snapshot as a zero-write OS sandbox.

## 6. Tests Required

- Unit coverage for shared `CODEX_HOME` resolution and invalid-route recovery.
- Regression coverage for sequential repair of multiple invalid roles and for
  explicit managed Claude frontend/backend selection without default/fallback
  changes.
- Go wrapper tests for the reported version and provider execution contract.
- Go argument coverage for exact upstream Provider permission behavior and Pi's
  native approved capabilities.
- One CLI-to-child regression for Antigravity permission propagation; direct
  `buildAntigravityArgs` construction alone is insufficient.
- Python helper coverage proving only the Antigravity snapshot-review command
  receives `--skip-permissions`, plus CLI-to-child coverage for the final
  `agy --dangerously-skip-permissions` argument.
- Wrapper regression coverage with stderr larger than 4 KiB proving opted-in
  Grok failure retention, exact path reporting, unchanged exit code, absence of
  a fabricated envelope, default failure cleanup, success cleanup, and non-Grok
  isolation.
- Offline clean-home acceptance covering install, routing, wrapper execution,
  preview opening, resume, parallel execution, doctor, update, recovery, and
  uninstall.
- CI runs clean-home acceptance from the authoritative LF checkout on Linux and
  Windows with Node 22 and Go 1.21.13, so the current-platform build must match
  the pinned release digest.
- Unit/integration coverage for `invocation_failed`, `received_unverified`, and
  `verified`, including no-search terminal responses, advisory validation,
  cache reuse, route publication, and GPT Pro consumption.
- Coverage proving missing-domain `verify` keeps `official_unknown`, valid
  domains enter the prompt, incident mode preserves preferred X, and pure local
  review surfaces do not invoke external intelligence.
- ACP/wrapper coverage proving inherited Grok permissions and acceptance of tool
  events while retaining terminal, identity, state, and evidence validation.
- Runner coverage proving an uncorrelated search update cannot promote sources
  but also cannot discard a complete terminal response.
- Event coverage with search-result, URL, and Pattern completed actions proving
  auxiliary actions satisfy correlation completeness but remain unknown and
  source-free, while a blank search-result query still fails.
- Argument and environment coverage proving CCG does not suppress Grok updates
  by default and preserves an explicit user override.
- Argument, runner, command, route, and live-smoke coverage proving an
  unconfigured normal model emits no `--model`, records the ACP actual model,
  and an explicit model mismatch fails.
- Cache coverage proving atomic directory publication, valid dead-owner
  recovery, legacy owner compatibility, and refusal to remove a live replacement
  while a third contender remains excluded.
- Routing and distributed-Skill coverage proving automatic companion-search
  failure is advisory/non-blocking, while an explicit semantic route remains
  required and preserves its failure code.
- Provider argument/output coverage proving unconfigured Gemini/Grok and
  product-manager Codex/Gemini omit model flags, explicit pins are checked, and
  product-manager Claude still passes `opus`.
- Cross-platform regression coverage that swaps an approved parent directory to
  a symlink/junction between checks and proves no outside file reaches the
  snapshot.
- Regression coverage that grows the same file between `lstat` and open beyond
  the per-file budget, plus a prompt-contract assertion that the Antigravity
  reviewer says the writable snapshot is not an OS sandbox.

## 7. Wrong vs Correct

```text
Wrong: routing reads ~/.codex while doctor checks CODEX_HOME.
Correct: both resolve the same Codex home helper.

Wrong: doctor checks only that a wrapper file exists.
Correct: doctor verifies the pinned digest and wrapper-reported version.

Wrong: invalid routing is silently replaced or rewritten.
Correct: configuration stays byte-identical and the exact repair command is shown.

Wrong: repairing one role first normalizes every other role and fails on the next invalid value.
Correct: validate and write only the selected role so repeated repairs can converge.

Wrong: reject `backend: claude` because Claude was historically product-manager-only.
Correct: allow explicit frontend/backend/product-manager selection while keeping defaults and fallback unchanged.

Wrong: add a fork-only Antigravity permission profile for one review entrypoint.
Correct: preserve the selected official revision's conditional permission behavior.

Wrong: parse --skip-permissions but drop it while rebuilding TaskSpec or Config.
Correct: carry the parsed value to the final Antigravity child-process arguments.

Wrong: enable Antigravity permission bypass globally because snapshot review needs it.
Correct: add the existing skip flag only in the unattended disposable-snapshot helper.

Wrong: keep only a truncated console tail after an opted-in Grok failure.
Correct: close and retain the existing complete wrapper log, print its exact path, and preserve failure semantics.

Wrong: reject a complete Grok response because verification or preferred X evidence is missing.
Correct: retain it as received_unverified; only absence of a usable terminal response is invocation_failed.

Wrong: Grok searches first and its returned host becomes the official whitelist.
Correct: keep the source official_unknown unless the caller predeclared the domain.

Wrong: fail a complete Grok result solely because Grok used an inherited tool.
Correct: validate the response and evidence independently of Provider tool use.

Wrong: relabel a complete Grok response as invocation_failed because one search update lacks a recognized start event.
Correct: keep the update unverified, return the response as received_unverified, and let Codex decide whether to use it.

Wrong: require query/sources from every completed WebSearch action or accept an empty search-result query as a workaround.
Correct: classify observed URL/Pattern actions as completed unknown diagnostics while keeping actual search results strict.

Wrong: force every automated Grok invocation to keep its currently installed CLI version.
Correct: use Grok's native updater behavior and preserve only an explicit user override.

Wrong: replace a stale Grok model pin with another versioned default.
Correct: omit --model when normal default_model is empty, record the single ACP actual model, and compare only explicit requests.

Wrong: publish a prepared lock directory with rename and assume an existing destination cannot be replaced.
Correct: publish complete owner metadata with an atomic no-replace operation, then reclaim only a confirmed dead owner.

Wrong: every frontend/backend task must complete external search before local work can continue.
Correct: treat companion search as advisory; only an explicit semantic evidence route is blocking.

Wrong: replace a retired Gemini or Grok default with another versioned model string.
Correct: omit the model argument unless explicitly configured, record actual transport identity, and keep only the intentional Claude product-manager opus pin.

Wrong: a local diff review fails because no official domain was supplied.
Correct: local review never enables the external fact domain gate.

Wrong: check a parent directory and file size, then follow the path again and copy without a bound budget.
Correct: verify the opened descriptor's final path and enforce the remaining budget before and during copying.

Wrong: tell Antigravity that its writable disposable snapshot provides zero filesystem write permission.
Correct: instruct it not to write while stating that the snapshot is writable and is not an OS sandbox.

```
