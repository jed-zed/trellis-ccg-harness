# CCG Fast Context Rule

Follow the current project's `AGENTS.md` and its code-search policy before
choosing a search tool. CCG does not install, register, or enable MCP servers.
Third-party search tools may be used only after the user has explicitly
approved their installation and the current project policy permits them.

Use this default routing when no stronger project rule applies:

- For known filenames, symbols, literals, or error messages, use `rg`.
- For known symbols, callers, callees, or impact paths, use CodeGraph only
  when a current `.codegraph` index already exists.
- For behavior-oriented discovery, use an explicitly approved semantic search
  tool when it is available; otherwise use targeted reads and exact search.

Do not invoke ace-tool. Do not run `codegraph init` automatically. If no
approved semantic search tool is available, continue with local search rather
than installing or configuring one.
