[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Index,
  [string]$CcgUpdateTargetVersion
)

$ErrorActionPreference = "Stop"
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$manifest = Get-Content -LiteralPath (Join-Path $RepoRoot "harness.sources.json") -Raw | ConvertFrom-Json
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Read-Version {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @("--version")
  )

  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    return $null
  }

  $result = & $Command @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    return $null
  }
  return ($result -join [Environment]::NewLine).Trim()
}

function Add-Failure([string]$Message) {
  $failures.Add($Message)
  Write-Output "FAIL  $Message"
}

function Add-Pass([string]$Message) {
  Write-Output "PASS  $Message"
}

function Add-Warning([string]$Message) {
  $warnings.Add($Message)
  Write-Output "WARN  $Message"
}

function Test-CcgUpdateTargetDrift($Finding) {
  # The lifecycle derives this version from the validated target commit. Keep
  # the exception exact so arbitrary runtime drift remains blocking.
  if (
    -not $CcgUpdateTargetVersion -or
    [string]$Finding.status -ne "conflict" -or
    [string]$Finding.id -notin @("ccg-runtime-cli", "ccg-plugin-cache")
  ) {
    return $false
  }
  $expected = [string]$Finding.evidence.expected
  $actual = [string]$Finding.evidence.actual
  if (
    $expected -ne [string]$manifest.ccg.version -or
    -not $actual -or
    $actual -eq "missing"
  ) {
    return $false
  }
  if ([string]$Finding.id -eq "ccg-runtime-cli") {
    return $actual -eq $CcgUpdateTargetVersion
  }
  return (
    $actual -eq $CcgUpdateTargetVersion -or
    $actual.StartsWith(
      "$CcgUpdateTargetVersion+",
      [StringComparison]::OrdinalIgnoreCase
    )
  )
}

function Write-AdapterFinding($Finding) {
  $label = if ([string]$Finding.status -eq "ok") {
    "PASS"
  }
  elseif ([string]$Finding.severity -eq "blocking") {
    "BLOCK"
  }
  elseif ([string]$Finding.severity -eq "warning") {
    "WARN"
  }
  else {
    "INFO"
  }
  Write-Output "$($label.PadRight(5)) $($Finding.id): $($Finding.summary)"
  if ([string]$Finding.status -ne "ok" -and $null -ne $Finding.evidence) {
    Write-Output "      evidence: $($Finding.evidence | ConvertTo-Json -Compress -Depth 10)"
  }
  if ([string]$Finding.status -ne "ok" -and $Finding.action) {
    Write-Output "      action: $($Finding.action)"
  }
}

$nodeVersion = Read-Version "node"
if (-not $nodeVersion) {
  Add-Failure "Node.js is missing."
}
elseif ([int](($nodeVersion -replace '^v', '').Split('.')[0]) -lt 20) {
  Add-Failure "Node.js 20+ is required; found $nodeVersion."
}
else {
  Add-Pass "Node.js $nodeVersion"
}

$pythonResolver = Join-Path $PSScriptRoot "python-resolver.mjs"
$pythonJson = & node $pythonResolver 2>&1
if ($LASTEXITCODE -ne 0) {
  Add-Failure "Python 3.9+ resolution failed: $($pythonJson -join [Environment]::NewLine)"
}
else {
  $python = ($pythonJson -join [Environment]::NewLine) | ConvertFrom-Json
  Add-Pass "Python $($python.version) ($($python.command))"
}

$trellisVersion = Read-Version "trellis"
if (-not $trellisVersion) {
  Add-Failure "Trellis CLI is missing."
}
elseif ($trellisVersion.Split([Environment]::NewLine)[-1].Trim() -ne [string]$manifest.trellis.version) {
  Add-Failure "Trellis CLI must be $($manifest.trellis.version); found $trellisVersion."
}
else {
  Add-Pass "Trellis $($manifest.trellis.version)"
}

$pnpmVersion = Read-Version "pnpm"
if (-not $pnpmVersion) {
  Add-Failure "pnpm is missing."
}
else {
  Add-Pass "pnpm $pnpmVersion"
}

$goVersion = Read-Version "go" @("version")
if (-not $goVersion) {
  Add-Failure "Go is missing; CCG wrapper verification requires Go."
}
else {
  Add-Pass "$goVersion"
}

$ccgRoot = Join-Path $RepoRoot ([string]$manifest.ccg.snapshotPath)
$ccgBin = Join-Path $ccgRoot "bin/ccg.mjs"
if ($CcgUpdateTargetVersion) {
  Add-Pass (
    "Current CCG snapshot uses package/source verification; local CLI smoke " +
    "is deferred to strict post-replacement verification"
  )
}
else {
  $localCcgVersion = & node $ccgBin --version 2>&1
  $localCcgText = ($localCcgVersion -join [Environment]::NewLine).Trim()
  $expectedCcgPattern = "(?:^|[/@])$([Regex]::Escape([string]$manifest.ccg.version))(?:$|\s)"
  if ($LASTEXITCODE -ne 0) {
    Add-Failure "The activated CCG CLI cannot run from its final Harness path."
  }
  elseif ($localCcgText -ne [string]$manifest.ccg.version -and $localCcgText -notmatch $expectedCcgPattern) {
    Add-Failure "Activated CCG CLI must be $($manifest.ccg.version); found $($localCcgVersion -join ' ')."
  }
  else {
    Add-Pass "Activated CCG CLI $($manifest.ccg.version)"
  }
}

$transactionState = Join-Path $RepoRoot ".harness-cache"
$transactionJournal = Join-Path $transactionState "transaction-journal.json"
$transactionLock = Join-Path $transactionState "transaction.lock"
if (Test-Path -LiteralPath $transactionJournal) {
  Add-Failure "Interrupted transaction journal found. Run pnpm harness:recover."
}
else {
  Add-Pass "No interrupted transaction journal"
}
if (Test-Path -LiteralPath $transactionLock) {
  Add-Failure "Transaction lock residue found. Run pnpm harness:recover."
}
else {
  Add-Pass "No transaction lock residue"
}
foreach ($runtimeDirectory in @("staging", "discard", "file-discard")) {
  $runtimePath = Join-Path $transactionState $runtimeDirectory
  $residue = Get-ChildItem -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($residue) {
    Add-Failure "Transaction $runtimeDirectory residue found. Run pnpm harness:recover."
  }
}

try {
  $verifySourceArguments = @{
    RepoRoot = $RepoRoot
    Index = $Index
  }
  if ($CcgUpdateTargetVersion) {
    $verifySourceArguments.AllowAuthoritativeCheckoutDrift = $true
  }
  & (Join-Path $PSScriptRoot "verify-sources.ps1") @verifySourceArguments
  Add-Pass "Personal source provenance and Git tree"
}
catch {
  Add-Failure $_.Exception.Message
}

$adapterScript = Join-Path $PSScriptRoot "harness-adapter.mjs"
$adapterArguments = @($adapterScript, "conflicts")
if ($Index) {
  $adapterArguments += "--index"
}
if ($CcgUpdateTargetVersion) {
  $adapterArguments += "--json"
}
$adapterOutput = & node @adapterArguments 2>&1
$adapterExitCode = $LASTEXITCODE
if (-not $CcgUpdateTargetVersion) {
  $adapterOutput | ForEach-Object { Write-Output $_ }
  if ($adapterExitCode -eq 0) {
    Add-Pass "Layered adapter conflict audit"
  }
  else {
    Add-Failure "Layered adapter conflict audit exited with code $adapterExitCode."
  }
}
else {
  $adapterReport = $null
  try {
    $adapterReport = ($adapterOutput -join [Environment]::NewLine) | ConvertFrom-Json
    if ($null -eq $adapterReport.findings -or $null -eq $adapterReport.summary) {
      throw "Adapter report is missing findings or summary."
    }
  }
  catch {
    Add-Failure "Layered adapter conflict audit returned invalid JSON: $($_.Exception.Message)"
  }
  if ($adapterReport) {
    $blockingFindings = [System.Collections.Generic.List[object]]::new()
    $runtimeTargetRejected = $false
    $runtimeFindings = @(
      $adapterReport.findings |
        Where-Object { [string]$_.id -eq "ccg-runtime-cli" }
    )
    if ($runtimeFindings.Count -ne 1) {
      Add-Failure (
        "CCG update preflight requires exactly one global CCG runtime finding; " +
        "found $($runtimeFindings.Count)."
      )
      $runtimeTargetRejected = $true
    }
    foreach ($finding in @($adapterReport.findings)) {
      if ([string]$finding.id -eq "ccg-runtime-cli") {
        $runtimeVersion = [string]$finding.evidence.actual
        if ($runtimeVersion -ne $CcgUpdateTargetVersion) {
          $reportedRuntimeVersion = if ($runtimeVersion) {
            $runtimeVersion
          }
          else {
            "missing"
          }
          Add-Failure (
            "Global CCG runtime must match update target " +
            "$CcgUpdateTargetVersion; found $reportedRuntimeVersion."
          )
          $runtimeTargetRejected = $true
          continue
        }
      }
      if (Test-CcgUpdateTargetDrift $finding) {
        Add-Warning (
          "CCG update preflight permits $($finding.id) target drift: " +
          "$($finding.evidence.expected) -> $($finding.evidence.actual)."
        )
        continue
      }
      Write-AdapterFinding $finding
      if (
        [string]$finding.status -eq "conflict" -and
        [string]$finding.severity -eq "blocking"
      ) {
        $blockingFindings.Add($finding)
      }
    }
    if ($adapterExitCode -notin @(0, 2)) {
      Add-Failure "Layered adapter conflict audit exited unexpectedly with code $adapterExitCode."
    }
    elseif ($blockingFindings.Count -gt 0) {
      Add-Failure "Layered adapter conflict audit exited with code 2."
    }
    elseif (-not $runtimeTargetRejected) {
      Add-Pass "Layered adapter conflict audit for CCG update target $CcgUpdateTargetVersion"
    }
  }
}

$origin = (& git -C $RepoRoot remote get-url origin 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
  Add-Failure "Git origin is missing."
}
elseif ($origin -notmatch 'jed-zed/trellis-ccg-harness(?:\.git)?$') {
  Add-Failure "Unexpected Git origin: $origin"
}
else {
  Add-Pass "Git origin $origin"
}

if (Get-Command gh -ErrorAction SilentlyContinue) {
  $expectedVisibility = [string]$manifest.harness.visibility
  $privacy = & gh repo view ([string]$manifest.harness.repository) --json isPrivate --jq ".isPrivate" 2>$null
  if ($LASTEXITCODE -eq 0) {
    $actualVisibility = if ($privacy.Trim() -eq "true") {
      "private"
    }
    else {
      "public"
    }
    if ($expectedVisibility -notin @("private", "public")) {
      Add-Failure "Unsupported repository visibility in harness.sources.json: $expectedVisibility"
    }
    elseif ($actualVisibility -eq $expectedVisibility) {
      Add-Pass "GitHub repository visibility is $actualVisibility"
    }
    else {
      Add-Failure "GitHub repository visibility is $actualVisibility; expected $expectedVisibility."
    }
  }
  else {
    Add-Warning "Could not verify GitHub repository visibility with the current gh session."
  }
}
else {
  Add-Warning "GitHub CLI is unavailable; remote visibility was not checked."
}

if ($warnings.Count -gt 0) {
  Write-Output ""
  Write-Output "Warnings: $($warnings.Count)"
}

if ($failures.Count -gt 0) {
  Write-Output ""
  Write-Output "Doctor failed with $($failures.Count) issue(s)."
  exit 1
}

Write-Output ""
Write-Output "Harness doctor passed."
$global:LASTEXITCODE = 0
exit 0
