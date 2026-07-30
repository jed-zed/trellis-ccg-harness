# Installing CCG with an AI agent

This file defines the safe, provider-neutral contract for users who give this
repository link to an AI agent and ask it to install CCG.

## Authority boundary

A repository URL allows inspection; a repository URL does not authorize installation, downloads, configuration writes, logins, network calls, paid calls, or third-party add-ons.

The agent must:

1. Read this file and the applicable README before proposing commands.
2. Inspect the checked-out commit and explain the core CCG installation effects.
3. Ask for explicit approval before installing CCG or changing user-level
   configuration.
4. Treat every optional third-party add-on as a separate approval boundary.
5. Never infer approval for a provider login, credential use, network request,
   paid model call, hook trust, global default, or project indexing.

## Discovery before optional installation

After CCG is available, the agent may run:

```bash
ccg addons --json
```

This is a deterministic, read-only catalog operation. It does not write files,
execute installers, contact the network, or select any candidate. Its default
action is `skip`.

The catalog distinguishes:

- `ccg-managed`: optional MCP components already available through the existing
  `ccg init` or `ccg config mcp` flow.
- `manual-pending`: external Skills, plugins, hook trust, or global defaults
  that require a separate owner-approved installer or transaction.

For every requested `manual-pending` candidate, show its pinned source,
dependencies, filesystem and executable effects, hooks, network behavior, and
data-egress disclosure. Then ask for approval for that exact action. Never claim
that a `manual-pending` candidate is installed until the approved installer has
completed and its result has been verified.

Do not replace pinned commits, versions, selectors, trees, or integrity values
with mutable branches, tags, or `latest`.

## Recommended auxiliary MCPs

Context7, Playwright, DeepWiki, and Exa are recommendations, not selections.
Show all four and obtain item-by-item approval before running `ccg config mcp`.

- Context7 sends documentation queries and library identifiers to its service.
- Playwright is not a security boundary. Browser downloads, site access, local
  files, and browser-profile reuse need separate disclosure and approval.
- DeepWiki uses only the official, free, no-auth
  `https://mcp.deepwiki.com/mcp` Streamable HTTP endpoint.
- Exa defaults to the official `https://mcp.exa.ai/mcp` hosted free tier. For
  higher limits or production use, direct the user to
  `https://dashboard.exa.ai/api-keys`. Only request a key if the user chooses
  the local npm mode; never place it in a URL, command arguments, logs, this
  repository, or an AI prompt.

An approval to inspect the catalog is not approval to configure any MCP.
Approval for one candidate does not authorize another candidate, browser
downloads, provider login, paid use, or credential creation.

## Verification

After an approved core installation, run the relevant non-paid checks:

```bash
ccg doctor
ccg status
```

Only run live provider checks when the user separately authorizes the provider,
credentials, network access, and any possible charge.
