# Implementation plan: isolate automation side effects

## 1. Complete child planning

- Keep the existing browser-popup PRD, design, and implementation plan.
- Finalize the developer-identity CLI PRD, design, and implementation plan.
- Validate all three task directories.

## 2. Start only after approval

- Start the parent task after the user approves this combined plan.
- Execute each child independently while retaining the parent task as the
  shared acceptance boundary.

## 3. Implement and verify the browser child

- Work in an isolated personal-CCG source worktree.
- Add the test-only browser-launch seam and focused Go coverage.
- Verify the authoritative source, obtain commit approval, then synchronize the
  Harness snapshot through `pnpm harness:update`.

## 4. Implement and verify the identity child

- Add standard help/argument parsing to the generated CLI.
- Add centralized, filesystem-safe developer-name validation.
- Add subprocess regression tests proving help and invalid-input paths are
  write-free and valid initialization still works.
- Exercise the Harness Trellis candidate-update path to confirm the intentional
  overlay is preserved without unresolved `.new` files.

## 5. Run combined gates

- Run focused child tests first.
- Run source verification, Harness tests, doctor, conflicts, CCG gates, Go
  tests/build, and the applicable Trellis upgrade tests.
- Inspect the complete diff and report any upstream-only limitation.
