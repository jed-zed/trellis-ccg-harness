# GPT Pro bridge for original Claude CCG

This optional, separately named Claude plugin adds `/ccg-gptpro-bridge:gptpro-plan`,
`/ccg-gptpro-bridge:gptpro-review`, and `/ccg-gptpro-bridge:gptpro-exc`. It leaves the
original author's `/ccg:*` workflow and model settings in charge. It contains no
Harness routing, task approval, Trellis memory, hooks, MCP registration, credentials,
or PATH executable. No automatic invocation, authentication, or message is installed.

The private transport is a reviewed snapshot of the user's existing authorized
`chatgpt-pro-sidebar` bridge. `scripts/vendor/UPSTREAM_SNAPSHOT.json` records each
original SHA-256. The three fixed DOM JavaScript files and ZIP implementation are
copied byte for byte. Two PowerShell entry points add explicit host metadata and
RootWait-only Claude lifecycle support. Updating this private snapshot requires
review and testing; it does not silently track or overwrite the daily bridge.

## Load and lifecycle

For a session-local preview, use `claude --plugin-dir <absolute-plugin-directory>`.
Claude's normal permissions still apply. Do not use a permissions bypass.

The local installer requires an explicit physical Claude home, a reviewed physical
Claude executable, and the separately built Windows launcher with its exact SHA256.
It writes the plugin, its ownership receipt, an adjacent empty runtime lock, and
owned backup ZIPs. It does not edit settings, PATH, profiles, credentials, permissions,
marketplaces, original CCG commands, or browser/MCP registrations:

```text
python scripts/claude_bridge.py install --claude-home <absolute-claude-home> --claude-executable <physical-claude.exe> --launcher-file <reviewed-launcher.exe> --launcher-sha256 <sha256>
python scripts/claude_bridge.py uninstall --claude-home <absolute-claude-home>
python scripts/claude_bridge.py rollback --claude-home <absolute-claude-home> --backup <exact-returned-backup.zip> --backup-sha256 <returned-sha256>
```

The stable daily entry is `<claude-home>/plugins/local/ccg-gptpro-bridge/ccg-gptpro-claude.exe`.
Run that absolute executable from the project directory, or point an ordinary local
shortcut at it. It adds the supported `--plugin-dir` flag automatically; all user
arguments, other plugin directories, cwd, and ordinary Claude permissions remain in
effect. It starts a fresh Claude session; launching ordinary `claude` directly does
not enable this addon. Existing sessions require a new launch through this entry.
No global alias, persistent plugin registration, or execution-policy change is needed.

The dependency-free launcher source is `scripts/launcher/main_windows.go`; the
Windows binary is a separate distribution artifact, not a Git source file. The
installer records its SHA256 and byte count independently. A JavaScript Claude
entry is also supported with explicit `--claude-runtime <physical-node.exe>`;
shell `.cmd`/`.ps1` shims are rejected. Native Windows loading/discovery is tested;
macOS/Linux launchers are not provided.

Only a complete matching ownership receipt permits update or uninstall. Missing,
changed, linked, hard-linked, or extra files fail closed. Identical reinstall is a
no-op. Reinstall from the owned copy can reuse its recorded CLI and launcher pins;
changing either executable requires explicit reviewed input. The launcher checks
every owned plugin file and CLI pin before starting Claude. Multiple active sessions
hold shared runtime locks; install, uninstall, and rollback require exclusive access
and stop before changing plugin files while a session is active. Updates
and uninstall first save the exact owned directory and receipt in an adjacent ZIP,
with the backup path/hash returned to the caller. The recursive removal target is
resolved and checked again immediately before removal. The formal rollback command
checks the exact backup path/hash, safe bounded ZIP inventory, matching target/owner,
and complete current ownership before restoring. Later user edits or extra files stop
the whole rollback and remain untouched; review those conflicts separately. Rollback
also backs up a current valid install, so the action is reversible. Other Claude paths
remain untouched. Keep original CCG installation separate from this addon.

## Host and browser contract

Claude substitutes `${CLAUDE_SESSION_ID}` in skill/command content. The adapter
requires that real canonical session UUID. It derives a namespaced transport UUID
from `ccg-gptpro-bridge/claude/<session-id>`; the old `CodexThreadId` parameter and
`codexThreadId` evidence field retain that **legacy protocol key only**. They are
never claimed to be a Codex session. Every durable state/event/evidence record also
contains `hostKind=claude`, `hostSessionId`, and `transportThreadId`. Raw authority
records `claudeIsSoleWorkspaceWriter=true`, `codexIsSoleWorkspaceWriter=false`.
Final imported evidence records Claude ownership and preserves raw evidence hashes.

The browser remains the installed `agent-browser-cli-v2` extension/CLI channel.
Status must identify an already approved target. New chat, upload and RootWait use
that exact browser/profile/tab/session binding and a canonical blank ChatGPT tab.
No login, extra authorization, cookie/API access, CDP, Playwright, or fallback
transport is provided. Missing extension/tab, authentication, and permission
barriers are real blockers for the user. Existing shared global capacity and target
claims remain in force (six total, three per namespaced host session).

The official Browser Service MCP wrapper is a different interface. This plugin
does not register it, claim its file-upload compatibility, or switch to it. Claude
uses its existing permitted Bash interface to call the same fixed transport. A
future MCP-only integration needs its own reviewed schema and real capability test.

One prepared round can invoke `run-root` once. The started marker is written before
launch; a lost result never permits caller resend. The unchanged transport may make
its single internal proved-not-submitted retry under the original 180-second proof
and absolute deadline contract. Other failures preserve evidence for diagnosis.
Only a completed, live, exact-bound RootWait result is importable. Matching import
is idempotent; changed content, host/session, target, prompt, URL, watcher or hashes
is rejected. RootWait runs local polling, with no Stop Hook, desktop wake, agent
monitor, model watcher or background model continuation. This first Claude adapter
supports sequential independent rounds; its batch interface is intentionally absent.

Evidence stays under `.ccg/gptpro-bridge/claude/<session>/<round>/`; it does not read
or write task lifecycle state. GPT Pro results are untrusted advisory evidence.
Claude owns the original CCG result, implementation and verification.

## ZIP attachments

Attachments are optional and explicit. Never collect private project files
automatically. Supply the existing schema-v1 manifest with one to six ordinary ZIPs,
absolute local paths, exact filenames, byte counts, SHA-256 and complete target binding.
The existing conservative limits are 1 MiB per ZIP, 4 MiB total and 8 MiB inspected
expanded data, with unsafe-path and credential-pattern rejection.

`upload` uses the unchanged fixed DOM template and File/DataTransfer assignment;
`upload-status` only observes the original ledger. Ready receipts require two stable
bound-page observations at least 500 ms apart. Upload is separate from message send.
RootWait requires the original complete manifest and receipt; the fixed transport
rechecks cards before filling and before its send commit. The Claude adapter seals
both original hashes into the send state and completion evidence, then verifies those
same hashes, files and exact target during import. Unknown/pending uploads are not
assigned again automatically. Specialized old display-name recovery is not a new
automatic mapping permission.

## Validation and limits

`tests/test_claude_bridge.py` exercises offline forged evidence and lifecycle
fixtures. `tests/host-contract.ps1` exercises actual private PowerShell functions
without invoking a browser. These are contract tests, not live model/Claude/browser
acceptance. `claude plugin validate <plugin-dir>` checks actual native plugin parsing
without a model request. `doctor` checks local files only.

Real acceptance still requires a real Claude session loading this plugin, its
ordinary original CCG route, one authorized synthetic GPT Pro round (including a
synthetic ZIP if requested), completed capture/import, and independent verification.
No live Claude or GPT Pro execution is claimed by the offline tests.

Official references checked 2026-10-03:
[Claude skill substitutions](https://code.claude.com/docs/en/skills),
[plugin layout and path substitutions](https://code.claude.com/docs/en/plugins/manifest-reference).
