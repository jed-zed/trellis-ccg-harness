# Template Runtime Security Design

## Scope

Templates become executable or instruction-bearing files in user environments.
They must preserve the same ownership, credential, lifecycle, and provider
boundaries enforced by the TypeScript installer.

## Trust Boundaries

- `templates/codex/hooks/ccg-workflow.py` runs as a global Codex hook but may
  observe repositories owned by Trellis.
- `templates/engine/tools/mcp-secret-launcher.mjs` starts a configured MCP child
  using a private secret spec.
- Command templates can describe executable third-party tools, but their actual
  selectors must come from the reviewed source inventory.

## Decisions

### Trellis-first delegation

The Codex hook searches parent directories for `.trellis` before considering
CCG or Git state. In Trellis projects it delegates to the project-owned hook
with `sys.executable`, forwards stdin and stdout without interpretation, and
returns Trellis-only guidance if delegation is unavailable. It must not emit
`.ccg/tasks` instructions in that branch.

### Secret launcher

The MCP launcher:

- accepts only an absolute path under the expected owner-only CCG secret area;
- validates the JSON shape before process creation;
- passes the child command and arguments as an argv array with no shell;
- injects secrets only into the child environment;
- does not print the spec, credentials, or child arguments;
- propagates child exit status and signals.

## Known Risks

- A user who explicitly configures a malicious MCP executable is authorizing
  that local program. The launcher prevents accidental disclosure and shell
  interpolation; it is not an application sandbox.
- Global hooks remain sensitive to future Trellis hook contract changes. The
  Harness conflict doctor and delegation regression tests detect drift.

## Change History

### 2026-07-24 - Ownership and credential boundary

**Change:** Added Trellis-first Codex hook delegation and the owner-only MCP
secret launcher.

**Reason:** Prevent dual lifecycle state and keep credentials out of process
arguments and mirrored configuration.

**Impact:** Codex Hook behavior, MCP launch configuration, installer tests, and
Harness conflict checks.
