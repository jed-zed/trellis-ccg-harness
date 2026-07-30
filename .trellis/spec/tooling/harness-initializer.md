# Harness Initializer Contract

## 1. Scope / Trigger

This contract applies when changing project-contract validation, first-time
installation into `.harness/`, ready-project Skill revision, managed
`AGENTS.md` projection, ownership metadata, transaction recovery, the
`approved` to `ready` transition, or the approval-gated global addon discovery
and installation workflow.

The implementation is
`.agents/skills/harness-init/scripts/harness-init-core.mjs`; the root
`scripts/harness-init.mjs` file is only the CLI entry point.

## 2. Signatures

Supported commands:

```text
node scripts/harness-init.mjs apply --contract <json-path> --repo-root <path>
node scripts/harness-init.mjs mark-ready --repo-root <path>
node scripts/harness-init.mjs revise-project-skills --repo-root <path> \
  --home-dir <profile-home> --skills <names> [--replace-existing] --approved
node scripts/harness-init.mjs addons --status --home-dir <path> --repo-root <path>
node scripts/harness-init.mjs addons --plan-only \
  --third-party-global-skills <ids-or-none> \
  --third-party-global-plugins <ids-or-none> \
  --third-party-mcp-cli <ids-or-none> \
  --home-dir <path> \
  --repo-root <path>
node scripts/harness-init.mjs addons --non-interactive \
  --third-party-global-skills <ids-or-none> \
  --third-party-global-plugins <ids-or-none> \
  --third-party-mcp-cli <ids-or-none> \
  --third-party-source-sha256 <sha256> \
  --third-party-plan-sha256 <sha256> \
  --allow-third-party-network \
  --approved \
  --home-dir <path> \
  --repo-root <path>
```

Core readiness API:

```javascript
markProjectReady({
  repoRoot,
  faultInjector?,
  isProcessAlive?,
  readProcessIdentity?,
  provenanceKeyPath?,
})
```

`repoRoot` is required. Optional arguments exist for deterministic transaction
and recovery tests; ordinary callers use only `repoRoot`.

## 3. Contracts

- `apply` accepts only an approved, secret-free contract and writes canonical
  JSON to `.harness/project.json`.
- First-time apply may reuse an existing safe `.harness/` directory only when
  `.harness/project.json`, `.harness/project.schema.json`, and
  `.harness/ownership.json` are all absent.
- Existing unrelated entries, including `.harness/adapter.json`, remain
  user-owned and byte-preserved.
- An existing owned collaboration-policy snapshot or managed `AGENTS.md` block is
  adopted only when it exactly matches the distribution policy projection.
- `.harness/ownership.json` schema v2 binds the exact contract, schema, owned
  policy, and rendered block digests.
- Project Schema JSON is parsed and serialized canonically with LF before
  installation and hashing; source-checkout line endings never enter ownership.
- Historical schema projections that differ only by JSON formatting are
  transactionally canonicalized when their recorded ownership still matches
  the actual installed bytes.
- Repository attributes pin every exact-byte-owned projection to LF so a Git
  checkout cannot create ownership drift.
- Readiness also binds the installed Schema and collaboration projection to the
  current `harness-init` Skill assets. Updating ownership alongside altered
  installed bytes does not make coordinated drift valid.
- `mark-ready` accepts only `status: approved` or an intact `status: ready`.
  Successful promotion changes only the contract status and corresponding
  ownership digest.
- `revise-project-skills` accepts only a ready, ownership-valid project and a
  clean, immutable Git catalog identity from the saved Skill profile.
- The revision's global essentials must exactly match the saved 13-Skill
  profile. `grill-me` remains an externally owned optional Skill and must not
  enter the project contract's global-essential baseline.
- Replacing an already owned Project Skill requires `--replace-existing`.
  The transaction verifies and claims the old owned tree, stages the complete
  new tree, and atomically updates the copied Skill, project contract, Project
  Skill manifest, and ownership digests. A failure restores the previous
  complete projection.
- The contract, schema, policy, block, and ownership files are transaction
  inputs. The ready contract and ownership manifest are atomic transaction
  targets.
- Provider credentials have no initializer fields or environment contract.
  Secret-looking contract keys or values are rejected before mutation.
- `addons --status` is a read-only inventory of the nine global candidates in
  the pinned third-party manifest. It never accepts selections, approvals, or
  network authorization.
- Interactive `addons` lists every candidate and defaults every selection,
  network prompt, and final approval to skip or cancel.
- Non-interactive addon planning requires all three selection groups, including
  explicit empty groups, and returns the exact source-manifest and plan
  digests without mutation.
- Non-interactive addon apply requires those two exact digests plus explicit
  final approval. Network candidates additionally require
  `--allow-third-party-network`.
- Addon apply rebuilds and compares the approved plan immediately before the
  first mutation. Source or plan drift fails closed.
- Candidate dependencies may be satisfied only by an exact installed candidate
  bound into the current plan or by a dependency that remains approved after
  policy and dependency resolution in the same transaction. A selected but
  blocked dependency never satisfies its dependents.
- Drifted or unowned targets are reported but are never selectable or
  overwritten by the addon workflow.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| All three initializer-owned targets are absent | First-time installation may proceed |
| Only some initializer-owned targets exist | Refuse as incomplete user-owned state |
| Existing policy or managed block differs | Refuse collision without mutation |
| Contract status is neither `approved` nor intact `ready` | Refuse readiness promotion |
| Contract bytes differ from the ownership digest | Refuse drift, including formatting-only drift |
| Schema, policy, block, or ownership differs | Refuse drift without mutation |
| Schema or policy plus ownership are changed together | Refuse because Skill asset bytes remain authoritative |
| Source Schema uses CRLF or another formatting layout | Install and hash canonical JSON/LF bytes |
| Legacy Schema formatting is noncanonical but semantically exact and ownership matches its bytes | Canonicalize Schema and ownership transactionally |
| Failure after either ready target is installed | Restore both original files and clean transaction residue |
| Intact contract is already `ready` | Return `status: unchanged` without writing |
| Ready-project Skill source is a dirty checkout or has a credential-bearing remote | Refuse before mutation |
| Existing Project Skill differs from its ownership record | Refuse replacement and preserve all bytes |
| Replacement is requested without `--replace-existing` | Refuse without mutation |
| Replacement fails after any target is claimed or published | Restore the previous Skill, contract, manifest, and ownership |
| `addons --status` receives a selection or approval flag | Refuse as a mixed read/write request |
| Non-interactive addon planning omits a selection group | Refuse the ambiguous selection set |
| Non-interactive addon apply omits either digest or final approval | Refuse before mutation |
| A selected addon requires network and network approval is absent | Refuse before mutation |
| Approved source or plan changes before apply | Refuse the stale approval before mutation |
| An addon target is drifted or unowned | Report it as non-selectable and preserve its bytes |

Errors propagate to `scripts/harness-init.mjs`, which writes one
`Harness Init failed: <message>` line to stderr and exits non-zero.

## 5. Good / Base / Bad Cases

- Good: `.harness/adapter.json` exists, all initializer-owned targets are
  absent, and an exact owned policy/block snapshot already exists. Apply preserves the
  existing bytes and installs only the missing owned contract files.
- Base: `.harness/` and `AGENTS.md` do not exist. Apply creates the complete
  owned projection transactionally.
- Bad: `.harness/project.json` exists without matching schema and ownership.
  Apply refuses the partial installation.
- Bad: an approved contract gains a trailing newline after apply.
  `mark-ready` refuses because ownership binds exact bytes, not parsed JSON
  equivalence.
- Good: an AI first calls `addons --status`, requests a complete `--plan-only`
  result with all three groups, presents the effects, and applies the unchanged
  plan only after explicit user approval.
- Base: interactive `addons` receives only Enter responses. Every candidate is
  skipped and the command exits without mutation.
- Bad: an AI reuses an older addon digest after the manifest or installed state
  changes. Apply refuses the stale plan.

## 6. Tests Required

`tests/harness-init-cli.test.mjs` must assert:

- adoption preserves every pre-existing unrelated byte;
- Schema installation is byte-identical for LF and CRLF source assets;
- an intact legacy noncanonical Schema and ownership pair migrates to canonical
  bytes, while content drift remains rejected;
- Git attributes pin every exact-byte-owned projection to LF;
- collisions at initializer-owned targets still fail closed;
- CLI and core API promotion update the status and ownership digest together;
- repeat promotion returns `unchanged`;
- contract, schema, policy, block, and ownership drift leave all files intact;
- coordinated policy/ownership and schema/ownership drift still fail closed;
- a fault after the first ready target rolls both targets back and leaves no
  transaction residue.
- ready-project Skill revision preserves the 13-core global baseline, binds a
  clean credential-free catalog commit, requires `--replace-existing` for an
  owned revision, and rolls back the whole projection on failure.

`tests/harness-third-party-cli.test.mjs` must assert:

- status is global-only, read-only, and reports all nine candidates;
- planning requires explicit global selection groups and does not mutate;
- interactive Enter defaults skip every candidate and cancel final approval;
- Ponytail dependencies may be selected in one transaction but cannot bypass
  missing, policy-blocked, drifted, or unowned prerequisites;
- strict-boundary and network approval rules fail before mutation;
- stale source or plan digests and a final pre-apply plan change fail closed.

`tests/install-script.test.mjs` must assert that successful default setup keeps
third-party installation optional and prints the `pnpm addons` re-entry path
when recommended addons remain pending.

Run `node --test tests/harness-init-cli.test.mjs` before the full
`pnpm harness:test` gate.

## 7. Wrong vs Correct

Wrong:

```javascript
contract.status = "ready";
await writeFile(projectPath, JSON.stringify(contract));
```

This bypasses ownership, exact-byte drift checks, rollback, and concurrent
file identity checks.

Correct:

```javascript
await markProjectReady({ repoRoot });
```

The shared transaction engine validates all owned inputs, atomically updates
the two targets, and preserves the approved state on failure.
