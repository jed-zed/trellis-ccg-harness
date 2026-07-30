# Add-on discovery and AI-assisted installation design

## Architecture and boundaries

The feature extends the existing Harness initializer rather than adding a
second installation system.

```text
pnpm setup
  -> scripts/install.ps1
  -> harness-init global-init
  -> existing third-party plan + approval + apply transactions
  -> post-install recommendation summary

pnpm addons
  -> harness-init addons
  -> canonical third-party-plan
  -> read-only status / plan-only evidence or interactive menu
  -> separate third-party network approval
  -> existing global Skill/action apply transactions

AI_INSTALL.md
  -> read-only status + plan-only commands
  -> user-facing approval summary
  -> digest-bound non-interactive setup/addons commands after approval
```

Trellis remains the lifecycle/task/plan authority. CCG provides planning and
quality gates. Codex is the sole workspace writer. The new command never calls
providers, installs provider CLIs, or owns project-specific Skill choices.

## Command contract

Add an `addons` command to the Harness initializer and expose it through the
root package script:

```text
pnpm addons
```

Interactive mode:

1. Build the canonical third-party approval plan for the effective home and
   repository.
2. Limit choices to `global-skills`, `global-plugins`, and `mcp-cli`.
3. Render candidate status, recommendation, source/version, dependencies,
   scripts/hooks/executables, network, and data-egress effects.
4. Present `no` first and as the default for every candidate.
5. Request separate network approval only for selected candidates that require
   acquisition.
6. Present the canonical plan digest and bound command/root evidence.
7. Apply through `applyThirdPartyGlobalSkills` and
   `applyThirdPartyGlobalActions`.
8. Return a structured result including installed, skipped, blocked, drifted,
   and manual-pending outcomes.

Read-only/non-interactive modes:

- `pnpm addons -- --status` rebuilds the canonical plan and prints
  machine-readable candidate status and effects without mutation.
- `pnpm addons -- --plan-only` requires explicit values for the existing
  `--third-party-global-skills`, `--third-party-global-plugins`, and
  `--third-party-mcp-cli` selections. It prints the source manifest SHA-256,
  plan SHA-256, resolved selections, dependency/blocked outcomes, network
  requirements, and write effects without mutation.
- Apply reuses those exact selection flags plus
  `--third-party-source-sha256`, `--third-party-plan-sha256`,
  `--allow-third-party-network` when required, and `--approved`.
- Apply reconstructs the canonical plan immediately before mutation and
  rejects a changed manifest, digest, selection, execution binding, strict
  boundary, or dependency state.

Missing approval evidence fails closed. No special "AI bypass" flag or
parallel approval store exists.

The command parser, plan builder, approval resolver, preflight, and apply
functions remain the validation boundary. UI visibility is never the only
enforcement for strict data boundaries, dependencies, drift, or protected MCP
configuration.

## Recommendation presentation

`recommended: true` remains display metadata only. It must never mutate
`selected: false` or change the default answer.

First setup and `pnpm addons` use consistent language:

- `Recommended` explains why the candidate is useful.
- `Default: skip` explains that Enter/no performs no installation.
- Blocked or unavailable candidates are visible but cannot be selected.
- Dependency chains, especially Ponytail plugin -> hooks/default, are shown
  before selection. A dependent Ponytail action is selectable only when its
  base plugin is exact-installed or included in the same explicit transaction.
- Drifted candidates are visible but cannot be overwritten. The command
  reports separate remediation is required.

After Global Setup, the installer prints a compact summary only when applicable
recommended candidates remain absent, blocked, drifted, or manual-pending. It
points to `pnpm addons` and does not treat the condition as a setup failure.

## AI-assisted installation contract

Create a root `AI_INSTALL.md` and link it prominently near the top of
`README.md`. The contract is provider-neutral and must be understandable by an
agent that only has the public repository.

The guide requires this state machine:

```text
repository URL
-> inspect README + AI_INSTALL.md
-> clone/read-only preflight
-> core setup preview
-> pnpm addons -- --status
-> pnpm addons -- --plan-only with exact candidate flags
-> disclose exact source/plan digests, effects, and recommendations
-> obtain fresh core/add-on/network approvals
-> execute the same candidate flags with matching digests and approvals
-> run doctor/conflict checks
-> report installed, skipped, blocked, and manual-pending items
```

The guide must distinguish user intent from authority: "install this
repository" starts inspection and planning, but does not implicitly approve
global writes, optional add-ons, third-party networking, provider login, or
paid calls.

## Compatibility and migration

- Existing `pnpm setup` non-interactive behavior remains default-none.
- Existing approved third-party ownership files remain authoritative.
- Existing same-name Codex MCP entries remain protected; the result stays
  `manual-pending` when atomic registration is unavailable.
- Existing global installations are reported through current status logic and
  are not silently adopted.
- Drifted targets fail closed and are never overwritten by `pnpm addons`.
- Strict data boundary continues to make fast-context and Context7
  unavailable.
- The feature is additive; no migration is required for existing users.

## Operational and rollback behavior

The new entry point does not implement new filesystem transactions. Rollback,
interruption recovery, source pinning, tree fingerprints, and ownership checks
stay in the existing third-party modules. Documentation and package-script
changes are removed by ordinary repository rollback; installed add-ons use
their existing ownership-aware uninstall behavior.

## Trade-offs

- A dedicated command improves discoverability but creates another public CLI
  surface; sharing the existing parser and apply functions limits drift.
- A single `addons` command with `--status` and `--plan-only` flags adds less
  parser and documentation surface than separate `plan`/`apply` subcommands,
  while preserving distinct read-only and mutating phases.
- AI execution improves the link-to-install experience but requires explicit
  approval wording and structured evidence to avoid treating a link as broad
  authority.
- Keeping project Skills out of `pnpm addons` makes the menu smaller and
  preserves project contract authority at the cost of a separate
  `project-init` step.

## Reviewed disagreement

Gemini recommended removing third-party prompts from `pnpm setup` and showing
only a completion table. The accepted user requirement explicitly asks for
first-run recommendation during setup, and the current installer already
contains an interactive third-party selection flow. The implementation keeps
that flow, makes recommendation/default-skip wording unambiguous, and also
adds the completion hint. Non-interactive setup remains default-none.
