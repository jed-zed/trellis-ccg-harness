# PR58 CI closeout design

The accepted scope now includes the three existing CCG CI defects, as explicitly
approved in this chat on 2026-10-22. The MCPX verifier candidate is retained.

- Sidebar: normalize the prefilled SendSelector through the existing fixture
  helper; production logic and every original assertion remain unchanged.
- Cache contention: observe the contender rejection as soon as it is created,
  retain the assertion that a live replacement owner is never reclaimed, and
  await all started work. Change production locking only if a separate regression
  demonstrates a production defect.
- Go: distinguish physical temporary-fixture roots, Windows 8.3 aliases, and real
  symlink/junction traversal. Keep config size/type checks and reject real links.
  Preserve the explicit macOS managed-preferences rejection; test that platform
  outcome explicitly while retaining collector coverage.
- Personal CCG is authoritative. Implement in the isolated source checkout, then
  import a verified committed source tree and update Harness provenance together.
  The Go change requires a new wrapper candidate identity and six real binary
  pins under the existing dual-build release contract. Prepare these locally;
  the CCG package version and installed runtimes stay unchanged. No fabricated
  commit/tree, remote release, merge, or deployment is authorized by these edits.

Two native Sol leaves own disjoint Go and cache-test paths. The coordinator owns
task records, Sidebar, provenance, integration and final acceptance. Baseline
tests run against a separate frozen checkout so edits cannot contaminate results.
