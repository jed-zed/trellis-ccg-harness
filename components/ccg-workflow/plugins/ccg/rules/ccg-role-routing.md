# CCG Role Routing

CCG separates three top-level work roles from provider names:

| Role | Used by |
| --- | --- |
| `frontend` | Frontend analysis, planning, implementation drafts, and review |
| `backend` | Backend analysis, planning, implementation drafts, and review |
| `search` | External lookup planning, evidence gathering, analysis, and review |

`analysis`, `planning`, and `review` are workflow phases inside those three
roles. They are not independently configurable provider roles.

Before assigning generic work, classify each task slice as `frontend`,
`backend`, or `search`, then read only the needed provider:

```text
ccg routing get frontend --json
ccg routing get backend --json
ccg routing get search --json
```

A full-stack task may use both the frontend and backend providers. A task that
also needs current external evidence may additionally use the search provider.
Codex combines the results.

The registered providers are `codex`, `gemini`, `claude`, `antigravity`, and
`grok`. Route only to one of those existing providers; do not invent a command
backend or provider-registration layer.

- `codex`: Codex performs the role directly.
- `gemini`: use the bundled Gemini preview helper and read its response file.
- `claude`, `antigravity`, or `grok`: use the existing
  `codeagent-wrapper --backend <provider>` adapter for a bounded draft,
  analysis, or review.
- Codex remains the orchestrator, sole real-workspace writer, final verifier,
  and delivery owner regardless of the selected role provider.

An explicit user request for a provider on the current task overrides the
stored role for that task only. Provider-specific commands such as
`/ccg:gemini-preview`, `/ccg:grok-intel`, `/ccg:grok-verify`, and
`/ccg:gptpro-*` also use their named provider directly and do not rewrite role
configuration.

Change one top-level role with:

```text
ccg routing set <role> <provider>
```

Changing one role must not alter either of the other two roles.
