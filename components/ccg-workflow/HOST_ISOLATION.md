# Personal CCG host isolation

This distribution belongs to Codex. Install it as the separate package
`@jed-zed/ccg-codex-workflow`; its only npm command is `ccg-codex`.
The upstream Claude distribution keeps the `ccg` command. Do not install this
candidate over the existing global `ccg-workflow` package.

Personal configuration is `${CODEX_HOME}/ccg/config.toml`, or
`~/.codex/ccg/config.toml` when `CODEX_HOME` is unset. Managed install, uninstall,
and recovery reject paths overlapping Claude configuration, including junction
aliases and `CLAUDE_CONFIG_DIR`.

Use `ccg-codex codex-mode install --wrapper-file <pinned-local-wrapper>` for
the personal Codex runtime. `ccg-codex codex-mode uninstall` removes only its
owned runtime. Existing transaction journals, drift checks, and backup rules
remain in force. `ccg-codex doctor` and `status` inspect Codex. Legacy Claude
initialization, menu, MCP configuration, Grok management, and uninstall are
unavailable; use upstream CCG for those actions.

For the two existing agents with additive user model overrides, first run
`ccg-codex codex-mode plan-agent-preservation --baseline-dir <verified-old-agents> --agent-model gpt-6.1-sol --agent-reasoning xhigh --json`.
Save the explicit plan and install with `--agent-preservation-plan <absolute-plan>`.
The installer retains their exact user bytes and original installed hashes;
separate preservation records bind the baseline, plan and current bytes.
Prompt, sandbox, feature changes and later user edits fail the validation.
Uninstall keeps these preserved user agents and their ownership history.

Harness setup accepts separate `-HomeDir <AgentsHome>` and
`-CodexHome <physical-CodexHome>`. Use its pinned local package archive and
explicit agent plan options for the reviewed migration. Changing the physical
root or package namespace requires its own validated plan and receipt.

Claude GPTPro support is the independent `plugins/ccg-gptpro-bridge` addon.
Load that addon explicitly with Claude's `--plugin-dir`; do not load the
personal `plugins/ccg` Codex plugin into Claude. The addon owns no CCG routing,
Trellis policy, hooks, MCP registration, model setting, or PATH executable.
Its private transport snapshot does not replace the installed Codex bridge.

For upgrades, the Harness must validate the package name and executable as a
pair before choosing the command. It must continue checking Claude directory
bytes before and after each setup step. Existing ownership for the legacy
package is not permission to remove it or replace upstream Claude files.

The current live Claude installation already contains personal legacy CCG
assets. This candidate prevents future interference; replacing those existing
assets with upstream is a separate, backed-up migration. Preserve user model,
permissions, unrelated hooks, commands, and credentials. A dry-run manifest must
pin both current and replacement bytes and reject drift before a live migration.

Local verification does not establish native Claude GPTPro runtime success.
An approved, extension-connected ChatGPT Pro tab is required for a real send,
ZIP upload, exact-conversation completion, and verified response import.
