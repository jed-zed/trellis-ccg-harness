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

- [ ] `init_developer.py -h` and `--help` exit `0`, show usage, and create no
      `.developer` file or workspace directory.
- [ ] No name exits nonzero with usage and creates no state.
- [ ] Extra arguments exit nonzero and create no state.
- [ ] `--help`, `../escape`, `a/b`, `a\b`, control characters, and
      platform-invalid path components are rejected without state changes.
- [ ] A valid Unicode name with an internal space initializes once and produces
      the expected `.developer`, journal, and index files.
- [ ] Direct `init_developer()` calls enforce the same validation.
- [ ] Existing normal initialization and "already initialized" behavior remain
      compatible.
- [ ] The Harness test suite and Trellis candidate-update verification pass
      without unresolved template-conflict sidecars.

## Out of Scope

- Modifying or republishing `@mindfoldhq/trellis`.
- Opening an upstream issue or pull request without separate authorization.
- Renaming or migrating existing valid developer workspaces.
