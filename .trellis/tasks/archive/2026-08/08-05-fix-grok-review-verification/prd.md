# Fix Grok review model and read verification

## Goal

Make generic Grok code review use the intended current model and fail closed
unless it actually reads the explicitly bound local review target(s) and
returns a contract-valid review. Keep Grok external intelligence unchanged.

## Background

- Live `/ccg:review` routing resolved `backend` to `grok` and skipped the
  external-intelligence gate (`invoked=false`, `require_web_search=false`).
- Repository defaults and `~/.codex/ccg/config.toml` already specify
  `grok-4.5`; the repository contains no `grok-4.3` default.
- The current process and user environment contain `GROK_MODEL=grok-4.3`.
  `codeagent-wrapper/config.go:210-213` reads that override and
  `codeagent-wrapper/backend.go:208-210` passes it as `-m grok-4.3`.
- A retry with explicit `grok-4.5` connected successfully. Grok performed
  successful local read/search tool calls, but did not read the bound probe
  file and did not return the requested function, random literal, or line.
- `codeagent-wrapper/parser.go:95-100,439-464` recognizes only Grok
  `thought`, `text`, and `end` stream events and ignores other event shapes.
  `codeagent-wrapper/executor.go:1401-1419` treats any non-empty final message
  plus a successful process exit as success.
- `components/ccg-workflow/` is a provenance-bound snapshot, not the
  authoritative edit location. The authoritative checkout is
  `I:\ai\ccg-gptpro-worflow`; its current branch contains unrelated commits
  after the Harness-pinned `a57cddd3577d48d9a07def766e54ab1ad7beabb5`, so
  this task must use an isolated worktree from the pinned commit.

## Requirements

### R1. Correct model selection

- Replace the stale user-level `GROK_MODEL=grok-4.3` override with
  `grok-4.5`, matching the current CCG configuration and available Grok model.
- An unavailable explicitly selected model must return the original clear
  provider error. Do not add model fallback or automatic model switching.
- Do not modify repository model defaults that are already `grok-4.5`.

### R2. Review-specific local-read evidence

- Generic Grok code review must receive an explicit set of bound local review
  targets.
- A successful provider exit and non-empty prose are insufficient for review
  success.
- Review success must require successful Grok read/search tool evidence that
  resolves to the required bound target scope and a machine-valid final review
  envelope tied to that scope.
- Every explicitly bound review file must have its own qualifying successful
  `ReadFile` event or file-exact `Grep` event. Directory-wide or unrelated
  searches do not satisfy a file binding.
- Missing target-read evidence, evidence for unrelated files only, an invalid
  final envelope, or an error stop reason must fail with a specific non-zero
  error.
- The validation applies only to generic Grok code review. Other generic Grok
  tasks and Grok external-intelligence WebSearch keep their current semantics.

### R3. Safety and authority

- Grok remains a read-only review provider; Codex remains final verifier and
  sole workspace writer.
- Code review must not invoke WebSearch, write tools, terminal commands, MCP,
  or subagents.
- Do not copy or reuse the external-intelligence profile as a compatibility
  fallback.

### R4. Source provenance and installed runtime

- Implement and test the CCG change in an isolated authoritative-source
  worktree based on the Harness-pinned commit. Do not modify or merge the
  unrelated current source branch.
- After a separately approved clean source commit, use the repository's
  `harness:update` transaction to refresh `components/ccg-workflow/` and
  `harness.sources.json`; do not hand-edit the snapshot.
- Synchronize the existing local CCG plugin cache only from that approved
  source tree, then verify source/cache digest equality. Do not edit plugin
  cache files directly.

## Acceptance Criteria

- [x] A normal generic Grok review selects `grok-4.5` and no longer emits the
      observed `unknown model id` for `grok-4.3`.
- [x] An explicit unavailable model fails clearly without fallback.
- [x] Exit 0 plus non-empty prose but no qualifying bound-target read fails.
- [x] Successful reads of unrelated files do not satisfy the bound-target
      requirement.
- [x] If two or more files are bound, omitting evidence for any one file fails
      the review even when all other files were read successfully.
- [x] Qualifying bound-target read evidence plus a valid final review envelope
      succeeds.
- [x] Grok error stop reasons fail even when partial text exists.
- [x] Focused tests cover the failed smoke shape and the valid review shape.
- [x] `go test ./...` passes in `components/ccg-workflow/codeagent-wrapper`;
      affected CCG template/Skill tests also pass if those files change.
- [x] External-intelligence behavior and evidence validation remain unchanged.
- [x] The authoritative source commit, Harness snapshot/tree manifest, and
      installed local plugin cache identify the same reviewed CCG content.
- [x] No commit from the unrelated current authoritative-source branch enters
      this task's source commit or Harness snapshot.
- [x] The final diff contains no fallback, new retry framework, generic event
      platform, unrelated refactor, or speculative compatibility code.

## Out of Scope

- Automatic model discovery or fallback.
- A shared provider-event framework.
- Changes to Grok external intelligence, product-manager providers, Gemini,
  Claude, Antigravity, Pi, or Codex routing.
- Provider CLI installation, authentication redesign, or credential copying.
- General codeagent-wrapper refactoring.

## Planning Status

- Boss decided that every explicitly bound file must produce qualifying read
  evidence. No product decisions remain open.
- Boss approved the corrected source-provenance delivery path, and the task is
  active for implementation and verification.
