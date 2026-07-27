# Repository evidence: CLI capability routing

## Original CCG behavior

- `I:\ai\ccg-workflow\src\types\index.ts:5` defines a closed `ModelType` union.
  Adding a new provider currently requires a source change.
- `I:\ai\ccg-workflow\src\types\index.ts:40-55` fixes routing to only
  `frontend`, `backend`, and `review`.
- `I:\ai\ccg-workflow\src\utils\config.ts:8-10` stores canonical configuration
  under `~/.claude/.ccg/`, coupling shared routing to one host CLI.
- `I:\ai\ccg-workflow\src\utils\config.ts:199-215` hardcodes Gemini frontend,
  Codex backend, and Codex plus Gemini review defaults.
- `I:\ai\ccg-workflow\src\commands\menu.ts:475-500` presents fixed provider
  lists. Claude exists in the type/wrapper but is absent from both routing
  selectors.
- `I:\ai\ccg-workflow\src\commands\menu.ts:567-594` updates routing and reruns
  initialization to regenerate templates. This is easy to use but still couples
  routing changes to generated content.
- `I:\ai\ccg-workflow\codeagent-wrapper\backend.go:11-16` defines a backend
  interface, while lines `19-38` implement Codex and Claude as concrete
  backends. The adapter concept is reusable, but registration remains compiled.
- `I:\ai\ccg-workflow\codeagent-wrapper\backend.go:108-129` runs Claude
  headlessly and sets its working directory outside CLI arguments.
- `I:\ai\ccg-workflow\templates\commands\spec-impl.md:68-73` says delegated
  patches must not be applied directly; the lead rewrites them to production.
- `I:\ai\ccg-workflow\plugins\ccg\skills\ccg-executor\templates\gemini\frontend.md:15-17`
  requires a unified diff and states that Codex owns the real workspace.

## Harness coupling

- `.harness/adapter.json:12` fixes `workspaceOwner` to Codex.
- `.harness/adapter.json:36-59` encodes provider policy as named model objects,
  including Claude disabled and Gemini read-only.
- `scripts/lib/harness-adapter/conflict-static.mjs:216-238` treats any Claude
  enablement or non-Codex owner as a blocking conflict.
- `scripts/lib/harness-adapter/context.mjs:142-172` exports named `models`
  directly rather than effective role routing.
- `scripts/lib/harness-adapter/conflicts.mjs:32-58` accepts only adapter schema
  version 1.
- `AGENTS.md:36-40`, `README.md:114-129`, and
  `.trellis/spec/guides/layered-harness-adapter.md:24-52` repeat the same
  provider-name policy; all owned projections must change together.
- `tests/harness-adapter.test.mjs:58-73` builds hardcoded named-provider
  fixtures, and lines `363-382` assert Claude enablement is blocking.

## Version and working-state evidence

- `harness.sources.json` pins CCG `3.3.0`, commit
  `88222edd298dc4254d7fd7151f48682618063139`, and tree
  `8fcfd2b70efa6a2aa07b692911cbafc85616522c`.
- `ccg --version` and the globally installed package report `3.3.2`.
- The installed package identifies
  `https://github.com/jed-zed/ccg-gptpro-worflow.git` as its repository.
- The remote personal repository exposes tag `v3.3.2` at
  `b21778b090057187390a5a945cc85ef27c4e3125`; its current `main` was observed at
  `8bdad64e4e5ccad75e1086ae31ad757e6bbdbef8`.
- The local `I:\ai\ccg-workflow` branch is behind and contains unrelated
  deletions/untracked work. The Harness checkout also contains unrelated Claude
  asset deletions. Neither dirty tree is a safe implementation base.
- `scripts/harness-lifecycle.mjs` already requires a clean authoritative
  checkout, validates the full commit/tree, exports from Git objects, runs
  gates, replaces atomically, and records rollback ownership. The implementation
  should use that boundary rather than editing the snapshot or installed cache.

## Planning conclusion

Keep original delegated-patch semantics, but move provider identity out of
workflow templates. A single capability registry plus layered route resolver
must serve the installer, CLI, runtime skills, Harness context, and conflict
checks. Executable registration belongs only to a trusted user scope; projects
and tasks may select registered providers but cannot create command execution or
write authority.
