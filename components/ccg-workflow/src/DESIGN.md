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
file replacement, malformed-config data loss, process leaks, and accidental
replacement of the personal distribution with public upstream.

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

### Global ownership

- Codex mode owns one marked AGENTS block, one structured hook group, and files
  listed in `~/.codex/.ccg/ownership.json`.
- Existing collisions are backed up. Uninstall removes/restores an asset only
  when its installed digest still matches; user edits are preserved.
- JSON and Hook configuration is parsed before mutation and written atomically.
  Malformed or ambiguous state fails closed.

### Credentials and diagnostics

- MCP credentials are stored in owner-only secret specs. Public MCP config
  contains only the local launcher path and secret-spec path, never the secret.
- Credential-bearing MCP definitions are not mirrored across runtimes.
- `diagnose-mcp --smoke` is opt-in, stdio-only, protocol/time/output bounded,
  redacts exact and structural secrets, and terminates the full process tree.
- Python hooks use a version-checked cross-platform resolver and argv arrays.

## Trellis Boundary

The global CCG Codex hook searches for `.trellis` before `.ccg` or `.git`.
Inside a Trellis project it delegates to the project hook using the active
Python interpreter and forwards the original payload/output. Missing delegation
fails closed to Trellis-only guidance and never creates `.ccg/tasks`.

## Known Risks

- Trusted digest rotation is a reviewed source change and must accompany a
  release asset built from the intended personal commit.
- Windows owner-only guarantees rely on the surrounding Harness/OS ACL checks;
  POSIX modes alone are not meaningful on Windows.
- An explicit MCP smoke starts configured local commands and may have provider
  side effects. It is therefore never part of default diagnosis.
- Low-severity scanner findings for CLI `console.log` calls are intentional
  user-facing output, not debug logging.

## Change History

### 2026-07-24 - GPT Pro review hardening

**Change:** Added pinned executable provenance, ownership-safe Codex mode,
owner-only MCP secret launch, bounded MCP smoke, portable Python resolution,
fail-closed config handling, and Harness-only update guidance.

**Reason:** Whole-project review identified executable-before-verification,
mutable source, credential argv, destructive global mutation, false-success,
and cross-platform lifecycle risks.

**Impact:** Installer, MCP configuration, Codex mode, doctor, update command,
Hook delegation, tests, and distribution documentation.
