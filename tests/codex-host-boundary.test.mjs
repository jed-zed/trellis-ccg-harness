import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isClaudeHost } from "../.agents/skills/harness-init/scripts/codex-host-boundary.mjs";
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
const hosts = [{ CLAUDECODE: "1" }, { CCG_HOST: "claude" }, { CCG_HOST: "codex" }];
test("host markers only identify the host for content selection", () => {
  for (const env of [{ CLAUDECODE: "1" }, { CCG_HOST: " Claude " }]) assert.equal(isClaudeHost(env), true);
  for (const env of [{}, { CLAUDECODE: "0" }, { CCG_HOST: "codex" }]) assert.equal(isClaudeHost(env), false);
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
]) test(`${name} behave the same on every host and never touch .claude`, () => {
  for (const [command,args] of calls) {
    const outcomes = hosts.map(host => {
      const root = mkdtempSync(path.join(tmpdir(),"harness-host-boundary-"));
      const project = path.join(root,"project"), home = path.join(root,"home");
      try {
        for (const directory of [project,home]) { mkdirSync(path.join(directory,".claude"),{recursive:true}); writeFileSync(path.join(directory,".claude","keep.txt"),"Claude bytes preserved\n"); }
        // Every user-level location points into this fixture; no call may reach real user state.
        const env = {...process.env,HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,".codex"),
          APPDATA:path.join(home,"AppData","Roaming"),LOCALAPPDATA:path.join(home,"AppData","Local"),
          NPM_CONFIG_PREFIX:path.join(root,"npm-prefix"),NPM_CONFIG_CACHE:path.join(root,"npm-cache"),
          NPM_CONFIG_USERCONFIG:path.join(root,"empty.npmrc"),POWERSHELL_TELEMETRY_OPTOUT:"1"};
        delete env.CLAUDECODE; delete env.CCG_HOST; Object.assign(env,host);
        const ps = command === "pwsh";
        // PowerShell rewrites its own startup cache on every launch; keep that
        // shell state in the fixture but outside the compared target home.
        if (ps) { const shell = path.join(root,"shell"); Object.assign(env,{HOME:shell,USERPROFILE:shell,APPDATA:path.join(shell,"Roaming"),LOCALAPPDATA:path.join(shell,"Local")}); }
        const targetArgs = [...args,ps?"-RepoRoot":"--repo-root",project];
        if (ps) targetArgs.push("-HomeDir",home);
        const claudeBefore = {home:snapshot(path.join(home,".claude")),project:snapshot(path.join(project,".claude"))};
        const result = spawnSync(command,targetArgs,{env,cwd:project,encoding:"utf8",shell:false,timeout:15000,input:""});
        const output = [result.error,result.stdout,result.stderr].filter(Boolean).join("\n");
        assert.equal(result.error,undefined,output);
        assert.doesNotMatch(output,/require the Codex host|Claude host markers are rejected/);
        assert.deepEqual({home:snapshot(path.join(home,".claude")),project:snapshot(path.join(project,".claude"))},claudeBefore);
        return {status:result.status,home:snapshot(home),project:snapshot(project)};
      } finally { rmSync(root,{recursive:true,force:true}); }
    });
    for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome,outcomes[0],`${path.basename(args.at(-1))} differs by host`);
  }
});
