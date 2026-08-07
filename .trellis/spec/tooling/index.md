# Harness Tooling Specifications

> Executable contracts for the repository's Node.js, PowerShell, and Go
> lifecycle tooling.

## Scope

This repository is a tooling project, not a frontend or database application.
Root scripts own bootstrap, source verification, lifecycle operations, and
Harness initialization. The tracked CCG component remains an exact source
snapshot and is verified through root commands.

## Specifications

| Specification | Applies when |
|---|---|
| [Harness Initializer](./harness-initializer.md) | Changing contract apply, project ownership, or readiness promotion |
| [Product Manager Review](./product-manager-review.md) | Changing reviewer providers, task projection, evidence, gates, or lifecycle integration |
| [ChatGPT Pro Agent Browser V2](./chatgpt-pro-agent-browser-v2.md) | Changing external Chrome discovery, exact-once behavior, or RootWait monitoring |
| [Grok Local Review Runtime](./grok-local-review-runtime.md) | Changing Grok local-review target binding, tool evidence, or result validation |

## Pre-Development Checklist

- Read the active Trellis task's `prd.md`, `design.md`, and `implement.md`.
- Read `.harness/adapter.json`, `harness.sources.json`, and the relevant root
  script before changing lifecycle behavior.
- Preserve user-owned files and use authenticated, compare-and-swap
  transactions for owned project state.
- Add a failing regression before changing initializer behavior.

## Quality Check

Run the affected focused test first, then the complete offline gates:

```powershell
node --test tests/harness-init-cli.test.mjs
pnpm harness:test
pnpm doctor
pnpm harness:conflicts
pnpm verify:sources
pnpm ccg:lint
pnpm ccg:typecheck
pnpm ccg:test
pnpm ccg:build
```

For changes under `components/ccg-workflow/codeagent-wrapper`, also run
`go test -short ./...` and `go build ./...` from that module.
