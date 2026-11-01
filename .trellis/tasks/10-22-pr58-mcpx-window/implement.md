# Authoritative execution plan

Supersedes the short sequence in prd.md for the expanded CI scope. User approvals:
continue the handoff; fix Sidebar fixture and rerun offline tests; then explicitly
"继续完成这三处 CI 修复（推荐）" for cache, macOS and Windows.

1. Preserve original PR and candidate identities; use isolated checkouts.
2. Complete baseline Windows checks and record tool versions and actual results.
3. Cache leaf: diagnose rejected contender race, implement the minimum fix, and
   run its focused regression without relaxing locking assertions.
4. Go leaf: reproduce alias/platform cases, fix the applicable common boundary,
   retain real-link rejection and macOS fail-closed tests. Use Go 1.26.5 and
   report unexecuted platforms explicitly.
5. Accept frozen leaf output, inspect diffs and run affected full source checks.
   Reuse unchanged lint/build/Python evidence where valid.
6. Prepare the wrapper candidate version/recipe and six-platform binaries twice
   using the existing Go 1.26.2 release flags. Update installer pins only from
   actual matching artifacts, retaining the exact-source validator. This is local
   candidate preparation; release publication and installation remain excluded.
   Prepare source and Harness publication as one provenance-consistent change.
   Obtain missing commit/push/remote-CI permission after changes are reviewable.
   Do not deploy installed runtimes.
7. Import the actual source tree, update manifest, rerun provenance/conflicts and
   affected Harness gates. Record exact candidate/platform results and remaining
   remote matrix gaps; do not mark complete while required gaps remain.
