# Update Harness CCG preview parity snapshot

## Goal

Update the Harness-owned CCG snapshot to the verified personal-fork commit that
delivers original-author preview parity and the Grok terminal-event replay fix,
without changing Harness authority boundaries or runtime policy.

## Requirements

- Import only tracked files from the clean personal CCG checkout at
  `I:\ai\ccg-workflow-original-preview-parity-3.4.1`.
- Pin the exact reviewed CCG commit
  `97c4a9d6904b3ccd75fa4aa396e3016f74e539bf`, version `3.4.1`, and its Git
  tree in `harness.sources.json`.
- Refresh `components/ccg-workflow/` only through the repository-owned
  `pnpm harness:update` transaction.
- Preserve the 3.4.1 read-only product-manager, the three independent provider
  roles, Trellis task authority, Codex-only workspace writes, and optional
  Grok policy.
- Do not import credentials, nested Git metadata, model evidence, caches,
  build output, or other ignored runtime state.
- Keep the original dirty CCG checkout and the active provider-routing Harness
  worktree untouched.

## Acceptance Criteria

- [ ] `components/ccg-workflow/` is byte-identical to the tracked Git tree of
      CCG commit `97c4a9d6904b3ccd75fa4aa396e3016f74e539bf`.
- [ ] `harness.sources.json` records CCG version `3.4.1`, the exact commit, and
      the matching Git tree.
- [ ] Harness context and conflict checks report no blocking conflict.
- [ ] Source verification, Harness tests, doctor, CCG lint/typecheck/test/build,
      and applicable security checks pass.
- [ ] The Harness worktree contains only the expected snapshot, provenance, and
      Trellis task changes.

## Notes

- This is a lightweight, transactional source-snapshot update. The approved
  technical implementation remains in the CCG plan
  `.codex/ccg/plans/original-preview-parity.md`; this PRD does not duplicate
  that plan.
- The user explicitly authorized updating CCG and Harness together.
