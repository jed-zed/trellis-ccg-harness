import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { validateCcgRuntimePackage } from "./ccg-runtime.mjs";
import { resolvePackageManagerInvocation, globalPackageRootFromNpmPrefix } from "./lib/harness-lifecycle.mjs";
import { resolvePythonFromSystem } from "./lib/python-resolver.mjs";
import { assertCodexMutationHost } from "../.agents/skills/harness-init/scripts/codex-host-boundary.mjs";
const PACKAGE = "@jed-zed/ccg-codex-workflow";
const BIN = "ccg-codex";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function pinned(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Pending or invalid recipe pin: ${label}.`);
}
function relativeFile(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || path.posix.isAbsolute(value) || value.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("Recipe receipt path must be a safe relative file.");
  return value;
}
async function regularBytes(filename, label, max = 128 * 1024 * 1024) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw new Error(`${label} must be a bounded regular file.`);
  return readFile(filename);
}
function archivePackage(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  let found;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const string = (start,end) => header.subarray(start,end).toString("utf8").split("\0")[0];
    const name = [string(345,500),string(0,100)].filter(Boolean).join("/");
    const type = string(156,157);
    const sizeText = string(124,136).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("Invalid recipe archive entry size.");
    const size = Number.parseInt(sizeText,8);
    if (!Number.isSafeInteger(size) || offset + 512 + size > tar.length) throw new Error("Truncated recipe archive.");
    relativeFile(name.replace(/\/$/,""));
    if (["1","2"].includes(type)) throw new Error("Recipe archive links are forbidden.");
    if (name === "package/package.json") {
      if (found || !["", "0"].includes(type)) throw new Error("Ambiguous recipe archive package identity.");
      found = JSON.parse(tar.subarray(offset + 512,offset + 512 + size).toString("utf8"));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!found) throw new Error("Recipe archive package.json is missing.");
  return found;
}
export async function verifyLocalCcgRecipe(recipePath) {
  const recipeBytes = await regularBytes(path.resolve(recipePath),"Recipe",1024 * 1024);
  const recipe = JSON.parse(recipeBytes.toString("utf8"));
  if (recipe.schemaVersion !== 1 || recipe.kind !== "codex-private-local" || recipe.package !== PACKAGE || recipe.bin !== BIN || recipe.ownershipNamespace !== PACKAGE) throw new Error("Recipe must explicitly target the private Codex package and bin.");
  for (const [label,value] of Object.entries({receipt:recipe.source?.receiptSha256,archive:recipe.archive?.sha256,plugin:recipe.plugin?.sha256,marketplace:recipe.marketplace?.sha256})) pinned(value,label);
  for (const filename of [recipe.source.root,recipe.source.receiptPath,recipe.archive.path]) if (typeof filename !== "string" || !path.isAbsolute(filename)) throw new Error("Recipe source, receipt and archive paths must be absolute.");
  if (recipe.plugin.path !== "plugins/ccg/.codex-plugin/plugin.json" || recipe.marketplace.path !== ".codex-plugin/marketplace.json") throw new Error("Recipe must select the native Codex marketplace and plugin manifests.");
  const sourceRoot = await realpath(recipe.source.root);
  const receiptBytes = await regularBytes(recipe.source.receiptPath,"Receipt",4 * 1024 * 1024);
  if (sha(receiptBytes) !== recipe.source.receiptSha256) throw new Error("Recipe source receipt hash mismatch.");
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  if (!Array.isArray(receipt.files) || receipt.fileCount !== receipt.files.length || receipt.files.length === 0 || receipt.files.length > 20000) throw new Error("Recipe source receipt count mismatch.");
  const files = new Map(); let totalBytes = 0;
  for (const file of receipt.files) {
    const relative = relativeFile(file.path); pinned(file.sha256,relative);
    if (files.has(relative) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error("Recipe source receipt has duplicate or invalid files.");
    const filename = path.join(sourceRoot,...relative.split("/"));
    const resolved = await realpath(filename);
    const within = path.relative(sourceRoot,resolved);
    if (!within || within.startsWith("..") || path.isAbsolute(within)) throw new Error("Recipe source file resolves outside the source root.");
    const bytes = await regularBytes(filename,relative);
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`Recipe source file mismatch: ${relative}.`);
    files.set(relative,file); totalBytes += bytes.length;
  }
  if (receipt.bytes !== totalBytes) throw new Error("Recipe source receipt byte total mismatch.");
  for (const relative of ["package.json",recipe.plugin.path,recipe.marketplace.path]) if (!files.has(relative)) throw new Error(`Required Codex identity is not in the positive receipt: ${relative}.`);
  const sourcePackage = JSON.parse((await readFile(path.join(sourceRoot,"package.json"))).toString("utf8"));
  const identity = {ccg:{package:recipe.package,version:recipe.cliVersion}};
  validateCcgRuntimePackage(sourcePackage,identity);
  const archiveBytes = await regularBytes(recipe.archive.path,"Archive");
  if (sha(archiveBytes) !== recipe.archive.sha256) throw new Error("Recipe archive hash mismatch.");
  validateCcgRuntimePackage(archivePackage(archiveBytes),identity);
  const pluginBytes = await readFile(path.join(sourceRoot,recipe.plugin.path));
  const marketplaceBytes = await readFile(path.join(sourceRoot,recipe.marketplace.path));
  if (sha(pluginBytes) !== recipe.plugin.sha256 || sha(marketplaceBytes) !== recipe.marketplace.sha256) throw new Error("Recipe Codex plugin or marketplace hash mismatch.");
  const plugin = JSON.parse(pluginBytes.toString("utf8"));
  const marketplace = JSON.parse(marketplaceBytes.toString("utf8"));
  const advertised = marketplace.plugins?.filter(item => item.name === "ccg");
  if (plugin.name !== "ccg" || plugin.version !== recipe.pluginVersion || advertised?.length !== 1 || advertised[0].version !== recipe.cliVersion || advertised[0].source !== "./plugins/ccg") throw new Error("Recipe native Codex marketplace identity mismatch.");
  return {recipe,recipeSha256:sha(recipeBytes),sourceRoot,sourceFiles:files.size,sourceBytes:totalBytes};
}
async function directoryIdentity(root) {
  const entries=[];
  async function walk(directory) {
    for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const filename=path.join(directory,entry.name),relative=path.relative(root,filename);
      if (entry.isDirectory()) {entries.push({path:relative,kind:"directory"});await walk(filename);}
      else entries.push({path:relative,kind:"file",sha256:sha(await regularBytes(filename,"Protected file"))});
    }
  }
  await walk(root);return entries;
}
async function persistentRuntimeIdentity(prefix) {
  if (!prefix || !path.isAbsolute(prefix)) throw new Error("Recipe persistent prefix to preserve must be absolute.");
  const root=globalPackageRootFromNpmPrefix(prefix,{platform:process.platform});
  const files=[...['ccg-workflow',PACKAGE].flatMap(name=>[path.join(root,...name.split('/'),'package.json'),path.join(root,...name.split('/'),'bin','ccg.mjs')]),...['ccg','ccg-codex'].flatMap(name=>process.platform==='win32'?[path.join(prefix,name),path.join(prefix,name+'.cmd'),path.join(prefix,name+'.ps1')]:[path.join(prefix,'bin',name)])];
  return Promise.all(files.map(async filename=>({path:filename,sha256:await regularBytes(filename,'Persistent runtime').then(sha,error=>{if(error.code==='ENOENT')return null;throw error;})})));
}
export async function dryIsolatedInit(recipePath, reportPath) {
  assertCodexMutationHost();
  const verified = await verifyLocalCcgRecipe(recipePath);
  const recipe = verified.recipe;
  pinned(recipe.wrapper?.sha256,"wrapper");
  if (!path.isAbsolute(recipe.wrapper.path)) throw new Error("Recipe wrapper path must be absolute.");
  if (sha(await regularBytes(recipe.wrapper.path,"Wrapper")) !== recipe.wrapper.sha256) throw new Error("Recipe wrapper hash mismatch.");
  const persistentBefore=await persistentRuntimeIdentity(recipe.preservePrefix);
  const python = resolvePythonFromSystem();
  const root = await mkdtemp(path.join(tmpdir(),"harness-recipe-isolated-"));
  const report = {schemaVersion:1,recipeSha256:verified.recipeSha256,sourceFiles:verified.sourceFiles,root,checks:[],commands:[],persistentBefore,success:false,cleanup:{removed:false}};
  const prefix = path.join(root,"prefix"), home = path.join(root,"home"), project = path.join(root,"project");
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|PASSWORD|API.?KEY|AUTH|PROXY/i.test(key)) delete env[key];
  Object.assign(env,{HOME:home,USERPROFILE:home,CODEX_HOME:path.join(home,".codex"),APPDATA:path.join(home,"AppData","Roaming"),LOCALAPPDATA:path.join(home,"AppData","Local"),CCG_HOST:"codex",NPM_CONFIG_PREFIX:prefix,NPM_CONFIG_CACHE:path.join(root,"cache"),NPM_CONFIG_USERCONFIG:path.join(root,"user.npmrc"),NPM_CONFIG_GLOBALCONFIG:path.join(root,"global.npmrc"),NPM_CONFIG_UPDATE_NOTIFIER:"false",NO_COLOR:"1"});
  delete env.CLAUDECODE;
  env.PATH = [process.platform === "win32" ? prefix : path.join(prefix,"bin"),path.dirname(process.execPath),path.dirname(python.command),...(process.platform === "win32" ? [path.join(process.env.SystemRoot,"System32")] : ["/usr/bin","/bin"])].join(path.delimiter);
  const run = (command,args) => {
    const result = spawnSync(command,args,{cwd:project,env,encoding:"utf8",shell:false,timeout:60000});
    report.commands.push({command,args,status:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message});
    if (result.status !== 0) throw new Error(`Recipe isolated command failed: ${command}: ${result.error?.message ?? result.stderr}`);
    return result;
  };
  try {
    for (const directory of [project,home,prefix,path.join(project,".claude"),path.join(home,".claude")]) await mkdir(directory,{recursive:true});
    for (const filename of [env.NPM_CONFIG_USERCONFIG,env.NPM_CONFIG_GLOBALCONFIG]) await writeFile(filename,"");
    const globalRoot = globalPackageRootFromNpmPrefix(prefix,{platform:process.platform});
    const legacyRoot = path.join(globalRoot,"ccg-workflow");
    const legacyAlias = process.platform === "win32" ? path.join(prefix,"ccg.cmd") : path.join(prefix,"bin","ccg");
    await mkdir(path.join(legacyRoot,"bin"),{recursive:true}); await mkdir(path.dirname(legacyAlias),{recursive:true});
    await writeFile(path.join(legacyRoot,"package.json"),JSON.stringify({name:"ccg-workflow",version:"3.6.7",bin:{ccg:"bin/ccg.mjs"}}));
    await writeFile(path.join(legacyRoot,"bin","ccg.mjs"),"throw new Error('upstream sentinel must not execute')\n");
    await writeFile(legacyAlias,"upstream ccg alias unchanged\n");
    const sentinelFiles = [path.join(project,".claude","keep.txt"),path.join(home,".claude","keep.txt"),legacyAlias,path.join(legacyRoot,"package.json"),path.join(legacyRoot,"bin","ccg.mjs")];
    for (const filename of sentinelFiles.slice(0,2)) await writeFile(filename,"Claude unchanged\n");
    const expected = await Promise.all(sentinelFiles.map(filename => readFile(filename)));
    const claudeRoots=[path.join(project,".claude"),path.join(home,".claude")];
    const claudeBefore=JSON.stringify(await Promise.all(claudeRoots.map(directoryIdentity)));
    const preserved = async label => {
      for (let index=0;index<sentinelFiles.length;index++) if (!(await readFile(sentinelFiles[index])).equals(expected[index])) throw new Error("Claude or upstream ccg sentinel changed.");
      if (JSON.stringify(await Promise.all(claudeRoots.map(directoryIdentity)))!==claudeBefore) throw new Error("Claude protected directory content changed.");
      report.checks.push(label);
    };
    const npm = args => { const call = resolvePackageManagerInvocation("npm",[...args,"--prefix",prefix,"--offline","--ignore-scripts","--no-audit","--no-fund"]); return run(call.command,call.args); };
    // Re-read and copy pinned inputs into this owned temporary root before npm
    // or the CLI reads them; never execute an unchecked mutable external file.
    const localArchive = path.join(root,"ccg-codex.tgz"), localWrapper = path.join(root,path.basename(recipe.wrapper.path));
    const archiveBytes = await regularBytes(recipe.archive.path,"Archive"), wrapperBytes = await regularBytes(recipe.wrapper.path,"Wrapper");
    if (sha(archiveBytes) !== recipe.archive.sha256 || sha(wrapperBytes) !== recipe.wrapper.sha256) throw new Error("Recipe input changed after verification.");
    await writeFile(localArchive,archiveBytes); await writeFile(localWrapper,wrapperBytes,{mode:0o755});
    if (recipe.offlineCacheSeed) {
      const sourceCache=await realpath(recipe.offlineCacheSeed);
      if (path.basename(sourceCache)!=="_cacache") throw new Error("Offline seed must be an existing npm _cacache directory.");
      // Copy only the content-addressed cache. npm writes its logs and any new
      // indices in the private copy; the user's live cache is never a target.
      await cp(sourceCache,path.join(env.NPM_CONFIG_CACHE,"_cacache"),{recursive:true,dereference:false,errorOnExist:true,force:false});
      report.offlineDependencyMode="reuse copied existing npm content cache; no network or new dependency acquisition";
    }
    npm(["install","-g",localArchive]); report.checks.push("actual pinned archive installed only into private prefix");
    const installed = path.join(globalPackageRootFromNpmPrefix(prefix,{platform:process.platform}),...PACKAGE.split("/"));
    const installedManifest = JSON.parse(await readFile(path.join(installed,"package.json"),"utf8"));
    validateCcgRuntimePackage(installedManifest,{ccg:{package:PACKAGE,version:recipe.cliVersion}});
    const entry = path.join(installed,"bin","ccg.mjs");
    const version = run(process.execPath,[entry,"--version"]);
    if (!version.stdout.includes(recipe.cliVersion)) throw new Error("Installed scoped runtime version mismatch."); report.checks.push("actual installed scoped runtime version matches");
    for (let attempt=0;attempt<2;attempt++) {run(process.execPath,[entry,"codex-mode","install","--wrapper-file",localWrapper]);await preserved(`Codex-mode ${attempt===0?"clean":"repeat"} init preserves Claude bytes`);}
    run(process.execPath,[entry,"codex-mode","uninstall"]);await preserved("Codex-mode uninstall preserves Claude bytes");
    npm(["uninstall","-g",PACKAGE]);
    const remaining = await access(installed).then(() => true,() => false);
    if (remaining) throw new Error("Scoped package remains after private uninstall."); report.checks.push("actual scoped npm uninstall removes private package");
    await preserved("Scoped package lifecycle preserves upstream ccg alias/package and Claude bytes");
    report.success = true;
  } catch (error) { report.error = error.message; throw error; }
  finally {
    const target = path.resolve(root), relative = path.relative(path.resolve(tmpdir()),target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Recipe cleanup target escaped temp root.");
    await rm(target,{recursive:true,force:true});
    report.cleanup.removed = !(await access(target).then(() => true,() => false));
    report.persistentAfter=await persistentRuntimeIdentity(recipe.preservePrefix);
    report.persistentUnchanged=JSON.stringify(report.persistentBefore)===JSON.stringify(report.persistentAfter);
    if (!report.persistentUnchanged) {report.success=false;report.error="Persistent runtime identity changed.";}
    report.completedAt = new Date().toISOString();
    await writeFile(path.resolve(reportPath),JSON.stringify(report,null,2)+"\n");
  }
  if (!report.persistentUnchanged) throw new Error(report.error);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command,...args] = process.argv.slice(2);
    if (command === "verify" && args.length === 2 && args[0] === "--recipe") {
      const result = await verifyLocalCcgRecipe(args[1]);
      process.stdout.write(JSON.stringify({verified:true,recipeSha256:result.recipeSha256,sourceFiles:result.sourceFiles,package:result.recipe.package,bin:result.recipe.bin,cliVersion:result.recipe.cliVersion,pluginVersion:result.recipe.pluginVersion})+"\n");
    } else if (command === "dry-isolated-init" && args.length === 4 && args[0] === "--recipe" && args[2] === "--report") {
      const report = await dryIsolatedInit(args[1],args[3]);process.stdout.write(JSON.stringify({success:report.success,checks:report.checks.length,cleanup:report.cleanup})+"\n");
    } else throw new Error("Use ccg-local-recipe.mjs verify --recipe <file> or dry-isolated-init --recipe <file> --report <file>.");
  } catch (error) {process.stderr.write(error.message+"\n");process.exitCode=1;}
}
