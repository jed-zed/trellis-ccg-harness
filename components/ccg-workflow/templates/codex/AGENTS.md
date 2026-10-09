<!-- CCG:START — Managed by CCG Workflow. Do not edit this block manually. -->
# CCG Codex-Native Workflow

- Codex is the sole workspace writer and final verification owner.
- Inside this Codex execution domain, the root may dispatch independent research
  and bounded implementation leaves to native workers, including in Trellis
  inline mode. The root alone owns task/phase state, shared files, integration
  and final verification; do not delegate a whole lifecycle phase.
- Dispatch useful ready work early: start with 1–2 helpers and grow to 3–4
  when independent work and resources justify it. Zero is valid for simple or
  serial work; never require a worker count. Count native agents and provider
  CLI calls separately while budgeting their combined resource usage.
- Permit useful early findings and short same-package follow-ups. A partial
  delivery releases only dependencies on accepted frozen output or a fixed
  snapshot. Confirm a cancelled writer and its child commands have stopped
  before reassigning paths. Missing batch/report metadata is recoverable;
  unknown write authority is not. Existing permissions and model settings remain.
- CCG Skills and quality gates run through the installed Codex plugin.
- CCG runtime configuration lives at `~/.codex/ccg/config.toml`.
- The four top-level CCG roles (`frontend`, `backend`, `search`, and
  `product-manager`) resolve through unified routing. Read one role with
  `ccg-codex routing get <role> --json` and change only that role with
  `ccg-codex routing set <role> <provider>`.
- Third-party Skills, plugins, and MCP servers are unselected by default and
  require the user's explicit approval before a Harness or project initializer
  installs them.
<!-- Legacy Grok CLI/ACP routing; inactive in ordinary research.
- External-intelligence routing uses `ccg-codex route`; it is disabled by default.
-->
- Search actively with existing independent research agents and grok-search MCP.
  Match key conclusions to original sources; check code versions/licenses when
  reusing code and experiment conditions when adopting papers. Mark uncertainty.
  Ordinary research does not start Grok CLI/ACP, require its evidence packages,
  or wait for its gates. Archived search instructions are reference only.
- Registered provider CLIs may supply bounded drafts or review evidence for
  their configured roles. Provider assignment is configurable, not permanent.
  Claude may be explicitly selected for `frontend`, `backend`, or the
  snapshot-bound `product-manager` contract. It is not eligible for `search`;
  defaults and no-fallback behavior remain unchanged.
- When `.trellis/` exists, Trellis owns task identity, lifecycle,
  specifications, plans, and completion. CCG must not create a parallel task
  authority.
- Keep runtime evidence under ignored `.ccg/` or `.codex/ccg/` paths.
<!-- CCG:END -->
