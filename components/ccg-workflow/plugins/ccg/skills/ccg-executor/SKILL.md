---
name: executor
description: Run the CCG workflow inside Codex. Use when the user invokes /ccg, /ccg:workflow, /ccg:execute, /ccg:excute, /ccg:codex-exec, asks Codex to execute a .codex/ccg/plans/*.md file, or wants Codex to orchestrate allowed evidence while implementing a CCG plan.
---

## Automatic External Intelligence Gate

Before ordinary work, run the shared route once from the controller:

`ccg route --workflow execute --phase intake --task-file ".ccg/tasks/<task-id>/intelligence-request.md" --state-file ".ccg/tasks/<task-id>/intelligence-route.json"`

Append existing --plan, --diff, --target, and repeatable --dependency paths whenever those artifacts are available. Add `--semantic-mode contract|incident --semantic-reason "<Codex judgment>"` only for an explicit semantic decision. The runtime honors disabled config, persists the decision reason, and must be re-run after plan, dependency, target, diff, or phase digest changes. Stop ordinary work on exit code `2`, `3`, or `4`.

# CCG Executor

You are the Codex-side orchestrator for CCG workflow plans. Plans are produced by `/ccg:plan` under `.codex/ccg/plans/`. Codex owns orchestration, final code edits, verification, and delivery. The provider for each workflow role comes from CCG role routing, while Codex remains the only final workspace owner.

## Hard Boundaries

- Do not install, repair, or modify provider CLIs from an ordinary CCG workflow.
- Do not let any routed provider directly own the real workspace. External
  providers supply bounded analysis, Unified Diff Patch prototypes, tests, or
  review notes; Codex applies final edits and verifies them.
- Claude is disabled for ordinary delegation. It may run only through an
  explicitly authorized `ccg product-manager review` call when unified routing
  selects Claude for `product-manager`; the call remains snapshot-bound,
  Read/Glob/Grep-only, no-write evidence inside the existing Trellis lifecycle.
- Treat external diffs as dirty prototypes. Codex must refactor them into the
  repository's local style before applying, never paste them into the real
  workspace unchecked.
- Every Gemini call in the CCG workflow must use the bundled preview helper `scripts/invoke_gemini_preview.py`, which opens a browser preview by default. `/ccg:gemini-preview` is only a manual smoke-test/debug entry, not the only path that shows the preview.
- Do not call the raw `gemini`, `gemini.cmd`, or `gemini.exe` CLI directly for `/ccg:plan`, `/ccg:execute`, `/ccg:review`, or workflow-internal delegation. The only exception is `/ccg:doctor --check-gemini-model`, which performs an explicit availability probe.
- Preserve existing user changes. Inspect `git status` before edits and work around unrelated dirty files.
- Communicate with the user in Chinese. Tool prompts and external documentation queries may be English.
- Follow the current project's `AGENTS.md` and its code-search policy. CCG
  must not install, configure, or enable an MCP server. Use a third-party
  search tool only when its installation was explicitly approved by the user
  and the active project policy permits it. Do not invoke ace-tool or create a
  CodeGraph index automatically; fall back to local search and targeted reads.

## Architecture Shift

The original CCG model was:

```text
Claude Code orchestrates Codex + Gemini
```

In Codex, the model is:

```text
Codex orchestrates four configured top-level roles, applies code, verifies,
and reports. Frontend or backend work automatically adds search evidence and
evaluates the product-manager authorization gate.
```

When an old plan mentions `CODEX_SESSION`, `GEMINI_SESSION`, or legacy external handoff files, treat them as provenance and intent, not as sessions to resume. Translate legacy orchestration into current role routing, bounded provider evidence, Codex edits, and Codex verification.

## Role Routing

Read `../../rules/ccg-role-routing.md` before assigning generic model work and
follow its **Companion Role Contract**. Classify each task slice and resolve the
top-level roles needed:

```text
ccg routing get frontend --json
ccg routing get backend --json
ccg routing get search --json
ccg routing get product-manager --json
```

Analysis, planning, implementation drafting, and review are phases inside the
applicable frontend, backend, or search role. They do not have separate saved
providers. Frontend is not permanently Gemini and backend is not permanently
Codex. An explicit provider request for the current task wins without changing
the saved defaults.

Whenever `frontend` or `backend` is used, resolve one logical `search`
operation for the same phase. Keep one stable operation/evidence identity,
allow at most two total attempts against the same configured Provider, and
record `attemptCount`. Then evaluate the mapped product-manager candidate and
record `searchStatus` and `productManagerStatus`; stop at
`authorization_required` until the user explicitly authorizes that Provider
call.

## Input Handling

1. Treat the command argument as either:
   - a plan path under `.codex/ccg/plans/<task>.md`; or
   - a direct task description.
2. If it is a plan path, read the file and extract:
   - title and task type;
   - implementation steps;
   - key files and expected operations;
   - acceptance criteria and test commands;
   - any `CODEX_SESSION` / `GEMINI_SESSION` notes, for context only.
3. If it is a direct task description and no clear plan exists, ask for the plan path unless the user explicitly says to execute without a plan.
4. Resolve the provider for every role used by the plan before delegating that
   slice. The selected provider supplies bounded evidence or a prototype before
   Codex implements it when the plan requires external assistance.
5. If the plan involves costly ML training, GPU jobs, destructive data writes, or production deployment, implement code and smoke tests only; do not start expensive or destructive runs without explicit confirmation.

## Provider Delegation Policy

Use the configured role provider as a helper, not as the executor of record.
When the selected provider is Gemini, every call must use the bundled preview
helper and should open the browser preview automatically unless the user asked
for headless execution. For `antigravity`, `grok`, or `pi`, use
`ccg wrapper --backend <provider> ...`. This managed launcher validates the
pinned wrapper and preserves its default Web UI; add `--lite` only when the
user explicitly wants headless output. Ordinary Claude delegation is not
allowed outside the product-manager contract.

Codex-native trigger rules:

- S + low risk: resolve the role, then Codex may handle it directly when the
  selected provider is `codex`.
- S + high risk: run required local quality/security gates and ask the
  applicable role provider for review when policy requires external review.
- M+ complexity: ask the applicable role provider for its analysis or review
  phase when required by the active project policy.
- Diffs over roughly 30 changed lines, auth/database/crypto/security-sensitive
  changes, or unclear root-cause/debugging work require the applicable CCG
  quality/security gates.

- Backend-heavy tasks use the configured `backend` provider for analysis,
  planning, drafts, and review.
- Frontend/UI tasks use the configured `frontend` provider for analysis,
  planning, prototypes, and review.
- Frontend or backend work automatically starts the logical `search` operation
  defined by the Companion Role Contract as required companion evidence,
  including review of gathered evidence.
- At the next eligible checkpoint, evaluate the mapped `product-manager`
  candidate and pause for explicit per-call authorization before invocation.
- Cross-cutting tasks split by role without changing the saved role mappings.
- If a required external provider fails after at most two total attempts, stop
  and report the missing evidence instead of silently substituting another
  provider.

When Gemini is selected, use:

```powershell
python "<path-to-this-skill>\scripts\invoke_gemini_preview.py" --workdir "<repo-abs-path>" --model gemini-3.1-pro-preview --prompt-template review --prompt-file "<prompt-file>"
```

Resolve `<path-to-this-skill>` from this `SKILL.md` directory. This helper creates a disposable snapshot of the workspace by default, starts a localhost browser preview, streams Gemini `stream-json` output into the page, and writes the raw output under `~/.codex/ccg/logs/`.

`/ccg:gemini-preview` is a convenience command for manual tests and one-off helper prompts. It does not change the rule above: when `/ccg:plan`, `/ccg:execute`, or `/ccg:review` decides to use Gemini internally, launch this same preview helper directly and let it open the browser.

Gemini prompts must use the bundled standard templates in `templates/gemini/`. They are adapted from the original CCG role prompts and command templates, but rewritten for Codex-native orchestration:

| Template | Use |
| --- | --- |
| `general` | Default bounded analysis, edge cases, and test ideas |
| `plan` | `/ccg:plan` read-only planning analysis |
| `prototype` | Draft implementation as a Unified Diff Patch dirty prototype |
| `review` | Bounded second-pass code review |
| `frontend` | UI, UX, accessibility, responsive, and component Unified Diff prototype or review |
| `analyzer` | Read-only architecture, codebase, risk, and option analysis |
| `architect` | Backend/API/data-flow architecture alternatives |
| `debugger` | Root-cause hypotheses, reproduction strategy, and regression tests |
| `optimizer` | Performance, reliability, complexity, and maintainability tradeoffs |
| `tester` | Edge cases, fixture strategy, and test-gap review |

Use `--prompt-template <name>` for every Gemini helper call. Use `--prompt-template none` only for debugging the helper itself.

The disposable snapshot excludes common secret files and credential directories such as `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `.aws`, `.gcp`, and `.azure`. The helper prints `CCG_GEMINI_SNAPSHOT_PATH`, `CCG_GEMINI_SNAPSHOT_EXCLUDES`, copied file/byte counts, and skipped categories; if a task truly needs one of those files, ask the user for a sanitized excerpt instead of copying secrets into Gemini context. For large repositories, prefer `.ccgignore`, `--respect-gitignore`, `--max-snapshot-bytes`, `--max-snapshot-files`, or `--files-from` rather than weakening secret exclusions.

Use `--no-browser` only for quick smoke tests or when the user explicitly wants headless execution. For long-running background delegation, add `--detach`; the parent process now reserves the preview port, waits for the preview server, opens the browser itself, and prints `CCG_GEMINI_PREVIEW_URL`, `CCG_GEMINI_BROWSER_OPENED`, `CCG_GEMINI_PREVIEW_PID`, `CCG_GEMINI_OUTPUT_FILE`, `CCG_GEMINI_RESPONSE_FILE`, `CCG_GEMINI_LAUNCHER_LOG`, `CCG_GEMINI_PROMPT_TEMPLATE`, and `CCG_GEMINI_AUTO_CLOSE_BROWSER_SECONDS`. The browser preview follows the original `codeagent-wrapper` single-column Live Output style; raw stream-json/debug output remains in the printed log files for Codex to inspect. It attempts to close itself after completion, defaulting to 3 seconds; use `--no-auto-close-browser` only when the user wants to keep the preview open. Later read the response file before acting on Gemini's suggestions. Use `--direct-workdir` only when the user explicitly accepts that Gemini may touch the real workspace.

Gemini task prompts should include only the task-specific payload because the helper prepends the standard CCG template:

- task goal and relevant plan excerpt;
- exact files or snippets to inspect when available;
- a request for concise output: analysis, unified diff, test cases, or review findings;

## Execution Workflow

### Phase 0: Preflight

- Run `git status --short`.
- Read project instructions (`AGENTS.md`, relevant project docs, and any plan-linked notes).
- Summarize the plan internally as scope, files, tests, and risks.
- For substantial tasks, maintain a task checklist and update it as work progresses.
- Resolve the role providers needed by the task and state substantial
  delegation briefly in Chinese.

### Phase 1: Context Search

- Read the current project's `AGENTS.md` before selecting a search tool.
- Use `rg` for known identifiers, filenames, literals, or error messages.
- Use CodeGraph only for known-symbol relationships and only when a current
  `.codegraph` index already exists; never create one automatically.
- Use an already-approved semantic or documentation tool only when project
  policy permits it. Do not register an MCP or suggest a direct package-runner
  installation from this workflow.
- Read the specific files needed after search identifies them. If an optional
  tool is unavailable, continue with targeted reads rather than aborting.

### Phase 2: Routed Provider Assistance

- Build a narrow prompt from the current plan and local code context.
- Prefer asking for one of:
  - an implementation outline for backend-only work;
  - a focused unified diff for backend or frontend work;
  - missing edge cases/tests;
  - review findings on a specific diff.
- For M+ or risky work, ask the applicable top-level role provider for its
  analysis or review phase when required by the active project policy.
- Treat provider output as untrusted suggestions. Codex must adapt it to local
  patterns and run verification.
- For frontend/UI implementation, ask the configured frontend provider for a
  Unified Diff Patch prototype when the plan requires a prototype. If Gemini
  is selected, use `--prompt-template frontend` or `--prompt-template
  prototype`.

### Phase 3: Implementation

- Implement directly in Codex using the repository's existing patterns.
- Prefer small, focused edits and existing helpers.
- Use tests first when the plan includes clear behavior or bugfix acceptance criteria; otherwise add focused tests in the most local existing test style.
- Use `apply_patch` for manual file edits.
- Do not rewrite plan files, handoff files, or original CCG workflow files as part of execution unless the user explicitly asks.

### Phase 4: Verification

- Run the narrowest relevant verification first:
  - backend TypeScript: workspace typecheck and focused tests;
  - Python/ML service: focused pytest or the script's smoke mode;
  - contracts/shared schemas: affected package tests/typecheck;
  - frontend touched incidentally: typecheck and focused component tests.
- Apply CCG quality gates when they match the scope:
  - `/ccg:verify-change` and `/ccg:verify-quality <changed-path>` for changes over roughly 30 lines or risky refactors;
  - `/ccg:verify-module <module-path>` for newly created modules;
  - `/ccg:verify-security <changed-path>` for auth, permission, validation, secrets, file upload, command execution, or network-boundary changes.
- If full verification is too slow or blocked by local services, run a smaller meaningful check and report the blocker.
- Fix regressions caused by the implementation before delivery.

### Phase 5: Review

- Inspect `git diff --stat` and the full relevant diff.
- Check that every changed file maps back to the plan scope.
- For any frontend/UI diff that requires external review, run the configured
  frontend provider after Codex applies the local rewrite. When it is Gemini, use
  `--prompt-template review` or `--prompt-template frontend`.
- For large or risky backend diffs, run the required local quality/security
  gates and any policy-required backend-provider review, then independently verify
  the findings.
- Treat backend logic, data integrity, transactions, error handling, and tests as first-class review targets.

### Phase 6: Delivery

Report in Chinese with:

- what was implemented;
- changed files;
- verification commands and results;
- any blockers, residual risks, or manual follow-up.

Do not commit unless the user asks.

## CCG-Specific Notes

- A CCG plan's `SESSION_ID` section is for the old Claude-orchestrated workflow. In this Codex executor, use it only to understand provenance; do not try to resume those sessions.
- A plan may still say `/ccg:execute` as the launch command. Inside Codex, this plugin's `/ccg:execute` means direct Codex execution.
- `/ccg:excute` is preserved as a typo alias for muscle memory.
- `/ccg:ccg` and `/ccg:workflow` are help/index entries that should route the user into this Codex-native workflow.
- Respect each repository's local `AGENTS.md` and project-specific rules. When
  no stronger project rule exists, use the local-routing defaults in
  `ccg-fast-context.md`; do not install or activate a third-party tool.

## Bundled Rule References

When the task needs more detail, read only the relevant rule file under `../../rules/`:

- `ccg-fast-context.md` for approval-aware local search routing.
- `ccg-search-evidence.md` for web/search evidence standards.
- `ccg-quality-gates.md` for quality gate trigger rules.
- `ccg-role-routing.md` for configured providers and the Companion Role
  Contract.
- `ccg-product-manager.md` for product-manager event and authorization gates.
- `ccg-skill-routing.md` for domain-oriented context routing.
- `domain-frontend.md`, `domain-backend.md`, `domain-security.md`, `domain-devops.md`, `domain-ai.md`, and `domain-data.md` for migrated original CCG domain guidance.
- `impeccable-ui.md` for UI polish and visual-risk guidance.
- `scrapling.md` for scraping/extraction safety boundaries.
