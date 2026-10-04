import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertCodexMutationHost } from "../.agents/skills/harness-init/scripts/codex-host-boundary.mjs";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
function snapshot(root) {
  const entries = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { entries.push([path.relative(root,target),"directory"]); walk(target); }
      else entries.push([path.relative(root,target),createHash("sha256").update(readFileSync(target)).digest("hex")]);
    }
  }
  walk(root); return entries;
}
const markers = [{ CLAUDECODE: "1" }, { CCG_HOST: "claude" }];
test("explicit Claude host markers reject mutations; Codex and unmarked contexts remain compatible", () => {
  for (const marker of markers) assert.throws(() => assertCodexMutationHost(marker), /require the Codex host/);
  for (const env of [{}, {CLAUDECODE:"0"}, {CCG_HOST:"codex"}]) assert.doesNotThrow(() => assertCodexMutationHost(env));
});
for (const [name, calls] of [
  ["core init and migration", [
    [process.execPath, [path.join(repoRoot,"scripts/harness-init.mjs"),"apply"]],
    [process.execPath, [path.join(repoRoot,"scripts/harness-init.mjs"),"project-init"]],
    [process.execPath, [path.join(repoRoot,"scripts/harness-init.mjs"),"global-init"]],
    [process.execPath, [path.join(repoRoot,".agents/skills/harness-init/scripts/harness-init-core.mjs"),"skill-migration-apply"]],
    [process.execPath, [path.join(repoRoot,".agents/skills/harness-init/scripts/harness-init-core.mjs"),"skill-migration-rollback"]],
  ]],
  ["lifecycle", ["bootstrap-begin","bootstrap-complete","bootstrap-abort","update","rollback","recover","uninstall"].map(command => [process.execPath,[path.join(repoRoot,"scripts/harness-lifecycle.mjs"),command]])],
  ["PowerShell install and bootstrap", ["install.ps1","bootstrap.ps1"].map(script => ["pwsh",["-NoLogo","-NoProfile","-NonInteractive","-File",path.join(repoRoot,"scripts",script)]])],
]) test(`${name} rejects both explicit Claude markers before synthetic home/project writes`, () => {
  const root = mkdtempSync(path.join(tmpdir(),"harness-host-boundary-"));
  const project = path.join(root,"project"), home = path.join(root,"home");
  try {
    for (const directory of [project,home]) { mkdirSync(path.join(directory,".claude"),{recursive:true}); writeFileSync(path.join(directory,".claude","keep.txt"),"Claude bytes preserved\n"); }
    const shellHome = path.join(root,"shell-startup-cache"); mkdirSync(shellHome,{recursive:true});
    const baseEnv = {...process.env,HOME:home,USERPROFILE:home,POWERSHELL_TELEMETRY_OPTOUT:"1"};
    delete baseEnv.CLAUDECODE; delete baseEnv.CCG_HOST;
    // PowerShell writes startup timing cache on every process launch. Its own
    // profile is separate from the explicit Harness target home; both stay in
    // this temporary fixture, and the full target home/project are compared.
    const targetSnapshot = () => ({home:snapshot(home),project:snapshot(project)});
    const before = targetSnapshot();
    for (const marker of markers) for (const [command,args] of calls) {
      const env = {...baseEnv,...marker};
      const ps = command === "pwsh";
      if (ps) env.USERPROFILE = shellHome;
      const targetArgs = [...args,ps?"-RepoRoot":"--repo-root",project];
      if (ps && args.at(-1).endsWith("install.ps1")) targetArgs.push("-HomeDir",home);
      const result = spawnSync(command,targetArgs,{env,cwd:project,encoding:"utf8",shell:false,timeout:15000});
      assert.equal(result.status,1,[result.error,result.stdout,result.stderr].filter(Boolean).join("\n"));
      assert.match(result.stderr,/require the Codex host/);
      assert.deepEqual(targetSnapshot(),before);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
