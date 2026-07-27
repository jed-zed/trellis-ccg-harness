[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$HomeDir = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::UserProfile
  ),
  [switch]$NonInteractive,
  [switch]$Approved,
  [switch]$ApproveTrellis,
  [switch]$ApproveCcgCli,
  [switch]$ApproveCodexMode,
  [switch]$ApproveCcgPlugin,
  [switch]$ApproveGlobalInit,
  [ValidateSet("skip", "local", "clone")]
  [string]$CatalogMode,
  [string]$CatalogPath,
  [string]$CatalogUrl,
  [string]$ProviderActions,
  [switch]$AllowCatalogNetwork,
  [switch]$AllowThirdPartyNetwork,
  [switch]$PreviewOnly
)

$ErrorActionPreference = "Stop"
$script:PluginMarketplaceAdded = $false
$script:PluginInstalled = $false

function Get-NormalizedPath {
  param([Parameter(Mandatory)][string]$Path)

  $value = $Path
  if ($IsWindows -and $value.StartsWith("\\?\")) {
    $value = $value.Substring(4)
  }
  $fullPath = [System.IO.Path]::GetFullPath($value)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if ($fullPath -eq $pathRoot) {
    return $fullPath
  }
  return $fullPath.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
}

function Test-SamePath {
  param(
    [Parameter(Mandatory)][string]$Left,
    [Parameter(Mandatory)][string]$Right
  )

  $comparison = if ($IsWindows) {
    [System.StringComparison]::OrdinalIgnoreCase
  }
  else {
    [System.StringComparison]::Ordinal
  }
  return [string]::Equals(
    (Get-NormalizedPath $Left),
    (Get-NormalizedPath $Right),
    $comparison
  )
}

function Assert-RealDirectory {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Label must be an existing directory: $Path"
  }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "$Label must not be a symbolic link or junction: $Path"
  }
}

function Assert-NotFilesystemRoot {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Label
  )

  if ($Path -eq [System.IO.Path]::GetPathRoot($Path)) {
    throw "$Label cannot be a filesystem root."
  }
}

function Invoke-JsonCommand {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Label
  )

  $output = @(& $Command @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed: $($output -join [Environment]::NewLine)"
  }
  try {
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
  }
  catch {
    throw "$Label did not return valid JSON."
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Label
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Get-ThirdPartySourceSha256 {
  param(
    [Parameter(Mandatory)][string]$HarnessInitPath,
    [Parameter(Mandatory)][string]$ApprovedHomeDir
  )

  $plan = Invoke-JsonCommand "node" @(
    $HarnessInitPath,
    "third-party-plan",
    "--home-dir",
    $ApprovedHomeDir,
    "--repo-root",
    $RepoRoot
  ) "Third-party source plan"
  $digest = [string]$plan.sourceManifestSha256
  if ($digest -notmatch '^[a-f0-9]{64}$') {
    throw "Third-party source plan did not return a SHA-256 source manifest digest."
  }
  return $digest
}

function Get-CommandVersion {
  param([Parameter(Mandatory)][string]$Command)

  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    return $null
  }
  $output = @(& $Command --version 2>&1)
  if ($LASTEXITCODE -ne 0) {
    return $null
  }
  $match = [regex]::Match(
    ($output -join " "),
    "(?<![0-9])(?<version>[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)"
  )
  if (-not $match.Success) {
    return $null
  }
  return $match.Groups["version"].Value
}

function Test-CodexPluginReportedVersion {
  param(
    [Parameter(Mandatory)][string]$ReportedVersion,
    [Parameter(Mandatory)][string]$BaseVersion,
    [Parameter(Mandatory)][string]$PluginVersion
  )

  return (
    $ReportedVersion -eq $BaseVersion -or
    $ReportedVersion -eq $PluginVersion
  )
}

function Get-TreeFingerprint {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return "absent"
  }
  $root = Get-Item -LiteralPath $Path -Force
  $entries = [System.Collections.Generic.List[object]]::new()
  $allItems = @($root) + @(
    Get-ChildItem -LiteralPath $Path -Force -Recurse |
      Sort-Object FullName
  )
  foreach ($item in $allItems) {
    $relative = if ($item.FullName -eq $root.FullName) {
      "."
    }
    else {
      [System.IO.Path]::GetRelativePath($root.FullName, $item.FullName).
        Replace("\", "/")
    }
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      $entries.Add([ordered]@{
        path = $relative
        type = "link"
        target = [string]$item.LinkTarget
      })
    }
    elseif ($item.PSIsContainer) {
      $entries.Add([ordered]@{ path = $relative; type = "directory" })
    }
    else {
      $entries.Add([ordered]@{
        path = $relative
        type = "file"
        length = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.
          ToLowerInvariant()
      })
    }
  }
  $json = $entries | ConvertTo-Json -Depth 5 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  return [Convert]::ToHexString(
    [System.Security.Cryptography.SHA256]::HashData($bytes)
  ).ToLowerInvariant()
}

function Get-ClaudeBaseline {
  return [ordered]@{
    user = Get-TreeFingerprint (Join-Path $HomeDir ".claude")
    project = Get-TreeFingerprint (Join-Path $RepoRoot ".claude")
  }
}

function Assert-ClaudeUnchanged {
  param(
    [Parameter(Mandatory)][System.Collections.IDictionary]$Baseline,
    [Parameter(Mandatory)][string]$Step
  )

  $current = Get-ClaudeBaseline
  if (
    $current.user -ne $Baseline.user -or
    $current.project -ne $Baseline.project
  ) {
    throw (
      "The Harness-owned step '$Step' changed a user or project .claude " +
      "tree. Setup stopped without deleting or restoring user content."
    )
  }
}

function Confirm-SetupItem {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][bool]$PreApproved
  )

  if ($PreApproved) {
    return
  }
  $answer = Read-Host "Approve '$Name'? [y/N]"
  if ($answer -notmatch "^(?i:y|yes)$") {
    throw "Setup approval was declined for '$Name'; no setup action ran."
  }
}

function Assert-ProviderActions {
  param([Parameter(Mandatory)][string]$Value)

  $allowed = @("keep", "later", "skip", "install", "login", "check")
  $assignments = @{}
  foreach ($entry in ($Value -split ",")) {
    $parts = $entry.Trim() -split "=", 2
    if (
      $parts.Count -ne 2 -or
      [string]::IsNullOrWhiteSpace($parts[0]) -or
      $parts[1] -notin $allowed
    ) {
      throw (
        "ProviderActions entries must use provider=action with one of: " +
        ($allowed -join ", ") + "."
      )
    }
    if ($assignments.ContainsKey($parts[0])) {
      throw "ProviderActions contains duplicate provider '$($parts[0])'."
    }
    $assignments[$parts[0]] = $parts[1]
  }
  $names = @($assignments.Keys | Sort-Object)
  if (($names -join ",") -ne "claude,codex,gemini,grok") {
    throw "ProviderActions must name codex, gemini, grok, and claude exactly."
  }
  return $assignments
}

function Assert-CatalogArguments {
  if (-not $CatalogMode) {
    return
  }
  if ($CatalogMode -eq "skip") {
    if ($CatalogPath -or $CatalogUrl -or $AllowCatalogNetwork) {
      throw "CatalogMode skip cannot be combined with catalog path, URL, or network approval."
    }
    return
  }
  if (-not $CatalogPath) {
    throw "CatalogMode $CatalogMode requires -CatalogPath."
  }
  if ($CatalogMode -eq "local" -and ($CatalogUrl -or $AllowCatalogNetwork)) {
    throw "CatalogMode local cannot be combined with catalog URL or network approval."
  }
  if ($CatalogMode -eq "clone") {
    if (-not $CatalogUrl) {
      throw "CatalogMode clone requires -CatalogUrl."
    }
    if (-not $AllowCatalogNetwork) {
      throw "CatalogMode clone requires separate -AllowCatalogNetwork approval."
    }
  }
}

function Read-PluginOwnership {
  param(
    [Parameter(Mandatory)][string]$OwnershipPath,
    [Parameter(Mandatory)][string]$MarketplaceName,
    [Parameter(Mandatory)][string]$MarketplaceRoot,
    [Parameter(Mandatory)][string]$PluginId,
    [string]$PluginName,
    [Parameter(Mandatory)][string]$PluginBaseVersion,
    [Parameter(Mandatory)][string]$PluginVersion,
    [Parameter(Mandatory)][string]$PluginSource
  )

  if (-not (Test-Path -LiteralPath $OwnershipPath)) {
    return $null
  }
  $item = Get-Item -LiteralPath $OwnershipPath -Force
  if (
    $item.Attributes -band [System.IO.FileAttributes]::ReparsePoint -or
    $item.PSIsContainer
  ) {
    throw "Codex plugin ownership must be a regular non-linked file."
  }
  try {
    $ownership = Get-Content -LiteralPath $OwnershipPath -Raw | ConvertFrom-Json
  }
  catch {
    throw "Codex plugin ownership is not valid JSON."
  }
  if (
    $ownership.schemaVersion -ne 1 -or
    $ownership.owner -ne "trellis-ccg-harness" -or
    $ownership.marketplace.name -ne $MarketplaceName -or
    -not (Test-SamePath $ownership.marketplace.sourceRoot $MarketplaceRoot) -or
    $ownership.plugin.id -ne $PluginId -or
    $ownership.plugin.baseVersion -ne $PluginBaseVersion -or
    $ownership.plugin.version -ne $PluginVersion -or
    -not (Test-SamePath $ownership.plugin.sourcePath $PluginSource)
  ) {
    throw "Existing Codex plugin ownership differs from this Harness snapshot."
  }
  return $ownership
}

function Get-CodexPluginState {
  param(
    [Parameter(Mandatory)][string]$MarketplaceName,
    [Parameter(Mandatory)][string]$MarketplaceRoot,
    [Parameter(Mandatory)][string]$PluginId,
    [Parameter(Mandatory)][string]$PluginName,
    [Parameter(Mandatory)][string]$PluginBaseVersion,
    [Parameter(Mandatory)][string]$PluginVersion,
    [Parameter(Mandatory)][string]$PluginSource,
    [string]$OwnershipPath
  )

  $marketplaceResult = Invoke-JsonCommand "codex" @(
    "plugin", "marketplace", "list", "--json"
  ) "Codex marketplace inspection"
  $marketplaces = @($marketplaceResult.marketplaces)
  $namedMarketplaces = @(
    $marketplaces | Where-Object { $_.name -eq $MarketplaceName }
  )
  if ($namedMarketplaces.Count -gt 1) {
    throw "Codex has duplicate marketplaces named '$MarketplaceName'."
  }
  if (
    $namedMarketplaces.Count -eq 1 -and
    -not (Test-SamePath $namedMarketplaces[0].root $MarketplaceRoot)
  ) {
    throw (
      "Codex marketplace '$MarketplaceName' belongs to a different source: " +
      "$($namedMarketplaces[0].root)"
    )
  }

  $pluginResult = Invoke-JsonCommand "codex" @(
    "plugin", "list", "--available", "--json"
  ) "Codex plugin inspection"
  $installedNamed = @(
    @($pluginResult.installed) | Where-Object { $_.name -eq $PluginName }
  )
  $foreignInstalled = @(
    $installedNamed | Where-Object { $_.pluginId -ne $PluginId }
  )
  if ($foreignInstalled.Count -gt 0) {
    throw (
      "Installed Codex plugin '$PluginName' belongs to another marketplace: " +
      (($foreignInstalled.pluginId | Sort-Object) -join ", ")
    )
  }
  if ($installedNamed.Count -gt 1) {
    throw "Codex has duplicate installed plugins named '$PluginName'."
  }
  $installed = if ($installedNamed.Count -eq 1) {
    $installedNamed[0]
  }
  else {
    $null
  }
  if (
    $installed -and (
      $installed.marketplaceName -ne $MarketplaceName -or
      $installed.source.source -ne "local" -or
      -not (Test-CodexPluginReportedVersion `
        -ReportedVersion ([string]$installed.version) `
        -BaseVersion $PluginBaseVersion `
        -PluginVersion $PluginVersion) -or
      -not (Test-SamePath $installed.source.path $PluginSource)
    )
  ) {
    throw "Installed Codex plugin '$PluginId' differs from this Harness snapshot."
  }

  $available = @(
    @($pluginResult.available) |
      Where-Object { $_.pluginId -eq $PluginId }
  )
  if (
    $available.Count -gt 0 -and (
      $available.Count -ne 1 -or
      $available[0].name -ne $PluginName -or
      $available[0].marketplaceName -ne $MarketplaceName -or
      $available[0].source.source -ne "local" -or
      -not (Test-CodexPluginReportedVersion `
        -ReportedVersion ([string]$available[0].version) `
        -BaseVersion $PluginBaseVersion `
        -PluginVersion $PluginVersion) -or
      -not (Test-SamePath $available[0].source.path $PluginSource)
    )
  ) {
    throw "Available Codex plugin '$PluginId' has an unexpected identity."
  }
  return [ordered]@{
    marketplacePresent = $namedMarketplaces.Count -eq 1
    pluginInstalled = $null -ne $installed
  }
}

function Write-PluginOwnership {
  param(
    [Parameter(Mandatory)][string]$OwnershipPath,
    [Parameter(Mandatory)][string]$MarketplaceName,
    [Parameter(Mandatory)][string]$MarketplaceRoot,
    [Parameter(Mandatory)][string]$PluginId,
    [string]$PluginName,
    [Parameter(Mandatory)][string]$PluginBaseVersion,
    [Parameter(Mandatory)][string]$PluginVersion,
    [Parameter(Mandatory)][string]$PluginSource
  )

  $parent = Split-Path -Parent $OwnershipPath
  $canonicalHome = Get-Item -LiteralPath $HomeDir -Force
  if (
    $canonicalHome.Attributes -band [System.IO.FileAttributes]::ReparsePoint -or
    -not $canonicalHome.PSIsContainer
  ) {
    throw "HomeDir must be a real non-linked directory."
  }
  $relativeParent = [System.IO.Path]::GetRelativePath($HomeDir, $parent)
  if ($relativeParent.StartsWith("..") -or [System.IO.Path]::IsPathRooted($relativeParent)) {
    throw "Codex plugin ownership escapes HomeDir."
  }
  $currentParent = $HomeDir
  foreach ($segment in ($relativeParent -split "[/\\]" | Where-Object { $_ })) {
    $currentParent = Join-Path $currentParent $segment
    if (Test-Path -LiteralPath $currentParent) {
      $item = Get-Item -LiteralPath $currentParent -Force
      if (
        $item.Attributes -band [System.IO.FileAttributes]::ReparsePoint -or
        -not $item.PSIsContainer
      ) {
        throw "Codex plugin ownership parent is linked or not a directory: $currentParent"
      }
    }
    else {
      New-Item -ItemType Directory -Path $currentParent | Out-Null
    }
  }
  $temporary = Join-Path $parent (
    ".codex-plugin-" + [Guid]::NewGuid().ToString("N") + ".tmp"
  )
  $payload = [ordered]@{
    schemaVersion = 1
    owner = "trellis-ccg-harness"
    marketplace = [ordered]@{
      name = $MarketplaceName
      sourceRoot = Get-NormalizedPath $MarketplaceRoot
    }
    plugin = [ordered]@{
      id = $PluginId
      baseVersion = $PluginBaseVersion
      version = $PluginVersion
      sourcePath = Get-NormalizedPath $PluginSource
    }
  }
  try {
    [System.IO.File]::WriteAllText(
      $temporary,
      (($payload | ConvertTo-Json -Depth 6) + [Environment]::NewLine),
      [System.Text.UTF8Encoding]::new($false)
    )
    [System.IO.File]::Move($temporary, $OwnershipPath, $false)
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Install-CodexPlugin {
  param(
    [Parameter(Mandatory)][System.Collections.IDictionary]$Identity,
    [Parameter(Mandatory)][System.Collections.IDictionary]$InitialState
  )

  try {
    if (-not $InitialState.marketplacePresent) {
      Invoke-JsonCommand "codex" @(
        "plugin", "marketplace", "add", $Identity.marketplaceRoot, "--json"
      ) "Codex local marketplace installation" | Out-Null
      $script:PluginMarketplaceAdded = $true
    }
    $afterMarketplace = Get-CodexPluginState @Identity
    if (-not $afterMarketplace.pluginInstalled) {
      Invoke-JsonCommand "codex" @(
        "plugin", "add", $Identity.pluginId, "--json"
      ) "Codex CCG plugin installation" | Out-Null
      $script:PluginInstalled = $true
    }
    $verified = Get-CodexPluginState @Identity
    if (-not $verified.marketplacePresent -or -not $verified.pluginInstalled) {
      throw "Codex CCG plugin verification did not reach the installed state."
    }
    if (-not (Test-Path -LiteralPath $Identity.ownershipPath)) {
      Write-PluginOwnership @Identity
    }
  }
  catch {
    $failure = $_
    if ($script:PluginInstalled) {
      & codex plugin remove $Identity.pluginId --json 2>&1 | Out-Null
    }
    if ($script:PluginMarketplaceAdded) {
      & codex plugin marketplace remove $Identity.marketplaceName --json 2>&1 |
        Out-Null
    }
    throw $failure
  }
}

function Assert-GlobalSkillProjection {
  $manifestPath = Join-Path $HomeDir ".agents/harness/global-skills.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Global Init did not create the global platform Skill manifest."
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $skills = @($manifest.managedPlatformSkills)
  if (
    $manifest.owner -ne "trellis-ccg-harness" -or
    $manifest.installMode -ne "copy" -or
    $skills.Count -ne 13
  ) {
    throw "Global Init did not verify exactly 13 owned platform Skills."
  }
  foreach ($skill in $skills) {
    if (-not (Test-Path -LiteralPath $skill.targetPath -PathType Container)) {
      throw "Global platform Skill is missing after setup: $($skill.name)"
    }
  }
  return $manifestPath
}

function Show-PendingProviderActions {
  param(
    [object]$Result,
    [string]$HomeDir,
    [string]$RepoRoot
  )

  $pending = @($Result.pendingProviderActions)
  if ($pending.Count -eq 0) {
    Write-Output "Provider actions: no install/login action is pending."
    return
  }
  Write-Output ""
  Write-Output "Provider actions requiring a separate future approval:"
  foreach ($action in $pending) {
    $guidance = if ($action.guidance.command) {
      @($action.guidance.command) -join " "
    }
    else {
      [string]$action.guidance.reference
    }
    Write-Output (
      "  - $($action.provider): $($action.action); status=$($action.status); " +
      "not executed; guidance=$guidance"
    )
    Write-Output (
      "    Review plan: node `"$RepoRoot/scripts/harness-init.mjs`" " +
      "provider-action-plan --home-dir `"$HomeDir`" --repo-root `"$RepoRoot`" " +
      "--provider $($action.provider) --action $($action.action)"
    )
    if (
      $action.action -eq "login" -and
      $action.provider -in @("codex", "grok")
    ) {
      Write-Output (
        "    After reviewing planSha256, show manual guidance with a second explicit approval: " +
        "node `"$RepoRoot/scripts/harness-init.mjs`" provider-action-run " +
        "--home-dir `"$HomeDir`" --repo-root `"$RepoRoot`" " +
        "--provider $($action.provider) --action login " +
        "--plan-sha256 <planSha256> --approved"
      )
    }
    else {
      Write-Output "    Harness execution: manual-only; follow the official guidance above."
    }
  }
  if (@($pending | Where-Object { $_.provider -eq "claude" }).Count -gt 0) {
    Write-Output (
      "  Claude install/login is outside the zero-.claude profile and remains " +
      "unexecuted."
    )
  }
}

$RepoRoot = Get-NormalizedPath $RepoRoot
$HomeDir = Get-NormalizedPath $HomeDir
Assert-NotFilesystemRoot $RepoRoot "RepoRoot"
Assert-NotFilesystemRoot $HomeDir "HomeDir"
Assert-RealDirectory $RepoRoot "RepoRoot"
Assert-RealDirectory $HomeDir "HomeDir"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ is required."
}
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  throw (
    "Codex CLI is required for the exact local plugin install. Provider CLI " +
    "installation is a separate action; install Codex, then rerun setup."
  )
}

Assert-CatalogArguments
$parsedProviderActions = if ($ProviderActions) {
  Assert-ProviderActions $ProviderActions
}
else {
  $null
}
if ($NonInteractive) {
  if (-not $PSBoundParameters.ContainsKey("HomeDir")) {
    throw "Non-interactive setup requires an explicit -HomeDir."
  }
  if (-not $CatalogMode) {
    throw "Non-interactive setup requires -CatalogMode."
  }
  if (-not $ProviderActions) {
    throw "Non-interactive setup requires -ProviderActions."
  }
  if (
    -not $PreviewOnly -and (
      -not $Approved -or
      -not $ApproveTrellis -or
      -not $ApproveCcgCli -or
      -not $ApproveCodexMode -or
      -not $ApproveCcgPlugin -or
      -not $ApproveGlobalInit
    )
  ) {
    throw (
      "Non-interactive setup requires -Approved and every explicit core " +
      "approval flag: -ApproveTrellis, -ApproveCcgCli, -ApproveCodexMode, " +
      "-ApproveCcgPlugin, and -ApproveGlobalInit."
    )
  }
}

$savedEnvironment = [ordered]@{
  HOME = $env:HOME
  USERPROFILE = $env:USERPROFILE
  CODEX_HOME = $env:CODEX_HOME
}
try {
  $env:HOME = $HomeDir
  $env:USERPROFILE = $HomeDir
  $env:CODEX_HOME = Join-Path $HomeDir ".codex"
  $claudeBaseline = Get-ClaudeBaseline

$sourceManifestPath = Join-Path $RepoRoot "harness.sources.json"
$sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw |
  ConvertFrom-Json
$requiredTrellisVersion = [string]$sourceManifest.trellis.version
$requiredCcgVersion = [string]$sourceManifest.ccg.version
if ($requiredCcgVersion -ne "3.3.2") {
  throw (
    "Public setup requires the Harness-recorded CCG 3.3.2 snapshot; found " +
    "'$requiredCcgVersion'."
  )
}
$ccgRoot = Get-NormalizedPath (
  Join-Path $RepoRoot ([string]$sourceManifest.ccg.snapshotPath)
)
Assert-RealDirectory $ccgRoot "Recorded CCG snapshot"
$relativeCcgRoot = [System.IO.Path]::GetRelativePath($RepoRoot, $ccgRoot)
if (
  $relativeCcgRoot.StartsWith("..") -or
  [System.IO.Path]::IsPathRooted($relativeCcgRoot)
) {
  throw "The recorded CCG snapshot path escapes RepoRoot."
}
$ccgPackage = Get-Content -LiteralPath (Join-Path $ccgRoot "package.json") -Raw |
  ConvertFrom-Json
$marketplace = Get-Content -LiteralPath (
  Join-Path $ccgRoot ".codex-plugin/marketplace.json"
) -Raw | ConvertFrom-Json
$plugins = @($marketplace.plugins | Where-Object { $_.name -eq "ccg" })
if (
  [string]$sourceManifest.ccg.package -ne "ccg-workflow" -or
  [string]$ccgPackage.name -ne [string]$sourceManifest.ccg.package -or
  [string]$ccgPackage.version -ne $requiredCcgVersion -or
  $plugins.Count -ne 1 -or
  [string]$plugins[0].version -ne $requiredCcgVersion
) {
  throw (
    "Harness, CCG package, and Codex marketplace package identity and base " +
    "version must match exactly."
  )
}
$marketplaceName = [string]$marketplace.name
if ($marketplaceName -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]*$") {
  throw "Codex marketplace name is not a safe plugin selector."
}
$pluginId = "ccg@$marketplaceName"
$pluginSource = Get-NormalizedPath (
  Join-Path $ccgRoot ([string]$plugins[0].source)
)
Assert-RealDirectory $pluginSource "Codex plugin source"
$relativePluginSource = [System.IO.Path]::GetRelativePath($ccgRoot, $pluginSource)
if (
  $relativePluginSource.StartsWith("..") -or
  [System.IO.Path]::IsPathRooted($relativePluginSource)
) {
  throw "Codex plugin source escapes the recorded CCG snapshot."
}
$pluginManifestPath = Join-Path $pluginSource ".codex-plugin/plugin.json"
if (-not (Test-Path -LiteralPath $pluginManifestPath -PathType Leaf)) {
  throw "Codex plugin manifest is missing from the recorded CCG snapshot."
}
$pluginManifest = Get-Content -LiteralPath $pluginManifestPath -Raw |
  ConvertFrom-Json
$pluginVersion = [string]$pluginManifest.version
$pluginVersionPattern = (
  "^" + [regex]::Escape($requiredCcgVersion) + "\+codex\.[0-9]+$"
)
if (
  [string]$pluginManifest.name -ne "ccg" -or
  $pluginVersion -notmatch $pluginVersionPattern
) {
  throw (
    "Codex plugin manifest version must be the matching " +
    "$requiredCcgVersion+codex.<build> identity."
  )
}
$pluginIdentity = [ordered]@{
  marketplaceName = $marketplaceName
  marketplaceRoot = $ccgRoot
  pluginId = $pluginId
  pluginName = "ccg"
  pluginBaseVersion = $requiredCcgVersion
  pluginVersion = $pluginVersion
  pluginSource = $pluginSource
}
$ownershipPath = Join-Path $HomeDir ".agents/harness/codex-plugin.json"
$ownership = Read-PluginOwnership `
  -OwnershipPath $ownershipPath `
  -MarketplaceName $marketplaceName `
  -MarketplaceRoot $ccgRoot `
  -PluginId $pluginId `
  -PluginBaseVersion $requiredCcgVersion `
  -PluginVersion $pluginVersion `
  -PluginSource $pluginSource
$pluginState = Get-CodexPluginState @pluginIdentity
Assert-ClaudeUnchanged $claudeBaseline "Codex plugin preflight"
$pluginIdentity.ownershipPath = $ownershipPath

$currentTrellisVersion = Get-CommandVersion "trellis"
$currentCcgVersion = Get-CommandVersion "ccg"
Assert-ClaudeUnchanged $claudeBaseline "CLI version preflight"
$catalogPreview = if ($CatalogMode) {
  $CatalogMode
}
else {
  "interactive choice (skip recommended)"
}
$providerPreview = if ($ProviderActions) {
  $ProviderActions
}
else {
  "interactive status-based choices (Claude skip recommended)"
}

Write-Output "Harness Global Setup preview"
Write-Output "  User home: $HomeDir"
Write-Output (
  "  Trellis: install/verify $requiredTrellisVersion " +
  "(current: $($currentTrellisVersion ?? 'missing'))"
)
Write-Output (
  "  CCG CLI: build/link exact $requiredCcgVersion snapshot " +
  "(current: $($currentCcgVersion ?? 'missing'))"
)
Write-Output (
  "  Codex plugin: $pluginId@$pluginVersion from local snapshot $ccgRoot " +
  "(installed: $($pluginState.pluginInstalled))"
)
Write-Output (
  "  Codex mode: after plugin registration run 'ccg codex-mode install' " +
  "(never legacy 'ccg init')"
)
Write-Output "  Platform Skills: Global Init will install/verify 13 bundled copies"
Write-Output "  Personal Skill catalog: $catalogPreview"
Write-Output (
  "  Catalog network: $($AllowCatalogNetwork.IsPresent); " +
  "third-party network: $($AllowThirdPartyNetwork.IsPresent) " +
  "(otherwise separately prompted, default no, only after candidate selection)"
)
Write-Output "  Provider status/actions: $providerPreview"
Write-Output (
  "  Provider install/login selections are guidance only and require a " +
  "separate later approval."
)
Write-Output (
  "  .claude guard: compare user and project trees after every Harness-owned step"
)

if ($PreviewOnly) {
  Write-Output "Preview complete; no setup action ran."
  return
}

if (-not $NonInteractive) {
  Confirm-SetupItem "Trellis $requiredTrellisVersion" $ApproveTrellis.IsPresent
  Confirm-SetupItem "CCG CLI $requiredCcgVersion" $ApproveCcgCli.IsPresent
  Confirm-SetupItem "Codex plugin $pluginId from the local snapshot" `
    $ApproveCcgPlugin.IsPresent
  Confirm-SetupItem "ccg codex-mode install" $ApproveCodexMode.IsPresent
  Confirm-SetupItem "Global Init and 13 bundled platform Skills" `
    $ApproveGlobalInit.IsPresent
}

  & (Join-Path $RepoRoot "scripts/bootstrap.ps1") `
    -RepoRoot $RepoRoot `
    -LinkCcg
  if ($LASTEXITCODE -ne 0) {
    throw "Harness bootstrap failed with exit code $LASTEXITCODE."
  }
  Assert-ClaudeUnchanged $claudeBaseline "bootstrap"

  $installedTrellisVersion = Get-CommandVersion "trellis"
  $installedCcgVersion = Get-CommandVersion "ccg"
  if ($installedTrellisVersion -ne $requiredTrellisVersion) {
    throw (
      "Installed Trellis version mismatch: expected $requiredTrellisVersion, " +
      "found $installedTrellisVersion."
    )
  }
  if ($installedCcgVersion -ne $requiredCcgVersion) {
    throw (
      "Installed CCG version mismatch: expected $requiredCcgVersion, " +
      "found $installedCcgVersion."
    )
  }

  $pluginFailure = $null
  try {
    Install-CodexPlugin -Identity $pluginIdentity -InitialState $pluginState
  }
  catch {
    $pluginFailure = $_
  }
  Assert-ClaudeUnchanged $claudeBaseline "Codex CCG plugin installation"
  if ($null -ne $pluginFailure) {
    throw $pluginFailure
  }

  # Codex plugin registration updates config.toml. Install Codex mode after the
  # plugin so its ownership digest records the converged final configuration.
  $codexModeFailure = $null
  try {
    Invoke-CheckedCommand "ccg" @("codex-mode", "install") `
      "CCG Codex mode installation"
  }
  catch {
    $codexModeFailure = $_
  }
  Assert-ClaudeUnchanged $claudeBaseline "ccg codex-mode install"
  if ($null -ne $codexModeFailure) {
    throw $codexModeFailure
  }

  $globalArguments = @(
    (Join-Path $RepoRoot "scripts/harness-init.mjs"),
    "global-init",
    "--home-dir",
    $HomeDir
  )
  if ($CatalogMode) {
    $globalArguments += @("--catalog-mode", $CatalogMode)
  }
  if ($CatalogPath) {
    $globalArguments += @("--repository", (Get-NormalizedPath $CatalogPath))
  }
  if ($CatalogUrl) {
    $globalArguments += @("--catalog-url", $CatalogUrl)
  }
  if ($AllowCatalogNetwork) {
    $globalArguments += "--allow-catalog-network"
  }
  if ($AllowThirdPartyNetwork) {
    $globalArguments += "--allow-third-party-network"
  }
  if ($ProviderActions) {
    $globalArguments += @("--provider-actions", $ProviderActions)
  }
  if ($NonInteractive) {
    # The approval receipt is explicit even when every optional candidate is
    # declined.  Resolve the digest through the pinned Harness plan instead of
    # duplicating a mutable value in this installer.
    $thirdPartySourceSha256 = Get-ThirdPartySourceSha256 `
      -HarnessInitPath (Join-Path $RepoRoot "scripts/harness-init.mjs") `
      -ApprovedHomeDir $HomeDir
    $globalArguments += @(
      "--third-party-global-skills",
      "none",
      "--third-party-global-plugins",
      "none",
      "--third-party-mcp-cli",
      "none",
      "--third-party-source-sha256",
      $thirdPartySourceSha256
    )
    $globalArguments += @("--non-interactive", "--approved")
    $globalOutput = @(& node @globalArguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "Global Init failed: $($globalOutput -join [Environment]::NewLine)"
    }
    try {
      $globalResult = ($globalOutput -join [Environment]::NewLine) |
        ConvertFrom-Json
    }
    catch {
      throw "Global Init did not return valid JSON."
    }
    Write-Output ($globalResult | ConvertTo-Json -Depth 12)
  }
  else {
    & node @globalArguments
    if ($LASTEXITCODE -ne 0) {
      throw "Global Init failed with exit code $LASTEXITCODE."
    }
    $globalStatePath = Join-Path $HomeDir ".agents/harness/global-init.json"
    $globalState = Get-Content -LiteralPath $globalStatePath -Raw |
      ConvertFrom-Json
    $globalResult = [ordered]@{
      pendingProviderActions = @($globalState.pendingProviderActions)
    }
  }
  Assert-ClaudeUnchanged $claudeBaseline "Global Init"
  $platformManifestPath = Assert-GlobalSkillProjection
  Show-PendingProviderActions $globalResult $HomeDir $RepoRoot

  Write-Output ""
  Write-Output "Global Setup complete."
  Write-Output "  Platform Skill ownership: $platformManifestPath"
  Write-Output "  Codex plugin ownership: $ownershipPath"
  Write-Output "  .claude state: unchanged"
}
finally {
  $env:HOME = $savedEnvironment.HOME
  $env:USERPROFILE = $savedEnvironment.USERPROFILE
  $env:CODEX_HOME = $savedEnvironment.CODEX_HOME
}
