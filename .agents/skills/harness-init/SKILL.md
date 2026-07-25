---
name: harness-init
description: "Use when starting a new project, adopting an existing repository into the Trellis plus CCG Harness, repairing missing Harness state, or selecting project-specific Skills from a reusable Skill repository."
---

# Harness Init

Establish the project's Harness contract before development begins. Discover
repository facts first, use `grill-me` for the decisions only the user can make,
then initialize Trellis and CCG after the user explicitly approves the complete
constraint summary. On the first trigger, also refine and persist the user's
Skill profile; later projects reuse that saved path and policy.

## Non-Negotiable Gates

1. **Read before asking.** Inspect the repository, existing instructions,
   manifests, specs, hooks, CI, and Git state before asking anything. If a fact
   is answerable from the repository, answer it through inspection instead of
   asking the user.
2. **One question at a time.** Load and use the `grill-me` Skill when it is
   available. Ask exactly one unresolved decision per turn. Each question must
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
7. **Keep global Skills minimal.** The default global essentials are
   `harness-init` and `grill-me`. Put task- or domain-specific Skills in the
   user-selected Skill repository and copy only the approved relevant subset
   into the project-level `.agents/skills/`.

## Phase 0: First-Run Skill Profile

Start every trigger with read-only `inspect`. Its `skillRepository` result
decides the branch:

- **First trigger (`configured: false`)** — after repository discovery, use
  `grill-me` one question at a time to refine the initialization Skill:
  1. the absolute, dedicated Skill repository path (not an active global
     `.agents/skills` or `.codex/skills` tree);
  2. the minimal global essential set (recommend `harness-init` and
     `grill-me`);
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
  --global-essential "harness-init,grill-me" `
  --guidance "<approved-selection-guidance>" `
  --exclude "<approved-exclusions>" `
  --approved
```

The saved user profile lives at
`~/.agents/harness/skill-repository.json`. Do not automatically delete or move
pre-existing global Skills; global cleanup is a separate ownership-aware,
explicitly approved migration.

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

Use `grill-me` and walk the decision inventory in dependency order. Ask one
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

If `grill-me` is unavailable, follow the same protocol directly: one
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
- minimal global essentials, saved Skill repository profile, and exact
  project-level Skill selection with reasons;
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
3. Create an approved contract candidate from
   [assets/project-contract.template.json](assets/project-contract.template.json).
   Replace draft values with approved facts, set `status` to `approved`, fill
   `approval.approvedAt` and `approval.approvedBy`, keep
   `unresolvedDecisions` empty, and do not include credentials. Validate it,
   then use the executable to apply it atomically:

   ```powershell
   node scripts/harness-init.mjs validate --contract "<approved-contract.json>"
   node scripts/harness-init.mjs apply --repo-root "<repository>" --contract "<approved-contract.json>"
   ```

   The apply command refuses draft contracts, credentials, unsafe authorities,
   non-inline dispatch, Claude enablement, and collisions with user-owned
   `.harness/` state. It creates `.harness/project.json`, its JSON Schema, and
   an ownership manifest only after approval.
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
   managed blocks or ownership-aware copies.
5. Load `trellis-spec-bootstrap` to generate or refresh code-backed
   `.trellis/spec/` guidelines. Existing code is the evidence source; templates
   are not the specification.
6. Configure CCG as the intelligence and quality layer without creating a
   second task/plan authority. Trellis remains lifecycle authority unless the
   approved contract explicitly says otherwise.
7. Run only the approved offline install, doctor, conflict, source, and quality
   checks. A failed required gate leaves the contract in `approved` status.
8. Change the contract status to `ready` only after all required gates pass and
   record the gate commands, not transient logs or secrets.

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
- validation commands and outcomes;
- anything intentionally left in `draft`;
- remaining operator actions, including any separately approved global install
  or provider login.

Do not claim initialization is complete while a required doctor, conflict,
source, or quality gate is failing.
