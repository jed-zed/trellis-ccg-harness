---
name: harness-init
description: "Use when starting a new project, adopting an existing repository into the Trellis plus CCG Harness, repairing missing Harness state, or selecting project-specific Skills from a reusable Skill repository."
---

# Harness Init

Establish the project's Harness contract before development begins. Discover
repository facts first, use an available approved interview Skill for the decisions only the user can make,
then initialize Trellis and CCG after the user explicitly approves the complete
constraint summary. On the first trigger, also refine and persist the user's
Skill profile; later projects reuse that saved path and policy.

## Non-Negotiable Gates

1. **Read before asking.** Inspect the repository, existing instructions,
   manifests, specs, hooks, CI, and Git state before asking anything. If a fact
   is answerable from the repository, answer it through inspection instead of
   asking the user.
2. **One question at a time.** Load and use the approved `grill-me` third-party
Skill only when the user has explicitly installed it. Otherwise ask exactly one
unresolved decision per turn. Each question must
   state why it matters, give a recommended answer, and explain the trade-off
   of choosing differently.
3. **Approval before mutation.** Do not write, generate, install, copy, delete,
   or mutate project or global state before the user gives explicit approval to
   the latest complete initialization summary. Earlier requests to "start",
   "initialize", or "go ahead" do not replace this final approval gate.
4. **Keep secrets out.** Never read secret values merely to discover whether a
   provider is configured. Record only environment-variable names, secret-store
   references, or a redacted configured/not-configured status.
5. **Keep providers opt-in.** Do not call Grok, Claude, GPT Pro, paid models, or
   network services during initialization unless the user separately approves
   that exact provider and operation. Offline discovery and verification are
   the default.
6. **Preserve existing ownership.** Treat every existing project or global file
   as user-owned until an ownership manifest or managed block proves otherwise.
   Merge or back up approved changes; never silently replace valid content.
7. **Keep the Harness platform global.** The global baseline is all 13
   built-in Harness/Trellis platform Skills: `harness-init`,
   `trellis-before-dev`, `trellis-brainstorm`, `trellis-break-loop`,
   `trellis-channel`, `trellis-check`, `trellis-continue`,
   `trellis-finish-work`, `trellis-meta`, `trellis-session-insight`,
   `trellis-spec-bootstrap`, `trellis-start`, and `trellis-update-spec`.
   Optional task/domain Skills live in an explicitly approved Git catalog and only the
   approved relevant subset is copied into project-level `.agents/skills/`.
8. **Keep third parties opt-in.** Skills, plugins, and MCP/CLI candidates from
   `third-party-sources.json` are shown in four groups and default to no.
   Install only individually approved candidates from their recorded immutable
   source; never use `main`, `latest`, or `@latest`. Recommended candidates
   include Ponytail, Caveman, Context7, fast-context, and CodeGraph, but a
   recommendation never changes the default or replaces an explicit yes from
   the user.
   Before the final interactive approval, display the canonical third-party
   `planSha256`, approved package and command roots, subprocess configuration
   roots, and every bound command identity. Approval applies to those exact
   values. Non-interactive initialization that selects any third-party
   candidate must supply the displayed digest through
   `--third-party-plan-sha256`; the source-manifest digest alone is
   insufficient.
   Approved MCP packages are registered through the Harness-owned runtime
   launcher. On every start it rechecks the exact manifest digest, ownership,
   package lock/integrity, installed-tree fingerprint, and entrypoint before
   spawning without a shell.

## Guided Entry Points

Initialization has three explicit, independently resumable commands:

- `addons` is the global-only third-party re-entry point. Interactive mode
  displays all global candidates, labels recommendations without preselecting
  them, and defaults every choice and network decision to `no`.
  `addons --status` is read-only. `addons --plan-only` requires explicit
  `global-skills`, `global-plugins`, and `mcp-cli` selections (use `none` for
  an empty group) and emits the source/plan digests and exact effects without
  mutation. Non-interactive apply must repeat those groups, both reviewed
  digests, `--approved`, and separate third-party network approval when
  required. It rebuilds the plan before mutation and rejects drifted, blocked,
  boundary-forbidden, or dependency-incomplete selections. Project Skills
  remain under `project-init`.
- `global-init` installs the 13 bundled platform Skills as link-free owned
  copies under an explicit or current user home, records the `skip`/`local`/
  `clone` catalog decision, and performs read-only Codex, Gemini, and Grok
  CLI/authentication status checks. Claude Code installation and login remain
  documentation/manual-only; Global Init never probes or starts `claude`.
  A later explicitly authorized product-manager call is a separate runtime
  operation and does not grant initialization authority.
- `project-init` inspects one repository and derives its technology stack and
  catalog recommendations. Interactively it accepts a complete non-Skill
  `draft` contract, asks each catalog and third-party project candidate as an
  explicit `no`/`yes` choice, then after final approval atomically compiles the
  fixed source digest, selections, reasons, and exact managed paths into the
  same `approved` contract before calling the existing owned apply/install path.
  `security.strictDataBoundary` is an explicit contract boolean at that point;
  a CLI `--strict-data-boundary` may only add the restriction, never weaken a
  contract that already requires it.
  An already `approved` contract only permits confirmation and execution of its
  recorded set. Non-interactive Project Init accepts only an exact approved
  contract. It must leave that contract `approved` until the separately reported
  quality, security, doctor, and conflict gates pass.

When the host provides a native structured-choice control, the agent **must**
use that host tool for every unresolved choice, mark the recommendation, and
ask only one question per tool call. Do not emulate a native control in prose.
The executable itself is the terminal fallback: it presents one numbered TTY
choice at a time. In non-interactive mode it never reads stdin and requires
complete flags plus `--approved`. Every third-party choice remains explicit;
when any candidate is selected, non-interactive Global or Project Init also
requires the exact `--third-party-plan-sha256` from the reviewed plan.

Global Init never installs a provider CLI or starts a login implicitly.
`install` and `login` remain selectable preview choices: Global Init records
them as unexecuted pending actions with safe command or official-documentation
guidance, `requiresSeparateApproval: true`, and returns
`needs-provider-actions`. `provider-action-plan` then creates a read-only plan
bound to the exact pending state. `provider-action-run` requires that digest,
`--approved`, and a second TTY `cancel`/`show-guide` choice that defaults to cancel.
The plan also binds the canonical absolute executable/Node entrypoint,
package/version identity, and file hashes for review, but it never starts a
Provider CLI. Codex/Grok receive fixed auth-only guidance; Gemini has no
approved auth-only subcommand, so starting its full interactive agent is
forbidden. Every Provider installation and login is manual-only. Provider
output, URLs, device codes, accounts, and tokens are never recorded.
A later approved Global Init may advance `install` to `login` after a manual
installation, or resolve pending actions to `keep`/`later`, while platform and
catalog identity remain unchanged. Claude Code defaults to `skip`; selecting
its external install/login path records `zeroClaudeProfile: false` immediately
and never authorizes Harness to invoke Claude.

Example after Global Init reports a pending Codex login:

```powershell
node scripts/harness-init.mjs provider-action-plan `
  --home-dir "<explicit-user-home>" --repo-root "<project>" `
  --provider codex --action login
node scripts/harness-init.mjs provider-action-run `
  --home-dir "<explicit-user-home>" --repo-root "<project>" `
  --provider codex --action login `
  --plan-sha256 "<reviewed-plan-sha256>" --approved
```

`provider-action-plan` and `provider-action-run` require an explicit project
root so the reviewed guidance is bound to the intended project context.
`provider-action-run` refuses non-interactive execution.

Safe non-interactive public-baseline example:

```powershell
node scripts/harness-init.mjs global-init `
  --non-interactive `
  --home-dir "<explicit-user-home>" `
  --catalog-mode skip `
  --provider-actions "codex=later,gemini=later,grok=later,claude=skip" `
  --third-party-global-skills none `
  --third-party-global-plugins none `
  --third-party-mcp-cli none `
  --third-party-source-sha256 "<sha256-from-third-party-plan>" `
  --approved
```

Global add-on discovery and planning examples:

```powershell
node scripts/harness-init.mjs addons `
  --status `
  --home-dir "<explicit-user-home>" `
  --repo-root "<repository>"
node scripts/harness-init.mjs addons `
  --plan-only `
  --home-dir "<explicit-user-home>" `
  --repo-root "<repository>" `
  --third-party-global-skills none `
  --third-party-global-plugins none `
  --third-party-mcp-cli none
```

For an AI-driven install, follow the repository-root `AI_INSTALL.md` contract.
A repository URL authorizes inspection only; it is never implicit approval for
core writes, add-ons, network access, Provider login, or paid calls.

For an existing local Git catalog, add `--catalog-mode local --repository
"<catalog-working-tree>"`. For a separately approved clone, use
`--catalog-mode clone --repository "<new-local-working-tree>" --catalog-url
"<credential-free-url>" --allow-catalog-network`; the saved profile contains
only the canonical local working-tree path. Third-party acquisition uses the
separate `--allow-third-party-network` approval. In interactive mode it is
asked only after exact candidates are selected, lists their pinned sources and
manifest digest, defaults to `no`, and a refusal drops only those network
candidates while core initialization continues.

For non-interactive execution, the complete project contract and exact Skill
set must already be approved:

```powershell
node scripts/harness-init.mjs project-init `
  --non-interactive `
  --home-dir "<explicit-user-home>" `
  --repo-root "<repository>" `
  --contract "<approved-contract.json>" `
  --skills "<approved-comma-separated-names>" `
  --third-party-project-skills none `
  --third-party-source-sha256 "<sha256-from-third-party-plan>" `
  --approved
```

Use `--no-project-skills` instead of `--skills` when the approved catalog
decision is `skip` or no optional project Skill is selected. A successful
`project-init` returns `approved-awaiting-gates` and the exact follow-up
`mark-ready` command. Run that command only after every approved required gate
passes; do not treat Project Init itself as readiness evidence.

For a ready project, revise its approved copied Skills with
`revise-project-skills`. If the project already owns a different revision,
review the clean catalog commit and add `--replace-existing`; the transaction
verifies the old owned trees, stages every new tree, and restores the previous
copies if the revision fails.

## Phase 0: First-Run Skill Profile

Start every trigger with read-only `inspect`. Its `skillRepository` result
decides the branch:

- **First trigger (`configured: false`)** — after repository discovery, use an
  approved `grill-me` installation when present, otherwise ask one question at
  a time directly to refine the initialization Skill:
1. the absolute, explicitly approved Skill catalog path (not an active global
     `.agents/skills` or `.codex/skills` tree);
  2. the fixed 13-Skill global Harness platform baseline listed above;
  3. reusable selection guidance and explicit exclusions;
  4. confirmation that project Skills use approved copy snapshots rather than
     links.
- **Later trigger (`configured: true`)** — use the saved path. Do not ask for
  the Skill repository path again. If the saved path is unavailable or invalid,
  fail closed and ask only for a replacement path.

Before approval, `catalog-skills --repository "<path>"` is read-only. Include
the proposed profile in the final initialization summary. Only after explicit
approval may the profile be saved:

```powershell
node scripts/harness-init.mjs configure-skills `
  --repository "<absolute-skill-repository>" `
  --global-essential "harness-init,trellis-before-dev,trellis-brainstorm,trellis-break-loop,trellis-channel,trellis-check,trellis-continue,trellis-finish-work,trellis-meta,trellis-session-insight,trellis-spec-bootstrap,trellis-start,trellis-update-spec" `
  --guidance "<approved-selection-guidance>" `
  --exclude "<approved-exclusions>" `
  --approved
```

The saved user profile lives at
`~/.agents/harness/skill-repository.json`. Do not automatically delete or move
pre-existing global Skills outside an explicitly approved migration.

For a platform migration, first select an existing explicit Git catalog, choose
any approved project-Skill subset (or none), retain the read-only inventory
digest, and only then apply. The migration never creates, moves, or assumes a
fixed private catalog:

```powershell
node scripts/harness-init.mjs skill-migration-plan `
  --repo-root "<harness-repository>" `
  --repository "<absolute-skill-catalog>" `
  --skills "<approved-comma-separated-names>"
node scripts/harness-init.mjs skill-migration-apply `
  --repo-root "<harness-repository>" `
  --repository "<absolute-skill-catalog>" `
  --skills "<approved-comma-separated-names>" `
  --inventory-sha256 "<approved-inventory-sha256>" `
  --approved
```

Use `skill-migration-status` for read-only audit and
`skill-migration-rollback --backup-id <id> --approved` for exact,
ownership-checked restoration. Omit the Skill list when no optional project
Skills are approved. The explicit catalog is source-only and remains untouched
after rollback.

## Phase 1: Read-Only Discovery

Resolve the real repository root and classify the adoption mode:

- new or nearly empty project;
- existing codebase without Harness state;
- partially initialized Harness;
- existing Harness requiring repair or re-baselining.

When the repository contains this Harness executable, begin with its read-only
inspection command:

```powershell
node scripts/harness-init.mjs inspect --repo-root "<repository>"
node scripts/harness-init.mjs catalog-skills
```

An exported standalone Skill can run the same command through
`.agents/skills/harness-init/scripts/harness-init-core.mjs`. This inspection
must not create `.harness/` or modify any project file.

Inspect only relevant, non-secret evidence:

- `git status`, remotes, worktrees, tracked files, and ignore rules;
- `AGENTS.md` and other repository instruction files;
- language, runtime, package-manager, build, test, lint, and format manifests;
- architecture, package boundaries, migrations, deployment, and data stores;
- `.trellis/`, `.harness/`, `.agents/`, `.codex/`, hooks, and task/spec state;
- CI workflows, release/update scripts, provenance locks, and rollback support;
- environment-variable **names** and example files, never local secret values.

Read [references/constraint-checklist.md](references/constraint-checklist.md)
and cover every applicable category. Do not invent a constraint just to fill a
field; mark unsupported assumptions as unresolved decisions.

## Phase 2: Build the Decision Inventory

Present a compact inventory with four sections:

1. **Confirmed facts** — directly supported by repository evidence, with paths.
2. **Unresolved decisions** — product, scope, risk, compatibility, or operating
   choices that repository evidence cannot decide.
3. **Recommended defaults** — one recommendation per unresolved decision,
   grounded in the confirmed facts.
4. **Out of scope or deferred** — decisions that are safe to defer without
   changing the initial Harness behavior.

Use the discovered project facts, saved guidance, Skill descriptions, and
exclusions to recommend a small relevant project Skill set. Give one reason per
Skill. Do not install every catalog entry.

Do not write this inventory to the repository yet. Keep it in the conversation
until the approval gate is satisfied.

## Phase 3: Grill the Unresolved Decisions

Use an approved `grill-me` installation when available and walk the decision inventory in dependency order. Otherwise ask one
question at a time, beginning with the decision that would invalidate the most
downstream choices.

Typical order:

1. business outcome and project boundary;
2. repository, package, and architecture authority;
3. lifecycle, task, requirement, and spec authority;
4. supported platforms, runtimes, and toolchain;
5. recommended project Skill set and per-Skill rationale;
6. quality gates and definition of done;
7. security, data, secrets, network, and provider boundaries;
8. hook and global-configuration policy;
9. source provenance, dependency updates, rollback, and CI.

Present the recommended Skill set as one decision and obtain explicit approval
to add, remove, or accept it. Record the result in `skills.projectSelection`;
each selected Skill also requires its `.agents/skills/<name>` target in
`workflow.managedProjectPaths`.

After each answer, recompute the remaining inventory. Do not ask about a later
choice if the latest answer made it irrelevant. Do not batch questions into a
form, checklist, or numbered questionnaire.

If `grill-me` is not explicitly installed, follow the same protocol directly: one
high-leverage question, recommendation, rationale, and alternative trade-off
per turn.

## Phase 4: Final Constraint Review

When no blocking decision remains, present the complete proposed initialization
contract:

- goal and business value;
- confirmed repository facts;
- approved constraints and conventions;
- in-scope and out-of-scope Harness behavior;
- files and global locations that would change;
- fixed global platform baseline, saved Skill repository profile, and exact
  project-level Skill selection with reasons;
- third-party candidate effects, fixed source digest, explicit approvals, and
  any rejected candidates;
- the canonical third-party plan SHA-256, approved package/command roots,
  subprocess configuration roots, and exact bound command identities;
- exact initialization and offline validation commands;
- update, rollback, and uninstall expectations;
- residual risks and deliberately deferred items.

End with one approval question. Initialization may begin only after the user
explicitly approves this latest summary. If the proposal changes materially
after approval, repeat the review and obtain fresh approval.

## Phase 5: Approved Initialization

After approval:

1. Recheck Git state and repository instructions. Stop on unexpected drift.
2. Initialize or reconcile Trellis using the installed CLI's current help and
   supported commands. Do not guess CLI flags.
3. Create a `draft` contract candidate from
   [assets/project-contract.template.json](assets/project-contract.template.json).
   Fill the confirmed non-Skill facts, keep `unresolvedDecisions` empty, and do
   not include credentials. For interactive initialization, pass this draft to
   `project-init`: it shows technology discovery and recommendations, keeps every
   candidate unselected until an explicit yes, then atomically promotes the
   final candidate to `approved` with source digest, selection reasons, and
   exact managed paths. `security.strictDataBoundary` may be `null` in the
   draft template but must be a boolean before approval; strict contracts keep
   incompatible data-egress candidates unavailable. For non-interactive execution, set `status` to
   `approved`, fill `approval.approvedAt` and `approval.approvedBy`, validate
   it, then use the executable to apply it atomically:

   ```powershell
   node scripts/harness-init.mjs validate --contract "<approved-contract.json>"
   node scripts/harness-init.mjs apply --repo-root "<repository>" --contract "<approved-contract.json>"
   ```

   The apply command refuses draft contracts, credentials, unsafe authorities,
   non-inline dispatch, Claude enablement, collisions with user-owned
   `.harness/` state, and malformed or conflicting collaboration markers. It
   may incrementally adopt an existing safe `.harness/` directory only when
   every initializer-owned target is absent; unrelated entries remain
   user-owned, while a pre-existing owned policy snapshot or collaboration block must
   exactly match the approved distribution bytes. It
   uses an owned project lock, a pending journal, verified backups, read-only
   contract/schema preconditions, and final digest/identity/mode
   compare-and-swap checks. Schema JSON is canonicalized before installation
   and hashing so ownership remains stable across line-ending policies. An
   intact legacy Schema projection with matching ownership is transactionally
   migrated when only its JSON formatting differs. It creates
   `.harness/project.json`, its JSON Schema, an owned project policy snapshot at
   `.harness/policies/collaboration-policy.md`, and a schema-v2 ownership
   manifest, then projects the distribution
   [collaboration policy](assets/collaboration-policy.md) into one
   ownership-recorded `HARNESS-COLLABORATION` block in root `AGENTS.md`.
   Ownership is committed last. Existing Trellis, Harness, and user content
   outside that block is preserved.

   Treat every replacement or removal as a fail-closed transaction. Publish
   new state with create-only operations. For an existing owned target,
   atomically claim the exact object into the transaction area before
   validating or removing it; never validate one path and later delete or
   replace whatever happens to occupy that path. If a claim, publish, restore,
   or ownership write collides with concurrent or user-created state, preserve
   both the claimed object and the collision evidence for manual review, stop,
   and do not overwrite or recursively delete either side.

	   A later apply recovers a dead initializer deterministically: active
	   transaction or lock directories are atomically renamed to dedicated
	   cleanup tombstones before recursive removal, so partially deleted internal
	   metadata is never needed for recovery. An uncommitted journal restores
	   verified backups, while a committed journal is finalized only when every
	   installed target and read-only precondition still matches. Transaction
	   owners, journals, and commit markers carry authenticated provenance derived
	   from the user-scoped key at
	   `~/.harness-init/project-transaction.key`; residue without valid provenance
	   is preserved for manual review and must never be replayed against project
	   files. Owner records bind both PID and process-instance identity, so a
	   reused PID does not keep dead initializer state locked. PR #1 ownership
	   without block metadata migrates only when no collaboration marker exists.
   A lower policy version upgrades only when the current block and owned policy
   source still match their previous ownership digests. A newer version is
   never downgraded, and content changes at the current version require an
   explicit version bump. User edits always fail closed.

   Portable metadata protection covers the content digest, file identity,
   POSIX permission mode, change time, owner UID, and group GID exposed by
	   Node's filesystem APIs. ACLs, extended attributes, and Windows security
	   descriptors are outside this portable transaction guarantee; repositories
   that depend on them must verify and restore them with platform-specific
   tooling.
4. Re-read the saved catalog, ensure it still matches the approved selection,
   then install the exact project-level Skill copies:

   ```powershell
   node scripts/harness-init.mjs catalog-skills
   node scripts/harness-init.mjs install-skills `
     --repo-root "<repository>" `
     --skills "<approved-comma-separated-names>" `
     --approved
   ```

   The installer rejects global essentials, profile exclusions, unapproved
   names, source links, source drift, and user-owned target collisions. It
   records source and tree digests in `.harness/project-skills.json`. Reconcile
   other project instructions, hooks, ignores, and adapter files through
   managed blocks or ownership-aware copies. Do not mutate global configuration
   unless it was listed and explicitly approved.
5. Load `trellis-spec-bootstrap` to generate or refresh code-backed
   `.trellis/spec/` guidelines. Existing code is the evidence source; templates
   are not the specification.
6. Configure CCG as the intelligence and quality layer without creating a
   second task/plan authority. Trellis remains lifecycle authority unless the
   approved contract explicitly says otherwise.
7. Run only the approved offline install, doctor, conflict, source, and quality
   checks. A failed required gate leaves the contract in `approved` status.
8. Change the contract status to `ready` only after all required gates pass:

   ```powershell
   node scripts/harness-init.mjs mark-ready --repo-root "<repository>"
   ```

   `mark-ready` verifies schema-v2 or schema-v3 ownership, contract, schema, owned
   policy, and managed `AGENTS.md` block, then atomically updates only the
   contract status and ownership digest. Record gate commands in the contract,
   not transient logs or secrets.

For this repository, prefer the supported root commands when present:

```powershell
pnpm bootstrap
pnpm doctor
pnpm harness:conflicts
pnpm harness:test
```

For another repository, inspect its manifests and use its declared commands
instead of copying these blindly.

## Handoff

Report:

- the final constraints and authorities;
- every file created or changed;
- the distribution policy source, owned project snapshot, and derived
  `AGENTS.md` block;
- validation commands and outcomes;
- anything intentionally left in `draft`;
- remaining operator actions, including any separately approved global install
  or provider login.

Do not claim initialization is complete while a required doctor, conflict,
source, or quality gate is failing.
