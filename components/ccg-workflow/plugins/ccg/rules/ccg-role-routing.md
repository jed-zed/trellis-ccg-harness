# CCG Unified Role Routing

CCG has four formal top-level routing roles:

- `frontend`
- `backend`
- `search`
- `product-manager`

| Role | Used by |
| --- | --- |
| `frontend` | Frontend analysis, planning, implementation drafts, and review |
| `backend` | Backend analysis, planning, implementation drafts, and review |
| `search` | External lookup planning, evidence gathering, analysis, and review |
| `product-manager` | Intake, milestone, and final product review evidence |

`analysis`, `planning`, and `review` are workflow phases inside these roles.
They are not independently configurable provider roles.

Inspect or change exactly one role:

```text
ccg routing get frontend --json
ccg routing get backend --json
ccg routing get search --json
ccg routing get product-manager --json
ccg routing set <role> <provider>
```

The registered providers are `codex`, `gemini`, `claude`, `antigravity`,
`grok`, and `pi`. Registration does not imply that every role can use every
provider:

| Role | Allowed providers |
| --- | --- |
| `frontend` | `codex`, `gemini`, `claude`, `antigravity`, `grok`, `pi` |
| `backend` | `codex`, `gemini`, `claude`, `antigravity`, `grok`, `pi` |
| `search` | `codex`, `grok` |
| `product-manager` | `codex`, `gemini`, `claude` |

Use `ccg wrapper --backend <provider> --progress - "<workdir>"` for managed
Claude, Antigravity, Grok, or Pi delegation. Pass the prompt through stdin.
Do not add `--lite`; the launcher keeps the wrapper Web UI enabled. When a role
resolves to Gemini, run the bundled `ccg-executor/scripts/invoke_gemini_preview.py`
foreground command in a tool-managed background job. Do not pass `--detach`
from a Codex workflow because the tool runner owns the process lifetime. Do not
replace the helper with a raw Gemini CLI call. Claude may be explicitly selected
for `frontend`, `backend`, or `product-manager`, but not `search`; standalone
frontend/backend delegation does not become a product-manager call or inherit
product-manager task authority or authorization.
Codex remains the orchestrator, sole real-workspace writer, final verifier, and
delivery owner regardless of the selected role provider.

The product-manager Provider selection exists only at
`routing.product-manager`. `[product_manager]` stores behavior parameters such
as enablement, contract version, retry, timeout, and output limits. Harness,
projects, and Trellis tasks may restrict allowed Providers but must not select
one or introduce fallback.

Routing changes never install, authenticate, invoke, or grant permissions to a
Provider. Provider launch permissions follow the upstream CCG baseline;
product-manager calls still require explicit per-call authorization.

## Companion Role Contract

When a workflow uses `frontend` or `backend`, the controller must also resolve
exactly one logical `search` operation for that task phase. Search is required
companion evidence, not an optional classification. The operation may make at
most two total attempts against the same configured `search` Provider. Keep one
stable operation/evidence identity, record `attemptCount`, keep the output
read-only, and do not fall back to another Provider. If the required search
evidence still fails after those attempts, stop and report the missing channel.

The same workflow must evaluate the mapped product-manager event at the next
eligible checkpoint described by `ccg-product-manager.md`. A candidate opens
an explicit per-call authorization gate; it never authorizes or silently starts
the Provider call. Record both outcomes in workflow evidence:

- `searchStatus`: `invoked`, `failed`, or `not_applicable`.
  `not_applicable` is valid only when neither frontend/backend nor an
  independent search slice participates;
- `productManagerStatus`: `authorization_required`, `authorized`, `declined`,
  `disabled`, `unavailable`, `completed`, or `not_applicable`.
