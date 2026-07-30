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
  [switch]$PluginOnly,
  [ValidateSet("skip", "local", "clone")]
  [string]$CatalogMode,
  [string]$CatalogPath,
  [string]$CatalogUrl,
  [string]$ProviderActions,
  [string]$CcgSourceCheckout,
  [switch]$AllowCatalogNetwork,
  [switch]$AllowThirdPartyNetwork,
  [switch]$PreviewOnly
)

$ErrorActionPreference = "Stop"

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
  $ownershipBytes = [System.IO.File]::ReadAllBytes($OwnershipPath)
  try {
    $ownership = [System.Text.Encoding]::UTF8.GetString($ownershipBytes) |
      ConvertFrom-Json
  }
  catch {
    throw "Codex plugin ownership is not valid JSON."
  }
  if (
    $ownership.schemaVersion -ne 1 -or
    $ownership.owner -ne "trellis-ccg-harness" -or
    $ownership.marketplace.name -ne $MarketplaceName -or
    $ownership.plugin.id -ne $PluginId
  ) {
    throw "Existing Codex plugin ownership is not owned by this Harness."
  }
  $ownedMarketplaceRoot = [string]$ownership.marketplace.sourceRoot
  $ownedPluginBaseVersion = [string]$ownership.plugin.baseVersion
  $ownedPluginVersion = [string]$ownership.plugin.version
  $ownedPluginSource = [string]$ownership.plugin.sourcePath
  if (
    -not [System.IO.Path]::IsPathFullyQualified($ownedMarketplaceRoot) -or
    -not [System.IO.Path]::IsPathFullyQualified($ownedPluginSource) -or
    $ownedPluginBaseVersion -notmatch
      '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$' -or
    $ownedPluginVersion -notmatch (
      "^" + [regex]::Escape($ownedPluginBaseVersion) + "\+codex\.[0-9]+$"
    )
  ) {
    throw "Existing Codex plugin ownership has an invalid immutable identity."
  }
  $ownedMarketplaceRoot = Get-NormalizedPath $ownedMarketplaceRoot
  $ownedPluginSource = Get-NormalizedPath $ownedPluginSource
  Assert-NotFilesystemRoot $ownedMarketplaceRoot "Owned Codex marketplace source"
  $expectedOwnedPluginSource = Get-NormalizedPath (
    Join-Path $ownedMarketplaceRoot "plugins/ccg"
  )
  if (-not (Test-SamePath $ownedPluginSource $expectedOwnedPluginSource)) {
    throw "Existing Codex plugin ownership has an unsafe plugin source path."
  }
  $matchesTarget = (
    (Test-SamePath $ownedMarketplaceRoot $MarketplaceRoot) -and
    $ownedPluginBaseVersion -eq $PluginBaseVersion -and
    $ownedPluginVersion -eq $PluginVersion -and
    (Test-SamePath $ownedPluginSource $PluginSource)
  )
  $ownershipSha256 = [Convert]::ToHexString(
    [System.Security.Cryptography.SHA256]::HashData($ownershipBytes)
  ).ToLowerInvariant()
  return [ordered]@{
    record = $ownership
    matchesTarget = $matchesTarget
    sha256 = $ownershipSha256
    identity = [ordered]@{
      marketplaceName = $MarketplaceName
      marketplaceRoot = $ownedMarketplaceRoot
      pluginId = $PluginId
      pluginName = $PluginName
      pluginBaseVersion = $ownedPluginBaseVersion
      pluginVersion = $ownedPluginVersion
      pluginSource = $ownedPluginSource
    }
  }
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
    [string]$OwnershipPath,
    [System.Collections.IDictionary]$AllowedPreviousIdentity
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
  $marketplaceMatchesTarget = (
    $namedMarketplaces.Count -eq 1 -and
    (Test-SamePath $namedMarketplaces[0].root $MarketplaceRoot)
  )
  $marketplaceMatchesPrevious = (
    $null -ne $AllowedPreviousIdentity -and
    $namedMarketplaces.Count -eq 1 -and
    (Test-SamePath `
      $namedMarketplaces[0].root `
      $AllowedPreviousIdentity.marketplaceRoot)
  )
  if (
    $namedMarketplaces.Count -eq 1 -and
    -not $marketplaceMatchesTarget -and
    -not $marketplaceMatchesPrevious
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
  $installedMatchesTarget = (
    $installed -and
    $installed.marketplaceName -eq $MarketplaceName -and
    $installed.source.source -eq "local" -and
    (Test-CodexPluginReportedVersion `
      -ReportedVersion ([string]$installed.version) `
      -BaseVersion $PluginBaseVersion `
      -PluginVersion $PluginVersion) -and
    (Test-SamePath $installed.source.path $PluginSource)
  )
  $installedMatchesPrevious = (
    $installed -and
    $null -ne $AllowedPreviousIdentity -and
    $installed.marketplaceName -eq $AllowedPreviousIdentity.marketplaceName -and
    $installed.source.source -eq "local" -and
    (Test-CodexPluginReportedVersion `
      -ReportedVersion ([string]$installed.version) `
      -BaseVersion $AllowedPreviousIdentity.pluginBaseVersion `
      -PluginVersion $AllowedPreviousIdentity.pluginVersion) -and
    (Test-SamePath $installed.source.path $AllowedPreviousIdentity.pluginSource)
  )
  if ($installed -and -not $installedMatchesTarget -and -not $installedMatchesPrevious) {
    throw "Installed Codex plugin '$PluginId' differs from this Harness snapshot."
  }
  if (
    $installedMatchesTarget -and
    $namedMarketplaces.Count -eq 1 -and
    -not $marketplaceMatchesTarget
  ) {
    throw "Installed Codex plugin '$PluginId' has mismatched marketplace ownership."
  }
  if (
    $installedMatchesPrevious -and
    $namedMarketplaces.Count -eq 1 -and
    -not $marketplaceMatchesPrevious
  ) {
    throw "Installed Codex plugin '$PluginId' has mismatched marketplace ownership."
  }

  $available = @(
    @($pluginResult.available) |
      Where-Object { $_.pluginId -eq $PluginId }
  )
  $availableMatchesTarget = (
    $available.Count -eq 1 -and
    $available[0].name -eq $PluginName -and
    $available[0].marketplaceName -eq $MarketplaceName -and
    $available[0].source.source -eq "local" -and
    (Test-CodexPluginReportedVersion `
      -ReportedVersion ([string]$available[0].version) `
      -BaseVersion $PluginBaseVersion `
      -PluginVersion $PluginVersion) -and
    (Test-SamePath $available[0].source.path $PluginSource)
  )
  $availableMatchesPrevious = (
    $available.Count -eq 1 -and
    $null -ne $AllowedPreviousIdentity -and
    $available[0].name -eq $AllowedPreviousIdentity.pluginName -and
    $available[0].marketplaceName -eq $AllowedPreviousIdentity.marketplaceName -and
    $available[0].source.source -eq "local" -and
    (Test-CodexPluginReportedVersion `
      -ReportedVersion ([string]$available[0].version) `
      -BaseVersion $AllowedPreviousIdentity.pluginBaseVersion `
      -PluginVersion $AllowedPreviousIdentity.pluginVersion) -and
    (Test-SamePath `
      $available[0].source.path `
      $AllowedPreviousIdentity.pluginSource)
  )
  if (
    $available.Count -gt 0 -and
    -not $availableMatchesTarget -and
    -not $availableMatchesPrevious
  ) {
    throw "Available Codex plugin '$PluginId' has an unexpected identity."
  }
  $activeIdentity = if ($installedMatchesTarget) {
    "target"
  }
  elseif ($installedMatchesPrevious) {
    "previous"
  }
  elseif ($marketplaceMatchesTarget -and -not $marketplaceMatchesPrevious) {
    "target"
  }
  elseif ($marketplaceMatchesPrevious -and -not $marketplaceMatchesTarget) {
    "previous"
  }
  elseif ($marketplaceMatchesTarget) {
    "target"
  }
  else {
    "absent"
  }
  return [ordered]@{
    marketplacePresent = $namedMarketplaces.Count -eq 1
    pluginInstalled = $null -ne $installed
    activeIdentity = $activeIdentity
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
    [Parameter(Mandatory)][string]$PluginSource,
    [string]$ExpectedSha256
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
    if (Test-Path -LiteralPath $OwnershipPath) {
      if (-not $ExpectedSha256) {
        throw "Codex plugin ownership appeared during setup."
      }
      $currentSha256 = (Get-FileHash `
        -LiteralPath $OwnershipPath `
        -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($currentSha256 -ne $ExpectedSha256) {
        throw "Codex plugin ownership changed concurrently during setup."
      }
      $backup = Join-Path $parent (
        ".codex-plugin-" + [Guid]::NewGuid().ToString("N") + ".bak"
      )
      try {
        [System.IO.File]::Replace($temporary, $OwnershipPath, $backup, $true)
      }
      finally {
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
      }
    }
    else {
      if ($ExpectedSha256) {
        throw "Codex plugin ownership disappeared during setup."
      }
      [System.IO.File]::Move($temporary, $OwnershipPath, $false)
    }
  }
  finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

function Install-CodexPlugin {
  param(
    [Parameter(Mandatory)][System.Collections.IDictionary]$Identity,
    [Parameter(Mandatory)][System.Collections.IDictionary]$InitialState,
    [System.Collections.IDictionary]$OwnershipState
  )

  $previousIdentity = if (
    $null -ne $OwnershipState -and
    -not $OwnershipState.matchesTarget
  ) {
    $OwnershipState.identity
  }
  else {
    $null
  }
  $targetMarketplaceAdded = $false
  $targetPluginInstalled = $false
  $previousMarketplaceRemoved = $false
  $previousPluginRemoved = $false
  try {
    if ($null -ne $OwnershipState) {
      $currentOwnershipSha256 = (Get-FileHash `
        -LiteralPath $Identity.ownershipPath `
        -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($currentOwnershipSha256 -ne $OwnershipState.sha256) {
        throw "Codex plugin ownership changed concurrently during setup."
      }
    }
    $currentState = Get-CodexPluginState `
      @Identity `
      -AllowedPreviousIdentity $previousIdentity
    if ($currentState.activeIdentity -eq "previous") {
      if (
        (Test-SamePath `
          $previousIdentity.marketplaceRoot `
          $Identity.marketplaceRoot)
      ) {
        throw (
          "Owned Codex plugin upgrade requires a distinct immutable previous " +
          "source so rollback remains possible."
        )
      }
      Assert-RealDirectory `
        $previousIdentity.marketplaceRoot `
        "Previous owned Codex marketplace source"
      Assert-RealDirectory `
        $previousIdentity.pluginSource `
        "Previous owned Codex plugin source"
      $previousMarketplaceManifest = Get-Content -LiteralPath (
        Join-Path $previousIdentity.marketplaceRoot ".codex-plugin/marketplace.json"
      ) -Raw | ConvertFrom-Json
      $previousPluginManifest = Get-Content -LiteralPath (
        Join-Path $previousIdentity.pluginSource ".codex-plugin/plugin.json"
      ) -Raw | ConvertFrom-Json
      $previousMarketplacePlugins = @(
        $previousMarketplaceManifest.plugins |
          Where-Object { $_.name -eq $previousIdentity.pluginName }
      )
      if (
        $previousMarketplaceManifest.name -ne
          $previousIdentity.marketplaceName -or
        $previousMarketplacePlugins.Count -ne 1 -or
        $previousMarketplacePlugins[0].version -ne
          $previousIdentity.pluginBaseVersion -or
        -not (Test-SamePath `
          (Join-Path `
            $previousIdentity.marketplaceRoot `
            ([string]$previousMarketplacePlugins[0].source)) `
          $previousIdentity.pluginSource) -or
        $previousPluginManifest.name -ne $previousIdentity.pluginName -or
        $previousPluginManifest.version -ne $previousIdentity.pluginVersion
      ) {
        throw "Previous owned Codex plugin source no longer matches ownership."
      }
      if ($currentState.pluginInstalled) {
        Invoke-JsonCommand "codex" @(
          "plugin", "remove", $previousIdentity.pluginId, "--json"
        ) "Previous Codex plugin removal" | Out-Null
        $previousPluginRemoved = $true
      }
      if ($currentState.marketplacePresent) {
        Invoke-JsonCommand "codex" @(
          "plugin", "marketplace", "remove",
          $previousIdentity.marketplaceName, "--json"
        ) "Previous Codex marketplace removal" | Out-Null
        $previousMarketplaceRemoved = $true
      }
    }
    $targetState = Get-CodexPluginState `
      @Identity `
      -AllowedPreviousIdentity $previousIdentity
    if (-not $targetState.marketplacePresent) {
      Invoke-JsonCommand "codex" @(
        "plugin", "marketplace", "add", $Identity.marketplaceRoot, "--json"
      ) "Codex local marketplace installation" | Out-Null
      $targetMarketplaceAdded = $true
    }
    $afterMarketplace = Get-CodexPluginState @Identity
    if (-not $afterMarketplace.pluginInstalled) {
      Invoke-JsonCommand "codex" @(
        "plugin", "add", $Identity.pluginId, "--json"
      ) "Codex CCG plugin installation" | Out-Null
      $targetPluginInstalled = $true
    }
    $verified = Get-CodexPluginState @Identity
    if (-not $verified.marketplacePresent -or -not $verified.pluginInstalled) {
      throw "Codex CCG plugin verification did not reach the installed state."
    }
    if (
      -not (Test-Path -LiteralPath $Identity.ownershipPath) -or
      ($null -ne $OwnershipState -and -not $OwnershipState.matchesTarget)
    ) {
      $ownershipArguments = @{}
      foreach ($key in $Identity.Keys) {
        $ownershipArguments[$key] = $Identity[$key]
      }
      if ($null -ne $OwnershipState) {
        $ownershipArguments.ExpectedSha256 = $OwnershipState.sha256
      }
      Write-PluginOwnership @ownershipArguments
    }
  }
  catch {
    $failure = $_
    $rollbackErrors = [System.Collections.Generic.List[string]]::new()
    if ($targetPluginInstalled) {
      try {
        Invoke-JsonCommand "codex" @(
          "plugin", "remove", $Identity.pluginId, "--json"
        ) "Target Codex plugin rollback" | Out-Null
      }
      catch {
        $rollbackErrors.Add($_.Exception.Message)
      }
    }
    if ($targetMarketplaceAdded) {
      try {
        Invoke-JsonCommand "codex" @(
          "plugin", "marketplace", "remove",
          $Identity.marketplaceName, "--json"
        ) "Target Codex marketplace rollback" | Out-Null
      }
      catch {
        $rollbackErrors.Add($_.Exception.Message)
      }
    }
    if ($previousMarketplaceRemoved) {
      try {
        Invoke-JsonCommand "codex" @(
          "plugin", "marketplace", "add",
          $previousIdentity.marketplaceRoot, "--json"
        ) "Previous Codex marketplace rollback" | Out-Null
      }
      catch {
        $rollbackErrors.Add($_.Exception.Message)
      }
    }
    if ($previousPluginRemoved) {
      try {
        Invoke-JsonCommand "codex" @(
          "plugin", "add", $previousIdentity.pluginId, "--json"
        ) "Previous Codex plugin rollback" | Out-Null
      }
      catch {
        $rollbackErrors.Add($_.Exception.Message)
      }
    }
    if ($rollbackErrors.Count -gt 0) {
      throw (
        "$($failure.Exception.Message) Plugin rollback also failed: " +
        ($rollbackErrors -join " | ")
      )
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
  $directOwnership = (
    $manifest.schemaVersion -eq 1 -and
    $manifest.installMode -eq "copy"
  )
  $migrationOwnership = (
    $manifest.schemaVersion -in @(1, 2) -and
    -not $manifest.installMode -and
    [string]$manifest.profileSha256 -match "^[a-f0-9]{64}$" -and
    [string]$manifest.backupId -match "^[A-Za-z0-9_.:-]+$"
  )
  $requiredSkills = @(
    "chatgpt-pro-sidebar",
    "grill-with-docs",
    "harness-init",
    "trellis-before-dev",
    "trellis-brainstorm",
    "trellis-break-loop",
    "trellis-channel",
    "trellis-check",
    "trellis-continue",
    "trellis-finish-work",
    "trellis-meta",
    "trellis-session-insight",
    "trellis-spec-bootstrap",
    "trellis-start",
    "trellis-update-spec"
  )
  $skillNames = @($skills | ForEach-Object { [string]$_.name })
  $missingOrDuplicate = @(
    $requiredSkills |
      Where-Object {
        $requiredName = $_
        @($skillNames | Where-Object { $_ -eq $requiredName }).Count -ne 1
      }
  )
  $unexpected = @(
    $skillNames |
      Where-Object { $_ -notin $requiredSkills -and $_ -ne "grill-me" }
  )
  $legacyGrillMeCount = @(
    $skillNames | Where-Object { $_ -eq "grill-me" }
  ).Count
  if (
    $manifest.owner -ne "trellis-ccg-harness" -or
    (-not $directOwnership -and -not $migrationOwnership) -or
    $missingOrDuplicate.Count -gt 0 -or
    $unexpected.Count -gt 0 -or
    $legacyGrillMeCount -gt 1 -or
    $skills.Count -notin @(15, 16)
  ) {
    throw (
      "Global Init did not verify the 15 required platform Skills " +
      "(plus at most one supported legacy grill-me projection)."
    )
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

function Show-PendingRecommendedAddons {
  param(
    [string]$HomeDir,
    [string]$RepoRoot
  )

  try {
    $output = @(
      & node (Join-Path $RepoRoot "scripts/harness-init.mjs") `
        "addons" "--status" `
        "--home-dir" $HomeDir `
        "--repo-root" $RepoRoot 2>&1
    )
    if ($LASTEXITCODE -ne 0) {
      Write-Warning (
        "Recommended add-on status could not be inspected; core setup remains " +
        "complete. Run 'pnpm addons' later. Details: " +
        ($output -join [Environment]::NewLine)
      )
      return
    }
    $status = ($output -join [Environment]::NewLine) | ConvertFrom-Json
    $pending = @(
      $status.candidates |
        Where-Object {
          $_.recommended -eq $true -and $_.status -ne "installed"
        }
    )
    if ($pending.Count -eq 0) {
      return
    }
    Write-Output ""
    Write-Output (
      "Recommended optional add-ons remain uninstalled or need attention " +
      "(recommended does not mean selected):"
    )
    foreach ($candidate in $pending) {
      Write-Output (
        "  - $($candidate.name): status=$($candidate.status); " +
        "default=skip"
      )
    }
    Write-Output "  Run 'pnpm addons' from $RepoRoot to review or install them."
  }
  catch {
    Write-Warning (
      "Recommended add-on status could not be inspected; core setup remains " +
      "complete. Run 'pnpm addons' later. Details: $($_.Exception.Message)"
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
  if ($PluginOnly) {
    if (
      -not $PreviewOnly -and (
        -not $Approved -or
        -not $ApproveCcgPlugin -or
        -not $ApproveCodexMode
      )
    ) {
      throw (
        "Non-interactive plugin-only setup requires -Approved, " +
        "-ApproveCcgPlugin, and -ApproveCodexMode."
      )
    }
  }
  elseif (-not $CatalogMode -or -not $ProviderActions) {
    throw (
      "Non-interactive full setup requires -CatalogMode and -ProviderActions."
    )
  }
  elseif (
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
$ccgRoot = Get-NormalizedPath (
  Join-Path $RepoRoot ([string]$sourceManifest.ccg.snapshotPath)
)
Assert-RealDirectory $ccgRoot "Recorded CCG snapshot"
if ($CcgSourceCheckout) {
  $CcgSourceCheckout = Get-NormalizedPath $CcgSourceCheckout
  Assert-RealDirectory $CcgSourceCheckout "Authoritative CCG source checkout"
}
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
  -PluginName "ccg" `
  -PluginBaseVersion $requiredCcgVersion `
  -PluginVersion $pluginVersion `
  -PluginSource $pluginSource
$previousPluginIdentity = if (
  $null -ne $ownership -and
  -not $ownership.matchesTarget
) {
  $ownership.identity
}
else {
  $null
}
$pluginState = Get-CodexPluginState `
  @pluginIdentity `
  -AllowedPreviousIdentity $previousPluginIdentity
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
Write-Output (
  "  Scope: " +
  $(if ($PluginOnly) { "Codex CCG plugin only" } else { "full global setup" })
)
Write-Output "  User home: $HomeDir"
Write-Output (
  "  Trellis: install/verify $requiredTrellisVersion " +
  "(current: $($currentTrellisVersion ?? 'missing'))"
)
Write-Output (
  "  CCG CLI: build/package-install exact $requiredCcgVersion snapshot " +
  "(current: $($currentCcgVersion ?? 'missing'))"
)
Write-Output (
  "  CCG provenance checkout: " +
  "$($CcgSourceCheckout ?? 'recorded remote commit')"
)
Write-Output (
  "  Codex plugin: $pluginId@$pluginVersion from local snapshot $ccgRoot " +
  "(installed: $($pluginState.pluginInstalled); " +
  "active identity: $($pluginState.activeIdentity))"
)
Write-Output (
  "  Codex mode: after plugin registration run 'ccg codex-mode install' " +
  "(never legacy 'ccg init')"
)
Write-Output "  Platform Skills: Global Init will install/verify 15 bundled copies"
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

if ($PluginOnly -and $currentCcgVersion -ne $requiredCcgVersion) {
  throw (
    "Plugin-only setup requires the existing CCG CLI to match " +
    "$requiredCcgVersion before plugin mutation; current: " +
    "$($currentCcgVersion ?? 'missing'). Run full setup to upgrade both together."
  )
}

if (-not $NonInteractive) {
  if ($PluginOnly) {
    Confirm-SetupItem "Codex plugin $pluginId from the local snapshot" `
      $ApproveCcgPlugin.IsPresent
    Confirm-SetupItem "ccg codex-mode install" $ApproveCodexMode.IsPresent
  }
  else {
    Confirm-SetupItem "Trellis $requiredTrellisVersion" $ApproveTrellis.IsPresent
    Confirm-SetupItem "CCG CLI $requiredCcgVersion" $ApproveCcgCli.IsPresent
    Confirm-SetupItem "Codex plugin $pluginId from the local snapshot" `
      $ApproveCcgPlugin.IsPresent
    Confirm-SetupItem "ccg codex-mode install" $ApproveCodexMode.IsPresent
    Confirm-SetupItem "Global Init and 15 bundled platform Skills" `
      $ApproveGlobalInit.IsPresent
  }
}

  if ($PluginOnly) {
    $pluginFailure = $null
    try {
      Install-CodexPlugin `
        -Identity $pluginIdentity `
        -InitialState $pluginState `
        -OwnershipState $ownership
    }
    catch {
      $pluginFailure = $_
    }
    Assert-ClaudeUnchanged $claudeBaseline "Codex CCG plugin installation"
    if ($null -ne $pluginFailure) {
      throw $pluginFailure
    }
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
    Write-Output ""
    Write-Output "Plugin-only setup complete."
    Write-Output "  Codex plugin ownership: $ownershipPath"
    Write-Output "  Codex mode: synchronized"
    Write-Output "  .claude state: unchanged"
    return
  }

  $bootstrapArguments = @{
    RepoRoot = $RepoRoot
    LinkCcg = $true
    CcgSetupTargetVersion = $requiredCcgVersion
    CcgSetupPreviousPluginVersion = if (
      $pluginState.activeIdentity -eq "previous"
    ) {
      $previousPluginIdentity.pluginVersion
    }
    elseif ($pluginState.activeIdentity -eq "absent") {
      "missing"
    }
    else {
      $null
    }
  }
  if ($CcgSourceCheckout) {
    $bootstrapArguments.AuthoritativeCcgCheckout = $CcgSourceCheckout
  }
  & (Join-Path $RepoRoot "scripts/bootstrap.ps1") @bootstrapArguments
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
    Install-CodexPlugin `
      -Identity $pluginIdentity `
      -InitialState $pluginState `
      -OwnershipState $ownership
  }
  catch {
    $pluginFailure = $_
  }
  Assert-ClaudeUnchanged $claudeBaseline "Codex CCG plugin installation"
  if ($null -ne $pluginFailure) {
    throw $pluginFailure
  }

  # Codex plugin registration updates config.toml. Install Codex mode after the
  # plugin on first setup. Re-init validates an existing owned installation
  # read-only so installation-level provider/routing choices remain preserved.
  $codexModeFailure = $null
  $codexModeOwnershipPath = Join-Path $env:CODEX_HOME ".ccg/ownership.json"
  try {
    if (Test-Path -LiteralPath $codexModeOwnershipPath) {
      Invoke-CheckedCommand "ccg" @("doctor", "--platform", "codex") `
        "existing CCG Codex mode verification"
    }
    else {
      Invoke-CheckedCommand "ccg" @("codex-mode", "install") `
        "CCG Codex mode installation"
    }
  }
  catch {
    $codexModeFailure = $_
  }
  Assert-ClaudeUnchanged $claudeBaseline "CCG Codex mode setup"
  if ($null -ne $codexModeFailure) {
    throw $codexModeFailure
  }

  $finalDoctorArguments = @{
    RepoRoot = $RepoRoot
  }
  if ($CcgSourceCheckout) {
    $finalDoctorArguments.AuthoritativeCheckout = $CcgSourceCheckout
  }
  & (Join-Path $RepoRoot "scripts/doctor.ps1") @finalDoctorArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Final Harness doctor failed with exit code $LASTEXITCODE."
  }
  Assert-ClaudeUnchanged $claudeBaseline "final Harness doctor"

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
  Show-PendingRecommendedAddons $HomeDir $RepoRoot

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
