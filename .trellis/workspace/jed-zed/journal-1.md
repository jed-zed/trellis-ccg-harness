# Journal - jed-zed (Part 1)

> AI development session journal
> Started: 2026-07-22

---



## Session 1: Compose personal Trellis CCG Harness

**Date**: 2026-07-23
**Task**: Compose personal Trellis CCG Harness
**Branch**: `main`

### Summary

Combined Trellis 0.6.8 with the exact tracked personal CCG 3.3.0 tree, added provenance, bootstrap, doctor, CI, security exclusions, documentation, and completed full offline verification.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `eb55a84` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Complete approval-gated Harness initialization

**Date**: 2026-07-27
**Task**: Complete approval-gated Harness initialization
**Branch**: `codex/archive-layered-adapter-task`

### Summary

Implemented the approval-gated Global and Project Init flow with fixed third-party provenance, manual-pending boundaries, Codex-only operation, and no .claude creation; updated the CCG 3.3.3 snapshot and merged PR #10 after clean-install and CI verification.

### Main Changes

- Archived the completed 07-23 layered-adapter task and finalized its delivery evidence.
- Preserved 00-bootstrap-guidelines as an active task.

### Git Commits

| Hash | Message |
|------|---------|
| `7511d17bba5d9738179a3ea0c5ab17484d6fcda2` | (see git log) |
| `96de82d23548be81f52072f5a1c5d223e4c6357a` | (see git log) |
| `bf2c5a7bb31ded2b8bc5e5f51c2cbe906a3860b9` | (see git log) |
| `bbf7bfe603cc150d20745d1f08e9ddbaee2aacbf` | (see git log) |
| `dd3def3257f15747b2781cbf19249cef473732e7` | (see git log) |
| `a19ba44068fbdf89b050d829536d16ac4a810b9a` | (see git log) |
| `4690884a5e7bb62ec2a2990b93b1b9d24f8b1585` | (see git log) |
| `d1ac358ffc0971e0fd145b260abd4975fa93077e` | (see git log) |
| `d77807302a827cb4fb1609f9ae9616cc268c2dd6` | (see git log) |
| `d49c51f6013f750ebd2fb7c93dc6165c06e02631` | (see git log) |
| `dd3d9a583ada23b92a4a6fe1b74c4b7b9af9449e` | (see git log) |

### Testing

- [OK] PR #10 CI passed 10 of 10 jobs; post-merge main CI passed 10 of 10 jobs.
- [OK] Fresh sandbox clean-install at d49c51f passed all 9 phases and created zero .claude paths.

### Status

[OK] **Completed**


## Session 3: Complete CLI capability role-routing decoupling

**Date**: 2026-07-27
**Task**: Complete CLI capability role-routing decoupling
**Branch**: `codex/role-routing-harness-sync`

### Summary

Implemented independent frontend/backend/search provider routing in CCG 3.4.0, completed Gemini and Grok reviews, synchronized the exact source tree through the Harness transaction, installed the CLI and Codex plugin cache, and passed final source, doctor, and conflict gates.

### Main Changes

- Decoupled the three persistent roles from provider names.
- Preserved analysis, planning, implementation/testing, and review as phases inside those roles.
- Recorded the source and Harness provenance transaction and review evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `19d094b77fa61b9d4408522053294e111aad90bb` | (see git log) |
| `bf60f343f22812a84c1c628f4d4d669ea9cf6996` | Final Harness projection commit |

### Testing

- [OK] CCG local gates passed: 32 files, 488 tests passed, 1 skipped.
- [OK] CCG PR #9 CI passed Linux, Windows, and Go jobs.
- [OK] Remote source verification, Harness tests, doctor, conflicts, and Trellis archive validation passed after the final provenance refresh.
- [OK] Harness PR #12 CI passed all 10 Node, Bootstrap/doctor, and Go jobs across Ubuntu, Windows, and macOS.

### Status

[OK] **Completed**

### Next Steps

- Merge CCG PR #9 before Harness PR #12.


## Session 4: Close provider role routing rollout

**Date**: 2026-07-27
**Task**: Close provider role routing rollout
**Branch**: `codex/provider-routing-closeout`

### Summary

Decoupled Harness provider role routing from permanent Claude/Grok disablement, preserved Codex-only workspace writes, added plugin-only CCG registration, installed and verified CCG 3.4.0+codex.1 from a durable source, passed local and initial GitHub CI gates, and prepared PR #13 for merge.

### Git Commits

| Hash | Message |
|------|---------|
| `b6e2e09` | (see git log) |
| `ddf09ce` | (see git log) |
| `1ee673d` | (see git log) |
| `62ccd67` | (see git log) |

### Status

[OK] **Completed**
