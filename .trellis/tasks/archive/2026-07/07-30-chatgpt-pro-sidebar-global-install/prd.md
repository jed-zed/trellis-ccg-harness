# Default Global Sidebar and Documentation Skills

## Goal

Make the bundled `chatgpt-pro-sidebar` and `grill-with-docs` Skills part of
the Harness default global Skill installation, and refresh the separately
approved local `grill-me` installation when its installed tree differs from
the pinned upstream source.

## Requirements

- Add `chatgpt-pro-sidebar` and `grill-with-docs` to the Harness-owned global
  platform Skill set.
- Fresh approved Global Init must copy both complete Skill trees into the
  managed user-global Skill root and record their tree fingerprints.
- Intact 13-Skill and 14-Skill legacy ownership manifests must upgrade
  transactionally without overwriting unowned targets.
- Preserve a legacy user-owned `grill-me`; it remains an explicit third-party
  install rather than part of the core 15-Skill projection.
- Adapt `grill-with-docs` from the MIT-licensed
  `mattpocock/skills` source at commit
  `2ab958093e83e0ec752e6c1c5932da465bf23e0c`, including the required
  grilling and domain-modeling guidance inside the Skill.
- Keep project contracts, generated guidance, installation scripts, ownership
  manifests, and documentation consistent with the 15-Skill baseline.

## Acceptance Criteria

- [x] The exported global platform Skill set contains both new defaults.
- [x] The project contract template contains both in
      `skills.globalEssential`.
- [x] Isolated Global Init installs and owns exactly 15 platform Skills.
- [x] Legacy 13-Skill and 14-Skill profiles upgrade without replacing
      user-owned `grill-me` content.
- [x] A schema-v1 Skill-platform migration upgrades without changing its
      project audit or backup identity.
- [x] `grill-with-docs` is self-contained, validates as a Codex Skill, and
      records its pinned MIT provenance.
- [x] The local `grill-me` and `grilling` trees match the pinned upstream
      candidate after an explicit, recoverable update.
- [ ] Full local Harness gates and remote GitHub CI pass.
- [ ] PR review has no unresolved blocking finding before merge.
- [x] No production deployment, database change, or user-data operation occurs.

## Superseded Constraint

The original Sidebar Skill PRD prohibited global installation. The user's
explicit 2026-07-30 follow-up requirement supersedes only that packaging
constraint; all authentication, UI automation, evidence, and verification
boundaries remain unchanged.
