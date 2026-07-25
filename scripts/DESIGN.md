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
2. persist a phase journal before the first mutating rename or file copy;
3. verify either the personal CCG commit/tree or exact Trellis version/integrity;
4. generate a sparse candidate and reject runtime state, links, junctions,
   protected-path materialization, and ownership-surface escapes;
5. run the source-specific and root Harness gates;
6. snapshot the current component or exact Trellis-managed files;
7. apply the candidate, update the source manifest, and run post-apply gates;
8. commit the transaction record only after success, otherwise restore the
   snapshot automatically.

Rollback restores only a Harness-created snapshot. If the process dies outside
normal exception handling, doctor blocks on the journal/lock and
`harness:recover` either finishes committed cleanup or deterministically
restores the pre-transaction state. Uninstall changes global state only when
its ownership record and installed digest still match; user edits are
preserved and reported for manual handling.

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
- A missing installed CCG CLI is a warning during setup; a mismatched installed
  version is blocking.
- Search capability is true only when the response contains both a web-search
  tool call and citation/annotation evidence.
- GPT Pro remains owned by the existing CCG bridge and is not reimplemented by
  the Harness adapter.

## Change History

### 2026-07-23 - Layered adapter

**Change:** Added canonical context, deterministic conflict auditing, provider
separation, offline tests, and doctor/CI integration.

**Reason:** Trellis and CCG need explicit ownership and runtime boundaries
without replacing the user's personal CCG implementation.

**Impact:** Root Harness scripts, documentation, doctor, CI, and model policy.
