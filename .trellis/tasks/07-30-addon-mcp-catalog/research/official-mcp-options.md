# Official MCP option research

Research date: 2026-07-30

## Context7

- Official repository/registry: <https://github.com/mcp/upstash/context7>
- Official package: `@upstash/context7-mcp`
- Existing reviewed Harness/CCG pin: `3.2.4`
- npm latest observed during planning: `3.2.5`
- Decision: do not upgrade only because it is newer; reuse the reviewed exact pin
  unless implementation evidence requires a separate source refresh.
- Data boundary: documentation queries and library identifiers leave the machine.

## Playwright MCP

- Official repository: <https://github.com/microsoft/playwright-mcp>
- Official package: `@playwright/mcp`
- Existing reviewed CCG pin and npm latest observed: `0.0.78`
- Official Codex setup uses `codex mcp add playwright npx
  "@playwright/mcp@latest"`; Harness/CCG must replace mutable `latest` with the
  reviewed exact selector.
- Playwright MCP is not a security boundary. Browser profile, cookies, downloads,
  file access, site permissions and browser binary acquisition must be disclosed.

## DeepWiki MCP

- Official docs: <https://docs.devin.ai/work-with-devin/deepwiki-mcp>
- Official MCP registry: <https://github.com/mcp/cognitionai/deepwiki>
- Recommended endpoint: `https://mcp.deepwiki.com/mcp`
- It is a free, remote, no-auth service for public repositories.
- `/sse` is legacy and being deprecated.
- Existing `mcp-deepwiki@0.0.10` is an unofficial crawler wrapper whose own
  repository states that it is not currently working. It must not remain the
  recommended executable.

## Exa MCP

- Official docs: <https://exa.ai/docs/reference/exa-mcp>
- Official repository: <https://github.com/exa-labs/exa-mcp-server>
- Official API key page: <https://dashboard.exa.ai/api-keys>
- Hosted endpoint: `https://mcp.exa.ai/mcp`
- Existing reviewed CCG local-package pin and npm latest observed:
  `exa-mcp-server@3.2.1`.
- The hosted service supports basic use; an API key raises limits/enables
  production and is required for local npm mode. The user explicitly wants the
  acquisition guidance exposed.
- Decision: never place the key in a query URL, argv, repository file, plan or
  log. Local mode uses the existing owner-only secret launcher with
  `EXA_API_KEY`.

## Repository evidence

- `components/ccg-workflow/src/commands/config-mcp.ts` already lists all four,
  but DeepWiki uses the obsolete package and Exa links only to the site root.
- `components/ccg-workflow/src/commands/addons.ts` exposes only Context7 among
  these four.
- `.harness/third-party-sources.json` and its Harness Skill asset expose only
  Context7 among these four.
- `components/ccg-workflow/third-party-sources.json` already pins Context7,
  Playwright, the obsolete DeepWiki wrapper, and Exa.
