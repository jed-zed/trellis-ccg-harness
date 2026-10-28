<!-- CCG:START — Managed by CCG Workflow. Do not edit this block manually. -->
# CCG Codex-Native Workflow

- Codex owns orchestration, integration and final verification. Native workers
  may handle bounded independent leaves, including in Trellis inline mode;
  the root retains task state and shared files. Dispatch useful ready work
  early, with one writer per path; zero workers is valid. Accept frozen output
  before dependent work and confirm cancelled writers have stopped before handoff.
- Use the minimum implementation that meets the accepted goal; reuse existing
  code, standard libraries and native capabilities. Follow the installed
  plugin's `ccg-quality-gates.md` for proportional checks and verified findings.
- CCG Skills run through the installed Codex plugin; runtime configuration is
  `~/.codex/ccg/config.toml`.
- The four top-level CCG roles (`frontend`, `backend`, `search`, and
  `product-manager`) resolve through unified routing. Read one role with
  `ccg-codex routing get <role> --json` and change only that role with
  `ccg-codex routing set <role> <provider>`.
- Third-party Skills, plugins, and MCP servers are unselected by default and
  require the user's explicit approval before a Harness or project initializer
  installs them.
- Search actively with existing independent research agents and grok-search MCP.
  Match key conclusions to original sources; check code versions/licenses when
  reusing code and experiment conditions when adopting papers. Mark uncertainty.
  Ordinary research does not start Grok CLI/ACP, require its evidence packages,
  or wait for its gates.
- Registered provider CLIs may supply bounded drafts or review evidence for
  their configured roles. Provider assignment is configurable, not permanent.
  Claude may be explicitly selected for `frontend`, `backend`, or the
  snapshot-bound `product-manager` contract. It is not eligible for `search`;
  defaults and no-fallback behavior remain unchanged.
- When `.trellis/` exists, Trellis owns task identity, lifecycle,
  specifications, plans, and completion. CCG must not create a parallel task
  authority.
- Keep runtime evidence under ignored `.ccg/` or `.codex/ccg/` paths.
- Reuse the existing task, Git, PR and CI records; do not require completion
  scores or turn optional advice into requirements.
- Main-agent user-facing communication follows the global AGENTS.md
  communication rules; preserve internal agent report contracts.
<!-- CCG:END -->
