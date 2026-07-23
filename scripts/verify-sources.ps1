[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Index
)

$ErrorActionPreference = "Stop"
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$manifestPath = Join-Path $RepoRoot "harness.sources.json"

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual
  )

  if ($Expected -ne $Actual) {
    throw "$Name mismatch. Expected '$Expected', got '$Actual'."
  }
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $output = & git -C $RepoRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine).Trim()
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Harness source manifest not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$componentRoot = Join-Path $RepoRoot ([string]$manifest.ccg.snapshotPath)
$trellisVersionPath = Join-Path $RepoRoot ".trellis/.version"
$ccgPackagePath = Join-Path $componentRoot "package.json"

if (-not (Test-Path -LiteralPath $componentRoot -PathType Container)) {
  throw "CCG component directory not found: $componentRoot"
}

$trellisVersion = (Get-Content -LiteralPath $trellisVersionPath -Raw).Trim()
Assert-Equal "Trellis project version" ([string]$manifest.trellis.version) $trellisVersion

$ccgPackage = Get-Content -LiteralPath $ccgPackagePath -Raw | ConvertFrom-Json
Assert-Equal "CCG package name" ([string]$manifest.ccg.package) ([string]$ccgPackage.name)
Assert-Equal "CCG package version" ([string]$manifest.ccg.version) ([string]$ccgPackage.version)

$requiredPersonalFiles = @(
  "plugins/ccg/.codex-plugin/plugin.json",
  "plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py",
  "plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/runner.mjs",
  "src/commands/doctor.ts",
  "templates/engine/tools/grok-intelligence/runner.mjs"
)

foreach ($relativePath in $requiredPersonalFiles) {
  $fullPath = Join-Path $componentRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Required personal CCG file is missing: $relativePath"
  }
}

$treeish = "HEAD"
if ($Index) {
  $treeish = Invoke-Git write-tree
}
else {
  Invoke-Git rev-parse --verify HEAD | Out-Null
}

$treeRef = "${treeish}:$([string]$manifest.ccg.snapshotPath)"
$actualTree = Invoke-Git rev-parse $treeRef
Assert-Equal "Personal CCG Git tree" ([string]$manifest.ccg.gitTree) $actualTree

$forbiddenRuntimePaths = @(
  ".git",
  ".ccg",
  ".codex/ccg",
  "node_modules",
  "output",
  "tmp"
)

foreach ($relativePath in $forbiddenRuntimePaths) {
  $forbiddenTreeRef = "${treeRef}:$relativePath"
  & git -C $RepoRoot cat-file -e $forbiddenTreeRef 2>$null
  if ($LASTEXITCODE -eq 0) {
    throw "Forbidden runtime path is committed in the CCG snapshot: $relativePath"
  }
}

Write-Output "Source verification passed."
Write-Output "  Trellis: $trellisVersion"
Write-Output "  CCG:      $($ccgPackage.version)"
Write-Output "  Commit:   $($manifest.ccg.commit)"
Write-Output "  Git tree: $actualTree"
Write-Output "  Source:   $($manifest.ccg.authoritativeRepository)"
