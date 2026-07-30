# Harden developer identity CLI parsing

## Goal

Make Trellis developer initialization safe and conventional: `-h` and
`--help` must display help without creating state, malformed invocations must
fail before writes, and valid developer names must continue to initialize the
expected workspace.

## Background

- `.trellis/scripts/init_developer.py` reads `sys.argv[1]` directly.
- Therefore `python .trellis/scripts/init_developer.py --help` initializes the
  developer as `--help` and creates `.trellis/workspace/--help/`.
- `.trellis/scripts/common/developer.py` checks only for an empty string before
  using the value as a path component.
- The globally installed `@mindfoldhq/trellis@0.6.9` template and the official
  Trellis `main` template currently have the same behavior.
- `.trellis/.template-hashes.json` identifies both Python files as
  Trellis-managed generated assets.

## Requirements

1. Use `argparse` or equivalent standard parsing so `-h` and `--help` exit `0`
   before checking existing identity or touching the filesystem.
2. Reject missing, extra, option-like, traversal, separator-containing,
   control-character, and non-portable path-component names before any write.
3. Keep ordinary Unicode and human-readable names, including internal spaces,
   supported when they form one portable directory component.
4. Centralize developer-name validation in `common/developer.py` so direct
   callers cannot bypass the CLI guard.
5. Preserve the existing already-initialized behavior for normal invocations.
6. Avoid partial identity creation when validation fails.
7. Add subprocess-level regression tests using an isolated temporary Trellis
   fixture.
8. Maintain the fix as an explicit project overlay; do not edit the installed
   npm package or pretend the local content came from version `0.6.9`.

## Acceptance Criteria

- [x] `init_developer.py -h` and `--help` exit `0`, show usage, and create no
      `.developer` file or workspace directory.
- [x] No name exits nonzero with usage and creates no state.
- [x] Extra arguments exit nonzero and create no state.
- [x] `--help`, `../escape`, `a/b`, `a\b`, control characters, and
      platform-invalid path components are rejected without state changes.
- [x] A valid Unicode name with an internal space initializes once and produces
      the expected `.developer`, journal, and index files.
- [x] Direct `init_developer()` calls enforce the same validation.
- [x] Existing normal initialization and "already initialized" behavior remain
      compatible.
- [x] The Harness test suite and Trellis candidate-update verification pass
      without unresolved template-conflict sidecars.

## Completion Evidence

`tests/trellis-developer-init.test.mjs` passes all four subprocess/library
regressions. The complete Harness suite passes with 410 tests and three
host-capability skips, including the managed Trellis update and overlay
preservation paths. `.trellis/.template-hashes.json` remains unchanged.

## Out of Scope

- Modifying or republishing `@mindfoldhq/trellis`.
- Opening an upstream issue or pull request without separate authorization.
- Renaming or migrating existing valid developer workspaces.
