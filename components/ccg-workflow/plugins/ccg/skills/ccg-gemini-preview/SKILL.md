---
name: gemini-preview
description: Run a read-only Gemini helper task with a local browser preview. Use when the user invokes /ccg:gemini-preview, asks to test Gemini preview, or wants to watch Gemini output while Codex delegates a CCG helper task.
---

# CCG Gemini Preview

`/ccg:gemini-preview` is the manual smoke-test and debugging entry for the same browser preview helper used by the rest of the CCG workflow. It is not a special mode that other commands must ask the user to run. Whenever `/ccg:plan`, `/ccg:execute`, or `/ccg:review` calls Gemini internally, they should invoke this helper themselves and open the browser preview automatically.

Use the Gemini preview helper bundled with this plugin:
`../ccg-executor/scripts/invoke_gemini_preview.py`.

Default command:

```powershell
python "<plugin-skill-root>\ccg-executor\scripts\invoke_gemini_preview.py" --workdir "<repo-abs-path>" --model gemini-3.1-pro-preview --prompt-template general --prompt "<focused prompt>"
```

The helper defaults to `gemini-3.1-pro-preview` when `--model` is omitted, while `GEMINI_MODEL` and `--model` can still override it. It also defaults to `--prompt-template general`, with additional templates `plan`, `prototype`, `review`, `frontend`, `analyzer`, `architect`, `debugger`, `optimizer`, and `tester` bundled under `ccg-executor/templates/gemini/`. These templates preserve the original CCG model boundary: Gemini is read-only and Codex owns final application and verification. It runs Gemini in a disposable workspace snapshot by default. For large repositories, use `.ccgignore`, `--respect-gitignore`, `--max-snapshot-bytes`, `--max-snapshot-files`, or `--files-from` to keep snapshots focused without weakening secret exclusions. Use `--direct-workdir` only when the user explicitly accepts direct workspace access.

For background mode, run the default foreground command in a tool-managed background job. Do not pass `--detach` from a Codex workflow; monitor the job until the helper exits, then read `CCG_GEMINI_RESPONSE_FILE` before using Gemini's output. The helper opens the browser automatically and prints `CCG_GEMINI_PREVIEW_URL`, `CCG_GEMINI_BROWSER_OPENED`, `CCG_GEMINI_RESPONSE_FILE`, `CCG_GEMINI_PROMPT_TEMPLATE`, and `CCG_GEMINI_AUTO_CLOSE_BROWSER_SECONDS`. The preview page intentionally follows the original `codeagent-wrapper` single-column Live Output style while the helper still writes raw logs and response files for Codex to inspect. The preview page closes itself after completion by default. Use `--no-auto-close-browser` only when the user explicitly wants the preview tab kept open. The OS-level `--detach` option remains for manual shells outside tool-managed execution.

## Live Output source and compatibility

The browser page is the mechanically resolved `generateIndexHTML()` template
from `fengshao1227/ccg-workflow` commit
`9eaff791de19fe45a1713b1153e65c5c7b607f80`,
`codeagent-wrapper/server.go`, distributed under its MIT license as
`ccg-executor/templates/live-output.upstream.html`.

The Python helper applies only narrow, assertion-backed compatibility patches:

- task text uses DOM `textContent`;
- new SSE clients receive no historical content;
- successful runs may notify and close after the configured delay;
- failed runs display the real exit code and stay open;
- `--no-auto-close-browser` keeps successful pages open;
- the preview remains bound to `127.0.0.1` and SSE is same-origin.

Template absence or patch-anchor drift is a startup error. Snapshot isolation,
prompt templates, manual-shell detach support, raw logs, and response-file
contracts remain owned by the Python helper.
