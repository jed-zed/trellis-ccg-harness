# Design

Use the existing Harness global platform Skill pipeline. Add the bundled
`chatgpt-pro-sidebar` and `grill-with-docs` trees to
`GLOBAL_PLATFORM_SKILLS`; do not create a second installer or copy path.

The existing Global Init transaction stages, fingerprints, collision-checks,
copies, and owns both Skills alongside the other platform Skills. The upgrade
path recognizes the released 13-Skill baseline and the intermediate 14-Skill
sidebar baseline only when every recorded target still matches its digest.
Missing new targets are added in the same transaction; unowned collisions fail
closed.

For schema-v1 Skill-platform migration ownership, the upgrade also performs
compare-and-swap replacements of the matching Skill repository profile and its
global AGENTS managed block. The original project audit and backup identity
remain unchanged, so adding global defaults does not retarget the earlier
project migration.

`grill-with-docs` is a self-contained Codex adaptation of the upstream
`grill-with-docs`, `grilling`, and `domain-modeling` workflows. Bundling the
supporting instructions as references avoids reserving generic global Skill
names and keeps one portable installation boundary. The upstream commit and
MIT notice are stored with the Skill.

`grill-me` stays outside the 15-Skill platform set. Its user-global update uses
the existing explicit third-party approval and ownership APIs, with a
recoverable backup of the previous local tree.
