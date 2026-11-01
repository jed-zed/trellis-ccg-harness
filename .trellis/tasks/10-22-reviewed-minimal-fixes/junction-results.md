# Codex-home Junction compatibility — parent review delivery

Implementation and original runtime acceptance completed on HEAD 724975b274d4cf4ec2f69ebfe7d7a888193e7706, branch codex/sync-main-20261021. Parent final review remains pending; no archive/commit/push/merge. User authorization: 2026-10-22 09:19 UTC continuation through parent thread 01a15691-e0ff-776b-b97a-0627cf34a0e6.

The existing C:/Users/29933/.codex Junction still points to G:/CodexData/.codex. Its physical target is still an ordinary directory. Only metadata was inspected. No real credentials/protected sessions, UI, actual upload/Provider login, installation, ACL/default-entry changes, or session termination.

## Scope, evidence and safety reasoning

- The original resolver rejected every symbolic-link component. Only the default HomeDir/.codex leaf (including an explicitly identical Windows case-insensitive spelling) may now be an alias. Its literal ancestors still must be ordinary directories. Only a missing default during that lstat walk retains bootstrap compatibility. realpath errors remain outside the missing-default catch, so dangling/cyclic links cannot masquerade as absent defaults.
- The resolved target is checked again: no filesystem root, non-directory or linked components. Every returned existing root is physical. Nondefault explicit link roots remain rejected. This selects an explicitly configured root; it is not a new arbitrary sandbox boundary.
- Skill repository isolation in core load/save previously compared the physical repository to the lexical Codex root. It now uses the resolved physical Codex root while retaining existing profile-path checks; the regression confirms active physical skills cannot become the catalog repository.
- Existing approval digest, ownership, CAS, authenticated rollback and contained-target checks remain. Tests bind a plan/state through the alias, retarget it, and verify refusal. sameCodexHome historical-alias semantics are unchanged; no legacy receipt/journal migration was attempted. This is not a defense against concurrent path replacement between resolve and use; downstream safeguards remain independent, as documented.
- The resolver's fixed source pin was updated using Claude's authored mechanical updater with the existing verifier's canonical UTF-8/CRLF normalization; no source-tree validation was removed. New pin: 6619e8686434c4ff354575fb036df30a2eb7fac322983dd100144426dcb60cbe.
- New seven-file scope: .agents/skills/harness-init/scripts/codex-home.mjs, .agents/skills/harness-init/scripts/harness-init-core.mjs, scripts/verify-sources.ps1, tests/harness-split-roots.test.mjs, .agents/skills/harness-init/SKILL.md, .trellis/spec/tooling/harness-initializer.md, scripts/DESIGN.md. All final files equal Claude snapshot outputs (the pin is produced by Claude's updater). All prior seven-file fixes remain byte-identical to their verified outputs. No other tracked edits were introduced; prior .serena/ and pnpm-lock.yaml remain untracked. Necessary task notes were appended to the existing task.

## Actual Claude and CCG use

Analysis: 09:22:59–09:29:07 UTC. Implementation: 09:31:50–09:36:28 UTC, 2026-10-22. Both requested opus[1m], returned claude-opus-5-5[1m], 1,000,000 context, success/exit 0, no permission denials. Claude actually read installed CCG execute/executor/quality instructions and authored Edit/Write output. Native Claude Code transport, normal acceptEdits with only Read/Glob/Grep/Edit/Write tools; no webpage, fallback or permission bypass. The installed CCG original snapshot builder was used. The stock wrapper was not used or claimed verified because its launch includes permission-bypass arguments.

Raw provider outputs: CLAUDE-ANALYSIS.md and CLAUDE-FIXES.md; execution receipts/events preserve actual model/tool evidence. This delivery is controller validation, distinct from those Claude outputs. One initial mechanical hash-sync attempt was denied by the ordinary sandbox before any write; normal require_escalated approval succeeded, then integration succeeded. No auto-review rejection, uncertain operation, or pending tool approval remains.

## Verification

| Check | Actual result |
|---|---|
| Junction/split-roots tests | 13 passed, 0 failed/skipped; default/case aliases, unsupported explicit aliases, missing roots, ancestors, dangling/self-loop/two-node loop/volume root/file link, plan/state retarget, repository isolation and prior rollback tests |
| Original focused adapter/CI/README files | 43 passed, 0 failed/skipped |
| Pester upload manifest cases | Discovered 5, PassedCount 5, FailedCount 0, SkippedCount 0, NotRunCount 0 |
| All offline Harness contracts (repository standard runner) | {"tests": 588, "pass": 587, "fail": 0, "cancelled": 0, "skipped": 1, "todo": 0}; exit 0 |
| Original conflicts --json | Exit 0; 19 ok, 2 info, 0 warning/blocking |
| doctor.ps1 | Exit 0; source provenance/tree verification passed and Harness doctor passed |
| context --json / conflicts --ci --json | Both exit 0 |
| git diff --check | Exit 0 |

Runtime commands used the original repository, home configuration and entry points, with no alternate-home or skip arguments added. The offline standard test runner's fixture isolation is not the runtime acceptance environment. All link test fixtures were removed as individual links before recursive fixture cleanup; file-link testing actually executed with zero skips.


The sole full-suite skip is the preexisting POSIX-mode AGENTS permission-drift CAS test (`tests/harness-init-cli.test.mjs:1241`, `skip: process.platform === "win32"`). No new Junction or Pester regression was skipped.

Installed CCG verify-change/verify-quality/verify-security scripts were run. All exit 0. Resolver quality: 0 warnings. Core retains 71 preexisting structure warnings (file/function lengths shifted by the small change). Security scanner reports zero findings but its extension-specific .mjs rule coverage is limited; it is not treated as proof of filesystem safety. Manual review and the actual path/identity regressions provide that scoped evidence. The change analyzer also under-classifies .mjs as code, so scope/doc synchronization was checked against the actual diff.

No cross-platform Node 20/22 CI matrix, full frozen CCG/Go suite, live installation, real Provider/browser/upload, or legacy journal migration was performed. No new remote CI run was created. The complete local offline suite and original blocking runtime commands above are the actual validation boundary.

## Deliverables and rollback

FINAL-SCOPED.diff is the actual current Git diff for the seven new files. SCOPED.diff and patches/01.diff–07.diff contain the prepared per-file delta; baseline/<path> preserves original bytes. Prior seven-file patches remain in ../recheck-20261022-0730. Rollback only the new seven hunks after checking concurrent edits, including the paired resolver/pin; do not reset the tree or remove/change the real Junction. No rollback was performed.

The task remains in_progress for parent final acceptance. Complete scoped diff follows.

```diff
diff --git a/.agents/skills/harness-init/SKILL.md b/.agents/skills/harness-init/SKILL.md
index 3e8710e..beb8cfa 100644
--- a/.agents/skills/harness-init/SKILL.md
+++ b/.agents/skills/harness-init/SKILL.md
@@ -68,7 +68,9 @@ unresolved decision per turn. Each question must
 
 For a split installation, pass `--home-dir <AgentsHome>` and
 `--codex-home <physical .codex directory>` together. The default remains
-`HomeDir/.codex`; a linked default requires its explicit physical root.
+`HomeDir/.codex`; that default entry alone may be a link (for example a Windows
+junction) and resolves to its physical directory. Other explicit links and
+linked ancestors are rejected.
 Skills, journals and backups remain in AgentsHome. Global Codex projections
 and subprocess `CODEX_HOME` use the selected physical root, which is bound into
 approval and rollback digests. Keep existing profile junctions in place.
diff --git a/.agents/skills/harness-init/scripts/codex-home.mjs b/.agents/skills/harness-init/scripts/codex-home.mjs
index fefe49e..fb5f25d 100644
--- a/.agents/skills/harness-init/scripts/codex-home.mjs
+++ b/.agents/skills/harness-init/scripts/codex-home.mjs
@@ -13,25 +13,39 @@ export async function sameCodexHome(left, right) {
   catch { return false; }
 }
 
-// An explicit split root is a physical configuration directory, never a link
-// transplanted into AgentsHome. Defaults may be absent before first install.
-export async function resolveCodexHome(homeDir, codexHome = null) {
-  const target = codexHomePath(homeDir, codexHome);
+async function assertDirectoryChain(target, allowFinalLink) {
   if (target === path.parse(target).root) {
     throw new Error("Codex home cannot be a filesystem root.");
   }
   let current = path.parse(target).root;
-  for (const segment of path.relative(current, target).split(path.sep)) {
+  const segments = path.relative(current, target).split(path.sep);
+  for (const [index, segment] of segments.entries()) {
     current = path.join(current, segment);
-    try {
-      const state = await lstat(current);
-      if (state.isSymbolicLink() || !state.isDirectory()) {
-        throw new Error(`Codex home must use real non-linked directories: ${current}`);
-      }
-    } catch (error) {
-      if (error?.code === "ENOENT" && target === path.resolve(homeDir, ".codex")) return target;
-      throw error;
+    const state = await lstat(current);
+    if (allowFinalLink && index === segments.length - 1 && state.isSymbolicLink()) return;
+    if (state.isSymbolicLink() || !state.isDirectory()) {
+      throw new Error(`Codex home must use real non-linked directories: ${current}`);
     }
   }
-  return realpath(target);
+}
+
+// Only the HomeDir/.codex profile entry may itself be a link (e.g. a Windows
+// junction); its ancestors and every other explicit root stay real directories.
+// Callers bind the returned physical root, which must also be a link-free
+// directory chain. Defaults may be absent before first install.
+export async function resolveCodexHome(homeDir, codexHome = null) {
+  const target = codexHomePath(homeDir, codexHome);
+  const defaultHome = path.resolve(homeDir, ".codex");
+  const isDefault = process.platform === "win32"
+    ? target.toLowerCase() === defaultHome.toLowerCase()
+    : target === defaultHome;
+  try {
+    await assertDirectoryChain(target, isDefault);
+  } catch (error) {
+    if (error?.code === "ENOENT" && isDefault) return target;
+    throw error;
+  }
+  const physical = await realpath(target);
+  await assertDirectoryChain(physical, false);
+  return physical;
 }
diff --git a/.agents/skills/harness-init/scripts/harness-init-core.mjs b/.agents/skills/harness-init/scripts/harness-init-core.mjs
index 5266fe2..c6b9f31 100644
--- a/.agents/skills/harness-init/scripts/harness-init-core.mjs
+++ b/.agents/skills/harness-init/scripts/harness-init-core.mjs
@@ -1,4 +1,4 @@
-import { codexHomePath, resolveCodexHome } from "./codex-home.mjs";
+import { resolveCodexHome } from "./codex-home.mjs";
 import {
   createHash,
   createHmac,
@@ -376,13 +376,14 @@ function isSameOrInside(root, target) {
   );
 }
 
-function assertDedicatedSkillRepository(repositoryPath, homeDir, codexHome) {
+// codexRoot is the resolved physical root so a linked default cannot hide it.
+function assertDedicatedSkillRepository(repositoryPath, homeDir, codexRoot) {
   const repository = path.resolve(repositoryPath);
   const userRoot = path.resolve(homeDir);
   for (const activeRoot of [
     path.join(userRoot, ".agents", "skills"),
     path.join(userRoot, ".codex", "skills"),
-    path.join(codexHomePath(homeDir, codexHome), "skills"),
+    path.join(codexRoot, "skills"),
   ]) {
     if (
       isSameOrInside(activeRoot, repository) ||
@@ -517,7 +518,8 @@ export async function loadSkillRepositoryProfile({
   const profile = validateSkillRepositoryProfile(await readJson(target), {
     allowPreviousGlobalSkills,
   });
-  assertDedicatedSkillRepository(profile.repositoryPath, canonicalHome, codexHome);
+  assertDedicatedSkillRepository(profile.repositoryPath, canonicalHome,
+    await resolveCodexHome(canonicalHome, codexHome));
   return profile;
 }
 
@@ -546,7 +548,8 @@ export async function saveSkillRepositoryProfile({
       `Skill repository path is not a directory: ${canonicalRepository}`,
     );
   }
-  assertDedicatedSkillRepository(canonicalRepository, canonicalHome, codexHome);
+  assertDedicatedSkillRepository(canonicalRepository, canonicalHome,
+    await resolveCodexHome(canonicalHome, codexHome));
   const profile = {
     schemaVersion: 1,
     repositoryPath: canonicalRepository,
diff --git a/.trellis/spec/tooling/harness-initializer.md b/.trellis/spec/tooling/harness-initializer.md
index e6fab3e..5f5b891 100644
--- a/.trellis/spec/tooling/harness-initializer.md
+++ b/.trellis/spec/tooling/harness-initializer.md
@@ -65,7 +65,8 @@ and recovery tests; ordinary callers use only `repoRoot`.
 - `homeDir`/`--home-dir` is AgentsHome. `codexHome`/`--codex-home` is the physical
   Codex directory, with HomeDir/.codex as the compatibility default. Resolve
   and bind both roots in plans, inventory digests, receipts, backups, provider
-  environments, rollback and validation. Reject a changed or linked root.
+  environments, rollback and validation. Reject a changed root or any link
+  other than the final HomeDir/.codex entry.
 - Updating the same managed platform Skill count requires a formal source
   update: verify the original receipt and target tree, back up original source
   manifest and bytes, CAS the new ownership, and retain explicit rollback
@@ -77,8 +78,17 @@ and recovery tests; ordinary callers use only `repoRoot`.
 approval records, provenance keys and backups remain under its `.agents/`.
 `--codex-home` (`-CodexHome`) selects the physical Codex configuration root;
 the compatibility default is `HomeDir/.codex`. Explicit roots must exist and
-use non-linked directory chains. An existing profile junction is retained and
-is never transplanted. An existing historical alias must resolve to the same
+use non-linked directory chains. Only the final `HomeDir/.codex` entry, used by
+default or named explicitly (case-insensitive on Windows), may be a link: its
+literal ancestors must be real directories; only a missing default is tolerated
+during that walk; `realpath` errors (dangling or looping links) propagate; the
+physical result must be a link-free directory chain and not a volume root or
+file. The resolver returns that physical root, and every plan, state,
+ownership, CAS and rollback binding uses it, so a later retarget is a root
+change. This is not protection against concurrent path replacement; downstream
+checks remain independent. Skill repository isolation also compares against
+the resolved physical root. An existing profile junction is retained and is
+never transplanted. An existing historical alias must resolve to the same
 selected physical directory before its first source-update transaction.
 
 The selected Codex root binds global AGENTS projection, migration inventory
@@ -107,6 +117,10 @@ cannot establish ownership. Direct schema-1 Global Init receipts remain direct
 receipts; catalog migration audit applies to schema-2 catalog ownership.
 
 Regression coverage includes separate roots with existing profile junctions,
+default-link resolution and its rejected variants (other explicit links, linked
+ancestors, missing explicit roots, dangling/looping links, volume-root or file
+targets), default-link retarget rejection for plans and Global Init state,
+physical Skill-repository isolation,
 plan/apply/repeat/failure/rollback, root-switch rejection, same-count source
 updates and later-user-edit rollback refusal. Tests use owned temporary roots;
 they never write the installed daily profile or change credentials/permissions.
diff --git a/scripts/DESIGN.md b/scripts/DESIGN.md
index 906c06a..86ee7d8 100644
--- a/scripts/DESIGN.md
+++ b/scripts/DESIGN.md
@@ -192,6 +192,14 @@ unclaimed path merely because an earlier observation matched.
   entrypoint, package/version identity, and file hashes for review, but Harness
   never starts the Provider CLI or writes an action receipt. This avoids the
   unattested dependency-tree and verify-to-spawn interval.
+- The Codex root resolver accepts a link only as the final `HomeDir/.codex`
+  entry (default or explicit, case-insensitive on Windows) so a profile
+  junction keeps working. Its ancestors, all other explicit roots and the
+  resolved physical chain must be real directories; realpath failures are not
+  swallowed and a volume-root or file target is rejected. Approvals, state,
+  ownership and rollback bind the physical root, so a retargeted link reads as
+  a root switch. This does not defend against concurrent path replacement
+  between resolution and use; downstream checks stay independent.
 - User-profile parent directories and catalog/project Skill trees reject
   symbolic links and reparse points; project copies are bounded by depth, file
   count, individual file size, and total size.
diff --git a/scripts/verify-sources.ps1 b/scripts/verify-sources.ps1
index 2deeac3..99e851d 100644
--- a/scripts/verify-sources.ps1
+++ b/scripts/verify-sources.ps1
@@ -25,7 +25,7 @@ $expectedThirdPartyValidatorSha256 = "919c9bd4a68ecf45f61c6139c2d0571d8a9a5ab4da
 $expectedTrustedCommandResolverSha256 = "cf7c2645f0b7b2cbc502b9e96c24ae306b1f7727f3fd03f15017da351b449494"
 # Every transitive native-identity import is pinned and staged with the validator.
 $identityDependencyPins = @{
-  "codex-home.mjs" = "ee6c9c0cde172584d22a7c72816f38582ef2570c4abff69801a4589bae33549b"
+  "codex-home.mjs" = "6619e8686434c4ff354575fb036df30a2eb7fac322983dd100144426dcb60cbe"
   "windows-process-identity.mjs" = "bbce7766912c3ec91dfd83223b4feca2b903dbe2d03fc868e0c7a5273434672d"
   "python-resolver.mjs" = "68eb4a600b1c03545ccc8edf8318a1b3760f7ee11d9ce9d7dedfd04f9b40ae1d"
 }
diff --git a/tests/harness-split-roots.test.mjs b/tests/harness-split-roots.test.mjs
index e59718f..03c121b 100644
--- a/tests/harness-split-roots.test.mjs
+++ b/tests/harness-split-roots.test.mjs
@@ -1,6 +1,6 @@
 import assert from "node:assert/strict";
 import { createHash } from "node:crypto";
-import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
+import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
 import { tmpdir } from "node:os";
 import path from "node:path";
 import test from "node:test";
@@ -9,7 +9,7 @@ import { fileURLToPath } from "node:url";
 import { resolveCodexHome } from "../.agents/skills/harness-init/scripts/codex-home.mjs";
 import { GLOBAL_PLATFORM_SKILLS, rollbackPlatformSourceUpdate } from "../.agents/skills/harness-init/scripts/skill-platform-migration.mjs";
 import { installBundledPlatformSkills, loadGlobalInitState, inspectProviderCliStatuses } from "../.agents/skills/harness-init/scripts/guided-init.mjs";
-import { runGlobalInit, runHarnessInitCli } from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";
+import { loadSkillRepositoryProfile, runGlobalInit, runHarnessInitCli, saveSkillRepositoryProfile } from "../.agents/skills/harness-init/scripts/harness-init-core.mjs";
 import { buildThirdPartyApprovalPlan, thirdPartySubprocessEnvironment, verifyThirdPartyApprovalPlanForOperation } from "../.agents/skills/harness-init/scripts/third-party-approval.mjs";
 import { runUserStateChecks } from "../scripts/lib/harness-adapter/conflict-runtime.mjs";
 
@@ -41,17 +41,131 @@ async function plan(value, codexHome = value.codexHome) {
     approvedCommandRoots: [], approvedPackageRoots: [] });
 }
 
-test("split roots preserve an existing AgentsHome junction and reject it as the selected physical root", async () => {
-  const value = fixture();
+function globalInitOptions(value, codexHome, cliPlan) {
+  return { approved: true, catalogMode: "skip", homeDir: value.homeDir,
+    codexHome, repoRoot: value.repoRoot, skillRoot: SKILL_ROOT,
+    providerActions: Object.fromEntries(["codex", "gemini", "grok", "claude"].map((name) => [name, "later"])),
+    providerStatusOverrides: Object.fromEntries(["codex", "gemini", "grok", "claude"].map((name) => [name, "not-installed"])),
+    thirdPartyApprovalPlan: cliPlan, thirdPartyPlanSha256: cliPlan.planSha256,
+    thirdPartySourceSha256: cliPlan.sourceManifestSha256 };
+}
+
+// Fixture links are removed one by one before any recursive cleanup, so a
+// link to a volume root or outside the fixture is never traversed.
+function linker() {
+  const links = [];
+  const link = (target, at, type = process.platform === "win32" ? "junction" : "dir") => {
+    symlinkSync(target, at, type); links.push(at); return at;
+  };
+  link.removeAll = () => {
+    for (const at of links.splice(0).reverse()) {
+      let state;
+      try { state = lstatSync(at); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
+      if (!state.isSymbolicLink()) throw new Error(`Fixture link was replaced: ${at}`);
+      unlinkSync(at);
+    }
+  };
+  return link;
+}
+
+function retarget(link, at, target) {
+  unlinkSync(at); link(target, at);
+}
+
+test("only the default HomeDir/.codex entry may be a link and resolves to its physical root", async () => {
+  const value = fixture(), link = linker();
   try {
-    const junction = path.join(value.homeDir, ".codex");
-    symlinkSync(value.codexHome, junction, process.platform === "win32" ? "junction" : "dir");
+    const junction = link(value.codexHome, path.join(value.homeDir, ".codex"));
     assert.equal(await resolveCodexHome(value.homeDir, value.codexHome), value.codexHome);
+    assert.equal(await resolveCodexHome(value.homeDir), value.codexHome);
+    assert.equal(await resolveCodexHome(value.homeDir, junction), value.codexHome);
+    if (process.platform === "win32") {
+      assert.equal(await resolveCodexHome(value.homeDir, path.join(value.homeDir, ".CODEX")), value.codexHome);
+    }
+    const other = link(value.codexHome, path.join(value.root, "alias-codex"));
+    await assert.rejects(resolveCodexHome(value.homeDir, other), /non-linked/);
+    assert.equal(readFileSync(value.sentinel, "utf8"), "fixture credentials remain untouched\n");
+    assert.equal(lstatSync(junction).isSymbolicLink(), true);
+  } finally { link.removeAll(); value.cleanup(); }
+});
+
+test("missing defaults stay compatible while missing explicit roots and linked ancestors are rejected", async () => {
+  const value = fixture(), link = linker();
+  try {
+    assert.equal(await resolveCodexHome(value.homeDir), path.join(value.homeDir, ".codex"));
+    const absentHome = path.join(value.root, "absent", "home");
+    assert.equal(await resolveCodexHome(absentHome), path.join(absentHome, ".codex"));
+    await assert.rejects(resolveCodexHome(value.homeDir, path.join(value.root, "absent-codex")), { code: "ENOENT" });
+    const linkedHome = link(value.homeDir, path.join(value.root, "linked-home"));
+    await assert.rejects(resolveCodexHome(linkedHome), /non-linked/);
+    const linkedRoot = link(value.root, path.join(value.root, "linked-root"));
+    await assert.rejects(resolveCodexHome(value.homeDir, path.join(linkedRoot, "physical-codex")), /non-linked/);
+  } finally { link.removeAll(); value.cleanup(); }
+});
+
+test("a dangling, looping, volume-root or file default link is rejected", async (t) => {
+  const value = fixture(), link = linker();
+  const alias = path.join(value.homeDir, ".codex");
+  try {
+    link(path.join(value.root, "gone"), alias);
+    await assert.rejects(resolveCodexHome(value.homeDir), { code: "ENOENT" });
+    unlinkSync(alias); link(alias, alias);
+    await assert.rejects(resolveCodexHome(value.homeDir), { code: "ELOOP" });
+    unlinkSync(alias);
+    const loopB = link(alias, path.join(value.root, "loop-b"));
+    link(loopB, alias);
+    await assert.rejects(resolveCodexHome(value.homeDir), { code: "ELOOP" });
+    retarget(link, alias, path.parse(value.root).root);
+    await assert.rejects(resolveCodexHome(value.homeDir), /filesystem root/);
+    const file = path.join(value.root, "codex-file");
+    writeFileSync(file, "not a directory\n");
+    await assert.rejects(resolveCodexHome(value.homeDir, file), /non-linked/);
+    unlinkSync(alias);
+    try { link(file, alias, "file"); } catch (error) {
+      if (error.code !== "EPERM") throw error;
+      t.skip("file symbolic links are unavailable without the symlink privilege");
+      return;
+    }
     await assert.rejects(resolveCodexHome(value.homeDir), /non-linked/);
-    await assert.rejects(resolveCodexHome(value.homeDir, junction), /non-linked/);
+  } finally { link.removeAll(); value.cleanup(); }
+});
+
+test("plans and Global Init state bound through the default link reject a later retarget", async () => {
+  const value = fixture(), link = linker();
+  try {
+    const alias = link(value.codexHome, path.join(value.homeDir, ".codex"));
+    const other = path.join(value.root, "other-codex"); mkdirSync(other);
+    const bound = await plan(value, null);
+    assert.equal(bound.execution.subprocessConfigRoots.codexHome, value.codexHome);
+    assert.equal((await runGlobalInit(globalInitOptions(value, null, bound))).status, "initialized");
+    assert.equal((await loadGlobalInitState({ homeDir: value.homeDir })).codexHome, value.codexHome);
+    retarget(link, alias, other);
+    await assert.rejects(verifyThirdPartyApprovalPlanForOperation({
+      approvalPlan: bound, homeDir: value.homeDir, codexHome: null, repoRoot: value.repoRoot,
+      manifest: JSON.parse(readFileSync(MANIFEST_PATH, "utf8")), manifestSha256: bound.sourceManifestSha256,
+      strictDataBoundary: false, env: {},
+    }), /subprocess configuration roots/);
+    await assert.rejects(loadGlobalInitState({ homeDir: value.homeDir }), /differs from the selected root/);
     assert.equal(readFileSync(value.sentinel, "utf8"), "fixture credentials remain untouched\n");
-    assert.equal(existsSync(junction), true);
-  } finally { value.cleanup(); }
+  } finally { link.removeAll(); value.cleanup(); }
+});
+
+test("Skill repository isolation uses the physical root behind the default link", async () => {
+  const value = fixture(), link = linker();
+  try {
+    link(value.codexHome, path.join(value.homeDir, ".codex"));
+    const physicalSkills = path.join(value.codexHome, "skills"); mkdirSync(physicalSkills);
+    const profilePath = path.join(value.homeDir, ".agents", "harness", "skill-repository.json");
+    await assert.rejects(saveSkillRepositoryProfile({ approved: true, homeDir: value.homeDir,
+      globalEssentialSkills: GLOBAL_PLATFORM_SKILLS, repositoryPath: physicalSkills }), /dedicated and separate/);
+    assert.equal(existsSync(profilePath), false);
+    mkdirSync(path.dirname(profilePath), { recursive: true });
+    writeFileSync(profilePath, JSON.stringify({ schemaVersion: 1, repositoryPath: physicalSkills,
+      globalEssentialSkills: GLOBAL_PLATFORM_SKILLS,
+      selection: { approvalRequired: true, installMode: "copy", guidance: [], excludedSkills: [] },
+      refinedAt: "2026-10-22T00:00:00.000Z" }));
+    await assert.rejects(loadSkillRepositoryProfile({ homeDir: value.homeDir }), /dedicated and separate/);
+  } finally { link.removeAll(); value.cleanup(); }
 });
 
 test("addon plan and subprocess environment bind the physical Codex root and reject a root switch", async () => {
@@ -75,12 +189,7 @@ test("Global Init and CLI repeat on split roots without touching physical Codex
   const value = fixture();
   try {
     const cliPlan = await plan(value);
-    const options = { approved: true, catalogMode: "skip", homeDir: value.homeDir,
-      codexHome: value.codexHome, repoRoot: value.repoRoot, skillRoot: SKILL_ROOT,
-      providerActions: Object.fromEntries(["codex", "gemini", "grok", "claude"].map((name) => [name, "later"])),
-      providerStatusOverrides: Object.fromEntries(["codex", "gemini", "grok", "claude"].map((name) => [name, "not-installed"])),
-      thirdPartyApprovalPlan: cliPlan, thirdPartyPlanSha256: cliPlan.planSha256,
-      thirdPartySourceSha256: cliPlan.sourceManifestSha256 };
+    const options = globalInitOptions(value, value.codexHome, cliPlan);
     assert.equal((await runGlobalInit(options)).status, "initialized");
     assert.equal((await runGlobalInit(options)).status, "unchanged");
     const state = await loadGlobalInitState({ homeDir: value.homeDir, codexHome: value.codexHome });

```
