<!-- CCG:START — Managed by CCG Workflow. Do not edit this block manually. -->
# CCG Codex-Native Workflow

- Codex is the sole workspace writer and final verification owner.
- CCG Skills and quality gates run through the installed Codex plugin.
- CCG runtime configuration lives at `~/.codex/ccg/config.toml`.
- The three top-level CCG roles (`frontend`, `backend`, `search`) resolve at
  runtime with `ccg routing get <role> --json`. Analysis, planning, and review
  are phases inside those roles. Change one role with
  `ccg routing set <role> <provider>`; this must not alter the other two.
- Third-party Skills, plugins, and MCP servers are unselected by default and
  require the user's explicit approval before a Harness or project initializer
  installs them.
- External-intelligence routing uses `ccg route`; it is disabled by default.
- Registered provider CLIs may supply bounded drafts or review evidence for
  their configured roles. Provider assignment is configurable, not permanent.
  Codex remains the sole real-workspace writer and final verification owner.
- When `.trellis/` exists, Trellis owns task identity, lifecycle,
  specifications, plans, and completion. CCG must not create a parallel task
  authority.
- Keep runtime evidence under ignored `.ccg/` or `.codex/ccg/` paths.
<!-- CCG:END -->
