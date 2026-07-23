# brainstorm: Compose Trellis and CCG into a custom Harness

## Goal

Create a standalone, reusable AI development Harness that combines Trellis task/spec lifecycle management with the custom CCG 3.3.0 multi-model orchestrator, including Codex-led execution, Gemini/Claude assistance, Grok Web/X evidence, GPT Pro evidence workflows, and shared quality gates.

## What I already know

- The project must live in a new GitHub repository, separate from the CCG source repository.
- The local project root is `I:\ai\trellis-ccg-harness`, initialized as a new Git repository on `main`.
- Trellis was audited against the npm package before upgrade: the previous global `0.5.17` installation contained zero changed, added, or missing package files.
- Trellis global CLI and this project's generated assets have been upgraded to the npm latest version, `0.6.8`.
- The custom CCG source is the local `I:\ai\ccg-workflow` checkout at version `3.3.0`, commit `7fba2c309b3c6a54ab8e7ea4b47a8a0b53321e13`.
- CCG provides Codex/Claude workflow assets, multi-model routing, Grok ACP evidence, GPT Pro evidence bridges, hooks, skills, and quality gates.
- The GitHub owner inferred from the authenticated workspace is `jed-zed`.
- The authoritative CCG remote is the personal fork `https://github.com/jed-zed/ccg-gptpro-worflow.git`; `https://github.com/fengshao1227/ccg-workflow.git` is provenance/upstream only.
- The personal CCG main has 20 commits and 369 changed files beyond its current merge base with the original upstream.

## Assumptions

- The Harness should pin compatible Trellis and CCG versions while keeping both independently upgradeable.
- The Harness owns integration adapters, bootstrap/update scripts, validation, documentation, and CI.
- Local secrets, browser OAuth state, evidence bundles, generated tasks, and machine-specific configuration must never be committed.
- The repository name is `trellis-ccg-harness` under the `jed-zed` GitHub account.
- The repository should begin private until Trellis-generated asset redistribution and combined licensing are reviewed.

## Open Questions

- None blocking for the initial private snapshot.

## Confirmed Decisions

- GitHub repository: `jed-zed/trellis-ccg-harness`.
- Initial visibility: private.
- The repository was created and source may be pushed after the Harness passes its local verification gates.
- The user selected a personal-source-first monorepo snapshot instead of a dependency-only layered adapter.
- CCG source must come from the local personal `main` tree, not a fresh archive of the original author's repository.
- Trellis uses latest `0.6.8` generated project assets; no Trellis CLI source is vendored because the pre-upgrade local package had no personal modifications.
- Superseded/squash-backup CCG branches are not allowed to overwrite the more complete personal `main` tree.
- CCG runtime evidence, model responses, OAuth/browser state, logs, output, temp data, and other untracked state are excluded even in the private repository.

## Research References

- `research/integration-architecture.md` — compares layered adapters, vendoring, and submodules; recommends a layered, version-pinned composition.
- `research/hook-and-upgrade-boundaries.md` — defines configuration ownership, hook ordering, upgrade transactions, rollback, security exclusions, and licensing risks.

## Architecture Options

1. **Layered adapters** — Trellis owns repository lifecycle, CCG owns model/evidence orchestration, Harness owns version manifests, adapters, bootstrap/update/doctor/rollback, and CI.
2. **Personal-source monorepo snapshot (selected)** — retain the full tracked tree of the user's CCG fork alongside the project-local latest Trellis Harness files, with explicit provenance and source hashes.
3. **Git submodules/source composition** — exact source pinning, but operationally heavy and still requires the same adapter layer.

Selected direction: option 2, because the user explicitly wants every local personal modification represented in the new private repository and the personal fork to be authoritative.

## Requirements (evolving)

- Trellis remains the source of truth for task lifecycle, PRD/spec context, implementation state, and finish-work bookkeeping.
- CCG remains the source of truth for model routing, Grok external intelligence, GPT Pro evidence, multi-model execution, and quality gates.
- Provide deterministic bootstrap, update, doctor, and uninstall/rollback paths.
- Support Windows first while avoiding unnecessary platform lock-in.
- Keep generated and credential-bearing state outside Git.
- Document how a user starts a task, plans it, executes it, verifies it, and upgrades both components.
- Detect and reconcile project-level Trellis hooks with user-level CCG/Codex hooks without replacing whole user configuration files.
- Keep normal CI offline and free of paid model calls; live Grok/GPT Pro smoke tests require explicit user action and credentials.
- Preserve the complete tracked CCG personal main tree under `components/ccg-workflow/`.
- Record the exact personal fork URL, commit, tree hash, version, and capture time in a machine-readable source manifest.
- Keep the root Trellis workflow on `0.6.8` and configure Codex for inline dispatch in this Harness.
- Provide an audit script that proves the vendored CCG tree matches the recorded personal source commit while ignoring the Harness-owned provenance file.

## Acceptance Criteria (evolving)

- [ ] A clean clone can install the pinned Trellis and CCG integration without copying credentials.
- [ ] One documented workflow carries a requirement from Trellis task creation through CCG planning/execution and back into Trellis verification/finish.
- [ ] Automatic Grok routing and explicit Grok/GPT Pro commands remain available.
- [ ] Doctor checks detect version drift, stale plugin assets, hook conflicts, missing CLIs, and unsafe local state.
- [ ] CI validates scripts, configuration schemas, generated-file parity, and a representative offline workflow.
- [ ] Repository contains no secrets, OAuth state, evidence bundles, machine paths, or generated task output.
- [ ] `components/ccg-workflow/` matches the tracked tree from personal commit `7fba2c3`, not the original author's current `main`.
- [ ] Source provenance explicitly labels `jed-zed/ccg-gptpro-worflow` as authoritative and the original repository as upstream credit only.
- [ ] Trellis reports `0.6.8` globally and in `.trellis/.version`.

## Definition of Done (team quality bar)

- Tests added or updated for bootstrap, routing adapters, version drift, and rollback.
- Lint, typecheck, script syntax, and CI are green.
- Architecture, installation, upgrade, security boundary, and usage documentation are complete.
- Rollback is tested and preserves pre-existing user configuration.
- A GitHub repository is created and the initial branch is pushed only after local verification.

## Out of Scope (explicit)

- Publishing a new Trellis or CCG package in the first MVP.
- Vendoring the Trellis CLI/npm source when there are no audited personal changes to that package.
- Importing old/superseded CCG branch trees over the selected personal `main`.
- Committing user credentials, Grok browser profiles, model logs, or canonical evidence bundles.
- Replacing Trellis task semantics or CCG model/evidence semantics.

## Technical Notes

- Trellis CLI: `@mindfoldhq/trellis@0.6.8`, upstream `mindfold-ai/trellis`.
- CCG CLI/plugin: `ccg-workflow@3.3.0`, authoritative source `jed-zed/ccg-gptpro-worflow@7fba2c3`.
- Trellis initialized `.trellis/`, `.agents/`, `.claude/`, `.codex/`, and `.gemini/` project assets.
- CCG is imported from `git archive HEAD`, so only tracked personal source is included; local `.ccg/`, `.codex/`, `output/`, and `tmp/` runtime trees are not imported.
- Root Trellis/Harness platform files and nested CCG plugin/template files remain in separate namespaces to avoid silent overwrites.
- Trellis upstream is AGPL-3.0 and CCG is MIT; visibility and the final repository license require an explicit decision before public release.
