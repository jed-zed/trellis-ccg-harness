# Subagent MCP invocation contract

This personal branch inherits approved MCP configuration by default. Tasks that
need search, documentation, browser tools, or plugin skills should use that
default or explicitly pass `--with-mcp`. Inheritance does not install, enable,
authorize, or connect a new server on behalf of the controller.

A caller may explicitly request `--without-mcp` for a Codex or Gemini wrapper
child that only needs its prompt and local files. Parallel headers support
`mcp: off` and `mcp: inherit`; an explicit header overrides the invocation
default. All tasks undergo preflight before any task in the batch starts.
Unsupported modes, malformed settings, conflicting flags, and conflicting
repeated headers fail without retrying a less restrictive invocation. The
internal custom-argument seam rejects opt-out because it bypasses the argument
builder. Claude, Grok, Antigravity, Pi, Kimi, and OpenCode currently reject
opt-out before provider startup.

## Codex 0.156.1

Codex opt-out is deliberately versioned to the official npm package
`@openai/codex` 0.156.1. Preparation reads configuration in memory; it never
runs native Codex against a personal HOME. Package metadata provides the
supported npm installation/version contract. It does not authenticate an
arbitrarily modified PATH shim or substituted native binary.

The wrapper enumerates declarations from the OS system config, absolute
`CODEX_HOME/config.toml`, trusted project `.codex/config.toml` files between
the nearest default `.git` marker and the task directory, and the task
`config.toml`. With no marker, the project scope falls back to the task
directory. It does not scan unrelated HOME ancestors. Existing Codex resume
invocations omit `-C` and inherit the wrapper cwd, so resume preparation uses
that same cwd. Windows system config uses the OS ProgramData known folder,
matching Codex; changing the `ProgramData` environment variable does not
redirect this layer.

Every enumerated server receives `enabled=false` in a nonempty root-table
CLI overlay, including servers with dots, spaces, quotes, or escaped control
characters in their names. For example:

```text
-c 'mcp_servers={"docs.server"={enabled=false},"browser"={enabled=false}}'
```

The empty table `-c mcp_servers={}` is not a deny-all setting. Codex merges
that table with existing settings, leaving servers enabled. A dotted CLI
assignment also splits on literal dots rather than interpreting a quoted
server name, so opt-out uses the complete named table value. Other server
settings, HOME, credentials, model routing, and permission arguments remain
in the original configuration. The wrapper also supplies child-only
`features.apps=false` and `features.skill_mcp_dependency_install=false` to
close built-in Apps MCP and skill-triggered MCP installation paths.

Enabled Codex plugins require a second explicit acknowledgement:

```text
codeagent-wrapper --backend codex --without-mcp --allow-child-plugin-disable "Review these local files" .
```

Codex `exec` starts plugin marketplace/remote bundle synchronizers that may
introduce server names absent from a static snapshot. Native `mcp list` does
not start those same tasks. Enumerating cached plugin manifests is therefore
insufficient to prove execution opt-out. `remote_plugin=false` does not
independently stop installed bundle reconciliation.

With `--allow-child-plugin-disable`, the wrapper appends
`features.plugins=false` for this child. This stops plugin MCP, plugin startup
synchronization, and **this child's plugin skills**. It does not disable
plugins in the controller or GPTPro browser bridge. Without acknowledgement,
plugins that are enabled or enabled by native default cause preflight to
refuse opt-out. Already disabled plugins from system/user configuration need
no acknowledgement. A project-only `plugins=false` does not establish this
condition, since project trust can prevent that layer from taking effect;
a project `plugins=true` conservatively requires acknowledgement.

The acknowledgement has no environment-variable default and is valid only
with Codex opt-out. Inherited tasks must omit it or explicitly reset it with
`allow_child_plugin_disable: false` in a parallel header. Both header values
are strict `true`/`false`. This mixed batch explicitly preserves the tools and
plugin skills needed by its research task:

```text
codeagent-wrapper --backend codex --without-mcp --allow-child-plugin-disable --parallel
---TASK---
id: local-review
---CONTENT---
Review the supplied file excerpts.
---TASK---
id: tool-research
mcp: inherit
allow_child_plugin_disable: false
dependencies: local-review
---CONTENT---
Research using the project's approved MCP tools and plugin skills.
```

Unknown/unverifiable Codex versions, relative CODEX_HOME, selected profiles,
custom project root markers, runtime executor capability discovery, known
managed/cloud layers, macOS managed preferences, linked/nonregular/unreadable
or oversized files, invalid TOML, missing server transports, and unconfirmed
project trust refuse opt-out. No missing/unreadable layer is silently assumed
empty. Use `--with-mcp` without the plugin-disable acknowledgement when this
configuration needs a broader compatibility contract.

## Gemini

Gemini opt-out supplies `--allowed-mcp-server-names` with a fresh 128-bit random
name. This restricts configured and extension MCP servers for that child.
It preserves HOME, credentials, model routing, permission flags, the
controller, and GPTPro's browser bridge. Its internal browser agent has a
separate MCP connection path; no browser permissions are changed. Unknown
Gemini versions may reject the allowlist flag, and errors are surfaced.
The Codex-native Gemini preview helper retains its existing tools.

## Validation and restoration

The isolated Codex 0.156.1 native proof runs only `--version` and
`mcp list --json` in synthetic HOME/CODEX_HOME directories with no personal
credentials. Four user/project server declarations remain present and all
are disabled; the synthetic plugin MCP is absent after explicit plugin
disablement; loopback HTTP discovery requests are zero. The real OS system
layer cannot be redirected by an environment variable, so the native test
skips if a real system/managed config exists. Synthetic system enumeration
is covered statically and serialized into the isolated user layer for the
native overlay check; actual native system-layer loading was not exercised.
Plugin startup suppression during `exec` is established from the fixed
release's source gate, not by invoking a paid model.

An authorized pure static acceptance check against the personal CODEX_HOME
refused opt-out without acknowledgement and succeeded with acknowledgement,
enumerating eight configured servers. It invoked native Codex zero times,
wrote no configuration, and verified the original config SHA-256 unchanged.
Regressions cover malformed/unavailable config, quoted/control-character
names, feature precedence, relative HOME, new/resume/stdin argument parity,
whole-batch refusal, explicit header restoration, and executor propagation.
No live model, provider, browser, remote synchronization, or latency test was
performed. This is a child invocation contract, not a security sandbox or a
promise of faster execution.

Restore the default by omitting opt-out and its plugin acknowledgement,
choosing `--with-mcp`, or using `mcp: inherit` with
`allow_child_plugin_disable: false`. There is no global configuration to
roll back. The candidate remains local; publication/installation is a
separate action.

Source checks are fixed to the versions used for this contract:
[Codex config layers](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/config/src/loader/mod.rs),
[Codex CLI overrides](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/config/src/overrides.rs),
[Codex plugin startup gates](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core-plugins/src/manager.rs),
[Codex in-process startup](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/app-server/src/in_process.rs),
[Codex MCP list](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/cli/src/mcp_cmd.rs),
[Gemini configured-server filter](https://github.com/google-gemini/gemini-cli/blob/v0.53.1/packages/core/src/tools/mcp-client-manager.ts),
and [Gemini browser connection](https://github.com/google-gemini/gemini-cli/blob/v0.53.1/packages/core/src/agents/browser/browserManager.ts).
Local Gemini is 0.51.0; source inspection agrees with the relevant configured
server filter.
