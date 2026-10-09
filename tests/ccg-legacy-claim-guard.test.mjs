import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertLegacyClaimMutationAllowed as guard } from "../scripts/lib/ccg-legacy-claim-guard.mjs";
import { acquireTransactionLock, recoverInterruptedTransaction,
  replaceComponentTransaction, replaceManagedFilesTransaction,
  rollbackLastTransaction } from "../scripts/lib/harness-transaction.mjs";

const sha = raw => createHash("sha256").update(raw).digest("hex");
async function fixture(t) {
  const parent = await mkdtemp(path.join(tmpdir(), "legacy-claim-guard-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(tmpdir()), parent);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    assert.match(path.basename(parent), /^legacy-claim-guard-/);
    await rm(parent, { recursive: true, force: true });
  });
  const control = path.join(parent, "control"), old = path.join(parent, "old");
  for (const root of [control,old]) await mkdir(path.join(root,".harness-cache"),{recursive:true});
  const original = Buffer.from('{"schemaVersion":1,"entries":[{"id":"ccg-link"},{"id":"trellis"}]}\r\n');
  const receipt = path.join(old,".harness-cache","ownership.json");
  await writeFile(receipt,original);
  const digest = "1".repeat(64);
  const registryPath = path.join(control,".harness-cache","legacy-ccg-claim-authority.json");
  const sidecarPath = path.join(old,".harness-cache","legacy-ccg-claim-retirement.json");
  const registry = {schemaVersion:1,kind:"legacy-ccg-claim-authority",planSha256:digest,
    transactionDir:path.join(control,".harness-cache","legacy-ccg-claims",digest),
    owners:[{repoRoot:old,ownershipSha256:sha(original)}]};
  return {parent,control,old,original,receipt,digest,registryPath,sidecarPath,registry};
}
test("pending authority holds writes even before a sidecar, and deleting the sidecar cannot resurrect the claim",async t=>{
  const f=await fixture(t);
  await guard(f.old,{codeRoot:f.control});
  await writeFile(f.registryPath,JSON.stringify(f.registry));
  await assert.rejects(guard(f.old,{codeRoot:f.control}),/archives this old management root/);
  await writeFile(f.sidecarPath,'{}');
  await rm(f.sidecarPath);
  await assert.rejects(guard(f.old,{codeRoot:f.control}),/archives this old management root/);
  assert.deepEqual(await readFile(f.receipt),f.original);
});
test("metadata-only resume binds the exact plan and original raw receipt",async t=>{
  const f=await fixture(t); await writeFile(f.registryPath,JSON.stringify(f.registry));
  await guard(f.old,{codeRoot:f.control,retirementPlanSha256:f.digest});
  await assert.rejects(guard(f.old,{codeRoot:f.control,retirementPlanSha256:"2".repeat(64)}),/archives/);
  await writeFile(f.receipt,Buffer.concat([f.original,Buffer.from(" ")]));
  await assert.rejects(guard(f.old,{codeRoot:f.control,retirementPlanSha256:f.digest}),/receipt changed/);
});
test("an ancestor junction cannot bypass pending retirement through an alternate old-root spelling",async t=>{
  const f=await fixture(t); await writeFile(f.registryPath,JSON.stringify(f.registry));
  const alias=path.join(f.parent,"alias");
  await symlink(f.parent,alias,process.platform==="win32"?"junction":"dir");
  await assert.rejects(guard(path.join(alias,"old"),{codeRoot:f.control}),/link\/reparse ancestor/);
  assert.deepEqual(await readFile(f.receipt),f.original);
});
test("unlisted roots remain usable, while orphan sidecars and malformed or redirected authority hold",async t=>{
  const f=await fixture(t), other=path.join(f.parent,"other"); await mkdir(other);
  await writeFile(f.registryPath,JSON.stringify(f.registry)); await guard(other,{codeRoot:f.control});
  await writeFile(f.sidecarPath,'{}'); await rm(f.registryPath);
  await assert.rejects(guard(f.old,{codeRoot:f.control}),/no authority/);
  await writeFile(f.registryPath,'{'); await assert.rejects(guard(other,{codeRoot:f.control}),/Malformed/);
  await writeFile(f.registryPath,JSON.stringify({...f.registry,transactionDir:path.join(f.parent,"elsewhere")}));
  await assert.rejects(guard(other,{codeRoot:f.control}),/fixed-root identity/);
});
test("hardlinks and ancestor junctions cannot redirect the authority",async t=>{
  const f=await fixture(t); await writeFile(f.registryPath,JSON.stringify(f.registry));
  await link(f.registryPath,path.join(f.parent,"hardlink"));
  await assert.rejects(guard(f.old,{codeRoot:f.control}),/link-free/);
  const redirected=path.join(f.parent,"redirected"); await mkdir(redirected);
  await symlink(path.join(f.control,".harness-cache"),path.join(redirected,".harness-cache"),process.platform==="win32"?"junction":"dir");
  await assert.rejects(guard(f.old,{codeRoot:redirected}),/symbolic|reparse|link|junction/i);
});
test("all direct transaction mutators and stale-lock recovery reject an archived root before writes",async t=>{
  const f=await fixture(t); await writeFile(f.sidecarPath,'{}');
  const stale=path.join(f.old,".harness-cache","transaction.lock");
  await writeFile(stale,'{"schemaVersion":2,"pid":2147483647,"createdAt":"2020-01-01T00:00:00Z","token":"stale","repoRoot":"fixture"}');
  const before=await readFile(stale);
  for (const run of [()=>acquireTransactionLock(f.old),
    ()=>recoverInterruptedTransaction({repoRoot:f.old}),
    ()=>replaceComponentTransaction({repoRoot:f.old}),
    ()=>replaceManagedFilesTransaction({repoRoot:f.old}),
    ()=>rollbackLastTransaction({repoRoot:f.old})]) await assert.rejects(run,/no authority/);
  assert.deepEqual(await readFile(stale),before); assert.deepEqual(await readFile(f.receipt),f.original);
});
test("bootstrap and transaction pending state block competing writers while permitting only their own internal resume",async t=>{
  const f=await fixture(t), pending=path.join(f.old,".harness-cache","bootstrap-pending.json");
  await writeFile(pending,'{}');
  await assert.rejects(acquireTransactionLock(f.old),/bootstrap-pending/);
  await assert.rejects(recoverInterruptedTransaction({repoRoot:f.old}),/bootstrap-pending/);
  const bootstrap=await acquireTransactionLock(f.old,{pendingOperation:"bootstrap-resume"}); await bootstrap.release();
  await rm(pending); const journal=path.join(f.old,".harness-cache","transaction-journal.json"); await writeFile(journal,'{}');
  await assert.rejects(acquireTransactionLock(f.old),/transaction-journal/);
  await assert.rejects(acquireTransactionLock(f.old,{pendingOperation:"bootstrap-resume"}),/transaction-journal/);
  const recovery=await acquireTransactionLock(f.old,{pendingOperation:"transaction-recover"}); await recovery.release();
  assert.deepEqual(await readFile(f.receipt),f.original);
});
test("the actual PowerShell installer phase refuses pending state without creating a lock or changing files",{skip:process.platform!=="win32"},async t=>{
  const f=await fixture(t), scripts=path.join(f.control,"scripts");
  await mkdir(path.join(scripts,"lib"),{recursive:true});
  for(const name of ["ccg-legacy-claim-guard.mjs","harness-fs.mjs"]) await copyFile(path.resolve("scripts/lib",name),path.join(scripts,"lib",name));
  const probe=path.join(scripts,"phase-probe.ps1");
  await writeFile(probe,`param([string]$Installer,[string]$RepoRoot)
$ErrorActionPreference='Stop'
$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$null,[ref]$parseErrors)
if($parseErrors.Count){throw 'Installer parsing failed'}
$definitions=@()
foreach($name in @('Assert-RealDirectory','Enter-InstallerTransactionLock','Exit-InstallerTransactionLock')){
  $definition=$ast.FindAll({param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name},$false)
  if(@($definition).Count -ne 1){throw 'Unique source function required'}
  $definitions += $definition.Extent.Text
}
$header='param([string]$RepoRoot)'+[Environment]::NewLine+'$ErrorActionPreference="Stop"'
$footer=@'
try { $lock=Enter-InstallerTransactionLock; Exit-InstallerTransactionLock $lock; throw 'Pending phase unexpectedly entered' }
catch { if($_.Exception.Message -notmatch 'archived|before installer mutation'){throw}; 'held-before-mutation' }
'@
$worker=Join-Path $PSScriptRoot 'generated-phase.ps1'
[IO.File]::WriteAllText($worker,(@($header)+$definitions+@($footer) -join [Environment]::NewLine))
& $worker -RepoRoot $RepoRoot
`);
  for(const name of ["bootstrap-pending.json","transaction-journal.json"]){
    const pending=path.join(f.old,".harness-cache",name); await writeFile(pending,'{}');
    const before=await readdir(path.join(f.old,".harness-cache"));
    const result=spawnSync(process.env.HARNESS_TEST_PWSH??"C:\\Program Files\\PowerShell\\7\\pwsh.exe",["-NoProfile","-NonInteractive","-File",probe,"-Installer",path.resolve("scripts/install.ps1"),"-RepoRoot",f.old],{encoding:"utf8",windowsHide:true,timeout:20000});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`); assert.match(result.stdout,/held-before-mutation/);
    assert.deepEqual(await readdir(path.join(f.old,".harness-cache")),before);
    assert.deepEqual(await readFile(f.receipt),f.original); assert.equal(await readFile(pending,"utf8"),'{}');
    await rm(pending);
  }
});

// Run the real final-phase source and native lock functions. Host commands
// write only fixture files; Doctor keeps its actual lock-residue branch.
const installerFinalPhaseProbe = String.raw`param([string]$Installer,[string]$Doctor,[string]$RepoRoot,[string]$HomeDir,[string]$NodeExecutable,[switch]$FailGlobal,[switch]$InjectForeignLock)
$ErrorActionPreference='Stop'
$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$null,[ref]$parseErrors)
if($parseErrors.Count){throw 'Installer parsing failed'}
$definitions=@()
foreach($name in @('Assert-RealDirectory','Enter-InstallerTransactionLock','Exit-InstallerTransactionLock')){
  $found=@($ast.FindAll({param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name},$false))
  if($found.Count -ne 1){throw 'Unique source function required'}
  $definitions+=$found[0].Extent.Text
}
$outer=@($ast.FindAll({param($item) $item -is [System.Management.Automation.Language.TryStatementAst] -and $null -ne $item.Finally -and $item.Finally.Extent.Text -match 'Exit-InstallerTransactionLock \$installerTransactionLock'},$false))
if($outer.Count -ne 1){throw 'Unique actual installer final try required'}
$starts=@($outer[0].Body.Statements | Where-Object {$_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -in @('$globalArguments','$finalDoctorArguments')})
if($starts.Count -ne 2){throw 'Actual final phase boundary is missing'}
$start=($starts | ForEach-Object {$_.Extent.StartOffset} | Measure-Object -Minimum).Minimum
$source=[IO.File]::ReadAllText($Installer)
$phase=$source.Substring($start,$outer[0].Body.Extent.EndOffset-1-$start)
$doctorAst=[System.Management.Automation.Language.Parser]::ParseFile($Doctor,[ref]$null,[ref]$parseErrors)
if($parseErrors.Count){throw 'Doctor parsing failed'}
$lockBranch=@($doctorAst.FindAll({param($item) $item -is [System.Management.Automation.Language.IfStatementAst] -and $item.Clauses[0].Item1.Extent.Text -eq 'Test-Path -LiteralPath $transactionLock'},$false))
if($lockBranch.Count -ne 1){throw 'Actual doctor transaction-lock branch is missing'}
$fakeDoctor=@'
param([string]$RepoRoot,[string]$AuthoritativeCheckout)
$ErrorActionPreference='Stop'
$events=Join-Path (Split-Path $RepoRoot -Parent) 'events.jsonl'
[IO.File]::AppendAllText($events,'"doctor"'+[Environment]::NewLine)
$script:failures=0
function Add-Failure {param([string]$Message) $script:failures++; Write-Output ('FAIL '+$Message)}
function Add-Pass {param([string]$Message) Write-Output ('PASS '+$Message)}
$transactionLock=Join-Path $RepoRoot '.harness-cache/transaction.lock'
if($InjectForeignLock){
  $prior=Get-Content -LiteralPath $events
  if('"projection-validated"' -notin $prior){throw 'Foreign fixture lock must follow all mutations and validation'}
  if(Test-Path -LiteralPath $transactionLock){throw 'Foreign fixture cannot replace the installer lock'}
  $foreignLease=[IO.File]::Open($transactionLock,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
  try {
    $record=@{schemaVersion=2;pid=2147483647;createdAt=[DateTime]::UtcNow.ToString('o');token='foreign-fixture-token';repoRoot=$RepoRoot}
    $raw=[Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Compress)+[Environment]::NewLine)
    $foreignLease.Write($raw,0,$raw.Length);$foreignLease.Flush($true)
  } finally {$foreignLease.Dispose()}
  [IO.File]::AppendAllText($events,'"foreign-lock-created"'+[Environment]::NewLine)
}
'@
$fakeDoctor+=[Environment]::NewLine+$lockBranch[0].Extent.Text+[Environment]::NewLine+'$global:LASTEXITCODE=[int]($script:failures -gt 0)'
[IO.File]::WriteAllText((Join-Path $RepoRoot 'scripts/doctor.ps1'),$fakeDoctor)
$header=@'
param([string]$RepoRoot,[string]$HomeDir,[string]$NodeExecutable,[switch]$FailGlobal,[switch]$InjectForeignLock)
$ErrorActionPreference='Stop'
$events=Join-Path (Split-Path $RepoRoot -Parent) 'events.jsonl'
function Record-Phase {param([string]$Name) [IO.File]::AppendAllText($events,('"'+$Name+'"')+[Environment]::NewLine)}
function Assert-PhaseLease {
  $lockPath=Join-Path $RepoRoot '.harness-cache/transaction.lock'
  $record=Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  if($record.token -ne $installerTransactionLock.token -or $record.pid -ne $PID){throw 'Actual phase token is not owned'}
  $unexpected=$null
  try {$unexpected=[IO.File]::Open($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)}
  catch [IO.IOException] {return}
  finally {if($null -ne $unexpected){$unexpected.Dispose()}}
  throw 'Native phase lease is no longer held'
}
function node {
  $arguments=@($args)
  if([string]$arguments[0] -like '*ccg-legacy-claim-guard.mjs') {& $NodeExecutable @arguments; return}
  if([string]$arguments[1] -ne 'global-init'){throw 'Unexpected nonfixture node command'}
  Assert-PhaseLease; Record-Phase 'global-init'
  [IO.File]::WriteAllText((Join-Path $HomeDir 'global-private-write.txt'),'private fixture only')
  if($FailGlobal){$global:LASTEXITCODE=7; 'injected-global-init-failure'; return}
  $global:LASTEXITCODE=0; '{"pendingProviderActions":[]}'
}
function Get-ThirdPartySourceSha256 {Assert-PhaseLease; return ('1'*64)}
function Assert-ClaudeUnchanged {param($Baseline,[string]$Label) if($Label -eq 'Global Init'){Assert-PhaseLease; Record-Phase 'global-validated'}}
function Assert-GlobalSkillProjection {Assert-PhaseLease; Record-Phase 'projection-validated'; return (Join-Path $HomeDir 'private-projection.json')}
function Show-PendingProviderActions {Record-Phase 'provider-status'}
function Show-PendingRecommendedAddons {Record-Phase 'addon-status'}
function Write-Output {
  if(@($args) -contains 'Global Setup complete.'){Record-Phase 'success'}
  Microsoft.PowerShell.Utility\Write-Output @args
}
$CodexHome=Join-Path $HomeDir 'codex'
$NonInteractive=$true; $CatalogMode='skip'; $ProviderActions='codex=later,gemini=later,grok=later,claude=skip'
$CcgSourceCheckout=$null; $CatalogPath=$null; $CatalogUrl=$null; $AllowCatalogNetwork=$false; $AllowThirdPartyNetwork=$false
$claudeBaseline=@{}; $ownershipPath=Join-Path $HomeDir 'private-ownership.json'
$savedEnvironment=@{HOME=$env:HOME;USERPROFILE=$env:USERPROFILE;CODEX_HOME=$env:CODEX_HOME}
$installerTransactionLock=$null
'@
$body='try {'+[Environment]::NewLine+'$installerTransactionLock=Enter-InstallerTransactionLock'+[Environment]::NewLine+$phase+'}'+[Environment]::NewLine+'finally '+$outer[0].Finally.Extent.Text
$worker=Join-Path $PSScriptRoot 'generated-final-phase.ps1'
[IO.File]::WriteAllText($worker,(@($header)+$definitions+@($body) -join [Environment]::NewLine))
& $worker -RepoRoot $RepoRoot -HomeDir $HomeDir -NodeExecutable $NodeExecutable -FailGlobal:$FailGlobal -InjectForeignLock:$InjectForeignLock
`;

async function runInstallerFinalPhase(t, failGlobal=false, injectForeignLock=false) {
  const f=await fixture(t), scripts=path.join(f.control,"scripts"), home=path.join(f.parent,"private-home");
  await mkdir(path.join(scripts,"lib"),{recursive:true}); await mkdir(home);
  for(const name of ["ccg-legacy-claim-guard.mjs","harness-fs.mjs"]) await copyFile(path.resolve("scripts/lib",name),path.join(scripts,"lib",name));
  const probe=path.join(scripts,"final-phase-probe.ps1"); await writeFile(probe,installerFinalPhaseProbe);
  const args=["-NoProfile","-NonInteractive","-File",probe,"-Installer",path.resolve("scripts/install.ps1"),"-Doctor",path.resolve("scripts/doctor.ps1"),"-RepoRoot",f.control,"-HomeDir",home,"-NodeExecutable",process.execPath];
  if(failGlobal) args.push("-FailGlobal");
  if(injectForeignLock) args.push("-InjectForeignLock");
  const result=spawnSync(process.env.HARNESS_TEST_PWSH??"C:\\Program Files\\PowerShell\\7\\pwsh.exe",args,{encoding:"utf8",windowsHide:true,timeout:25000});
  assert.equal(result.error,undefined,result.error?.message);
  assert.ok(Number.isInteger(result.status),"the actual phase process must exit with an integer status");
  const eventPath=path.join(f.parent,"events.jsonl");
  const events=await readFile(eventPath,"utf8").then(raw=>raw.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),()=>[]);
  const lockPath=path.join(f.control,".harness-cache","transaction.lock");
  assert.equal((await readdir(path.dirname(lockPath))).includes("transaction.lock"),injectForeignLock,"finally must release only its own phase lock and preserve a later foreign lock");
  assert.deepEqual(await readFile(f.receipt),f.original);
  return {result,events,home,lockPath};
}

test("actual installer final phase releases its native lease only after mutations and projection validation, then runs strict doctor before success",{skip:process.platform!=="win32"},async t=>{
  const {result,events,home}=await runInstallerFinalPhase(t);
  assert.equal(result.status,0,result.stdout+"\n"+result.stderr);
  assert.deepEqual(events,["global-init","global-validated","projection-validated","doctor","provider-status","addon-status","success"]);
  assert.equal(await readFile(path.join(home,"global-private-write.txt"),"utf8"),"private fixture only");
  assert.match(result.stdout,/PASS No transaction lock residue/);
  assert.match(result.stdout,/Global Setup complete\./);
});

test("actual installer early Global Init failure releases the phase lease without final doctor or success",{skip:process.platform!=="win32"},async t=>{
  const {result,events,home}=await runInstallerFinalPhase(t,true);
  assert.notEqual(result.status,0);
  assert.match(result.stdout+"\n"+result.stderr,/injected-global-init-failure/);
  assert.deepEqual(events,["global-init"]);
  assert.equal(await readFile(path.join(home,"global-private-write.txt"),"utf8"),"private fixture only");
  assert.doesNotMatch(result.stdout,/Global Setup complete\./);
});

test("strict final doctor rejects a later foreign transaction lock and installer finally preserves it without success",{skip:process.platform!=="win32"},async t=>{
  const {result,events,lockPath}=await runInstallerFinalPhase(t,false,true);
  assert.notEqual(result.status,0);
  assert.match(result.stdout,/FAIL Transaction lock residue found/);
  assert.match(result.stderr,/Final Harness doctor failed/);
  assert.deepEqual(events,["global-init","global-validated","projection-validated","doctor","foreign-lock-created"]);
  assert.equal(JSON.parse(await readFile(lockPath,"utf8")).token,"foreign-fixture-token");
  assert.doesNotMatch(result.stdout,/Global Setup complete\./);
});
