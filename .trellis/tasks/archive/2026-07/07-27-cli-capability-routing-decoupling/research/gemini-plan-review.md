# Gemini read-only planning review

## Evidence

- Model: `gemini-3.1-pro-preview`
- Preview URL: `http://127.0.0.1:50300/`
- Browser opened: yes
- Prompt template: `plan`
- Response:
  `C:\Users\29933\.codex\ccg\logs\gemini-preview-20260727-104437.response.txt`
- Claude Code: not invoked

The first helper path recorded by the installed `3.3.2+codex.1` Skill did not
exist. The successful run used the actually installed helper under the `3.3.0`
cache, providing additional evidence that runtime/plugin assets are not
version-aligned.

## Accepted must-fix findings

- Remove the Go wrapper as a second compiled provider registry.
- Migrate schema-v1 project model policy as well as user CCG configuration.
- Serialize migration/config mutation to prevent concurrent corruption.
- Separate `workspace_write` structurally from ordinary capabilities.
- Restrict generic CLI argument substitution to a closed placeholder grammar.
- Bind task overrides to the canonical active Trellis task, not only a clock.
- Normalize provider output to the expected patch/evidence contract.
- Refresh generated assets once during the version upgrade, while keeping later
  route switches configuration-only.
- Test missing/uninstalled providers and use only explicitly configured
  fallbacks; never silently choose a lower-precedence provider.

## Refinement

Gemini suggested extracting fenced diffs or calculating diffs from full-file
responses. The adopted design permits this only against the disposable snapshot
and only for bounded, unambiguous content. Ambiguous provider output fails
closed and is never applied to the real workspace.
