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

All 13 built-in bundled Harness platform Skills are required global defaults. Removing
or moving other pre-existing global Skills is deliberately outside
initialization and requires a separate ownership-aware migration.

Third-party Skills, plugins, and MCP/CLI actions are outside this baseline.
Their fixed source identity, effects, and user-approved selections are tracked
separately. Ponytail, Caveman, fast-context, and CodeGraph are recommended
candidates, but no third-party candidate is selected by default and no
recommendation is installation approval.

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
- Child processes receive an environment with credential-like and Claude
  variables removed.
- Commands are executed with argument arrays and `shell: false`.
- User-profile parent directories and catalog/project Skill trees reject
  symbolic links and reparse points; project copies are bounded by depth, file
  count, individual file size, and total size.
- Skill profile and project manifests contain canonical paths or digests, never
  provider credentials, and are written only after explicit approval.
- Provider response content is not persisted; the probe emits capability
  counts and status only.
- Bootstrap and lifecycle operations record exactly which global npm state they
  own, restore it on failure, and refuse to overwrite later user changes.

Accepted limitation: an operator can intentionally point the manual probe at an
internal HTTPS service. This is equivalent to running a local HTTP client and
is not exposed to untrusted task input.

## Known Limitations

- User-level Trellis hook precedence depends on the local fallback containing
  the marker declared by the adapter contract; doctor reports drift if a
  future global Trellis update removes that guard.
- The activated local CCG CLI and any Harness-managed global link are blocking
  doctor/update checks.
- Search capability is true only when the response contains both a web-search
  tool call and citation/annotation evidence.
- GPT Pro remains owned by the existing CCG bridge and is not reimplemented by
  the Harness adapter.

## Change History

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
