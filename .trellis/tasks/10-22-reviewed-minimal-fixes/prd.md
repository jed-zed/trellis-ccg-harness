# Reviewed minimal Harness fixes

Apply only F1/F2/F3/N1/N2 approved by the parent review. Preserve HEAD 724975b and all existing user work. No commits, pushes, merges, installation, authentication/permission/tunnel changes, UI, real uploads, credentials or protected session stores.

Acceptance: F1 synthetic-key regression covers crossing500 and normal-length errors, with red-to-green evidence; F2 only normalized IPv6 loopback HTTP is allowed; F3 keeps source-tree validation and documents authoritative-source security updates plus controlled import; N1 five manifest failure cases execute with discovered/passed/failed counts and no dot-source browser/write effects; N2 updates current hash rules without rewriting historical records. Existing required relevant checks must run; unrun checks are never passes.

Only seven approved files plus this task's necessary records may change. F4, source imports, host-isolation changes and all other findings are excluded. Parent must accept the final diff and results before task closeout.


## Authorized Junction compatibility continuation (2026-10-22)
User 09:19 UTC approved continuing the existing Codex-home Junction compatibility issue. Parent source thread 01a15691-e0ff-776b-b97a-0627cf34a0e6 authorizes project-only resolver/validation/tests/documentation changes with equivalent protections. The exact old seven-file implementation remains intact.

Permit only the default .codex leaf alias (including an explicitly identical default path), canonicalize to a verified non-root real directory, reject linked ancestors/nondefault explicit aliases/files/dangling/cycles, preserve missing-default compatibility, and pass the physical identity into repository isolation checks. Existing approval/ownership/CAS/rollback comparisons stay in place. Required source pin must match new resolver bytes. No installation, system-link/ACL/default-entry/auth changes or credential/session reads. Claude authors the scoped snapshot implementation and any mechanical pin-updater; Codex reviews and integrates.

The old written rejection of a default alias is deliberately superseded only within this new authorization; this is not approval to weaken other checks. Legacy journal migration and sameCodexHome historical semantics are unchanged. Runtime acceptance must use the original conflicts/doctor commands, not an alternate home or skip. Regression tests use disposable synthetic directories.

Scope: .agents/skills/harness-init/scripts/codex-home.mjs; .agents/skills/harness-init/scripts/harness-init-core.mjs; scripts/verify-sources.ps1; tests/harness-split-roots.test.mjs; .agents/skills/harness-init/SKILL.md; .trellis/spec/tooling/harness-initializer.md; scripts/DESIGN.md

Verification: split-roots regression and affected offline contracts; previous 43 Node and five Pester cases; context, conflicts --ci, original runtime conflicts, doctor/source verification; CCG change/quality/security checks. Parent final review remains pending.

Analysis source: J:\Codex-Archive\2026-10-21\task-2\junction-20261022\CLAUDE-ANALYSIS.md


## Parent-accepted local completion — 2026-10-22T10:19:08.630195+00:00

Parent session 01a15691-e0ff-776b-b97a-0627cf34a0e6 reviewed the resolver/isolation patch and local results, and accepted the local compatibility repair. The reviewed F1/F2/F3/N1/N2 work and its authorized Junction continuation are completed within this local acceptance scope. Earlier pending-parent-review statements are historical and superseded by this acceptance.

Reused verification: offline Harness 588 total / 587 passed / 0 failed / 1 existing Windows skip; split-roots 13/13 with no skips; focused Node 43/43; Pester discovered 5 / passed 5 / failed 0; original runtime conflicts and doctor/source verification passed; context, conflicts --ci and diff check passed. No tests were rerun during closeout.

The skipped test is the existing POSIX AGENTS permission-drift CAS test (tests/harness-init-cli.test.mjs:1241). Cross-platform Node 20/22 CI, live installation and legacy journal migration remain unverified. The resolver does not claim to prevent arbitrary concurrent path replacement. Existing user changes, the actual Codex Junction and personal installation are retained. See junction-results.md and implementation-results.md for evidence and complete diffs.

Only this task's task.json and prd.md were updated for completion. No directory archive move, session-pointer update, additional implementation, tests, commits, push/merge or installation.
