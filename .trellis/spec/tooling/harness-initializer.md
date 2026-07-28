# Harness Initializer Contract

## 1. Scope / Trigger

This contract applies when changing project-contract validation, first-time
installation into `.harness/`, managed `AGENTS.md` projection, ownership
metadata, transaction recovery, or the `approved` to `ready` transition.

The implementation is
`.agents/skills/harness-init/scripts/harness-init-core.mjs`; the root
`scripts/harness-init.mjs` file is only the CLI entry point.

## 2. Signatures

Supported commands:

```text
node scripts/harness-init.mjs apply --contract <json-path> --repo-root <path>
node scripts/harness-init.mjs mark-ready --repo-root <path>
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
- The contract, schema, policy, block, and ownership files are transaction
  inputs. The ready contract and ownership manifest are atomic transaction
  targets.
- Provider credentials have no initializer fields or environment contract.
  Secret-looking contract keys or values are rejected before mutation.

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
