# Delivery Evidence

## Source baselines

- CCG version: `3.4.5`
- CCG merge commit: `36c4a4171aa1896d02a249be21eb7d948ec4b5fc`
- CCG tree: `02bfe46bd29c9b0b63d7cd7086425466b7613914`
- Third-party manifest SHA-256:
  `748796e09774955811aa1d4a8ed165efb865d88643d493cd9cf211d835a34850`

## Functional validation

- Formal `pnpm harness:update`: passed; 442 Harness tests, 439 passed,
  3 skipped, 0 failed.
- Delivery `pnpm harness:test`: passed; 442 Harness tests, 439 passed,
  3 skipped, 0 failed.
- CCG: lint passed, typecheck passed, build passed, 574 tests passed,
  1 skipped.
- Go wrapper: `go test -short ./...` and `go build ./...` passed from
  `components/ccg-workflow/codeagent-wrapper`.
- `pnpm verify:sources`, `pnpm doctor`, `pnpm harness:conflicts`, and
  `node scripts/harness-adapter.mjs conflicts` passed.

## Live latest-channel smoke

The first deep-path smoke exposed two distinct issues:

1. A resolved `source.commit` mutated the shared stable manifest and caused a
   later executor to reject it as a stored pin. The installers now clone the
   supplied stable manifest before adding runtime identity; a regression covers
   this boundary.
2. Windows Git rejected the deliberately deep temporary cache with
   `Filename too long`. Re-running the same approved flow at the short isolated
   path `C:\ccg-smoke-019fb905` removed that environmental limit.

The short-path live smoke passed:

- plan SHA-256:
  `56a931f2adebb4a91087fcbe3ee3ffcf109a81a3956c6b55a23b187712b3519f`
- resolved Caveman commit:
  `0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0`
- installed Skill tree SHA-256:
  `e0c86bd256115e65bb74956920da46bd7d76c96490bf7a17440a99113c64d360`
- read-only status: `installed`, observed `exact`, Harness-owned `true`

This is an isolated local integration smoke, not a production deployment.
Per Boss instruction, no security audit was performed.
