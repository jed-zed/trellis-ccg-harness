# Optional DeepSeek Harness compatibility

The personal workflow keeps Codex/Trellis as its default task authority and
writer. This separately enabled profile bundle adds one explicitly routed
`ccg_dsh_review` opinion tool. It does not start Harness, configure a provider,
copy credentials, change CCG model defaults or install Harness itself.

DeepSeek Harness is a developer preview with compatibility changes. This
integration follows the CCG v3.6.7 plugin contract at upstream commit
`f349e3de191f3b12609f9d4448772eddddc7e37b` and the official
`@deepseek-ai/dsh-tool-subagent@0.1.0-rc.6` schema/types. It implements a smaller
bundle instead of importing the seven-role `dsh-ccg@0.4.7` composition.

## Explicit entry

Select one existing profile and an absolute private staging prefix. Review the
plan before invoking the separate install action. No omitted option selects
all profiles or creates a new profile.

```text
ccg deepseek-harness plan --dsh-home /absolute/dsh-home --profile web --prefix /absolute/ccg-optional --provider existing-gateway --model explicit-model
ccg deepseek-harness install --dsh-home /absolute/dsh-home --profile web --prefix /absolute/ccg-optional --provider existing-gateway --model explicit-model --dsh-cli /absolute/dsh-cli.js
ccg deepseek-harness doctor --dsh-home /absolute/dsh-home --profile web --prefix /absolute/ccg-optional
ccg deepseek-harness rollback --dsh-home /absolute/dsh-home --profile web --prefix /absolute/ccg-optional
```

Use `--dry-run` with install or rollback for a read-only plan and `--json` for
structured results. Windows paths work in the same options. On Windows a npm
batch shim cannot be executed safely through `execFile`; the resolver finds
the official package's actual Node launcher, or `--dsh-cli` specifies it.
Shell, batch and PowerShell scripts are rejected as launchers. Provider/model
values are stored in a private route declaration, never in shell text.

Install stages an independently named package at
`PREFIX/ccg-deepseek-compat/PROFILE`, appends one `file:` dependency and bundle
entry to the selected profile's existing manifest, then invokes only
`dsh plugin --profile PROFILE install` with that profile's cwd and `DSH_HOME`.
This explicit installation may resolve packages using Harness's own package
manager; it makes no provider/model request. There is no fallback to a global
npm/pnpm installation and no automatic DSH process startup.

## Runtime policy

The optional tool uses official `spawn`, a `one-shot` lifecycle,
`maxDepth: 1`, a 2048-token child output cap and `toolFilter: { allow: [] }`.
`enableRunInBackground: false` leaves no background-job entry. The output cap
is not a billing limit. The optional tool alone carries the official
ToolRuntime `timeoutMs: 120000` deadline and inherits the caller's AbortSignal.
One delegation can start; its
child receives no tools, including no file-writing or further delegation
tools. `maxDepth: 0` would prohibit the entry itself and is deliberately not
used. Providers that cannot enforce these official capabilities must fail
rather than receiving a prose-only substitute.

The plugin requires a complete provider/model pair and a matching provider
route from `llm.listConfigurableProviders()`. Missing or unavailable catalog
APIs fail before any role is registered. It never silently inherits a
deployment-default model. A configured provider name proves local routing,
not that the remote model exists, its credentials work or requests succeed.

Team, memory, knowledge, triage, routing prompts, skills, cross-check panels,
live settings and resident teammates are absent. Thus the upstream team
confirmation path is never used. Upstream `confirmHire` can approve when a
question provider is absent or throws; it is not an approval guarantee.
Upstream ownership prompts also are not filesystem sandboxing. This bundle
does not add an approval or memory system alongside Trellis.

## Ownership, diagnosis and rollback

The installer refuses undeclared ownership, profile collisions, links or
junctions in its owned paths, changed profile bytes, edited plugin files,
hard-linked owned files and additional content. A private ownership receipt
records the exact payload hashes and a private copy of the original profile
manifest. Provider settings and credential files are never read or written.

`ready` means the unchanged payload resolves and the plugin imports through
Node, including its transitive peers. It does not claim a native Harness boot
or successful model request;
every result contains `runtimeVerified: false`. A linker failure or a successful
return with missing modules yields `declared-but-unlinked`, `success: false`
and a nonzero command exit status. Repeating install can retry linkage without
rewriting the owned files. Changing a route/version requires rollback first.

Rollback verifies the full ownership set before restoring the original
manifest bytes and removing only the unchanged plugin payload. It leaves
package-manager lockfiles, module directories and caches for inspection.
It never recursively deletes a Harness home or profile. A user edit blocks
automatic rollback so that the edit remains reviewable.

## Validation and limits

Regression tests use an isolated real Node subprocess to exercise launcher
argv, cwd, environment, file dependency copies, module resolution and installed
plugin import. They cover missing dependencies, failed linking, full ownership,
dry runs, repeat installation, user-change refusal, exact rollback and route
validation. Fixtures do not start a provider or a browser. A native DSH boot
and a paid provider call remain unverified; enabling them needs an explicitly
selected installation and provider environment.

Separate fixed official SDK evidence lives in
`four-integrations/dsh-official-sdk-proof/verify.mjs` and `result.json` in the
research workspace. It runs the actual rc.6 ToolSubagent schema, registration
and execute function and the actual SubagentRuntime dispatch/capability
checks. Only the spawn provider and event transport are finite local fakes.
Its 16 checks verify route, persona, empty tools, depth, foreground disposal,
background refusal, caller cancellation, scoped timeout definition, provider
removal and the unchanged parent model options. The executed module matches
the SRI-verified official archive. It makes zero model calls and does not
represent a native DSH deployment. The fixed SDK lock contains 13 packages;
it is test evidence rather than a new default CCG runtime dependency.

Primary contracts:

- [DeepSeek Harness official repository](https://github.com/deepseek-ai/deepseek-harness)
- [Official ToolSubagent package](https://registry.npmjs.org/@deepseek-ai/dsh-tool-subagent/-/dsh-tool-subagent-0.1.0-rc.6.tgz)
- [CCG v3.6.7 DSH plugin](https://github.com/fengshao1227/ccg-workflow/tree/f349e3de191f3b12609f9d4448772eddddc7e37b/dsh-ccg)
