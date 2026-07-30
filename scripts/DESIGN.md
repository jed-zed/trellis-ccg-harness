# Harness Scripts Design

## Design Goals

- Preserve Trellis as the only lifecycle and plan authority.
- Preserve the exact personal CCG Git tree while using the installed matching
  CLI/plugin as the runtime.
- Make blocking drift deterministic and testable offline.
- Keep model credentials and mutable evidence outside Git and task artifacts.
- Work on Windows, macOS, and Linux without shell interpolation.

## Selected Design

The Node adapter is split into six built-in-only concerns:

1. Redaction and credential-free subprocess environments.
2. Shell-free process execution and path/digest helpers.
3. Read-only canonical Trellis context resolution.
4. Static source, state, dispatch, and model-policy conflict checks.
5. User-runtime and installed CCG checks.
6. An explicit OpenAI-compatible provider probe with bounded HTTP requests.

The CLI is a thin presentation layer. Tests import the same functions and
inject command and Fetch implementations, so CI never requires paid providers.

Lifecycle mutation is a separate transaction boundary:

1. acquire an exclusive Harness lock;
2. persist a phase journal before creating transaction snapshots/staging or
   performing the first mutating rename/file copy;
3. verify either the personal CCG commit/tree or exact Trellis version/integrity;
4. reject any sparse source exclusions, then materialize the complete candidate
   directly from Git blobs and bind every path, type, blob SHA and executable
   mode before mutation;
5. reject ignored live CCG component state, then run source-specific and root
   Harness gates;
6. snapshot the current component or exact Trellis-managed files;
7. apply the candidate, update the source manifest, then rerun frozen install,
   CCG/Go gates, tracked-tree validation, local CLI and any Harness-owned global
   CLI smoke from the final component path;
8. commit the transaction record only after success, otherwise restore the
   snapshot automatically;
9. remove the rollback snapshot superseded by the newly committed transaction.

Rollback restores only a Harness-created snapshot and only while the current
component or managed-file fingerprints still match what Harness installed.
Post-update tracked, staged, untracked, ignored, or renamed content makes the
operation fail before mutation. If the process dies outside
normal exception handling, doctor blocks on the journal/lock and
`harness:recover` either finishes committed cleanup or deterministically
restores the pre-transaction state. Uninstall changes global state only when
its strict ownership record and filesystem fingerprint still match; the
ordinary-package fingerprint includes the complete content tree. First-time
adoption of a pre-existing ordinary Trellis global package is refused because a
version-only reinstall cannot restore local patches exactly. Link baselines are
restored by exact source path. User edits are preserved and reported for manual
handling.

Project Skill provisioning is a separate approval and ownership boundary:

1. the first initialization refines and saves a user-level repository profile
   at `~/.agents/harness/skill-repository.json`;
2. later initializations reuse the canonical saved path unless it is no longer
   a directory;
3. read-only catalog discovery validates bounded `SKILL.md` frontmatter,
   rejects duplicate names and links, and never executes repository content;
4. the approved project contract binds each selected name and reason to an
   owned `.agents/skills/<name>` target;
5. installation copies a bounded, link-free snapshot and records profile,
   source, and copied-tree digests in `.harness/project-skills.json`.

Standalone `harness-init` export applies the same real-directory-chain checks to
`.agents/skills`, stages a bounded link-free tree, verifies the staged identity,
and rechecks the target before rename. Project-contract idempotence requires an
exact ownership schema plus matching contract and schema digests.

All 14 built-in bundled Harness platform Skills are required global defaults. Removing
or moving other pre-existing global Skills is deliberately outside
initialization and requires a separate ownership-aware migration.

Third-party Skills, plugins, and MCP/CLI actions are outside this baseline.
Their fixed source identity, effects, and user-approved selections are tracked
separately. Ponytail, Caveman, Context7, fast-context, and CodeGraph are
recommended candidates, but no third-party candidate is selected by default
and no recommendation is installation approval.
The canonical approval evidence also binds the complete execution plan:
`planSha256`, approved package and command roots, subprocess configuration
roots, and every resolved command identity. The final interactive confirmation
renders those values. Non-interactive Global or Project Init with any selected
third-party candidate must provide the exact reviewed
`--third-party-plan-sha256`; a source-manifest digest alone cannot authorize
execution.
Approved MCP packages are never registered as direct third-party entrypoints.
Codex invokes the Harness-owned launcher, which revalidates the approval
manifest, ownership, package lock, full installed-tree fingerprint, and exact
entrypoint before every local process start.

`addons` is a thin orchestration surface over the same canonical plan,
approval ledger, source resolver, global Skill transaction, and global action
transaction. It does not own a second installer or approval store:

```text
addons --status
  -> build canonical plan
  -> project global candidate states/effects
  -> JSON only, no mutation

addons --plan-only + explicit groups
  -> build canonical plan
  -> resolve exact selections/dependencies/network effects
  -> JSON only, no mutation

addons --non-interactive + exact groups/digests/approval
  -> rebuild and compare canonical plan
  -> fail closed on blocked/drifted/dependency/boundary changes
  -> existing approval + apply transactions
```

Interactive `addons` uses the same candidate explanation as Global Init,
labels recommendation separately from selection, and makes `no` the Enter
default. Global Setup performs a final read-only status call and prints the
`pnpm addons` re-entry command when recommended candidates remain unresolved;
failure to render that optional summary does not turn a successful core setup
into a failure.

Third-party filesystem mutation follows an additional fail-closed CAS rule.
New destinations are published create-only. Existing owned objects are first
atomically claimed into the transaction area, then the claimed object itself is
validated and used for rollback/removal. A claim, publish, restore, or
ownership collision preserves both the claimed state and the conflicting state
with diagnostics for manual review; cleanup must not recursively delete an
unclaimed path merely because an earlier observation matched.

## Alternatives Considered

- **Directly execute CCG source helpers:** rejected because the component is a
  provenance snapshot and source-package behavior can differ from the installed
  plugin runtime.
- **Merge Trellis and CCG task stores:** rejected because it creates dual-write
  lifecycle state and ambiguous recovery.
- **Use shell commands for Windows shims:** rejected because shell
  interpolation broadens the command-injection boundary. The adapter invokes
  the installed CCG Node entry point directly on Windows.
- **Require Grok for every task:** deferred because no working provider is
  configured. Grok remains optional and fail-closed when explicitly probed.

## Security Boundary and Threat Model

- Provider URLs and credentials are trusted operator configuration, not remote
  user input.
- Provider base URLs require HTTPS, except explicit localhost test endpoints.
- URL user information and HTTP redirects are rejected to prevent credential
  forwarding.
- Authorization values are never emitted; response errors are bounded and
  redacted with both structural and exact-secret rules.
- Child processes receive an explicit minimal environment derived from the
  approval plan's home/configuration roots. Injection surfaces such as
  `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `DYLD_*`, ambient `GIT_*`, and
  unrelated variables are removed; Git receives additional no-prompt and
  no-global/system-config controls.
- Executable helpers use canonical absolute command bindings whose file and,
  for Node launchers, package-tree identities are revalidated before use.
- Commands are executed with argument arrays and `shell: false`.
- The Windows installed-CCG version probe still executes the packaged CLI.
  It first uses the system Windows PowerShell executable as a no-profile bridge
  to the exact trusted Node executable and installed CCG entrypoint, with an
  exact `cmd.exe` bridge retained as a compatibility path. This avoids the
  hosted-runner nested Node launch failure without trusting package metadata as
  runtime evidence or interpolating task-controlled input.
- `doctor.ps1` executes the installed `ccg --version` command natively before
  invoking the adapter. Its adapter call skips only the duplicate nested
  runtime probe, avoiding hosted-runner nested Node capture failures while
  keeping the ordinary adapter command and the doctor runtime gate fail-closed.
- Global Init records provider install/login intent but never executes it.
  Every Provider installation and login is documentation/manual-only; Harness
  never probes or starts `claude`. A later provider guidance request needs an
  exact state-bound plan digest, `--approved`, and a second default-cancel TTY
  confirmation. The plan may bind a canonical absolute executable/Node
  entrypoint, package/version identity, and file hashes for review, but Harness
  never starts the Provider CLI or writes an action receipt. This avoids the
  unattested dependency-tree and verify-to-spawn interval.
- User-profile parent directories and catalog/project Skill trees reject
  symbolic links and reparse points; project copies are bounded by depth, file
  count, individual file size, and total size.
- Skill profile and project manifests contain canonical paths or digests, never
  provider credentials, and are written only after explicit approval.
- Provider response content is not persisted; the probe emits capability
  counts and status only.
- Bootstrap and lifecycle operations record exactly which global npm state they
  own, restore it on failure, and refuse to overwrite later user changes.
- Installing CodeGraph never creates or refreshes a `.codegraph` index.
- Harness initialization never invokes Claude and Harness never creates,
  restores, mutates, or deletes user-level or project `.claude` content.
  A separately authorized product-manager review may invoke the trusted native
  Claude CLI in safe, no-tool, non-persistent mode without workspace writes.

Accepted limitation: an operator can intentionally point the manual probe at an
internal HTTPS service. This is equivalent to running a local HTTP client and
is not exposed to untrusted task input.

## Known Limitations

- User-level Trellis hook precedence depends on the local fallback containing
  the marker declared by the adapter contract; doctor reports drift if a
  future global Trellis update removes that guard.
- The activated local CCG CLI and its Harness-managed packaged global
  installation are blocking doctor/update checks and must not junction back
  into the mutable snapshot.
- Search capability is true only when the response contains both a web-search
  tool call and citation/annotation evidence.
- GPT Pro remains owned by the existing CCG bridge and is not reimplemented by
  the Harness adapter.

## Change History

### 2026-07-28 - Cross-platform conflict resolution

**Change:** Restored cross-platform lock-claim cleanup retries, canonicalized
Windows test paths before comparison, made the installed-CCG runtime probe
asynchronous with exact Windows PowerShell and command bridges, and separated
deterministic CI from user runtime inspection.

**Reason:** The product-manager branch merge exposed Linux transient-directory
cleanup drift, Windows 8.3 versus long-path aliases, and a pre-existing hosted
runner `ERROR_BROKEN_PIPE` that had previously been warning-only.

**Impact:** Harness approval locks, plugin/command resolver tests, adapter
subprocess capture, doctor, and cross-platform CI.

**Security boundary:** The Windows bridge uses `shell: false` to start the
native command processor with a fixed `--version` command. Both the Node
executable and installed CCG entrypoint must be absolute and free of command
expansion characters; no project, task, or Provider value is interpolated.

### 2026-07-25 - Secondary adversarial review closure

**Change:** Added pre-side-effect replacement journaling, live-only crash
recovery, sparse/ignored-state fail-closed gates, rollback snapshot rotation,
full ordinary-package identities, first-adoption refusal, shared Windows
`py -3` resolution, strict contract ownership verification, and safe Skill
export directory traversal.

**Reason:** PR #1 secondary review found unrecoverable early kill windows,
silent sparse/ignored-state loss, inexact global-package rollback, junction
write escape, snapshot accumulation, resolver drift, and weak idempotence.

**Impact:** Harness lifecycle, rollback/recovery, bootstrap ownership,
initialization/export, adapter context, documentation, and offline regression
tests.

### 2026-07-25 - Reusable project Skill provisioning

**Change:** Added first-run user Skill-repository profiles, minimal global
essentials, approved project selection, bounded copy snapshots, and an owned
project Skill manifest.

**Reason:** Reusable domain/task Skills belong in a user-selected catalog, while
each project should receive only the small approved subset relevant to its
constraints.

**Impact:** Harness initialization contract, user profile storage, project
`.agents/skills/`, documentation, threat model, and offline regression tests.

### 2026-07-23 - Layered adapter

**Change:** Added canonical context, deterministic conflict auditing, provider
separation, offline tests, and doctor/CI integration.

**Reason:** Trellis and CCG need explicit ownership and runtime boundaries
without replacing the user's personal CCG implementation.

**Impact:** Root Harness scripts, documentation, doctor, CI, and model policy.
