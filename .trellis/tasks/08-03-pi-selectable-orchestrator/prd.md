# Add Pi as selectable orchestrator

## Goal

Add Pi Agent as a real, selectable CCG role provider so Boss can later run
`ccg routing set frontend pi` without changing today's default routing.

## Background

- Trellis already supports Pi as a host platform through `.pi` prompts,
  `pi -p`, session resume, and Pi session environment variables.
- CCG does not register Pi as a provider, and `codeagent-wrapper` currently
  rejects `--backend pi` as unsupported.
- The authoritative personal CCG source is `I:\ai\ccg-gptpro-worflow` at the
  commit/tree recorded in `harness.sources.json`; `components/ccg-workflow` is
  a verified snapshot, not the source of truth.
- Pi is not installed on this host. Current official documentation identifies
  `@earendil-works/pi-coding-agent` as the package and `pi` as the executable.

## Requirements

1. Register `pi` in the CCG provider registry and every derived CLI/menu/help
   surface without changing any existing role default.
2. Make `codeagent-wrapper --backend pi` invoke the official non-interactive
   JSON event mode and support deterministic session resume by ID.
3. Parse Pi's JSONL session header and assistant message lifecycle into the
   wrapper's existing final-message and session-ID contract.
4. Preserve the Harness boundary: Codex remains the sole workspace writer.
   Pi must load no project extensions, skills, prompt templates, or context
   files and may use only the read-only `read,grep,find,ls` tool allowlist.
5. Treat Pi as optional. Routing changes must not install, authenticate, or
   invoke Pi; a missing executable must fail clearly at execution time.
6. Keep product-manager execution out of scope. Pi is a normal role provider
   for analysis/planning/draft/review routing, not a product-manager reviewer.
7. Implement first in the authoritative personal CCG checkout, then synchronize
   its tracked committed tree into the Harness snapshot and refresh source
   provenance before installing or publishing the updated runtime.

## Acceptance Criteria

- [ ] `ccg routing set frontend pi` succeeds and `ccg routing get frontend --json`
      reports `pi`.
- [ ] Existing defaults remain `frontend=gemini`, `backend=codex`,
      `search=grok`, and `product-manager=claude`.
- [ ] `codeagent-wrapper --backend pi` resolves a Pi backend instead of returning
      `unsupported backend`.
- [ ] New-session arguments use Pi JSON mode, read-only tools, disabled project
      resources, and the caller-provided working directory.
- [ ] Resume arguments use `--session <id>` and do not open an interactive
      session picker.
- [ ] Parser regression fixtures recover the session header ID and the final
      assistant text from Pi JSONL, while unknown/non-text events remain safe.
- [ ] Missing Pi returns the wrapper's existing command-not-found failure and
      does not trigger installation or authentication.
- [ ] Focused TypeScript and Go tests pass, followed by the repository's CCG,
      source-verification, doctor, conflict, and Harness gates.
- [ ] The authoritative source, Harness snapshot, manifest, and installed
      local CCG runtime are synchronized only through their documented coupled
      update flow.

## Out of Scope

- Switching any current role to Pi by default.
- Installing Pi, logging in, choosing a Pi model, or copying credentials.
- Giving Pi write, edit, bash, network-search, product-manager, or lifecycle
  authority.
- Adding a Pi-specific model selector before a real installed Pi needs it.
- Refactoring the existing global provider registry into a role-compatibility
  matrix.
