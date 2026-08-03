# Claude SSH Snapshot Bridge v2

The bridge is operator-installed. CCG does not install it, authenticate it, or
modify user environment variables.

## Environment

The bridge receives only these SSH-specific variables in addition to the CCG
minimal process environment:

```text
CCG_PRODUCT_MANAGER_CLAUDE_SSH_EXECUTABLE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_HOST
CCG_PRODUCT_MANAGER_CLAUDE_SSH_USER
CCG_PRODUCT_MANAGER_CLAUDE_SSH_PORT
CCG_PRODUCT_MANAGER_CLAUDE_SSH_IDENTITY_FILE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_KNOWN_HOSTS_FILE
CCG_PRODUCT_MANAGER_CLAUDE_SSH_REMOTE_EXECUTABLE
```

Password/token variables, disabled host-key checking, ambient SSH settings, and
arbitrary environment inheritance are forbidden. Values must not be printed.

## Probe

CCG runs:

```text
<bridge> --product-manager-snapshot-protocol-version
```

Successful stdout is exactly one JSON object:

```json
{"protocol_version":"2","bridge_version":"...","remote_cli_version":"..."}
```

The probe must validate SSH host keys and the configured remote Claude
executable. Any other version or output fails closed.

## Review

CCG runs the bridge with `shell:false`:

```text
<bridge> --product-manager-snapshot-protocol 2 \
  --snapshot-root <local-root> --manifest <local-manifest> \
  --attempt-id <uuid> --model <model> --json-schema <schema>
```

The review prompt is stdin. Successful stdout is exactly the Claude JSON
envelope accepted by CCG. SSH connection details remain environment-only.

For every attempt the bridge must:

1. create a fresh unpredictable remote directory;
2. transfer only the supplied local snapshot and manifest;
3. recompute and match the manifest and every file digest;
4. run the configured remote Claude in that directory with only Read, Glob,
   and Grep; disable writes, shell, MCP, hooks, skills/plugins, browser,
   sessions, and subagents;
5. bound and redact diagnostics; and
6. delete the remote directory after success, non-zero exit, invalid output,
   timeout, disconnect, or retry.

The bridge must exit non-zero if any step fails. CCG retries only this same SSH
transport and snapshot identity; it never starts local Claude as a fallback.
