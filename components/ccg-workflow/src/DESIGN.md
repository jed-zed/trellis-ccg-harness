# CCG CLI Security Design

## Scope

This document records the personal distribution boundaries implemented by the
TypeScript CLI. Detailed module and command indexes remain in
[`CLAUDE.md`](CLAUDE.md).

## Threat Model

The installer and doctor cross several trust boundaries:

- downloaded wrapper binaries and executable package sources;
- user-owned global Claude, Codex, and Gemini configuration;
- MCP credentials and child-process arguments;
- local diagnostic child processes and their output;
- the public upstream and npm registry versus the authoritative personal fork.

The design defends against executing unverified bytes, mutable dependency
replacement, credential exposure through argv/config/logs, destructive global
file replacement, malformed-config data loss, process leaks, linked-path
escape, process-crash partial state, and accidental replacement of the personal
distribution with public upstream.

## Security Decisions

### Executable provenance

- `codeagent-wrapper` is downloaded only from the personal
  `jed-zed/ccg-gptpro-worflow` release.
- A platform-specific SHA-256 must match before chmod or process creation.
- The reported wrapper version is checked only after the digest succeeds.
- Executable npm and Git dependencies are exact-version or exact-commit entries
  in `third-party-sources.json`; mutable selectors and automatic elevation are
  rejected.
- The built-in public npm updater is disabled. Harness update requires a full
  personal commit and a matching tree.
- Wrapper platform, download, digest, or version failure is fatal. Initialization
  stops and returns failure until the pinned binary verifies.

### Global ownership

- Codex mode owns one marked AGENTS block, one structured hook group, and files
  listed in `~/.codex/.ccg/ownership.json`.
- Existing collisions are backed up. Uninstall removes/restores an asset only
  when its installed digest still matches; user edits are preserved.
- Ownership and transaction records use strict, versioned schemas with
  allowlisted derived paths and verified SHA-256 snapshots.
- Every existing managed path component must be a regular directory or file;
  symbolic links, Windows junctions, and reparse traversal fail closed.
- Install and uninstall create a durable journal before the first user-state
  mutation. An interrupted operation blocks later lifecycle work until
  `ccg codex-mode recover` restores all original bytes.
- JSON and Hook configuration is parsed before mutation and written atomically.
  Malformed or ambiguous state fails closed.

### Credentials and diagnostics

- MCP credentials are stored in owner-only secret specs. Public MCP config
  contains only the local launcher path and secret-spec path, never the secret.
- MCP children receive only a minimal platform environment and the variables
  explicitly approved for that server; unrelated parent credentials are not
  inherited.
- The installed launcher revalidates owner-only Windows ACL evidence for the
  secret directory and selected spec immediately before reading the spec.
- Launcher shutdown targets the complete MCP process tree: a detached process
  group on Unix and `taskkill /T /F` on Windows.
- Claude, Codex, and Gemini MCP entries are tracked independently. Unowned
  same-name collisions are refused unless the interactive user explicitly
  adopts them; the first original entry is restored on uninstall.
- Credential-bearing MCP definitions are not mirrored across runtimes.
- `diagnose-mcp --smoke` is opt-in, stdio-only, protocol/time/output bounded,
  redacts exact and structural secrets, and terminates the full process tree.
  Static configuration failure skips the active smoke and returns nonzero.
- Python hooks use a version-checked cross-platform resolver and argv arrays.

## Trellis Boundary

The global CCG Codex hook searches for `.trellis` before `.ccg` or `.git`.
Inside a Trellis project it delegates to the project hook using the active
Python interpreter and forwards the original payload/output. Missing delegation
fails closed to Trellis-only guidance and never creates `.ccg/tasks`.

## Role Routing Boundary

- CCG persists exactly three configurable top-level roles: `frontend`,
  `backend`, and `search`.
- Analysis, planning, implementation drafting, and review are phases performed
  inside the applicable top-level roles, not separate provider routes.
- Each role resolves to one of the providers already registered by
  `codeagent-wrapper`: Codex, Gemini, Claude, Antigravity, or Grok.
- Changing one role preserves the other two. Codex remains the orchestrator,
  sole real-workspace writer, and final verification owner.
- Explicit provider commands and GPT Pro manual bridges do not rewrite saved
  role defaults. This feature adds no generic command backend, task permission
  store, daemon, database, or second configuration root.

## Known Risks

- Trusted digest rotation is a reviewed source change and must accompany a
  release asset built from the intended personal commit.
- Windows owner-only guarantees rely on verified ACL application in addition to
  path confinement; POSIX modes alone are not meaningful on Windows.
- An explicit MCP smoke starts configured local commands and may have provider
  side effects. It is therefore never part of default diagnosis.
- A crash after the transaction commit point can leave inert private snapshot
  residue. The live configuration is committed and the residue contains no new
  authority; later cleanup may remove it without rollback.
- Low-severity scanner findings for CLI `console.log` calls are intentional
  user-facing output, not debug logging.
- High-severity scanner matches on synthetic credential strings under
  `__tests__` are redaction fixtures, not production credentials. Production
  scans exclude test fixtures and must have zero Critical/High findings.

## Change History

### 2026-07-27 - Three-role provider routing

**Change:** Replaced fixed provider responsibilities with independently
configurable frontend, backend, and search roles while keeping analysis,
planning, and review inside those roles.

**Reason:** Switching the provider responsible for one domain should be an
installer/config operation, not a cross-cutting source edit.

**Impact:** Routing types and config commands, installer templates, Codex
workflow Skills, compatibility tests, and user documentation. The Go wrapper
execution boundary is unchanged.

### 2026-07-25 - MCP launch-time boundary verification

**Change:** Closed the Windows ACL check/use gap and added complete child-tree
termination to the deployed secret launcher.

**Reason:** Secondary adversarial review showed that install-time ACL checks and
direct-child signals did not cover later permission drift or grandchildren.

**Impact:** MCP secret launch, signal handling, Windows ACL regression tests,
and template security documentation.

### 2026-07-25 - Transaction, ownership, and environment closure

**Change:** Added strict per-target MCP ownership, minimal child environments,
linked-path confinement, durable Codex-mode install/uninstall recovery,
nonzero diagnostic failure propagation, and an explicit fatal wrapper
installation contract.

**Reason:** Final adversarial review identified unowned same-name mutation,
ambient credential inheritance, lexical-only containment, process-crash partial
state, false-success diagnostics, and contradictory binary failure semantics.

**Impact:** MCP installation/mirroring/uninstall, secret launch, Codex mode,
doctor and CLI exit behavior, binary installation, tests, and user-facing
security documentation.

### 2026-07-24 - GPT Pro review hardening

**Change:** Added pinned executable provenance, ownership-safe Codex mode,
owner-only MCP secret launch, bounded MCP smoke, portable Python resolution,
fail-closed config handling, and Harness-only update guidance.

**Reason:** Whole-project review identified executable-before-verification,
mutable source, credential argv, destructive global mutation, false-success,
and cross-platform lifecycle risks.

**Impact:** Installer, MCP configuration, Codex mode, doctor, update command,
Hook delegation, tests, and distribution documentation.
