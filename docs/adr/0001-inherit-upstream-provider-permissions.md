# Inherit upstream Provider permissions

The personal CCG fork inherits Provider permission behavior from the exact
selected official `fengshao1227/ccg-workflow` revision across both upstream and
fork-only invocation paths, instead of maintaining separate no-tool overlays
that drift and reject valid results. Fork-only business validation and Codex/
Trellis authority remain, while GPT Pro keeps its existing read-only boundary
because it has no upstream Provider permission contract.
