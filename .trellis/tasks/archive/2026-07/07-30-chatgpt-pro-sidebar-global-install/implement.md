# Implementation Plan

1. Verify the upstream `mattpocock/skills` trees, commit, and license.
2. Add regression coverage for fresh installation, 13-Skill and 14-Skill
   upgrades, legacy `grill-me` preservation, and collision refusal.
3. Add both new defaults to the canonical platform list and synchronize
   project contracts, ownership manifests, scripts, and documentation.
4. Add an in-place, rollback-safe schema-v1 Skill-platform migration upgrade
   for existing machines with no selected project Skills.
5. Build and validate a self-contained `grill-with-docs` Skill with pinned
   upstream provenance.
6. Refresh the explicitly approved local `grill-me` and its `grilling`
   dependency through the Harness third-party installer when the local tree
   differs.
7. Run focused tests, the full Harness suite, doctor, conflict, source, change,
   quality, and diff gates.
8. Commit, push, wait for remote GitHub CI and review, then merge only when all
   blocking checks pass.
