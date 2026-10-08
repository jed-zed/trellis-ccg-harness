import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { verifyLocalCcgRecipe, dryIsolatedInit } from "../scripts/ccg-local-recipe.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const PACKAGE = "@jed-zed/ccg-codex-workflow", VERSION = "3.4.16-localarchive.4";
function packageArchive(manifest) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write("package/package.json",0);header.write(bytes.length.toString(8).padStart(11,"0")+"\0",124);header.write("0",156);
  return gzipSync(Buffer.concat([header,bytes,Buffer.alloc((512 - bytes.length % 512) % 512),Buffer.alloc(1024)]));
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(),"harness-recipe-verify-"));
  const source = path.join(root,"source");
  const manifest = {name:PACKAGE,version:VERSION,bin:{"ccg-codex":"bin/ccg.mjs"}};
  const values = new Map([
    ["package.json",JSON.stringify(manifest)],
    ["bin/ccg.mjs","throw new Error('verification never executes this fixture')\n"],
    ["plugins/ccg/.codex-plugin/plugin.json",JSON.stringify({name:"ccg",version:VERSION+"+codex.5"})],
    [".codex-plugin/marketplace.json",JSON.stringify({name:"private-codex",plugins:[{name:"ccg",version:VERSION,source:"./plugins/ccg"}]})],
  ]);
  const files=[];
  for (const [relative,value] of values) {const bytes=Buffer.from(value);const filename=path.join(source,relative);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);files.push({path:relative,bytes:bytes.length,sha256:sha(bytes)});}
  const receipt=Buffer.from(JSON.stringify({head:"a".repeat(40),branch:"local-test",fileCount:files.length,bytes:files.reduce((sum,item)=>sum+item.bytes,0),files}));
  const receiptPath=path.join(root,"receipt.json"),archivePath=path.join(root,"candidate.tgz"),recipePath=path.join(root,"recipe.json");
  await writeFile(receiptPath,receipt);const archive=packageArchive(manifest);await writeFile(archivePath,archive);
  const recipe={schemaVersion:1,kind:"codex-private-local",package:PACKAGE,bin:"ccg-codex",ownershipNamespace:PACKAGE,cliVersion:VERSION,pluginVersion:VERSION+"+codex.5",source:{root:source,receiptPath,receiptSha256:sha(receipt)},archive:{path:archivePath,sha256:sha(archive)},plugin:{path:"plugins/ccg/.codex-plugin/plugin.json",sha256:sha(Buffer.from(values.get("plugins/ccg/.codex-plugin/plugin.json")))},marketplace:{path:".codex-plugin/marketplace.json",sha256:sha(Buffer.from(values.get(".codex-plugin/marketplace.json")))}};
  const save=()=>writeFile(recipePath,JSON.stringify(recipe));await save();return {root,source,manifest,recipe,recipePath,save};
}
test("explicit pending recipe rejects missing pins before isolated execution",async()=>{
  const value=await fixture();try {value.recipe.archive.sha256=null;await value.save();await assert.rejects(verifyLocalCcgRecipe(value.recipePath),/Pending.*archive/);await assert.rejects(dryIsolatedInit(value.recipePath,path.join(value.root,"report.json")),/Pending.*archive/);await assert.rejects(readFile(path.join(value.root,"report.json")),{code:"ENOENT"});}finally{await rm(value.root,{recursive:true,force:true});}
});
test("local recipe verifies complete positive source/archive/Codex identities and rejects drift",async()=>{
  const value=await fixture();try {
    const verified=await verifyLocalCcgRecipe(value.recipePath);assert.equal(verified.sourceFiles,4);assert.equal(verified.recipe.bin,"ccg-codex");
    value.recipe.marketplace.path=".claude-plugin/marketplace.json";await value.save();await assert.rejects(verifyLocalCcgRecipe(value.recipePath),/native Codex/);value.recipe.marketplace.path=".codex-plugin/marketplace.json";
    const wrong=packageArchive({...value.manifest,bin:{ccg:"bin/ccg.mjs"}});await writeFile(value.recipe.archive.path,wrong);value.recipe.archive.sha256=sha(wrong);await value.save();await assert.rejects(verifyLocalCcgRecipe(value.recipePath),/identity must match/);
    const good=packageArchive(value.manifest);await writeFile(value.recipe.archive.path,good);value.recipe.archive.sha256=sha(good);await value.save();await writeFile(path.join(value.source,"bin/ccg.mjs"),"drift");await assert.rejects(verifyLocalCcgRecipe(value.recipePath),/source file mismatch/);
  }finally{await rm(value.root,{recursive:true,force:true});}
});
