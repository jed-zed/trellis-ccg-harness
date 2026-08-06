# Pi Agent CLI contract (official-source research)

Checked 2026-08-03.

## Confirmed official contract

- Canonical repository: https://github.com/earendil-works/pi
- Canonical package: `@earendil-works/pi-coding-agent`; executable: `pi`.
- Non-interactive machine output: `pi --mode json "prompt"` emits JSONL.
- First JSONL record is `{type:"session", version:3, id:"...", cwd:"..."}`.
- Lifecycle includes `message_update`, `message_end`, `turn_end`, and
  `agent_end`; assistant messages carry structured content blocks.
- Deterministic resume uses `--session <path|id>`; `-r/--resume` opens a
  selector and is unsuitable for automation.
- The CLI keeps the caller's working directory; it has no `--cwd` option.
- Session storage and lookup are keyed by CWD. A `--session` ID found in another
  project triggers an interactive fork confirmation, so an automated resume
  process must start in the original caller-provided work directory.
- Positional arguments are parsed as CLI options and `@file` inputs before they
  become messages. A later `--approve` overrides an earlier `--no-approve`.
  All wrapper-controlled task text must therefore use stdin.
- Assistant messages carry `stopReason` values including `stop`, `toolUse`,
  `length`, `error`, and `aborted`, plus optional `errorMessage`. JSON mode does
  not apply the text-mode exit-code conversion for `error` or `aborted`, so the
  wrapper must interpret these terminal states itself.
- A documented read-only tool example uses
  `--tools read,grep,find,ls -p "Review the code"`.
- `--no-approve` ignores untrusted project-local resources for one run;
  project resources can also be disabled with explicit `--no-*` flags.
- Windows requires Bash, with Git Bash as the documented normal setup.
- Pi has no built-in OS permission sandbox. Tool allowlisting reduces exposed
  tools but does not isolate filesystem/process/network/credential access.

Primary sources:

- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/windows.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/args.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/print-mode.ts
- https://github.com/earendil-works/pi#permissions--containerization

## Local state

- `pi` is not currently present in PATH, so no local runtime or authentication
  smoke test was performed.
- The CCG Grok intelligence channel was retried with a valid export directory
  but returned `configuration_required` / exit 4 because external intelligence
  is not enabled and explicitly consented in that channel. No Grok evidence
  bundle was produced. Official web-source evidence above remains available.
