[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$HomeDir,
  [string]$CodexHome,
  [switch]$LinkCcg,
  [switch]$SkipInstall,
  [string]$CcgSetupTargetVersion,
  [string]$CcgSetupPreviousPluginVersion,
  [string]$AuthoritativeCcgCheckout,
  [string]$CcgMigrationPlan,
  [string]$CcgMigrationPlanSha256,
  [string]$CcgPackageArchive,
  [string]$CcgPackageArchiveSha256
)

$ErrorActionPreference = "Stop"
if ($env:CLAUDECODE -eq "1" -or $env:CCG_HOST -eq "claude") {
  throw "Personal Harness mutations require the Codex host; explicit Claude host markers are rejected."
}
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
& node (Join-Path $PSScriptRoot "lib/ccg-legacy-claim-guard.mjs") --repo-root $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "The fixed new control root refuses mutations of a retired legacy management root." }
if ($CodexHome -and -not $HomeDir) { throw "CodexHome requires an explicit HomeDir." }
$savedRootEnvironment = @{ HOME = $env:HOME; USERPROFILE = $env:USERPROFILE; CODEX_HOME = $env:CODEX_HOME }
$archiveReadLease = $null
try {
if ($HomeDir) {
  $HomeDir = [System.IO.Path]::GetFullPath($HomeDir)
  $helper = Join-Path $RepoRoot ".agents/skills/harness-init/scripts/codex-home.mjs"
  $arguments = @("--input-type=module", "-e", 'import { pathToFileURL } from "node:url"; const { resolveCodexHome } = await import(pathToFileURL(process.argv[1])); console.log(await resolveCodexHome(process.argv[2], process.argv[3] || null));', $helper, $HomeDir)
  if ($CodexHome) { $arguments += $CodexHome }
  $result = @(& node @arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Invalid physical CodexHome: $($result -join [Environment]::NewLine)" }
  $CodexHome = ($result -join [Environment]::NewLine).Trim()
  $env:HOME = $HomeDir
  $env:USERPROFILE = $HomeDir
  $env:CODEX_HOME = $CodexHome
}
$manifest = Get-Content -LiteralPath (Join-Path $RepoRoot "harness.sources.json") -Raw | ConvertFrom-Json
$ccgRoot = Join-Path $RepoRoot ([string]$manifest.ccg.snapshotPath)
$runtimeArguments = @("--repo-root", $RepoRoot)
if ($CcgPackageArchive) {
  if (-not $LinkCcg -or $CcgPackageArchiveSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "Pinned CCG package archive requires -LinkCcg and its SHA-256."
  }
  $CcgPackageArchive = [System.IO.Path]::GetFullPath($CcgPackageArchive)
  # Keep the validated Windows archive readable by npm while denying writes
  # and replacement until the installation transaction has completed.
  $archiveReadLease = [System.IO.File]::Open($CcgPackageArchive,
    [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $runtimeArguments += @("--archive", $CcgPackageArchive, "--sha256", $CcgPackageArchiveSha256)
}
elseif ($CcgPackageArchiveSha256) { throw "CcgPackageArchiveSha256 requires CcgPackageArchive." }
$ccgRuntimeJson = & node (Join-Path $PSScriptRoot "ccg-runtime.mjs") @runtimeArguments
if ($LASTEXITCODE -ne 0) { throw "Personal CCG runtime identity is invalid." }
$ccgRuntime = ($ccgRuntimeJson -join [Environment]::NewLine) | ConvertFrom-Json
if ($CcgSetupTargetVersion -and -not $LinkCcg) {
  throw "CcgSetupTargetVersion requires -LinkCcg."
}
if (
  $CcgSetupTargetVersion -and
  $CcgSetupTargetVersion -ne [string]$manifest.ccg.version
) {
  throw "CcgSetupTargetVersion must match the Harness source manifest."
}
if ($CcgSetupPreviousPluginVersion -and -not $CcgSetupTargetVersion) {
  throw "CcgSetupPreviousPluginVersion requires -CcgSetupTargetVersion."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ is required."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required."
}
$nodeMajor = [int]((& node --version).Trim().TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20+ is required."
}

$pythonResolver = Join-Path $PSScriptRoot "python-resolver.mjs"
$pythonJson = & node $pythonResolver 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Python 3.9+ resolution failed: $($pythonJson -join [Environment]::NewLine)"
}
$python = ($pythonJson -join [Environment]::NewLine) | ConvertFrom-Json
Write-Output "Using Python $($python.version) at $($python.command)"

$requiredTrellis = [string]$manifest.trellis.version
$currentTrellis = $null
if (Get-Command trellis -ErrorAction SilentlyContinue) {
  $currentTrellis = ((& trellis --version) | Select-Object -Last 1).Trim()
}
$manageTrellis = $currentTrellis -ne $requiredTrellis
$manageCcg = [bool]$LinkCcg
$lifecycleScript = Join-Path $PSScriptRoot "harness-lifecycle.mjs"
$beginArguments = @(
  $lifecycleScript,
  "bootstrap-begin",
  "--repo-root",
  $RepoRoot
)
if ($manageTrellis) {
  $beginArguments += "--manage-trellis"
}
if ($manageCcg) {
  $beginArguments += "--manage-ccg"
}
if ($CcgMigrationPlan) {
  if (-not $manageCcg -or $CcgMigrationPlanSha256 -notmatch '^[a-f0-9]{64}$') {
    throw "CCG namespace migration requires -LinkCcg and its approved SHA-256."
  }
  $beginArguments += @("--ccg-migration-plan", [System.IO.Path]::GetFullPath($CcgMigrationPlan), "--ccg-migration-plan-sha256", $CcgMigrationPlanSha256)
}
elseif ($CcgMigrationPlanSha256) { throw "CcgMigrationPlanSha256 requires CcgMigrationPlan." }

& node @beginArguments
if ($LASTEXITCODE -ne 0) {
  throw "Could not start the Harness ownership transaction."
}

try {
  if ($manageTrellis) {
    Write-Output "Installing Trellis $requiredTrellis..."
    & npm install -g "$($manifest.trellis.package)@$requiredTrellis"
    if ($LASTEXITCODE -ne 0) {
      throw "Trellis installation failed."
    }
  }

  if (-not $SkipInstall -and -not $CcgPackageArchive) {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue) -and
        (Get-Command corepack -ErrorAction SilentlyContinue)) {
      & corepack enable
      if ($LASTEXITCODE -ne 0) {
        throw "corepack enable failed."
      }
    }

    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
      throw "pnpm is required after enabling corepack."
    }

    Write-Output "Installing the personal CCG snapshot dependencies..."
    & pnpm --dir $ccgRoot install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      throw "CCG dependency installation failed."
    }

    Write-Output "Building the personal CCG snapshot..."
    & pnpm --dir $ccgRoot build
    if ($LASTEXITCODE -ne 0) {
      throw "CCG build failed."
    }
  }

  if ($LinkCcg) {
    Write-Output (
      "Installing the packaged personal CCG snapshot as the global $($ccgRuntime.command) command..."
    )
    # Keep -LinkCcg as the compatibility switch used by existing lifecycle and
    # clean-install callers. npm's install-links option packages and copies a
    # local directory instead of leaving a global junction back into the
    # mutable Harness snapshot.
    if ($CcgPackageArchive) {
      $revalidatedRuntime = & node (Join-Path $PSScriptRoot "ccg-runtime.mjs") @runtimeArguments
      if ($LASTEXITCODE -ne 0) { throw "Pinned CCG package archive changed before installation." }
      & npm install -g $CcgPackageArchive --offline --ignore-scripts --no-audit --no-fund --install-strategy=nested
    }
    else {
      & npm install -g --install-links=true --install-strategy=nested $ccgRoot
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Packaged global CCG installation failed."
    }
    & node $lifecycleScript "bootstrap-runtime-checkpoint" "--repo-root" $RepoRoot
    if ($LASTEXITCODE -ne 0) { throw "Cannot checkpoint the installed CCG runtime ownership." }
  }

  $doctorArguments = @{
    RepoRoot = $RepoRoot
  }
  if ($CcgSetupTargetVersion) {
    $doctorArguments.CcgUpdateTargetVersion = $CcgSetupTargetVersion
  }
  if ($CcgSetupPreviousPluginVersion) {
    $doctorArguments.CcgSetupPreviousPluginVersion =
      $CcgSetupPreviousPluginVersion
  }
  if ($AuthoritativeCcgCheckout) {
    $doctorArguments.AuthoritativeCheckout = $AuthoritativeCcgCheckout
  }
  & (Join-Path $PSScriptRoot "doctor.ps1") @doctorArguments
  $doctorExitCode = $LASTEXITCODE
  if ($doctorExitCode -ne 0) {
    throw "Harness doctor failed."
  }

  & node $lifecycleScript "bootstrap-complete" "--repo-root" $RepoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Could not commit the Harness ownership transaction."
  }

  Write-Output ""
  Write-Output "Bootstrap complete."
}
catch {
  $bootstrapFailure = $_
  & node $lifecycleScript "bootstrap-abort" "--repo-root" $RepoRoot
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Bootstrap rollback also failed; inspect .harness-cache/bootstrap-pending.json."
  }
  throw $bootstrapFailure
}
}
finally {
  if ($null -ne $archiveReadLease) { $archiveReadLease.Dispose() }
  $env:HOME = $savedRootEnvironment.HOME
  $env:USERPROFILE = $savedRootEnvironment.USERPROFILE
  $env:CODEX_HOME = $savedRootEnvironment.CODEX_HOME
}
