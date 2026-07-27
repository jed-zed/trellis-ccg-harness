# Execution boundary amendment

Recorded from the user's `/ccg:execute` instruction.

## Required in this execution

- Keep Codex as the local plugin orchestrator and final workspace writer.
- Preserve the original CCG configuration, installer/template refresh, and Go
  wrapper architecture.
- Make frontend, backend, and search independently configurable across
  providers already registered by CCG. Analysis, planning, and review are
  phases inside those three roles.
- Use Gemini for implementation compatibility review.
- Use Grok for external version evidence and backend/diff audit.
- Keep source/runtime provenance checks when updating the Harness snapshot.

## Explicitly deferred

- A generic arbitrary-executable `CommandBackend`.
- A user-extensible command registration platform.
- Task permission records, expiry engines, or an authorization subsystem.
- A new dispatcher, service, daemon, routing database, or configuration root.
- Security controls unrelated to the real local subprocess/configuration
  behavior changed by this task.

## Minimal safety boundary

This is a local Codex plugin. Implementation should reuse existing process
launching and configuration validation. Add only tests needed to prevent
cross-role mutation, invalid registered provider selection, broken migration,
or source/runtime drift. Do not introduce enterprise threat models or remote
multi-tenant assumptions.

## Rule precedence

This amendment is superseded in role shape by
`research/role-hierarchy-amendment.md`. The minimal local-plugin boundary and
the deferral of `CommandBackend` and task-override infrastructure remain active.
