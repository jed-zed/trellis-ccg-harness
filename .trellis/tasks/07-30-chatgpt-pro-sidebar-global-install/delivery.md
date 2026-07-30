# Delivery Evidence

## Scope Delivered

- `chatgpt-pro-sidebar` and the self-contained `grill-with-docs` adaptation are
  part of the exact 15-Skill Harness global platform baseline.
- Fresh initialization and intact 13-Skill/14-Skill upgrades install the
  missing defaults without overwriting unowned targets.
- Schema-v1 Skill-platform migration ownership upgrades the missing defaults,
  profile, and global AGENTS managed block transactionally while preserving its
  project audit and backup identity.
- The local `grill-me` and required `grilling` trees were refreshed through the
  existing third-party ownership flow and match the pinned upstream trees.

## Provenance

- Upstream repository: `https://github.com/mattpocock/skills`
- Reviewed current upstream commit:
  `2ab958093e83e0ec752e6c1c5932da465bf23e0c`
- Existing Harness third-party pin:
  `ed37663cc5fbef691ddfecd080dff42f7e7e350d`
- The relevant upstream `grill-me` and `grilling` tree contents are identical
  at both commits.
- License: MIT, with the upstream notice copied into
  `.agents/skills/grill-with-docs/LICENSE.md`.

## Local Machine Verification

- Harness global ownership now records exactly 15 platform Skills.
- Installed platform tree fingerprints:
  - `chatgpt-pro-sidebar`:
    `309556819f70ea77786538351f8fb52f386d7cf8ff2d41d8c5a155ab5824d0a9`
  - `grill-with-docs`:
    `ed03af7e576a379e9a3196259f88e27e539b34aff0b3b993f8c8997b1897dc86`
- `installBundledPlatformSkills` repeated against the live home returned
  `unchanged`.
- Local upstream matches:
  - `grill-me`:
    `cbedc963f6088eae82958b54e397a2dc94c50a2655460eed9849f17ac12caef9`
  - `grilling`:
    `d298331d956ada756f7e127353384d515a6a98f04a35c54341f2837f95ca0d21`
- Recoverable prior `grill-me` backup:
  `C:\Users\29933\.agents\harness\backups\2026-07-30T23-45-00Z-grill-me-upstream-refresh\grill-me`

## Local Gates

- `pnpm harness:test`: 441 tests, 438 passed, 3 skipped, 0 failed.
  The three skips are Windows environments without permission to create test
  symlinks.
- `pnpm doctor`: passed.
- `pnpm harness:conflicts`: 0 blocking, 0 warning, 3 info, 16 passed.
- `pnpm verify:sources`: passed.
- CCG change analyzer: passed.
- CCG quality checker: passed, 0 errors; 181 existing advisory complexity
  warnings across the large initializer scripts.
- `quick_validate.py`:
  - repository `grill-with-docs`: passed;
  - installed `grill-with-docs`: passed;
  - installed `grilling`: passed.
- `git diff --check`: passed.
- Security review was intentionally not run per the explicit user requirement.

## Remote Delivery

- Pull request: `https://github.com/jed-zed/trellis-ccg-harness/pull/21`
- Implementation commit:
  `b08093876fce320b16a0bbe33080deb3b3caf8f1`
- Remote CI and final merge evidence are recorded on the pull request.

## Known External State

The local platform installation itself is complete and idempotent. A later
reject-all third-party receipt step still refuses to replace an older pinned
whole-manifest digest. That separate receipt-version mismatch does not change
the four installed Skill trees or their ownership fingerprints.
