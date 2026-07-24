# Implementation Plan

1. Add `.harness/adapter.json` with ownership, model, state, hook, and Grok provider contracts.
2. Add a Node adapter module and CLI that:
   - resolves the active Trellis task;
   - emits redacted canonical context;
   - audits deterministic Trellis/CCG conflicts;
   - probes an OpenAI-compatible Grok API using environment-only credentials.
3. Add project-level Harness instructions outside the Trellis-managed `AGENTS.md` block.
4. Extend `package.json`, `scripts/doctor.ps1`, and CI with adapter checks.
5. Add Node built-in tests for authority, redaction, namespace collision, hook overlap, provider separation, and blocking exit behavior.
6. Record the user's explicit Grok opt-out, run Gemini read-only review, adapter tests, source verification, security/quality gates, and the full CCG test/build suite. Do not call Grok or Claude.
7. Validate the GPT Pro review against the local dirty tree and record the
   finding matrix under `research/`.
8. In the authoritative personal CCG checkout, use red-green-refactor cycles to:
   - reject wrapper candidates by trusted SHA-256 before chmod or execution;
   - pin executable third-party sources and remove automatic `sudo`;
   - merge/backup/own Codex-mode global state and make uninstall digest-safe;
   - disable public npm self-update;
   - propagate required init/doctor/update failures through exit status;
   - quote hook paths and fail closed on malformed settings;
   - prevent secret arguments and secret-bearing MCP mirror copies;
   - delegate/yield to Trellis in the Codex-mode hook.
9. Commit the personal CCG hardening, import its exact tracked tree into the
   Harness component, and update `harness.sources.json` commit/tree provenance.
10. Add root Python resolution, strict source verification, explicit doctor
    success status, and transaction-safe update/uninstall/rollback commands.
11. Promote component Windows/Go/offline gates into root CI and add macOS
    bootstrap/path/doctor coverage.
12. Add normal-clone/worktree hook fixtures plus bounded opt-in MCP smoke
    diagnostics.
13. Run targeted tests after every fix group, then run adapter tests, source
    verification, CCG lint/typecheck/tests/build, Harness doctor, quality,
    security, and final dirty-tree review.
14. Write a final conflict matrix and distinguish fixed, intentional, and any
    residual operator-only risks.
15. Generate `.agents/skills/harness-init` with the Skill Creator, add a
    complete constraint checklist and project-contract template, integrate the
    `grill-me` one-question gate and `trellis-spec-bootstrap` handoff, validate
    the Skill package, and cover its non-mutation/provider boundaries with
    offline tests.

## Verification

```powershell
node --test .\tests\harness-adapter.test.mjs
node --test .\tests\harness-init-skill.test.mjs
node .\scripts\harness-adapter.mjs context
node .\scripts\harness-adapter.mjs conflicts
pwsh -NoProfile -File .\scripts\doctor.ps1
pnpm --dir .\components\ccg-workflow lint
pnpm --dir .\components\ccg-workflow typecheck
pnpm --dir .\components\ccg-workflow test
pnpm --dir .\components\ccg-workflow build
```

## Rollback point

Before staging, retain the original personal CCG commit and Harness component
tree as rollback anchors. Component replacement is allowed only from the new
clean personal commit. Never touch or stage the two endpoint-protection-blocked
security reference files.

## Completion evidence

- Harness root tests: 32 passed, 0 failed, including source residue rejection,
  lifecycle interruption recovery, CI ownership, and all three `harness-init`
  contracts, plus Windows package-manager launcher resolution.
- Local conflict audit: 0 blocking, 0 warnings, 3 information findings, 15
  checks passed.
- Harness doctor and personal source verification passed against
  `88222edd298dc4254d7fd7151f48682618063139` and Git tree
  `8fcfd2b70efa6a2aa07b692911cbafc85616522c`.
- Personal CCG lint, typecheck, 413 tests across 26 files, build, diff check,
  change analysis, quality scan, and production security scan passed.
- Native Go wrapper test and build passed.
- Harness script quality scan passed with 0 errors and 0 warnings; security
  scans for scripts and `harness-init` returned 0 findings.
- The Skill Creator validator reported `Skill is valid!`.
- Windows endpoint protection never entered the trusted tree: final source
  verification used the exact staged Git tree with the two blocked paths left
  unmaterialized, while their authoritative index blobs remained unchanged.
- Personal CCG GitHub CI run `30095082023` passed its full Node 20/22 Linux
  and Windows matrix plus both Go jobs.
- Harness GitHub CI run `30095603243` passed all ten jobs: Node 20/22 on
  Linux and Windows, Go on Linux/Windows/macOS, and bootstrap/doctor on
  Linux/Windows/macOS.
- Grok and Claude were not invoked.

### Additional repairs

- The user-level Trellis workflow-state hook now yields when the current
  project already registers its own local workflow-state hook.
- Projects without local Codex hook wiring retain the global fallback.
- The Harness doctor verifies the precedence marker and reports an unguarded
  duplicate as a warning.
- Rollback interruption now restores both the current component and its current
  source manifest before surfacing the failed post-restore gate.
- Windows lifecycle transactions launch `npm` and `pnpm` through their
  trusted JavaScript entry points beside Node.js, avoiding `.cmd` resolution
  failures without enabling a command shell.
