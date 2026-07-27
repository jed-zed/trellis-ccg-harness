# Role-routing execution result

Status: complete. Source, Harness projection, installed runtime, model reviews,
and final gates are verified.

## Implemented

- Three independently configurable top-level roles: `frontend`, `backend`, and
  `search`.
- Analysis, planning, and review run inside the applicable top-level role.
- Five existing wrapper providers available to every top-level role: `codex`,
  `gemini`, `claude`, `antigravity`, and `grok`.
- Original-style configuration flow through the existing CCG config,
  installer/menu, template injection, and Go wrapper registry.
- Non-interactive `ccg routing list|get|set` commands for Codex mode.
- Legacy frontend/backend/review config normalization.
- Provider-neutral generic CCG commands, Skills, and domain rules.
- Codex remains the orchestrator, final real-workspace writer, and verifier.
- Codex-mode update preserves user-edited role routing while refreshing the
  installed CCG version.

## Deliberately deferred

The latest user boundary overrides the heavier optional parts of the original
v2 plan. This execution does not add arbitrary executable registration, a
generic `CommandBackend`, task permission/expiry state, a dispatcher, a
database, a daemon, or a second routing configuration root.

Explicit provider commands such as Gemini Preview, Grok Intel/Verify, and GPT
Pro retain their named-provider semantics and do not rewrite saved role
routing.

## Review evidence

- Gemini compatibility/final review:
  `C:\Users\29933\.codex\ccg\logs\gemini-preview-20260727-142127.response.txt`
  (no blocking or major findings).
- Grok local code review ran against an isolated copy of the complete source
  diff in session `019fa54f-c815-7802-a84f-6ae2d886452c`. Its findings led to
  the GPT Pro optional-Gemini path, complete installer/init search routing,
  provider-neutral hook/help text, and focused regression tests.
- Grok final re-review ran in session
  `019fa562-7124-77d0-b38e-ab4247dc8e81`. It first found that
  `doctor`/routing status did not include `search`, plus two minor coverage/text
  gaps. After those fixes were copied back into the isolated review tree, the
  same session reported no blocker, major, or minor findings. Hash comparison
  confirmed the review tree matched all 91 changed or untracked source files.
- Grok external version/backend audit:
  `I:\ai\ccg-workflow-role-routing-v2\.ccg\tasks\cli-capability-routing-decoupling\grok-intelligence\20260727175539-e39c7046b8d2\evidence.json`
  (`partially_verified`; public upstream version/backend facts verified, private
  personal provenance left to local Git/Harness checks).

## Verification

- `pnpm test`: 32 files passed; 488 tests passed; 1 skipped.
- `pnpm build`: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.
- `go test ./...`: passed.
- `git diff --check`: passed.
- The Harness provenance transaction repeated the source and installed-path
  lint, typecheck, test, build, Go test/build, CLI version, and Node test gates.
- Focused routing tests cover single-role preservation, all five registered
  providers for all three roles, legacy normalization, `doctor` status, Codex
  update preservation, and both GPT Pro plan/review without Gemini evidence.
- Hardcoded generic-provider scan: no active Gemini-first, mandatory Gemini,
  permanent Claude-disabled, or Codex-primary-backend rule remains outside
  explicit provider commands and negative tests.
- Final Harness conflict gate: 14 checks passed, 0 warnings, 0 blockers.
- Plain `pnpm verify:sources` fetched the pushed source commit and passed.
- `pnpm doctor` and archived Trellis context validation passed.
- CCG PR #9 GitHub Actions run `30310513642` passed all Linux Node 20/22,
  Windows Node 20/22, and Go Ubuntu/Windows jobs.
- Harness PR #12 GitHub Actions run `30312480801` passed all 10 Node,
  Bootstrap/doctor, and Go jobs across Ubuntu, Windows, and macOS.
- Installed routing smoke test:
  `frontend=gemini`, `backend=codex`, `search=grok`.

## Source transaction

- Source worktree: `I:\ai\ccg-workflow-role-routing-v2`
- Branch: `codex/role-routing-v2`
- Base: `8bdad64e4e5ccad75e1086ae31ad757e6bbdbef8`
- Version: `3.4.0`
- Source commit:
  `19d094b77fa61b9d4408522053294e111aad90bb`
- Source Git tree:
  `42dda092fb187344af69c9af340eb7b4af3cec67`
- Source commits:
  `feat(codex): decouple workflow role routing` and
  `test(codex): support Windows config line endings`.
- Draft PR: `https://github.com/jed-zed/ccg-gptpro-worflow/pull/9`

## Harness projection and installation

- Harness worktree: `I:\ai\trellis-ccg-harness-role-routing-v2`
- Branch: `codex/role-routing-harness-sync`
- Rebased base: `8eb050df4e1f3c9c4bbc39c377ca22d9b16407db`.
- Final Harness projection commit:
  `bf60f343f22812a84c1c628f4d4d669ea9cf6996`
- Transaction:
  `2026-07-27T22-43-07-673Z-8d3b730e-8c19-40b2-b00f-eb20c54ff9b0`
- The committed Harness component tree exactly matches source Git tree
  `42dda092fb187344af69c9af340eb7b4af3cec67`.
- Global runtime: `ccg/3.4.0 win32-x64 node-v24.13.0`.
- Global runtime link is owned by the Harness transaction and retains its
  recorded rollback target.
- Codex plugin cache:
  `C:\Users\29933\.codex\plugins\cache\ccg-gptpro-worflow\ccg\3.4.0+codex.1`.
- The current Codex process cannot hot-reload the new cached Skills; a new
  Codex session is required.
- Draft PR: `https://github.com/jed-zed/trellis-ccg-harness/pull/12`
- Both PR branches were pushed; both PRs are mergeable and have green CI.
- Merge order remains source PR #9 first, then Harness PR #12.
- Existing dirty Harness and prototype worktrees were preserved without
  reset, clean, or unrelated staging.
