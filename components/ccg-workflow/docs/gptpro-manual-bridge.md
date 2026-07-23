# GPT Pro Manual Bridge

The GPT Pro bridge adds a user-mediated ChatGPT Pro layer to CCG without automating the ChatGPT
website. It does not create a separate Codex/Gemini/GPT Pro workflow. Instead, `gptpro-plan`,
`gptpro-review`, and `gptpro-exc` run the matching ordinary plan/review/execute semantics first,
preserve the current orchestrator and routed model evidence, then append GPT Pro as manual
task-local evidence.

## Layout

Runtime source is packaged under:

```text
templates/engine/tools/gptpro/
```

Installed location:

```text
~/.claude/.ccg/engine/tools/gptpro/
```

Task artifacts are written under:

```text
.ccg/tasks/<task-id>/gptpro/<session-id>/
  status.json
  round-1/
    prompt.md
    response.md
```

Canonical evidence is:

```text
.ccg/tasks/<task-id>/evidence.json
```

## Command Contract

- `/ccg:gptpro-plan` = ordinary `/ccg:plan` first, then manual GPT Pro planning second opinion.
- `/ccg:gptpro-review` = ordinary `/ccg:review` first, then manual GPT Pro review second opinion.
- `/ccg:gptpro-exc` = ordinary `/ccg:execute` preflight/routing/prototype or analysis evidence
  first, then manual GPT Pro second opinion before real code landing.

GPT Pro is fourth evidence. It is not a `codeagent-wrapper` backend, is not added to
`model-router.md`, and must not replace routed Codex, Claude, Gemini, or other configured helper
evidence.

## Manual Handoff

Plan/review modes still require valid Gemini gate evidence before creating the GPT Pro prompt.
Execution mode follows ordinary execute routing: backend-only work usually has no Gemini step, while
frontend/full-stack work may include real Gemini frontend evidence. Every GPT Pro mode now also
requires Base CCG Routing Evidence so the manual prompt can see what the ordinary command already
decided.

After the response is saved, the bridge:

- rejects empty responses;
- rejects preview writes without the per-session token;
- rejects responses larger than 2 MiB;
- writes the exact response bytes to `response.md`;
- records character count and SHA-256 in `status.json`;
- appends a GPT Pro item to `evidence.json`.

## Boundaries

- No ChatGPT login automation.
- No DOM scraping.
- No automatic prompt submission.
- No automatic output extraction.
- No browser cookies, sessions, or account tokens are stored.
- GPT Pro is not a `codeagent-wrapper` backend and must not be added to normal model routing.
- GPT Pro must not replace ordinary routed models or claim missing model participation.

## Evidence Contract

See `templates/engine/evidence-schema.md` for the canonical evidence shape.

For review mode, required Gemini evidence is:

```text
provider=gemini
role=gate
policy=required
available=true
artifactFile exists and is non-empty
artifactSha256 matches the exact artifact bytes
```

For GPT Pro responses, the bridge writes:

```text
provider=gptpro
role=review
policy=manual
available=true
artifactFile=gptpro/<session-id>/round-1/response.md
artifactSha256=<sha256>
```

For the ordinary routing evidence passed into GPT Pro prompts, use:

```text
--routing-evidence-file <routing-evidence-file>
--routing-summary-file <routing-summary-file>
--require-routing-evidence
--require-claude-evidence
```

`status.json` records:

```text
routing_evidence.available=true
routing_evidence.evidence_file=<path>
routing_evidence.evidence_sha256=<sha256>
routing_evidence.evidence_chars=<character-count>
routing_evidence.summary_file=<path>
routing_evidence.summary=<concise-summary>
routing_evidence.claudeEvidenceStatus=automatic|manual_handoff
```

Use `claudeEvidenceStatus=skipped_by_user` only when the user explicitly disabled Claude, and omit
`--require-claude-evidence` in that case. `blocked` or a missing status must stop bridge creation.

## Packaging Check

`package.json.files` already includes `templates/engine/`, so `templates/engine/tools/gptpro/**`
is included by the existing package allowlist. Release validation should still inspect `npm pack`
output before publishing.
