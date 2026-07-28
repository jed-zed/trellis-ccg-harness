# Multi-model plan review v2

## Scope

This record supports planning only. No implementation from the isolated
prototype worktree is accepted into the task. Claude Code was not authorized
for this task and was not invoked; that task-scoped restriction is not a
permanent routing policy.

## Gemini architecture review

- Model: `gemini-3.1-pro-preview`
- Response:
  `C:\Users\29933\.codex\ccg\logs\gemini-preview-20260727-112721.response.txt`
- Result: non-empty response after transient `429` retries.
- Review conclusion: v2 is preferable to v1 because it preserves the original
  Go wrapper boundary and the `config.toml -> installer -> generated template`
  pipeline.
- Required design points:
  - replace fixed role fields with `roles: Record<string, RoleConfig>`;
  - migrate legacy frontend/backend/review configuration on read;
  - make the installer role-first while updating only the selected role;
  - retain legacy template variables while adding dynamic role variables;
  - test migration, template compatibility, and arbitrary-role routing;
  - keep task-only overrides out of persistent runtime configuration.

## Grok external search and backend audit

- Model: `grok-4.5`
- Outcome: `partially_verified`
- Search activity: 24 Web searches and 5 X searches.
- Evidence:
  `.ccg/tasks/cli-capability-routing-decoupling/grok-intelligence/20260727173341-0e4ab2d11134/evidence.json`
- Evidence SHA-256:
  `a21a7ed095a35b509b744f6d18995207051c0124ff30a1ba5f40b834d38b78df`
- Manifest:
  `.ccg/tasks/cli-capability-routing-decoupling/grok-intelligence/20260727173341-0e4ab2d11134/manifest.json`
- Manifest SHA-256:
  `5693476d7f4305d13d2575d78184b179a851e3dfd1c19704d059919d407561d2`
- Export:
  `.ccg/tasks/cli-capability-routing-decoupling/grok-export/20260727173341-0e4ab2d11134`
- Verified findings:
  - upstream CCG is a lead-agent workflow over Codex, Gemini, and Grok;
  - upstream package version is `3.2.3`;
  - upstream `3.2.0` added Grok as a first-class backend selectable for
    frontend or backend work;
  - upstream still centers routing on configuration, installer/model-router,
    and the Go wrapper;
  - external CLIs are optional, so missing binary, PATH, startup, exit-code,
    stream, and timeout behavior need backend tests;
  - public search did not prove the private/personal fork state, so local Git
    evidence remains authoritative for provenance.

## Combined decision

The execution plan must follow upstream architecture and add only:

1. an extensible role map;
2. a backend registry plus a constrained compatible-command adapter;
3. provider-neutral Codex skills that resolve a role;
4. a Harness projection of effective CCG routing;
5. source/runtime provenance alignment as a separate transaction.

The plan must not create a parallel Node dispatcher, a new `~/.ccg`
configuration authority, a separate `.harness/routing.json`, or a second task
state. The isolated prototype is excluded and implementation must begin from a
clean reviewed commit after plan approval.

## Planning gate

`node scripts/harness-adapter.mjs conflicts` reported 14 passes and one
blocking gate:

- `ccg-runtime-cli`: expected `3.3.0`, actual `3.3.2`.

This is recorded as an execution preflight/provenance task. It does not
invalidate the architecture plan, and it must not be hidden by changing the
role-routing design.
