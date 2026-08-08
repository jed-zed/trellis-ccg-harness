# Align Product Manager provider timeout with upstream

## Goal

Align the personal CCG Product Manager's per-Provider invocation timeout with
the original CCG wrapper duration of 7200 seconds, so a complete read-only
review is not cut off by the current three-minute default.

## Background

- The installed CCG 3.4.6 configuration currently uses
  `product_manager.timeout_ms = 180000` with `max_retries = 1`.
- The personal CCG source defaults to `180_000` ms and rejects values above
  `600_000` ms in `src/utils/config.ts`.
- Original CCG uses a 7200-second timeout independently for each wrapper task.
  Original CCG has no Product Manager runner, so only the duration and
  independent-per-invocation timing are being aligned; the Product Manager
  architecture is not being replaced.
- `I:/ai/ccg-gptpro-worflow-route-timeout-publish` is a clean checkout of the
  authoritative personal CCG `gptpro/main` at `8f6d981`. Harness snapshots,
  installed npm files, wrapper binaries, and plugin caches are derived surfaces
  and must not be patched directly.

## Requirements

- R1: Set the Product Manager default timeout to `7_200_000` ms (7200 seconds)
  and allow that exact value through configuration normalization.
- R2: Keep the existing fixed wall-clock timer scope: each Provider attempt is
  timed independently from child-process start to exit.
- R3: Preserve `max_retries = 1`, same-Provider retry, no-fallback behavior,
  output limits, termination handling, and all authorization boundaries.
- R4: Synchronize the authoritative source default, Codex config template,
  focused configuration tests, and the canonical Harness Product Manager spec.
- R5: Do not change unrelated 180-second values, including Grok probes, Grok
  doctor checks, test-runner limits, or explicit short test fixtures.
- R6: Do not directly edit generated snapshots, installed npm package files,
  wrapper binaries, plugin caches, or source manifests.
- R7: Deliver the change end to end through an independent personal-source
  branch and PR, the supported publication path, a formal Harness update, and
  active-runtime verification on this machine.

## Acceptance Criteria

- [ ] With no explicit Product Manager timeout, normalization returns
      `timeout_ms = 7_200_000`.
- [ ] An explicit `timeout_ms = 7_200_000` is accepted, while a value above the
      chosen two-hour limit is rejected with the existing clear range error.
- [ ] Each retry receives its own 7200-second timeout; retry count and provider
      selection behavior remain unchanged.
- [ ] The generated Codex configuration template and canonical Harness spec
      both state `timeout_ms = 7200000`.
- [ ] Focused configuration and Product Manager tests pass without calling a
      live Provider or accessing credentials.
- [ ] The supported source publication and Harness update flow makes
      `ccg product-manager status --json` report
      `timeout_ms = 7200000` from the active config.

## Out of Scope

- Changing `CODEX_TIMEOUT` parsing or the original wrapper's two-hour default.
- Changing Product Manager retry count, fallback rules, process-runner design,
  output cap, tools, provider routing, or authorization.
- Changing Grok probe/doctor timeouts or running a live/paid Provider call.
- Combining this change with unrelated route-target or timeout-unit work.

## Delivery Decision

- Boss selected end-to-end delivery on 2026-08-07: source change, validation,
  PR/publication, formal Harness/runtime update, and active status verification.

