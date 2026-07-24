[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Index,
  [string]$AuthoritativeCheckout = $env:HARNESS_CCG_SOURCE_CHECKOUT
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

function Invoke-GitAt {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingTree,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  $output = & git -C $WorkingTree @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine).Trim()
}

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  return Invoke-GitAt -WorkingTree $RepoRoot @Arguments
}

function Get-GitTreeText {
  param(
    [Parameter(Mandatory = $true)][string]$Treeish,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  $gitPath = $RelativePath.Replace('\', '/')
  return Invoke-Git show "${Treeish}:$gitPath"
}

function Test-GitTreePath {
  param(
    [Parameter(Mandatory = $true)][string]$Treeish,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  $gitPath = $RelativePath.Replace('\', '/')
  & git -C $RepoRoot cat-file -e "${Treeish}:$gitPath" 2>$null
  return $LASTEXITCODE -eq 0
}

function Normalize-RepositoryUrl([string]$Url) {
  return (($Url.Trim() -replace '\\', '/') -replace '\.git$', '').TrimEnd('/').ToLowerInvariant()
}

function Assert-AuthoritativeCommitTree {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$SourceManifest,
    [string]$Checkout
  )

  $repository = [string]$SourceManifest.authoritativeRepository
  $commit = [string]$SourceManifest.commit
  $expectedTree = [string]$SourceManifest.gitTree
  if ($commit -notmatch '^[0-9a-f]{40}$') {
    throw "CCG authoritative commit must be a full 40-character SHA-1."
  }
  if ($expectedTree -notmatch '^[0-9a-f]{40}$') {
    throw "CCG authoritative Git tree must be a full 40-character SHA-1."
  }
  $uri = [Uri]$repository
  if ($uri.Scheme -ne "https" -or $uri.UserInfo) {
    throw "CCG authoritative repository must be a credential-free HTTPS URL."
  }

  $verificationRoot = $null
  $sourceRoot = $Checkout
  try {
    if (-not $sourceRoot) {
      $sibling = Join-Path (Split-Path -Parent $RepoRoot) "ccg-workflow"
      if (Test-Path -LiteralPath (Join-Path $sibling ".git")) {
        $sourceRoot = $sibling
      }
    }

    if ($sourceRoot) {
      $sourceRoot = [System.IO.Path]::GetFullPath($sourceRoot)
      if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot ".git"))) {
        throw "Authoritative CCG checkout is not a Git repository: $sourceRoot"
      }
      $remoteName = [string]$SourceManifest.authoritativeRemoteNameInSourceCheckout
      if (-not $remoteName) {
        $remoteName = "origin"
      }
      $remoteUrl = Invoke-GitAt -WorkingTree $sourceRoot remote get-url $remoteName
      Assert-Equal "CCG authoritative checkout remote" (Normalize-RepositoryUrl $repository) (Normalize-RepositoryUrl $remoteUrl)
      $head = Invoke-GitAt -WorkingTree $sourceRoot rev-parse HEAD
      Assert-Equal "CCG authoritative checkout HEAD" $commit $head
      $dirty = Invoke-GitAt -WorkingTree $sourceRoot status --porcelain --untracked-files=normal
      if ($dirty) {
        throw "Authoritative CCG checkout is dirty; commit and clean it before updating the Harness snapshot."
      }
    }
    else {
      $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
      $verificationRoot = Join-Path $tempBase "trellis-ccg-source-$([Guid]::NewGuid().ToString('N'))"
      New-Item -ItemType Directory -Path $verificationRoot | Out-Null
      Invoke-GitAt -WorkingTree $verificationRoot init | Out-Null
      Invoke-GitAt -WorkingTree $verificationRoot remote add origin $repository | Out-Null
      Invoke-GitAt -WorkingTree $verificationRoot fetch --no-tags --depth=1 origin $commit | Out-Null
      $fetched = Invoke-GitAt -WorkingTree $verificationRoot rev-parse FETCH_HEAD
      Assert-Equal "Fetched CCG authoritative commit" $commit $fetched
      $sourceRoot = $verificationRoot
    }

    $actualCommitTree = Invoke-GitAt -WorkingTree $sourceRoot rev-parse "$commit`^{tree}"
    Assert-Equal "Authoritative commit to Git tree" $expectedTree $actualCommitTree
  }
  finally {
    if ($verificationRoot) {
      $resolved = [System.IO.Path]::GetFullPath($verificationRoot)
      $tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
      if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove source verification directory outside the system temp root: $resolved"
      }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}

$treeish = "HEAD"
if ($Index) {
  $treeish = Invoke-Git write-tree
}

if ($Index) {
  if (-not (Test-GitTreePath -Treeish $treeish -RelativePath "harness.sources.json")) {
    throw "Harness source manifest is missing from the staged Git tree."
  }
  $manifest = Get-GitTreeText -Treeish $treeish -RelativePath "harness.sources.json" | ConvertFrom-Json
}
else {
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Harness source manifest not found: $manifestPath"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

$componentRoot = Join-Path $RepoRoot ([string]$manifest.ccg.snapshotPath)
$trellisVersionPath = Join-Path $RepoRoot ".trellis/.version"
$ccgPackagePath = Join-Path $componentRoot "package.json"

if ($Index) {
  if (-not (Test-GitTreePath -Treeish $treeish -RelativePath ([string]$manifest.ccg.snapshotPath))) {
    throw "CCG component directory is missing from the staged Git tree."
  }
  $trellisVersion = (Get-GitTreeText -Treeish $treeish -RelativePath ".trellis/.version").Trim()
  $ccgPackage = Get-GitTreeText -Treeish $treeish -RelativePath "$([string]$manifest.ccg.snapshotPath)/package.json" | ConvertFrom-Json
}
else {
  if (-not (Test-Path -LiteralPath $componentRoot -PathType Container)) {
    throw "CCG component directory not found: $componentRoot"
  }
  $trellisVersion = (Get-Content -LiteralPath $trellisVersionPath -Raw).Trim()
  $ccgPackage = Get-Content -LiteralPath $ccgPackagePath -Raw | ConvertFrom-Json
}

Assert-Equal "Trellis project version" ([string]$manifest.trellis.version) $trellisVersion

Assert-Equal "CCG package name" ([string]$manifest.ccg.package) ([string]$ccgPackage.name)
Assert-Equal "CCG package version" ([string]$manifest.ccg.version) ([string]$ccgPackage.version)
Assert-AuthoritativeCommitTree -SourceManifest $manifest.ccg -Checkout $AuthoritativeCheckout

$requiredPersonalFiles = @(
  "plugins/ccg/.codex-plugin/plugin.json",
  "plugins/ccg/skills/ccg-gptpro-bridge/scripts/gptpro_bridge.py",
  "plugins/ccg/skills/ccg-grok-intel/scripts/grok-intelligence/runner.mjs",
  "src/commands/doctor.ts",
  "templates/engine/tools/grok-intelligence/runner.mjs"
)

foreach ($relativePath in $requiredPersonalFiles) {
  if ($Index) {
    $treePath = "$([string]$manifest.ccg.snapshotPath)/$relativePath"
    if (-not (Test-GitTreePath -Treeish $treeish -RelativePath $treePath)) {
      throw "Required personal CCG file is missing from the staged Git tree: $relativePath"
    }
  }
  else {
    $fullPath = Join-Path $componentRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      throw "Required personal CCG file is missing: $relativePath"
    }
  }
}

if ($Index) {
  $untracked = Invoke-Git ls-files --others --exclude-standard -- $manifest.ccg.snapshotPath
  if ($untracked) {
    throw "CCG component has untracked paths; index verification requires an exact staged snapshot."
  }
}
else {
  Invoke-Git rev-parse --verify HEAD | Out-Null
  $staged = Invoke-Git diff --cached --name-only -- $manifest.ccg.snapshotPath
  $unstaged = Invoke-Git diff --name-only -- $manifest.ccg.snapshotPath
  $untracked = Invoke-Git ls-files --others --exclude-standard -- $manifest.ccg.snapshotPath
  if ($staged -or $unstaged -or $untracked) {
    throw "CCG component is dirty (staged, unstaged, or untracked); source verification requires an exact committed snapshot."
  }
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

# PowerShell can propagate the last native command's non-zero status when the
# script exits on Linux. The cat-file probes above intentionally expect
# missing paths, so reset the native status after all assertions pass.
$global:LASTEXITCODE = 0
