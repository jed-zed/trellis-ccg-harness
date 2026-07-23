[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Index
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

$pythonVersion = Read-Version "python"
if (-not $pythonVersion) {
  Add-Failure "Python 3.9+ is missing."
}
elseif ($pythonVersion -notmatch 'Python\s+(\d+)\.(\d+)') {
  Add-Failure "Could not parse Python version: $pythonVersion"
}
elseif ([int]$Matches[1] -lt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -lt 9)) {
  Add-Failure "Python 3.9+ is required; found $pythonVersion."
}
else {
  Add-Pass $pythonVersion
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

try {
  & (Join-Path $PSScriptRoot "verify-sources.ps1") -RepoRoot $RepoRoot -Index:$Index
  Add-Pass "Personal source provenance and Git tree"
}
catch {
  Add-Failure $_.Exception.Message
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
  $privacy = & gh repo view "jed-zed/trellis-ccg-harness" --json isPrivate --jq ".isPrivate" 2>$null
  if ($LASTEXITCODE -eq 0 -and $privacy.Trim() -eq "true") {
    Add-Pass "GitHub repository is private"
  }
  elseif ($LASTEXITCODE -eq 0) {
    Add-Failure "GitHub repository is not private."
  }
  else {
    Add-Warning "Could not verify GitHub privacy with the current gh session."
  }
}
else {
  Add-Warning "GitHub CLI is unavailable; remote privacy was not checked."
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
