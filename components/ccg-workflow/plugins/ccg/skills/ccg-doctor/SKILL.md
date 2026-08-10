---
name: doctor
description: Diagnose the local CCG Codex plugin installation. Use when the user invokes /ccg:doctor, asks whether CCG is installed correctly, or asks to inspect CCG command/skill/MCP/Gemini availability.
---

# CCG Doctor

Run the read-only doctor and summarize it in Chinese.

## Invocation

Resolve the doctor script relative to this skill:

```text
skills/ccg-doctor/SKILL.md -> ../../scripts/doctor.ps1
```

Default command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -Verbose
```

If the user asks for JSON or machine-readable output:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -Json
```

If the user explicitly asks to check Gemini model availability, add `-CheckGeminiModel`. Use `-GeminiModel <model>` only when the user names a model; otherwise doctor checks the configured default model:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -CheckGeminiModel -GeminiModel gemini-3.1-pro-preview -Verbose
```

The model probe uses Gemini CLI `--skip-trust` so availability diagnostics do not stall on workspace trust prompts.

For Grok intelligence diagnostics:

```powershell
# Local-only: binary/version/help/models/auth, isolated inspect, ACP handshake, retention report.
# This never sends a model prompt and never performs a paid Web/X call.
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -Grok -Verbose

# Explicit paid smoke only when the user asked for --grok-live.
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -GrokLive -Verbose

# Cleanup is separately explicit and never implied by -Grok.
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -Grok -GrokCleanup -Verbose
```

If browser OAuth is missing, tell the user to run `ccg grok login`. Do not read, copy, or print
`auth.json`. A configured `grok-search` MCP is a warning only: do not remove it and do not accept it
as official Grok intelligence evidence.

If the user invokes `/ccg:doctor --fix`, first determine whether the current workspace is the `ccg-codex-workflow` source checkout by checking for `plugins/ccg/.codex-plugin/plugin.json` and `scripts/sync-local-plugin-cache.ps1`.

- In the source checkout, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin-root>\scripts\doctor.ps1" -PluginRoot "<repo-root>\plugins\ccg" -Fix -Verbose
```

- Outside the source checkout, stay read-only. Run the normal doctor command without `-Fix`, then explain in Chinese that automatic cache repair requires the source checkout because fixing uses `sync-local-plugin-cache.ps1` as the trusted source.

## Reporting

- If `FAIL > 0`, lead with the failed checks and concrete repair suggestions.
- If there are no failures but `WARN > 0`, say the base plugin is usable and explain optional/degraded items.
- If everything is PASS/SKIP, say the plugin diagnostics passed and note any skipped checks.
- Mention that doctor checks prompt-visible skills and local file state. It cannot prove Codex TUI slash autocomplete.

## Boundaries

- Default doctor remains read-only and must not modify `.codex`.
- With `--fix`, only refresh the local CCG plugin cache from the source checkout. Do not install or remove command bridge files.
- Do not install or uninstall the command bridge.
- Do not call Gemini or run a real model request unless the user explicitly asks for `--check-gemini-model` or equivalent model availability diagnostics.
- Do not send a Grok model prompt unless the user explicitly asks for `--grok-live`; `--grok` is local-only.
- Do not delete expired evidence or private roots unless the user explicitly asks for `--grok-cleanup`.
- Do not change repository files while handling `/ccg:doctor`.
