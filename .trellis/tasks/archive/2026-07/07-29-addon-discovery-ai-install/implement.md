# Add-on discovery and AI-assisted installation implementation plan

## Ordered checklist

1. Add focused failing tests for the public command and safety contract.
   - Assert `package.json` exposes `pnpm addons`.
   - Assert the interactive menu labels recommended candidates while defaulting
     every choice to `no`.
   - Assert project Skills never appear in the global menu.
   - Assert dependency, blocked, drifted, and manual-pending states render.
   - Assert reject-all and declined network approval perform no add-on writes.
   - Assert `--status` and `--plan-only` are read-only and emit stable
     machine-readable source/plan digest evidence.
   - Assert non-interactive AI execution requires source and plan digests plus
     explicit approval.
   - Assert missing, stale, or fabricated digests and changed selections fail
     before mutation.
   - Assert strict-data-boundary and Ponytail dependency checks cannot be
     bypassed with non-interactive flags.
   - Assert drifted targets remain blocked and are never overwritten.
2. Extract or reuse a shared global third-party selection/presentation helper
   from `.agents/skills/harness-init/scripts/harness-init-core.mjs`.
   - Keep Global Init behavior compatible.
   - Add the `addons` command without duplicating apply logic.
   - Add read-only `--status` and explicit-selection `--plan-only` paths.
   - Prefer the candidate state already returned by
     `buildThirdPartyApprovalPlan`; extend approval/action status logic only
     where a required state cannot be derived safely.
   - Reuse `buildThirdPartyApprovalPlan`,
     `applyThirdPartyGlobalSkills`, and
     `applyThirdPartyGlobalActions`.
   - Rebuild and validate the plan at apply time using the existing source and
     plan SHA-256 flags; do not add a second approval store or bypass.
3. Add the root `addons` package script and help/usage coverage.
4. Add the Global Setup completion summary in `scripts/install.ps1`.
   - Print `pnpm addons` only when recommended candidates need attention.
   - Preserve successful core setup when add-ons are skipped.
5. Add AI installation documentation.
   - Create `AI_INSTALL.md` with the provider-neutral approval state machine,
     status/plan-only commands, exact candidate flags, digest-bound execution
     commands, validation, and reporting rules.
   - Add a prominent README entry and human `pnpm addons` documentation.
   - Update `scripts/README.md`, `scripts/DESIGN.md`, and the Harness Init Skill
     instructions where required to keep the public contract synchronized.
6. Run focused tests, then required Harness/CCG gates.
7. Review the diff for duplicated installer logic, approval weakening, global
   path expansion, provider invocation, or claims that manual-pending MCPs are
   installed.

## Likely files

| File | Planned action |
|---|---|
| `package.json` | Add the public `addons` script |
| `scripts/install.ps1` | Add post-setup recommendation output |
| `scripts/harness-init.mjs` | Preserve wrapper entry point; adjust only if command forwarding requires it |
| `.agents/skills/harness-init/scripts/harness-init-core.mjs` | Add shared add-on command/menu orchestration |
| `.agents/skills/harness-init/scripts/third-party-approval.mjs` | Reuse or minimally expose canonical status/dependency validation if the CLI boundary needs it |
| `.agents/skills/harness-init/SKILL.md` | Document the human and AI entry points |
| `README.md` | Add prominent human/AI discovery |
| `AI_INSTALL.md` | Add canonical provider-neutral AI installation contract |
| `scripts/README.md` | Document CLI behavior |
| `scripts/DESIGN.md` | Record architecture and safety boundaries |
| `tests/install-script.test.mjs` | Cover setup hint and compatibility |
| `tests/harness-init-cli.test.mjs` | Cover command parsing/help/menu contract |
| `tests/harness-third-party-global-actions.test.mjs` | Cover apply reuse and fail-closed behavior if needed |
| `tests/verify-sources.test.mjs` | Cover synchronized owned assets/docs when applicable |

## Validation commands

Focused:

```text
node --test tests/harness-init-cli.test.mjs
node --test tests/install-script.test.mjs
node --test tests/harness-third-party-global-actions.test.mjs
node --test tests/harness-third-party-mcp-launcher.test.mjs
node --test tests/verify-sources.test.mjs
```

Required project gates:

```text
pnpm doctor
pnpm harness:conflicts
pnpm harness:test
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
go test -short ./...
go build ./...
```

## Risk and rollback points

- Preserve `approvalDefaults.selected: false`; tests must fail if a
  recommendation becomes a default selection.
- Do not bypass source/plan digests for the AI path.
- Recompute the canonical plan before apply to close manifest, selection, and
  execution-binding TOCTOU gaps.
- Do not widen writes beyond existing owned roots.
- Do not overwrite drifted targets; require a separate remediation path.
- Do not auto-register over an existing MCP name.
- Do not run provider install/login or `codegraph init`.
- If shared-menu extraction changes Global Init output or selection behavior,
  revert the extraction and implement only a thin shared presentation helper.
- Any CCG source snapshot or owned asset digest change must follow the existing
  provenance/update transaction rather than manual cache editing.

## Before `task.py start`

- Requirement convergence and PRD convergence pass complete.
- CCG role-provider planning evidence captured and synthesized.
- Final planning summary presented to the user.
- User explicitly approves that latest final summary in a subsequent message.
