# Eliminate unintended automation side effects

## Goal

Remove two verified automation side effects:

1. CCG Go tests open short-lived `fake-cmd - Live Output` browser tabs.
2. Trellis `init_developer.py --help` treats `--help` as a developer identity
   and creates `.trellis/workspace/--help/`.

Both fixes must preserve normal production behavior and be delivered through
the source/provenance boundary that owns each component.

## Requirements

1. Complete the two child tasks independently:
   - `07-30-stop-test-browser-popups`
   - `07-30-harden-developer-identity-cli`
2. Keep Trellis as the canonical task and lifecycle authority.
3. Change the authoritative personal CCG source before refreshing the Harness
   CCG snapshot.
4. Treat the Trellis script change as an explicit project overlay because the
   installed `@mindfoldhq/trellis@0.6.9` template and official `main` both
   contain the defect, and this task is not authorized to publish or modify a
   global package.
5. Do not modify global npm packages, Codex plugin caches, or the
   `.trellis/.template-hashes.json` ownership record.
6. Add regression coverage for every side-effect boundary.
7. Preserve intentional dirty work and use isolated source worktrees where
   required.

## Acceptance Criteria

- [ ] Running the relevant Go tests does not open a browser.
- [ ] Running `init_developer.py -h` or `--help` exits successfully, prints
      help, and creates no identity file or workspace directory.
- [ ] Invalid or extra developer-name arguments fail before filesystem writes.
- [ ] Valid developer names still initialize the expected workspace.
- [ ] Normal CCG Live Output previews still open for real non-lite executions.
- [ ] Harness source, test, doctor, and conflict gates pass.
- [ ] Each child task is independently validated before the parent is complete.

## Boundaries

- No upstream Trellis push, PR, package publication, or global installation
  change without separate user authorization.
- No redesign of the CCG preview UI or Trellis workspace model.
- No blanket disabling of browser launch outside test execution.
