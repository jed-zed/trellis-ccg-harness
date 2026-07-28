# Remove CCG runtime version lock

## Goal

Allow any available version of the user's personal CCG CLI and Codex plugin to
work with the Harness without requiring an exact match to the CCG version
recorded in `harness.sources.json`.

## Requirements

- Treat the CCG version in `harness.sources.json` as provenance for the tracked
  `components/ccg-workflow` snapshot, not as a runtime compatibility gate.
- The conflict audit must accept any parseable installed personal CCG CLI
  version and report the observed version without comparing it to the source
  snapshot version.
- The user-level plugin-cache audit must accept any structurally valid personal
  CCG plugin cache entry under the owned marketplace/plugin path, regardless of
  its version.
- A missing or unusable CCG CLI/plugin may remain visible as setup drift, but a
  different valid version must not block or warn.
- The Harness doctor must smoke-test the activated CCG CLI without enforcing the
  source snapshot version during ordinary checks.
- Source repository identity, tracked Git-tree verification, installation
  transaction integrity, credential isolation, provider policy, and Codex-only
  workspace writes must remain unchanged.
- Documentation must distinguish source provenance from owner-guaranteed
  runtime compatibility.

## Acceptance Criteria

- [ ] `harness:conflicts` reports an available newer personal CCG CLI as healthy.
- [ ] `harness:conflicts` reports a valid newer personal CCG plugin cache as
      healthy.
- [ ] Missing or unparseable runtime state remains visible without creating an
      exact-version requirement.
- [ ] The ordinary Harness doctor accepts an activated CCG CLI whose reported
      version differs from `harness.sources.json`.
- [ ] Source package/version/tree verification remains covered and unchanged.
- [ ] Focused adapter and doctor tests pass on the supported local platform.
- [ ] Documentation no longer says that the installed runtime must match the
      source-manifest CCG version.

## Notes

- User decision: the personal CCG author and Harness owner are the same person,
  and the owner guarantees compatibility across personal CCG versions.
- This is a lightweight contract adjustment and remains PRD-only.
