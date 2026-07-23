# Design: Personal Trellis + CCG Harness Monorepo

## Context

The repository must preserve the user's own CCG work as the authoritative implementation while using the newest Trellis project workflow. Pulling a new copy from the original CCG author would lose or misrepresent the user's Grok, GPT Pro, Codex plugin, evidence, and quality-gate work.

The Harness is the combined Trellis + personal CCG system. The integration scripts and manifest are supporting glue, not a third framework or product layer.

## Source-of-truth hierarchy

1. `components/ccg-workflow/`: exact tracked tree of local personal CCG `main` at `7fba2c3`.
2. Root `.trellis/`, `.agents/`, `.claude/`, `.codex/`, `.gemini/`: Trellis 0.6.8 project layer plus Harness-local customization.
3. Root Harness files: integration manifest, audit/bootstrap scripts, CI, security exclusions, and documentation.
4. Original upstream repositories: provenance and future comparison only; never silently replace personal trees.

## Layout

```text
trellis-ccg-harness/
├── .trellis/                  # latest Trellis workflow/task/spec state
├── .agents/.claude/.codex/    # project integrations
├── .gemini/
├── components/
│   └── ccg-workflow/          # personal CCG tracked snapshot
├── scripts/
│   ├── bootstrap.ps1
│   ├── doctor.ps1
│   └── verify-sources.ps1
├── harness.sources.json       # exact source provenance and versions
├── .gitignore
└── README.md
```

## Import method

- Produce an archive from the local personal checkout's `HEAD`.
- Extract it under `components/ccg-workflow/`.
- Do not copy `.git/` or untracked content.
- Add a Harness-owned provenance marker outside the component tree so tree verification remains exact.
- Record commit and Git tree IDs in `harness.sources.json`.

## Security boundary

Exclude:

- `.ccg/` task/evidence state;
- `.codex/ccg/` intelligence and GPT Pro state;
- `.trellis/.runtime/`, `.trellis/.backup-*`, caches and worktrees;
- model prompts/responses generated at runtime;
- Grok/Claude/Gemini/Codex browser/login state;
- `.env*`, credentials, tokens, key files, logs, coverage and build output.

Tracked fixtures and test assets in the personal CCG repository remain included because they are source-controlled and required by its tests.

## Update model

- Trellis: `trellis upgrade` for the global CLI, followed by `trellis update --migrate` in the Harness.
- CCG: explicitly import from the personal fork/local checkout only after reviewing divergence from original upstream.
- Source updates are fail-closed when the selected CCG remote is not `jed-zed/ccg-gptpro-worflow`.
- Every update refreshes `harness.sources.json` and reruns source verification and secret scanning.

## Consequences

- The private Harness is self-contained for the user's customized CCG source.
- Repository size is larger than dependency-only composition.
- Upstream synchronization is deliberate rather than automatic.
- Public release remains blocked on combined licensing and redistribution review.
