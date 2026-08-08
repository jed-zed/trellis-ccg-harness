# Implementation plan: publish Grok unverified read-only intake

## 1. Accept CCG source

- [x] Require all PR #33 CI checks to pass.
- [x] Merge the PR and record the accepted 40-character commit and Git tree.

## 2. Update Harness

- [x] Commit this planning task so the Harness checkout is clean.
- [x] Run formal `harness:update` against the accepted CCG commit.
- [x] Review the exact component/manifest diff and verify plugin
      `3.4.6+codex.3` with unchanged wrapper `5.12.6` digests.

## 3. Verify and install

- [x] Run Harness tests, doctor/conflicts, and source identity checks.
- [x] Install the matching CLI/plugin with the supported non-interactive Harness
      flow and no live Provider call.
- [x] Re-run final identity and conflict checks.

## 4. Publish Harness

- [x] Commit only the task and formal Harness update outputs.
- [x] Push, open the scoped Harness PR, require CI, merge, then finish/archive
      this task through Trellis.
