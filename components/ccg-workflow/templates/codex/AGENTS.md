<!-- CCG:START — Managed by CCG Workflow. Do not edit this block manually. -->
# CCG Codex-Native Workflow

- Codex is the sole workspace writer and final verification owner.
- CCG Skills and quality gates run through the installed Codex plugin.
- CCG runtime configuration lives at `~/.codex/ccg/config.toml`.
- The four top-level CCG roles (`frontend`, `backend`, `search`, and
  `product-manager`) resolve through unified routing. Read one role with
  `ccg routing get <role> --json` and change only that role with
  `ccg routing set <role> <provider>`.
- Third-party Skills, plugins, and MCP servers are unselected by default and
  require the user's explicit approval before a Harness or project initializer
  installs them.
- External-intelligence routing uses `ccg route`; it is disabled by default.
- Gemini may provide bounded read-only evidence. Claude is disabled for
  ordinary Codex-mode delegation; the only exception is when unified routing
  selects Claude for the no-tool, no-write `product-manager` contract.
- When `.trellis/` exists, Trellis owns task identity, lifecycle,
  specifications, plans, and completion. CCG must not create a parallel task
  authority.
- Keep runtime evidence under ignored `.ccg/` or `.codex/ccg/` paths.
<!-- CCG:END -->
