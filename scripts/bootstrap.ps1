[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$LinkCcg,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$manifest = Get-Content -LiteralPath (Join-Path $RepoRoot "harness.sources.json") -Raw | ConvertFrom-Json
$ccgRoot = Join-Path $RepoRoot ([string]$manifest.ccg.snapshotPath)

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

  if (-not $SkipInstall) {
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
    Write-Output "Linking the personal CCG snapshot as the global ccg command..."
    & npm install -g $ccgRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Global CCG link failed."
    }
  }

  & (Join-Path $PSScriptRoot "doctor.ps1") -RepoRoot $RepoRoot
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
