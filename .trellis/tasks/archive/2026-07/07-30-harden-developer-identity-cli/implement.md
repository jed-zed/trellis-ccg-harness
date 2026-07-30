# Implementation plan: harden developer identity CLI

## 1. Add failing regression coverage

- Create an isolated temporary Trellis fixture from the project scripts.
- Cover `-h`, `--help`, missing arguments, extra arguments, invalid names,
  direct helper calls, one valid Unicode name, and repeated initialization.
- Assert help and error cases leave no filesystem identity state.

## 2. Implement the CLI guard

- Replace direct `sys.argv[1]` access with `argparse`.
- Keep one required positional developer name.
- Ensure parser exits happen before `get_developer()` and `init_developer()`.

## 3. Implement shared name validation

- Add a portable developer-name validation helper in
  `.trellis/scripts/common/developer.py`.
- Invoke it before computing or writing the workspace path.
- Return a clear error without creating `.developer` or workspace files.

## 4. Verify local and upgrade behavior

- Run the focused subprocess regression test.
- Run the existing Trellis upgrade and Harness test suites.
- Exercise the Trellis candidate-update flow in a disposable worktree and
  verify that the intentional overlay remains intact with no `.new` files.
- Confirm `.trellis/.template-hashes.json` was not edited.

## 5. Record upstream boundary

- Report that the official Trellis template still needs an upstream release for
  new projects outside this Harness repository.
- Do not create an issue, PR, publish a package, or modify the global install
  without explicit user authorization.
