# Publish Grok unverified read-only intake

## Goal

Publish accepted Grok receipt-state changes to the personal CCG fork, update the Harness snapshot, and install the matching read-only runtime without live Provider calls.

## Requirements

- Accept CCG PR #33 only after its required CI passes. The accepted source must
  retain `invocation_failed`, `received_unverified`, and `verified`, keep
  preferred X search optional, and keep the external-intelligence runtime
  read-only with arbitrary MCP disabled.
- Publish Codex plugin identity `3.4.6+codex.3`. Keep npm base version `3.4.6`,
  wrapper `5.12.6`, and all six wrapper digests unchanged.
- Update the Harness only through the supported clean-tree `harness:update`
  transaction bound to the accepted 40-character CCG commit.
- Install and verify the matching global CLI and Codex plugin through the
  supported Harness setup. Do not make a live Grok call or access Provider
  credentials.
- Preserve the separate dirty Harness worktree and all unrelated changes.

## Acceptance Criteria

- [ ] CCG PR #33 is merged after all required CI checks pass.
- [ ] The Harness manifest and component snapshot bind the accepted CCG commit
      and exact Git tree.
- [ ] Source, Harness, global CLI, and installed Codex plugin report one matching
      `3.4.6` / `3.4.6+codex.3` identity.
- [ ] Harness conflicts and relevant offline tests pass with no live Provider.
- [ ] The Harness publication PR is merged and the task is archived.

## Notes

- Boss approved the complete commit/publish/update chain on 2026-08-08.
- Authoritative CCG source commit before merge: `cffda18a5140df366abd1b0d83da6db2075c802d`.
