# Stop Hook retirement preflight (read-only)

Captured: 2026-08-18 (America/Denver)

## Repository identity

- Planning worktree:
  `G:/CodexWorktrees/remove-legacy-gptpro-stop-hook-harness`
- Branch: `codex/remove-legacy-gptpro-stop-hook`
- Base: `origin/main`
- Base commit: `e4d3319cac90d29d6faf2c9ef1fb1ff5d7b0a96c`

## Machine-global configuration

- `C:/Users/29933/.codex/hooks.json` resolves to
  `G:/CodexData/.codex/hooks.json`.
- SHA-256 before changes:
  `3231150f51fc1fb1f807553078059b41bf42fc99c85d5aa3ad6672a59b5c45ee`.
- One `Stop` command points to the legacy helper in
  `I:/ai/trellis-ccg-harness` with a 7500-second timeout.
- Registered helper SHA-256:
  `8f5407b1414e5a41007153870f361ed396d23077a085a3cab0bf860eb2252282`.
- Matching running Python process count: `0`.

## Local registry

- `stop-hook-v1`: absent.
- `stop-hook-v2`: present, 8 files, newest modification
  `2026-08-05T05:39:19-06:00`.
- Parsed registrations: 7 total; 4 `registered`, 3
  `continuation-requested`; all 7 deadlines expired.
- Raw UUIDs, URLs, prompts, responses, evidence paths, and log text were not
  copied into this artifact.

## Protected state

- `I:/ai/trellis-ccg-harness` is dirty and is the current global Hook target.
  It must not be modified, reset, stashed, cleaned, or deleted by this task.
- `G:/CodexData/.codex/worktrees/e2de/trellis-ccg-harness` also contains
  unrelated user changes and must remain untouched.

## Reachability conclusion

The repository-supported V2 path is RootWait-only and does not register Stop
Hook. The machine-global configuration is an external legacy registration and
must be detached before the dead repository implementation can be removed.

## Phase 1 execution evidence

- A second quiescence check found no matching Stop Hook or watcher process and
  no unexpired Stop Hook registration. Two owner-dead `run-starting` capacity
  claims remain isolated; they are not an in-flight batch and were not changed.
- Backup:
  `G:/CodexData/.codex/backups/stop-hook-retirement/20260818T-current/hooks.json.before-stop-hook-removal`.
- Backup SHA-256 matches the pre-change hash:
  `3231150f51fc1fb1f807553078059b41bf42fc99c85d5aa3ad6672a59b5c45ee`.
- The exact legacy `Stop` entry was removed. The resulting JSON parses, contains
  no `Stop` key, and is semantically identical for every other Hook.
- Post-change SHA-256:
  `3b93f45e773d3c65808eedab077d02dd0b574c9f61839f10255478564dabe683`.
- Registry quarantine and repository cleanup remain blocked until Codex is
  reloaded and one ordinary completion proves the removed Hook is not cached.

## Post-restart quarantine evidence

- After the user restarted Codex, the global `Stop` key remained absent, the
  configuration SHA-256 remained unchanged, and no matching helper/watcher
  process was running.
- The registry still contained exactly the same seven expired registrations;
  no unexpired registration appeared. Both capacity claims remained owner-dead,
  so there was no in-flight batch.
- The live registry was atomically renamed within its existing parent to:
  `C:/Users/29933/AppData/Local/ChatGptProSidebar/stop-hook-v2.quarantine-20260819T114016Z`.
- The quarantine contains the expected eight stale files and the live
  `stop-hook-v2` path is absent.
- Pre/post fingerprints for `concurrency-v1`, `idempotency-v1`, and
  `target-claims-v1` were identical. The registry move did not access the
  external evidence directories recorded inside stale registrations.
- The next ordinary completion cycle did not recreate the live registry and
  started no matching helper/watcher process. The quarantine was then deleted
  after exact-path validation.
- Final state: `stop-hook-v1`, `stop-hook-v2`, and all
  `stop-hook-v2.quarantine-*` directories are absent. The protected
  `concurrency-v1`, `idempotency-v1`, and `target-claims-v1` fingerprints still
  match the pre-quarantine values.
- Two pre-existing capacity claims remain owner-dead in `run-starting`; they
  were deliberately left untouched. Live capacity claim count is zero.
