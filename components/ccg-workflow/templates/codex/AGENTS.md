<!-- CCG:START — Managed by CCG Workflow. Do not edit this block manually. -->
# CCG Codex-Native Workflow

- Codex is the sole workspace writer and final verification owner.
- CCG Skills and quality gates run through the installed Codex plugin.
- CCG runtime configuration lives at `~/.codex/ccg/config.toml`.
- External-intelligence routing uses `ccg route`; it is disabled by default.
- Gemini may provide bounded read-only evidence. Claude is disabled and must
  not be invoked or required by Codex-mode workflows.
- When `.trellis/` exists, Trellis owns task identity, lifecycle,
  specifications, plans, and completion. CCG must not create a parallel task
  authority.
- Keep runtime evidence under ignored `.ccg/` or `.codex/ccg/` paths.
<!-- CCG:END -->
