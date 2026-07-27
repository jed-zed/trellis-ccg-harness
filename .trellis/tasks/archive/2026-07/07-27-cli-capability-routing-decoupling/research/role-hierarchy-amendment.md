# Role hierarchy amendment

Recorded from the user's correction before any commit was created.

## Accepted model

Only three top-level roles are independently configurable:

- `frontend`
- `backend`
- `search`

`analysis`, `planning`, and `review` are phases/capabilities inside those three
roles. They must not appear as additional persistent provider-routing entries.

Examples:

- Frontend planning and frontend review use the configured frontend provider.
- Backend analysis and backend review use the configured backend provider.
- Search planning and review of external evidence use the configured search
  provider.
- A full-stack task is split into frontend and backend slices; Codex
  orchestrates and combines the results.

## Consequences

- `ccg routing list|get|set` exposes only frontend/backend/search.
- The installer role-first menu exposes only those three roles.
- Generic analyze/plan/review workflows classify their input by top-level role
  and may use more than one provider for a cross-cutting task.
- Explicit provider commands retain their named-provider behavior.
- Codex remains the final real-workspace writer and verifier.

This amendment supersedes every earlier statement that described six
independently configurable peer roles.
