# Grok Build Windows Contract Verification

Date: 2026-07-21

> This is a historical probe record. The empty-MCP and tool-denial profile
> below describes the evidence captured on that date; it is not the current
> Provider-permission contract. Current ACP sessions omit `mcpServers`, accept
> the Provider's native permission option, and retain the client-side
> no-filesystem-write/no-terminal capability boundary.

Platform: Windows 11, PowerShell 7

CLI: `grok 0.2.106 (bde89716f6)`

Accepted transport: ACP over `grok agent stdio`

Rejected transport: one-shot `grok -p --output-format streaming-json`

## Outcome

The intelligence workflow must use Grok's official ACP transport, not the one-shot CLI stream.

- Browser OAuth login succeeded and ACP advertised `cached_token` and `grok.com` authentication.
- At the time, `session/new` was created with `mcpServers: []`.
- At the time, ACP reported `_x.ai/mcp/servers_updated` with an empty array and `_x.ai/mcp_initialized` with `mcpToolCount: 0`.
- The Web probe exposed stable, correlatable `tool_call` and `tool_call_update` events with source URLs.
- The X-domain probe exposed the same event contract but returned `sources: []`; its ungrounded final X URL is a required negative case and must be rejected.
- The legacy `grok -p` probe attempted to start the user's `exa` and `grok-search` MCP servers even though `inspect` marked Claude MCP compatibility disabled. It is unsafe for the intelligence profile.

This verifies the event **Contract Gate** for ACP. It does not by itself pass the later **Safety Gate**: the implementation must still enforce exact environment construction, process limits, deny rules, snapshot boundaries, cleanup and fail-closed validation.

## Authentication contract

The supported developer-workstation flow is direct official login:

```powershell
$env:GROK_HOME = "$env:LOCALAPPDATA\CCG\grok-intelligence\grok-home"
grok login --oauth
```

The dedicated home is protected with an ACL granting only the current Windows user full control. The runner reuses this home in place; it never copies or prints `auth.json`. API-key authentication may remain an optional CI path, but is not required for local use.

Official documentation confirms that browser OIDC is refreshable and intended for interactive workstations, while ACP supports cached local authentication: [Enterprise authentication](https://docs.x.ai/build/enterprise), [ACP headless scripting](https://docs.x.ai/build/cli/headless-scripting).

## Historical isolation probe (superseded)

The paid ACP probes used:

- a neutral empty working directory;
- `mcpServers: []` on every `session/new` request;
- no filesystem or terminal client capabilities;
- exact environment construction;
- all Claude, Cursor and Codex compatibility surfaces disabled;
- `GROK_MANAGED_MCPS_ENABLED=0` and `GROK_MCP_AUTO_RESTART=0`;
- `--permission-mode dontAsk`, `--no-plan`, `--no-memory`, `--no-subagents`, and bounded turns;
- `--tools web_search`, a complete `--disallowed-tools` list for all other observed runtime tool IDs, plus explicit `Bash`, `Edit`, `Read`, `Grep`, `MCPTool` and `WebFetch` deny rules.

ACP reported the CLI's full built-in tool catalogue in
`available_commands_update` even with the former allow/deny flags. In the
current contract, the client selects the Provider's native permission option
and does not force an empty MCP inventory. Source-backed evidence validation,
bounded snapshots, exact environment construction, cleanup, and Codex's sole
workspace-write authority remain separate fail-closed boundaries.

The dedicated `GROK_HOME` also stores local session/log artifacts. The implementation must remove per-run session, prompt-history and log artifacts after extracting the bounded evidence stream while preserving only `auth.json`, the pinned safe config and explicitly retained redacted evidence.

## Observed ACP event contract

| Purpose | ACP event | Required fields |
|---|---|---|
| Search start | `session/update` → `tool_call` | `toolCallId`, `kind=search`, `status=in_progress`, `rawInput.variant=WebSearch`, `rawInput.backend=true` |
| Search result | `session/update` → `tool_call_update` | matching `toolCallId`, `status=completed`, `rawOutput.action.type=search`, `rawOutput.action.query`, `rawOutput.action.sources[].url` |
| Assistant output | `session/update` → `agent_message_chunk` | `content.type=text`, `content.text` |
| Turn end | `_x.ai/session/update` → `turn_completed` | `stop_reason`, usage, model calls and cost ticks |
| Historical MCP preflight | `_x.ai/mcp/servers_updated`, `_x.ai/mcp_initialized` | empty `mcpServers`, `mcpToolCount=0` in the 2026-07-21 probe only |

`toolCallId` remained identical between search start and completion. Usage metadata included input/output/cache/reasoning tokens, model calls, duration and `costUsdTicks`. ACP `session/prompt` returned `stopReason=end_turn`; the client then terminated the stdio process. Timeout and process-tree cancellation remain a transport implementation test requirement rather than a model contract assumption.

## X evidence rule

The CLI exposes `web_search`, not a distinct `x_search` ACP tool. X collection is therefore a WebSearch query restricted to trusted `x.com` account URLs. A result becomes X evidence only when the search event itself contains the X URL in `rawOutput.action.sources`. A URL appearing only in assistant prose is never registered.

The captured X probe returned an empty `sources` array followed by an unsupported X URL in assistant text. The validator must produce `missing_x_sources` and discard that URL. X remains preferred/advisory except where a later explicit policy elevates it; X-only material never creates a blocker.

## Probe costs

Four bounded calls were made while establishing the contract:

| Probe | Cost (USD) | Result |
|---|---:|---|
| Rejected one-shot CLI Web probe | 0.0449488 | MCP isolation failure; event stream insufficient |
| ACP Web discovery probe | 0.0493644 | Stable search events |
| ACP X-domain probe | 0.0454148 | Stable negative event with empty sources |
| ACP strict Web verification | 0.0462948 | Accepted positive contract |
| **Total** | **0.1860228** | Contract frozen; no further model calls required |

## Fixture provenance

The original files remain in the private, ACL-restricted Grok session directory and are not committed. Fixture redaction removes session/prompt/call IDs, timestamps, event IDs, local paths and thought content while preserving event names, status transitions, queries, sources, final text and usage shape.

| Fixture | Original private file SHA-256 | Redacted fixture SHA-256 | Result |
|---|---|---|---|
| `acp-web-success.jsonl` | `b9df0bea8e7c5ac3f6fb958d491eb9eccc28bf2adda4628787081d41ded60a84` | `ba23709b387209559c26b6d58b14fbcf6499cf83c58cb6633d7ff554bfde166e` | required Web evidence accepted |
| `acp-x-empty-sources.jsonl` | `21914e2eb28b19f5b1418dfac80a70f9b6bbcf24687f9ad562d6984262646304` | `200a0186c8f7cb32a4be709126057be11c02bf5073c34680c99649f2e095d974` | X prose URL rejected |

Both checked-in fixture mirrors are byte-identical and every line parses as JSON.
