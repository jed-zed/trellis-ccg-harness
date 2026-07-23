# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report them privately via one of the following:

- **Email**: [fengshao1227@gmail.com](mailto:fengshao1227@gmail.com)
- **GitHub Security Advisory**: [Report a vulnerability](https://github.com/fengshao1227/ccg-workflow/security/advisories/new)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: within 48 hours
- **Assessment**: within 7 days
- **Fix release**: within 30 days for confirmed vulnerabilities

### Scope

The following are in scope:

- `ccg-workflow` npm package
- `codeagent-wrapper` binary
- CCG hook scripts (`~/.claude/hooks/ccg/`)
- Template files that get installed to user environments

The following are out of scope:

- Third-party MCP servers (ace-tool, fast-context, codegraph, etc.)
- Claude Code, Codex CLI, Gemini CLI themselves
- User-created CLAUDE.md or custom skills

## Security Design

- **No secrets in templates**: API keys and tokens are injected at install time via environment variables, never hardcoded in template files.
- **Hook isolation**: CCG hooks run in the user's own process context with no elevated privileges.
- **Binary integrity**: `codeagent-wrapper` binaries are built via GitHub Actions CI and distributed through GitHub Releases + Cloudflare R2 mirror. No third-party build infrastructure.
- **MCP sandboxing**: All MCP server configurations use `stdio` transport (no network listeners). MCP servers run as child processes of the AI agent.
