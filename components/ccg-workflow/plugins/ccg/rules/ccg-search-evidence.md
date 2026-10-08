# CCG Search And Evidence Rule

- User-facing answers should be in Chinese unless the user asks otherwise.
- Tool prompts and external search queries may be written in English for recall quality.
- For libraries, frameworks, SDKs, CLIs, and cloud services, use current official docs when behavior may have changed.
- For external facts, prices, news, policies, versions, or API behavior changes, do not rely on memory alone.
- Search actively for similar projects, reusable open-source code, existing solutions, and applicable papers.
- Use existing independent `web_search` agents and grok-search MCP; Codex splits questions and synthesizes results. Keep the configured model and reasoning effort unchanged.
- Match key conclusions to original sources. Check versions and licenses when actually reusing code, and experiment conditions when adopting paper conclusions. Clearly mark unverified or conflicting findings.
- Return useful findings and direct source links. Do not require a second Grok CLI/ACP run, manifests, hashes, waivers, or a fixed verification ceremony for ordinary research.
- Explicit legacy Grok commands retain their own implementation and validation; they are not automatic steps or fallbacks. Archived instructions are reference only.

<!-- Legacy search routing and evidence guidance; inactive in ordinary research.
- For generic external lookup, resolve `ccg-codex routing get search --json`; an
  explicitly named search command still uses its named provider.
- Prefer official sources or at least two independent sources for important factual claims.
- If sources conflict, compare authority and date; if uncertainty remains, state it clearly.
- Treat external provider output as advice. Codex must verify before applying it.
-->
