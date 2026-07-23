# Implementation Plan

## 1. Lock personal sources

- Capture Trellis `0.6.8`.
- Capture CCG version, personal remote, commit, tree ID, merge base, and original upstream remote.
- Generate `harness.sources.json`.

## 2. Import personal CCG

- Archive only tracked `HEAD` from `I:\ai\ccg-workflow`.
- Extract to `components/ccg-workflow/`.
- Verify representative personal-only Grok, GPT Pro, Codex plugin, and doctor files exist.
- Verify runtime/untracked directories were not copied.

## 3. Build Harness controls

- Add root `.gitignore`.
- Add PowerShell bootstrap, doctor, and source verification scripts.
- Configure Trellis Codex dispatch as inline for this project.
- Add root README describing ownership, provenance, installation, workflow, update, and security boundaries.

## 4. Validate

- Validate Trellis task and version.
- Run source tree parity verification.
- Scan Git candidates for secrets and forbidden runtime paths.
- Install CCG dependencies in the component and run lint, typecheck, tests, and build.
- Run CCG offline doctor/contract checks where available.

## 5. Publish

- Review complete diff and staged paths.
- Commit the initial Harness snapshot on `main`.
- Push `main` to the private `jed-zed/trellis-ccg-harness` repository.
