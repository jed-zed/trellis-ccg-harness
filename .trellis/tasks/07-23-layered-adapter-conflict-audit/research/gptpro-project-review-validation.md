# GPT Pro whole-project review validation

## Baseline

- Remote review baseline: `aaab167a59c081a34927e3426068dfd987d5df98`
- Local state: the same commit plus the active layered-adapter dirty tree
- Authoritative personal CCG checkout: `I:\ai\ccg-workflow` at
  `8198a9607ba98a8c4af1a691ab104e88a978d9aa`
- Personal release: `jed-zed/ccg-gptpro-worflow`, tag `preset`, six wrapper
  assets with GitHub-published SHA-256 digests

## Validated findings

| ID | Verdict | Remediation |
|---|---|---|
| C-01 | Confirmed, fixed | Wrapper downloads now use only the personal release, verify one of six pinned SHA-256 digests before chmod or execution, then perform the version compatibility check. |
| C-02 | Confirmed, fixed | Executable npm/MCP sources are exact-versioned and recorded in `third-party-sources.json`; automatic `sudo` was removed. |
| M-01 | Confirmed, fixed | Codex mode now uses managed ownership records, collision backups, atomic writes, digest-safe uninstall, and byte-exact restoration when unchanged. |
| M-02 | Confirmed, fixed | Public npm self-update is disabled; updates route to the Harness transaction with a full personal commit. |
| M-03 | Confirmed, fixed | Init, doctor, and update paths propagate required failures and preserve rollback evidence. |
| M-04 | Confirmed, fixed | Generated hook commands quote absolute paths and have Windows path regression coverage. |
| M-05 | Confirmed, fixed | Unsafe ace token argv transport is refused; secret-bearing entries are not mirrored; managed secret specs use owner-only storage and launcher references. |
| M-06 | Confirmed, fixed | Root CI covers Ubuntu/Windows Node 20/22, Ubuntu/Windows/macOS Go, and cross-platform bootstrap/doctor/source gates without paid model calls. |
| M-07 | Confirmed, fixed | Root update, rollback, and uninstall transactions are ownership-aware, interruption-tested, and retain verified rollback snapshots. |
| P-01 | Confirmed, fixed | Root scripts and hooks use a Python 3.9+ resolver rather than assuming the `python` command. |
| P-02 | Confirmed, fixed | Doctor explicitly resets native status after tolerated probes and exits non-zero on required failures. |
| P-03 | Confirmed, fixed | Source verification binds credential-free repository URL, full commit, commit tree, exact component tree, and clean staged/committed state. |
| P-04 | Confirmed, fixed | Malformed shared settings fail closed without overwriting original bytes. |
| P-05 | Confirmed, fixed | Doctor includes an explicit bounded MCP stdio initialize smoke with timeout, process-tree termination, and exact secret redaction. |
| H-01 | Confirmed, fixed | The CCG Codex hook detects Trellis and delegates or yields without introducing `.ccg/tasks`, Claude, or dual lifecycle guidance. |

## Rejected or retained boundaries

- GPT Pro's 2 MiB response cap is an intentional local DoS boundary.
- Installed plugin cache synchronization remains an explicit, disposable cache
  repair path and is not a merge blocker.
- Grok ACP timeout/retry already has contract coverage.
- Python 3.9+ remains an intentional prerequisite; only executable resolution is
  defective.
- The two endpoint-protection-blocked security reference files remain untouched
  and unstaged.
