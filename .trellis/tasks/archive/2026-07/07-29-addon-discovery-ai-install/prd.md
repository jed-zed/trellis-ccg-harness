# Add-on discovery and AI-assisted installation

## Goal

Make the Harness's recommended third-party add-ons discoverable during first
setup and later maintenance, while preserving explicit per-item approval,
network approval, data-egress disclosure, source pinning, ownership, and
rollback boundaries. A user who gives the GitHub repository URL directly to an
AI installer must also receive the same safe, understandable flow.

## Background

- Interactive `pnpm setup` already delegates third-party selection to Global
  Init, where every candidate is unselected by default
  (`tests/install-script.test.mjs:703`).
- The source manifest marks applicable candidates as recommended while keeping
  `approvalDefaults.selected: false`
  (`.agents/skills/harness-init/assets/third-party-sources.json`).
- The root `package.json` has no dedicated add-on discovery or maintenance
  command.
- The README documents `third-party-plan`, but the command is not a prominent
  post-install or AI-assisted entry point (`README.md:104`).
- Existing third-party installation already owns source pinning, plan digests,
  separate network approval, data-egress disclosure, transactional rollback,
  and MCP launcher validation. This task must reuse those controls.

## Requirements

### R1. First-run recommendation

- Interactive `pnpm setup` must visibly recommend applicable add-ons while
  keeping every candidate unselected by default.
- The prompt must distinguish "recommended" from "selected" and explain that
  pressing Enter or choosing the default skips installation.
- Setup completion must summarize recommended add-ons that remain uninstalled
  and point to the later add-on command.

### R2. Global add-on menu

- Add a discoverable `pnpm addons` entry point for global third-party
  candidates.
- Provide a read-only status mode and a plan-only mode so non-interactive
  callers can obtain the current source digest, plan digest, candidate states,
  dependencies, and effects before requesting approval.
- The menu must show installed, absent, drifted, blocked, and manual-pending
  states where applicable.
- It must cover:
  - `grill-me + grilling`
  - Caveman
  - Ponytail plugin
  - Ponytail hook trust
  - Ponytail global `full` default
  - CodeGraph
  - fast-context
  - Context7
  - ripgrep
- It must reuse the existing canonical third-party plan and apply paths rather
  than implement a second installer.
- Existing dependency ordering must remain explicit, including Ponytail
  install before hook trust or default configuration. A dependent action is
  blocked unless Ponytail is already exact-installed or explicitly selected in
  the same transaction.
- Drifted user or Harness-owned content must never be overwritten by the menu;
  it remains visible and fails closed for separate remediation.

### R3. AI-assisted installation

- The root README must contain a prominent entry point for users who give the
  repository URL to an AI and ask it to install the Harness.
- Add one canonical AI-readable installation contract or guide in the
  repository. It must direct an AI to:
  1. inspect and preview without mutation;
  2. present core changes and recommended add-ons;
  3. preserve the default-skip behavior;
  4. disclose per-candidate scripts, hooks, executable, network, and data-egress
     effects;
  5. obtain explicit approvals before any global or project write;
  6. use only existing Harness commands and reviewed plan digests;
  7. report manual-pending MCP registration instead of claiming completion.
- The AI path must be usable without relying on hidden Codex-only context.
- After obtaining fresh, explicit approval for core installation, exact
  add-on selections, and third-party network access, the AI may execute the
  existing Harness commands on the user's behalf.
- Before those approvals, the AI path is strictly read-only. The repository
  URL, a request to inspect the repository, or a prior unrelated approval must
  never authorize installation.
- The final apply command must repeat the exact selected candidates and bind
  both the displayed source digest and plan digest. The installer must
  reconstruct and revalidate the plan immediately before mutation.

### R4. Preserved safety and authority

- Trellis remains lifecycle and task authority; CCG remains orchestration and
  quality authority; Codex remains the sole workspace writer.
- No add-on may become selected merely because it is recommended.
- No add-on download may reuse catalog-network approval; third-party network
  approval remains separate.
- Strict-data-boundary behavior must continue to block fast-context and
  Context7.
- User-owned Skills, plugins, hooks, MCP configuration, and tools must remain
  protected by existing ownership and drift checks.

## Key Decisions

- Deliver both first-run/post-install recommendations and a reusable
  `pnpm addons` global menu.
- Keep project-specific Skills in `project-init`.
- Keep every recommended candidate defaulted to `no`.
- Allow AI execution only after the AI presents the reviewed plan and receives
  fresh explicit approvals for each mutating scope.
- Reuse the canonical third-party plan and apply transactions; do not create a
  parallel installer or approval store.

## Out of Scope

- Moving project-specific third-party Skills into the global add-on menu.
- Automatically installing or logging in provider CLIs.
- Automatically running `codegraph init`.
- Making all recommended add-ons selected by default.
- Bypassing the existing plan digest or approval transaction.

## Acceptance Criteria

- [x] A first interactive setup visibly recommends applicable add-ons, but the
      default response installs none.
- [x] Setup completion names the discoverable `pnpm addons` follow-up command
      when recommended add-ons remain absent.
- [x] `pnpm addons` presents the complete global candidate set, current state,
      recommendation, effects, and dependency constraints.
- [x] Read-only status and plan-only modes expose machine-readable evidence
      including the current source and plan SHA-256 values without mutation.
- [x] Selecting an add-on uses the existing source-pinned, approval-gated,
      ownership-aware transaction.
- [x] Refusing add-ons or their network approval leaves core setup successful.
- [x] Non-interactive and AI-assisted execution cannot install an add-on
      without the reviewed plan digest and explicit candidate approvals.
- [x] A stale or fabricated source/plan digest, changed candidate list,
      strict-boundary violation, missing Ponytail dependency, or drifted target
      fails before mutation.
- [x] The root GitHub landing documentation makes the AI-assisted path obvious
      to a user or agent that only has the repository URL.
- [x] AI instructions require read-only preview and disclosure before writes
      and never treat the repository URL itself as installation approval.
- [x] After fresh explicit approval, an AI can invoke the documented
      non-interactive core and add-on paths without bypassing plan digests,
      per-candidate selections, or separate network approval.
- [x] Existing same-name MCP configuration remains protected and
      manual-pending is reported accurately.
- [x] Focused installer, interactive prompt, third-party approval, MCP launcher,
      README/contract, and package-script tests pass.
