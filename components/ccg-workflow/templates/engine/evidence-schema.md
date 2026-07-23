# CCG Task Evidence Schema

Task evidence is stored outside `task.json` so workflow hooks can keep `task.json` small and stable.

Canonical path:

```text
.ccg/tasks/<task-id>/evidence.json
```

## Shape

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "gemini-gate-round-1",
      "provider": "gemini",
      "role": "gate",
      "policy": "required",
      "available": true,
      "artifactFile": "evidence/gemini-gate.md",
      "artifactSha256": "<sha256>",
      "artifactChars": 1200,
      "summary": "Short human-readable summary.",
      "sessionId": null,
      "round": 1,
      "createdAt": "2026-05-21T00:00:00.000Z"
    }
  ]
}
```

## Providers And Roles

Recommended providers:

- `gemini` for automated Gemini helper evidence.
- `gptpro` for user-mediated ChatGPT Pro evidence.
- `codex` for local synthesis or verification artifacts when useful.
- `grok` for validated external-intelligence evidence collected through the isolated ACP runtime.

Recommended roles:

- `gate` for required pre-GPT-Pro Gemini evidence.
- `review` for review findings.
- `plan` for planning evidence.
- `execution-companion` for legacy GPT Pro execution evidence; new items should add
  `displayRole: "execution-route-review"`, `semanticRole: "route-review"`, and
  `implementationOwner: false`.
- `frontend-prototype` for optional frontend/UI helper evidence.
- `external-intelligence` for current web/X facts, contracts, incidents, and ecosystem evidence.

## Artifact Rules

- Prefer paths relative to the task directory.
- `.ccg/...` and `.codex/...` paths are resolved from the project root.
- Every resolved path, including legacy absolute paths, must remain inside the project root; lexical and real-path escapes are rejected.
- Required evidence must point to a non-empty artifact.
- When `artifactSha256` is present, consumers must verify it against the exact artifact bytes.
- When `manifestFile` is present, preserve `manifestFile`/`manifestSha256` and validate the manifest hash independently.
- Grok bundles remain local-only by default under `.codex/ccg/intelligence/`; exported bundles are separately sanitized.

## External Intelligence Item

```json
{
  "id": "grok-external-intelligence-<evidence-id>",
  "provider": "grok",
  "role": "external-intelligence",
  "policy": "required",
  "available": true,
  "artifactFile": ".codex/ccg/intelligence/<evidence-id>/evidence.json",
  "artifactSha256": "<sha256>",
  "manifestFile": ".codex/ccg/intelligence/<evidence-id>/manifest.json",
  "manifestSha256": "<sha256>",
  "localOnly": true,
  "exported": false,
  "summary": "Validated current external contract evidence"
}
```

`task.json.external_intelligence` is only a compact pointer: requirement, status, evidence ID,
manifest path/hash, `localOnly`, and `exported`. Full claims, sources, reports, and raw events never
belong in `task.json`.

## Legacy Compatibility

Readers may normalize `task.json.gemini_evidence` or `task.json.gemini_gate` into this shape.
Writers must not append large evidence payloads to `task.json`.
