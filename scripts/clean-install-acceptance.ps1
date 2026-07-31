[CmdletBinding()]
param(
  [string]$HarnessSource,
  [string]$HarnessRef = "HEAD",
  [string]$CommandManifest,
  [string]$ProjectContract,
  [string]$DeveloperName = "clean-install-acceptance",
  [string]$WorkingRoot,
  [string]$HomeRoot,
  [string]$UserProfileRoot,
  [string]$CodexRoot,
  [string]$NpmPrefixRoot,
  [string]$ProjectRoot,
  [string]$ReportPath,
  [switch]$Live,
  [switch]$KeepTemporary,
  [switch]$DescribeCommandInterface
)

$ErrorActionPreference = "Stop"

$RequiredPhases = @(
  "bootstrap",
  "plugin",
  "ccgCodexMode",
  "globalSkills",
  "trellisProjectInit",
  "projectInit",
  "gates",
  "markReady"
)
$GlobalPlatformSkills = @(
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
$PublicHarnessOrigin = "https://github.com/jed-zed/trellis-ccg-harness.git"
$ExplicitPhaseOverrides = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)

function Get-CommandInterface {
  return [ordered]@{
    schemaVersion = 1
    description = @(
      "Each phase is an array of executable/arguments objects.",
      "Arguments are passed directly without shell evaluation."
    ) -join " "
    requiredPhases = $RequiredPhases
    commandShape = [ordered]@{
      executable = "pwsh"
      arguments = @("-NoProfile", "-File", "{repo}/path/to/script.ps1")
      workingDirectory = "{repo}"
    }
    tokens = [ordered]@{
      "{repo}" = "Materialized Harness checkout"
      "{ref}" = "Resolved Harness ref"
      "{home}" = "Isolated HOME"
      "{userProfile}" = "Isolated USERPROFILE"
      "{codexHome}" = "Isolated CODEX_HOME"
      "{npmPrefix}" = "Isolated npm prefix"
      "{project}" = "Project initialized by the acceptance flow"
      "{contract}" = "Isolated copy of the approved project contract"
      "{thirdPartySourceSha256}" = "Canonical third-party source manifest SHA-256 resolved from the materialized Harness checkout"
    }
    liveDefaultPhases = $RequiredPhases
    liveCommands = Get-LiveDefaultPhases
    localLiveOrigin = $PublicHarnessOrigin
    liveRequirements = @(
      "-ProjectContract must name an approved public-baseline contract.",
      "Manifest gates append to the built-in doctor/conflicts/ccg doctor --platform codex list.",
      "A contract with requiredLocalCommands requires structured manifest gates.",
      "A local -Live source is materialized locally at the exact ref, then its isolated checkout origin is assigned the fixed public Harness URL."
    )
  }
}

function Get-FullPath([string]$PathValue) {
  return [System.IO.Path]::GetFullPath($PathValue)
}

function Test-DirectoryEmpty([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Container)) {
    return $true
  }
  return $null -eq (Get-ChildItem -LiteralPath $PathValue -Force | Select-Object -First 1)
}

function Initialize-EmptyDirectory([string]$PathValue, [string]$Label) {
  if (-not (Test-DirectoryEmpty $PathValue)) {
    throw "$Label must be a new or empty directory: $PathValue"
  }
  New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
}

function Invoke-NativeCommand(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$FailureMessage
) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit $LASTEXITCODE)."
  }
}

function New-PhaseCommand(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$WorkingDirectory = "{repo}"
) {
  return [ordered]@{
    executable = $Executable
    arguments = $Arguments
    workingDirectory = $WorkingDirectory
  }
}

function Get-LiveDefaultPhases {
  return [ordered]@{
    bootstrap = @((New-PhaseCommand "pwsh" @(
      "-NoProfile",
      "-File",
      "{repo}/scripts/bootstrap.ps1",
      "-RepoRoot",
      "{repo}",
      "-LinkCcg"
    )))
    plugin = @(
      (New-PhaseCommand "codex" @(
        "plugin",
        "marketplace",
        "add",
        "{repo}/components/ccg-workflow"
      )),
      (New-PhaseCommand "codex" @(
        "plugin",
        "add",
        "ccg@ccg-gptpro-worflow"
      ))
    )
    ccgCodexMode = @((New-PhaseCommand "ccg" @("codex-mode", "install")))
    globalSkills = @((New-PhaseCommand "node" @(
      "{repo}/scripts/harness-init.mjs",
      "global-init",
      "--home-dir",
      "{home}",
      "--catalog-mode",
      "skip",
      "--provider-actions",
      "codex=later,gemini=later,grok=later,claude=skip",
      "--third-party-global-skills",
      "none",
      "--third-party-global-plugins",
      "none",
      "--third-party-mcp-cli",
      "none",
      "--third-party-source-sha256",
      "{thirdPartySourceSha256}",
      "--non-interactive",
      "--approved"
    )))
    trellisProjectInit = @((New-PhaseCommand "trellis" @(
      "init",
      "--codex",
      "--yes",
      "--user",
      $DeveloperName,
      "--no-monorepo"
    ) "{project}"))
    projectInit = @((New-PhaseCommand "node" @(
      "{repo}/scripts/harness-init.mjs",
      "project-init",
      "--repo-root",
      "{project}",
      "--home-dir",
      "{home}",
      "--contract",
      "{contract}",
      "--no-project-skills",
      "--third-party-project-skills",
      "none",
      "--third-party-source-sha256",
      "{thirdPartySourceSha256}",
      "--non-interactive",
      "--approved"
    ) "{project}"))
    gates = @(
      (New-PhaseCommand "pwsh" @(
        "-NoProfile",
        "-File",
        "{repo}/scripts/doctor.ps1",
        "-RepoRoot",
        "{repo}"
      )),
      (New-PhaseCommand "node" @(
        "{repo}/scripts/harness-adapter.mjs",
        "conflicts"
      )),
      (New-PhaseCommand "ccg" @("doctor", "--platform", "codex") "{project}")
    )
    markReady = @((New-PhaseCommand "node" @(
      "{repo}/scripts/harness-init.mjs",
      "mark-ready",
      "--repo-root",
      "{project}"
    ) "{project}"))
  }
}

if ($DescribeCommandInterface) {
  Get-CommandInterface | ConvertTo-Json -Depth 8
  exit 0
}

if ([string]::IsNullOrWhiteSpace($HarnessSource)) {
  if ($Live) {
    $HarnessSource = "https://github.com/jed-zed/trellis-ccg-harness"
  }
  else {
    throw "HarnessSource is required unless -Live or -DescribeCommandInterface is used."
  }
}
if ($Live -and [string]::IsNullOrWhiteSpace($ProjectContract)) {
  throw "Live clean-install acceptance requires -ProjectContract."
}
if ($HarnessSource -match '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*@' -or
    $HarnessSource -match '[?#]') {
  throw (
    "HarnessSource must not contain URL credentials, query parameters, or " +
    "fragments; pass the Git ref separately."
  )
}
$ProjectContractSource = $null
if (-not [string]::IsNullOrWhiteSpace($ProjectContract)) {
  $ProjectContractSource = [System.IO.Path]::GetFullPath($ProjectContract)
  if (-not (Test-Path -LiteralPath $ProjectContractSource -PathType Leaf)) {
    throw "ProjectContract does not exist: $ProjectContractSource"
  }
}

function ConvertTo-PhaseCommands([object]$Value, [string]$PhaseName) {
  if ($null -eq $Value) {
    return @()
  }
  $commands = @()
  foreach ($entry in @($Value)) {
    if ($null -eq $entry.executable -or
        [string]::IsNullOrWhiteSpace([string]$entry.executable)) {
      throw "Phase '$PhaseName' contains a command without executable."
    }
    $arguments = @()
    if ($null -ne $entry.arguments) {
      foreach ($argument in @($entry.arguments)) {
        if ($null -eq $argument) {
          throw "Phase '$PhaseName' contains a null argument."
        }
        $arguments += [string]$argument
      }
    }
    $commands += ,([ordered]@{
      executable = [string]$entry.executable
      arguments = $arguments
      workingDirectory = if ($null -eq $entry.workingDirectory) {
        "{repo}"
      }
      else {
        [string]$entry.workingDirectory
      }
    })
  }
  return $commands
}

function Read-PhaseManifest([string]$ManifestPath) {
  $phases = [ordered]@{}
  if ($Live) {
    foreach ($property in (Get-LiveDefaultPhases).GetEnumerator()) {
      $phases[$property.Key] = $property.Value
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($ManifestPath)) {
    $canonicalManifest = Get-FullPath $ManifestPath
    if (-not (Test-Path -LiteralPath $canonicalManifest -PathType Leaf)) {
      throw "Command manifest does not exist: $canonicalManifest"
    }
    $manifest = Get-Content -LiteralPath $canonicalManifest -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $null -eq $manifest.phases) {
      throw "Command manifest must use schemaVersion 1 and contain phases."
    }
    foreach ($property in $manifest.phases.PSObject.Properties) {
      if ($property.Name -notin $RequiredPhases) {
        throw "Unknown clean-install phase in command manifest: $($property.Name)"
      }
      $commands = ConvertTo-PhaseCommands $property.Value $property.Name
      if ($Live -and $property.Name -eq "gates") {
        $phases[$property.Name] = @($phases[$property.Name]) + @($commands)
      }
      else {
        $phases[$property.Name] = $commands
      }
      $script:ExplicitPhaseOverrides.Add($property.Name) | Out-Null
    }
  }
  foreach ($phaseName in $RequiredPhases) {
    if (-not $phases.Contains($phaseName) -or @($phases[$phaseName]).Count -eq 0) {
      throw (
        "Phase '$phaseName' has no command. Provide it through " +
        "-CommandManifest; guided setup remains an explicit external interface."
      )
    }
  }
  return $phases
}

function Expand-CommandToken(
  [string]$Value,
  [System.Collections.IDictionary]$TokenValues
) {
  $expanded = $Value
  foreach ($token in $TokenValues.Keys) {
    $expanded = $expanded.Replace([string]$token, [string]$TokenValues[$token])
  }
  return $expanded
}

function Test-PathWithin([string]$PathValue, [string]$RootValue) {
  $relative = [System.IO.Path]::GetRelativePath($RootValue, $PathValue)
  return (
    $relative -eq "." -or
    (-not [System.IO.Path]::IsPathRooted($relative) -and
      $relative -ne ".." -and
      -not $relative.StartsWith(
        "..$([System.IO.Path]::DirectorySeparatorChar)",
        [System.StringComparison]::Ordinal
      ))
  )
}

function Resolve-SafeWorkingDirectory(
  [string]$WorkingDirectory,
  [string[]]$AllowedRoots
) {
  if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
    throw "Command workingDirectory does not exist: $WorkingDirectory"
  }
  $resolvedDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
  foreach ($allowedRoot in ($AllowedRoots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $allowedRoot -PathType Container)) {
      continue
    }
    $resolvedRoot = (Resolve-Path -LiteralPath $allowedRoot).Path
    if (Test-PathWithin $resolvedDirectory $resolvedRoot) {
      return $resolvedDirectory
    }
  }
  throw "Command workingDirectory escapes the isolated acceptance roots: $resolvedDirectory"
}

function Find-ClaudeDirectories([string[]]$Roots) {
  $found = [System.Collections.Generic.List[string]]::new()
  foreach ($root in $Roots) {
    $candidate = Join-Path $root ".claude"
    if (Test-Path -LiteralPath $candidate -PathType Container) {
      $found.Add((Get-FullPath $candidate))
    }
  }
  return $found.ToArray()
}

function Assert-NoClaudeDirectories([string]$PhaseName, [string[]]$Roots) {
  $found = @(Find-ClaudeDirectories $Roots)
  if ($found.Count -gt 0) {
    throw "Phase '$PhaseName' created forbidden .claude directories: $($found -join ', ')"
  }
}

function Assert-FileExists([string]$PathValue, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    throw "$Label is missing: $PathValue"
  }
}

function Assert-DirectoryExists([string]$PathValue, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Container)) {
    throw "$Label is missing: $PathValue"
  }
}

function Assert-BootstrapArtifacts([string]$CheckoutRoot) {
  Assert-FileExists (Join-Path $CheckoutRoot "harness.sources.json") "Harness source manifest"
  Assert-FileExists (Join-Path $CheckoutRoot "scripts/bootstrap.ps1") "Harness bootstrap"
}

function Get-ThirdPartySourceSha256(
  [string]$HarnessCheckout,
  [string]$AcceptanceHome,
  [string]$AcceptanceProject
) {
  $harnessInit = Join-Path $HarnessCheckout "scripts/harness-init.mjs"
  Assert-FileExists $harnessInit "Harness Init CLI"
  $output = @(& node $harnessInit "third-party-plan" `
    "--home-dir" $AcceptanceHome `
    "--repo-root" $AcceptanceProject 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Third-party source plan failed: $($output -join [Environment]::NewLine)"
  }
  try {
    $plan = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  }
  catch {
    throw "Third-party source plan did not return valid JSON."
  }
  $digest = [string]$plan.sourceManifestSha256
  if ($digest -notmatch '^[a-f0-9]{64}$') {
    throw "Third-party source plan did not return a SHA-256 source manifest digest."
  }
  return $digest
}

function Assert-IsolatedCommand([string]$Name, [string]$ExpectedRoot) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandType -in @("Application", "ExternalScript") } |
    Select-Object -First 1
  if ($null -eq $command) {
    throw "Bootstrap did not install the '$Name' command."
  }
  $resolvedPath = if ($command.Path) { $command.Path } else { $command.Source }
  $commandPath = [System.IO.Path]::GetFullPath($resolvedPath)
  if (-not (Test-PathWithin $commandPath $ExpectedRoot)) {
    throw "Bootstrap resolved '$Name' outside the isolated npm prefix: $commandPath"
  }
}

function Get-CommandDirectories([string[]]$Names) {
  $directories = [System.Collections.Generic.List[string]]::new()
  foreach ($name in $Names) {
    foreach ($command in @(Get-Command $name -All -ErrorAction SilentlyContinue)) {
      $commandPath = if ($command.Path) { $command.Path } else { $command.Source }
      if ([string]::IsNullOrWhiteSpace($commandPath) -or
          -not (Test-Path -LiteralPath $commandPath -PathType Leaf)) {
        continue
      }
      $directories.Add((Get-FullPath (Split-Path -Parent $commandPath)))
    }
  }
  return @($directories | Select-Object -Unique)
}

function Get-PathEntriesWithoutDirectories(
  [string]$PathValue,
  [string[]]$ExcludedDirectories
) {
  $comparison = if ($IsWindows) {
    [System.StringComparison]::OrdinalIgnoreCase
  }
  else {
    [System.StringComparison]::Ordinal
  }
  $entries = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in @($PathValue -split [System.IO.Path]::PathSeparator)) {
    if ([string]::IsNullOrWhiteSpace($entry)) {
      continue
    }
    $fullEntry = try {
      Get-FullPath $entry
    }
    catch {
      $entry
    }
    $excluded = $false
    foreach ($directory in $ExcludedDirectories) {
      if ([string]::Equals($fullEntry, $directory, $comparison)) {
        $excluded = $true
        break
      }
    }
    if (-not $excluded) {
      $entries.Add($entry)
    }
  }
  return @($entries | Select-Object -Unique)
}

function Initialize-WindowsNpmPrefixIdentity(
  [string]$AppDataRoot,
  [string]$PrefixRoot
) {
  if (-not $IsWindows) {
    return $null
  }
  New-Item -ItemType Directory -Path $AppDataRoot -Force | Out-Null
  $conventionalPrefix = Join-Path $AppDataRoot "npm"
  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  if ([string]::Equals(
      (Get-FullPath $conventionalPrefix),
      (Get-FullPath $PrefixRoot),
      $comparison
    )) {
    return $null
  }
  if (Test-Path -LiteralPath $conventionalPrefix) {
    throw (
      "Isolated APPDATA npm identity already exists outside the requested " +
      "prefix: $conventionalPrefix"
    )
  }
  New-Item -ItemType Junction -Path $conventionalPrefix -Target $PrefixRoot |
    Out-Null
  return $conventionalPrefix
}

function Assert-CcgArtifacts([string]$AcceptanceCodexRoot) {
  Assert-FileExists (Join-Path $AcceptanceCodexRoot ".ccg-version") "CCG Codex-mode version marker"
}

function Assert-PluginArtifacts([string]$AcceptanceCodexRoot) {
  $cacheRoot = Join-Path $AcceptanceCodexRoot "plugins/cache"
  Assert-DirectoryExists $cacheRoot "Codex plugin cache"
  $pluginFound = $false
  foreach ($candidate in (Get-ChildItem -LiteralPath $cacheRoot -Recurse -Force -File -Filter "plugin.json")) {
    try {
      $plugin = Get-Content -LiteralPath $candidate.FullName -Raw | ConvertFrom-Json
      if ([string]$plugin.name -eq "ccg") {
        $pluginFound = $true
        break
      }
    }
    catch {
      continue
    }
  }
  if (-not $pluginFound) {
    throw "Installed CCG Codex plugin manifest was not found under $cacheRoot"
  }
}

function Assert-GlobalSkillArtifacts([string[]]$CandidateHomes) {
  foreach ($candidateHome in ($CandidateHomes | Select-Object -Unique)) {
    $complete = $true
    foreach ($skillName in $GlobalPlatformSkills) {
      if (-not (Test-Path -LiteralPath (
          Join-Path $candidateHome ".agents/skills/$skillName/SKILL.md"
        ) -PathType Leaf)) {
        $complete = $false
        break
      }
    }
    if ($complete) {
      return
    }
  }
  throw "The 15 global Harness platform Skills were not projected under isolated HOME or USERPROFILE."
}

function Assert-TrellisProjectArtifacts([string]$AcceptanceProject) {
  Assert-DirectoryExists (Join-Path $AcceptanceProject ".trellis") "Project Trellis state"
  Assert-DirectoryExists (Join-Path $AcceptanceProject ".agents") "Project Agents state"
  Assert-DirectoryExists (Join-Path $AcceptanceProject ".codex") "Project Codex state"
}

function Assert-ProjectArtifacts(
  [string]$AcceptanceProject,
  [ValidateSet("approved", "ready")][string]$ExpectedStatus
) {
  Assert-TrellisProjectArtifacts $AcceptanceProject
  Assert-FileExists (Join-Path $AcceptanceProject "AGENTS.md") "Project AGENTS.md"
  $contractPath = Join-Path $AcceptanceProject ".harness/project.json"
  Assert-FileExists $contractPath "Project Harness contract"
  Assert-FileExists (
    Join-Path $AcceptanceProject ".harness/ownership.json"
  ) "Project Harness ownership"
  $contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json
  if ([string]$contract.status -ne $ExpectedStatus) {
    throw (
      "Project Harness contract must be $ExpectedStatus; " +
      "found '$($contract.status)'."
    )
  }
}

function Assert-SafeGeneratedCleanup([string]$PathValue) {
  $canonical = Get-FullPath $PathValue
  $temporaryRoot = (Get-FullPath ([System.IO.Path]::GetTempPath())).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $parent = (Split-Path -Parent $canonical).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $leaf = Split-Path -Leaf $canonical
  if ($parent -ne $temporaryRoot -or
      $leaf -notmatch '^trellis-ccg-clean-install-[0-9a-fA-F-]{36}$') {
    throw "Refusing cleanup outside the exact generated acceptance root: $canonical"
  }
  $entry = Get-Item -LiteralPath $canonical -Force -ErrorAction SilentlyContinue
  if ($null -ne $entry -and
      ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing cleanup after the generated acceptance root became a reparse point: $canonical"
  }
}

$Phases = Read-PhaseManifest $CommandManifest
$CreatedWorkingRoot = $false
if ([string]::IsNullOrWhiteSpace($WorkingRoot)) {
  $WorkingRoot = Join-Path (
    Get-FullPath ([System.IO.Path]::GetTempPath())
  ) "trellis-ccg-clean-install-$([guid]::NewGuid())"
  $CreatedWorkingRoot = $true
}
$WorkingRoot = Get-FullPath $WorkingRoot
$CheckoutRoot = Join-Path $WorkingRoot "harness"
if ([string]::IsNullOrWhiteSpace($HomeRoot)) {
  $HomeRoot = Join-Path $WorkingRoot "user-home"
}
if ([string]::IsNullOrWhiteSpace($UserProfileRoot)) {
  $UserProfileRoot = $HomeRoot
}
if ([string]::IsNullOrWhiteSpace($CodexRoot)) {
  $CodexRoot = Join-Path $HomeRoot ".codex"
}
$AppDataRoot = Join-Path $UserProfileRoot "AppData/Roaming"
$LocalAppDataRoot = Join-Path $UserProfileRoot "AppData/Local"
if ([string]::IsNullOrWhiteSpace($NpmPrefixRoot)) {
  $NpmPrefixRoot = if ($IsWindows) {
    Join-Path $AppDataRoot "npm"
  }
  else {
    Join-Path $HomeRoot ".npm-global"
  }
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Join-Path $WorkingRoot "project"
}

$HomeRoot = Get-FullPath $HomeRoot
$UserProfileRoot = Get-FullPath $UserProfileRoot
$CodexRoot = Get-FullPath $CodexRoot
$NpmPrefixRoot = Get-FullPath $NpmPrefixRoot
$ProjectRoot = Get-FullPath $ProjectRoot
$AppDataRoot = Get-FullPath (Join-Path $UserProfileRoot "AppData/Roaming")
$LocalAppDataRoot = Get-FullPath (Join-Path $UserProfileRoot "AppData/Local")
$ProjectContractIsolated = if ($null -ne $ProjectContractSource) {
  Join-Path $WorkingRoot "approved-project-contract.json"
}
else {
  ""
}
if (-not (Test-DirectoryEmpty $WorkingRoot)) {
  throw "WorkingRoot must be a new or empty directory: $WorkingRoot"
}
foreach ($directory in @(
  $HomeRoot,
  $UserProfileRoot,
  $CodexRoot,
  $NpmPrefixRoot,
  $ProjectRoot
) | Select-Object -Unique) {
  if (-not (Test-DirectoryEmpty $directory)) {
    throw "Acceptance isolation path must be new or empty: $directory"
  }
}

if ($CreatedWorkingRoot -and
    -not [string]::IsNullOrWhiteSpace($ReportPath)) {
  $canonicalReport = Get-FullPath $ReportPath
  $workingPrefix = "$WorkingRoot$([System.IO.Path]::DirectorySeparatorChar)"
  if ($canonicalReport.StartsWith(
      $workingPrefix,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "ReportPath must be outside an automatically cleaned WorkingRoot."
  }
}

$TokenValues = [ordered]@{
  "{repo}" = $CheckoutRoot
  "{ref}" = $HarnessRef
  "{home}" = $HomeRoot
  "{userProfile}" = $UserProfileRoot
  "{codexHome}" = $CodexRoot
  "{npmPrefix}" = $NpmPrefixRoot
  "{project}" = $ProjectRoot
  "{contract}" = $ProjectContractIsolated
  "{thirdPartySourceSha256}" = ""
}
$AuditRoots = @(
  $HomeRoot,
  $UserProfileRoot,
  $CheckoutRoot,
  $ProjectRoot
) | Select-Object -Unique
$AllowedWorkingRoots = @(
  $WorkingRoot,
  $HomeRoot,
  $UserProfileRoot,
  $CheckoutRoot,
  $ProjectRoot
) | Select-Object -Unique
$PhaseRecords = [System.Collections.Generic.List[object]]::new()
$PhaseOutputs = @{}
$StartedAt = [DateTime]::UtcNow
$RunError = $null
$ReportJson = $null
$OriginalPath = $env:PATH
$OriginalPathEntries = @(
  $OriginalPath -split [System.IO.Path]::PathSeparator |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$OriginalRuntimeCommandDirectories = @(
  Get-CommandDirectories @("trellis", "ccg")
)
$BootstrapBasePathEntries = @(
  Get-PathEntriesWithoutDirectories (
    $OriginalPath
  ) $OriginalRuntimeCommandDirectories
)
$IsolatedNpmPathEntries = if ($IsWindows) {
  @($NpmPrefixRoot, (Join-Path $NpmPrefixRoot "bin"))
}
else {
  @((Join-Path $NpmPrefixRoot "bin"), $NpmPrefixRoot)
}
$CheckoutOrigin = $null

function Invoke-AcceptancePhase([string]$PhaseName, [object[]]$Commands) {
  $phaseStart = [DateTime]::UtcNow
  $commandCount = 0
  $outputs = [System.Collections.Generic.List[string]]::new()
  $workingDirectories = [System.Collections.Generic.List[string]]::new()
  try {
    foreach ($command in $Commands) {
      $commandCount++
      $executable = Expand-CommandToken $command.executable $TokenValues
      $arguments = @(
        $command.arguments | ForEach-Object {
          Expand-CommandToken ([string]$_) $TokenValues
        }
      )
      $workingDirectory = Resolve-SafeWorkingDirectory (
        Expand-CommandToken $command.workingDirectory $TokenValues
      ) $AllowedWorkingRoots
      $workingDirectories.Add($workingDirectory)
      $commandFailure = $null
      $commandOutput = @()
      $commandExitCode = 0
      Push-Location -LiteralPath $workingDirectory
      try {
        $commandOutput = @(& $executable @arguments 2>&1)
        $commandExitCode = $LASTEXITCODE
      }
      catch {
        $commandFailure = $_
      }
      finally {
        Pop-Location
      }
      foreach ($line in $commandOutput) {
        $text = [string]$line
        $outputs.Add($text)
        Write-Host $text
      }
      if ($null -eq $commandFailure -and $commandExitCode -ne 0) {
        $commandFailure = [System.Management.Automation.RuntimeException]::new(
          "Phase '$PhaseName' command failed (exit $commandExitCode)."
        )
      }
      Assert-NoClaudeDirectories "$PhaseName command $commandCount" $AuditRoots
      if ($null -ne $commandFailure) {
        throw $commandFailure
      }
    }
    $PhaseOutputs[$PhaseName] = $outputs -join [Environment]::NewLine
    Assert-NoClaudeDirectories $PhaseName $AuditRoots
    $PhaseRecords.Add([ordered]@{
      name = $PhaseName
      status = "passed"
      commandCount = $commandCount
      workingDirectories = @($workingDirectories | Select-Object -Unique)
      startedAt = $phaseStart.ToString("o")
      completedAt = [DateTime]::UtcNow.ToString("o")
    })
  }
  catch {
    $PhaseRecords.Add([ordered]@{
      name = $PhaseName
      status = "failed"
      commandCount = $commandCount
      workingDirectories = @($workingDirectories | Select-Object -Unique)
      startedAt = $phaseStart.ToString("o")
      completedAt = [DateTime]::UtcNow.ToString("o")
      error = $_.Exception.Message
    })
    throw
  }
}

try {
  Initialize-EmptyDirectory $WorkingRoot "WorkingRoot"
  foreach ($directory in @(
    $HomeRoot,
    $UserProfileRoot,
    $CodexRoot,
    $NpmPrefixRoot,
    $ProjectRoot
  ) | Select-Object -Unique) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  if ($null -ne $ProjectContractSource) {
    Copy-Item -LiteralPath $ProjectContractSource -Destination $ProjectContractIsolated
    $contractCandidate = Get-Content -LiteralPath $ProjectContractIsolated -Raw |
      ConvertFrom-Json
    if ([string]$contractCandidate.status -ne "approved") {
      throw "ProjectContract must have status 'approved'."
    }
    $requiredProjectGates = @(
      $contractCandidate.qualityGates.requiredLocalCommands
    )
    if ($Live -and
        $requiredProjectGates.Count -gt 0 -and
        -not $ExplicitPhaseOverrides.Contains("gates")) {
      throw (
        "ProjectContract declares requiredLocalCommands; provide them as " +
        "structured gates in -CommandManifest."
      )
    }
  }

  $env:HOME = $HomeRoot
  $env:USERPROFILE = $UserProfileRoot
  $env:CODEX_HOME = $CodexRoot
  $env:NPM_CONFIG_PREFIX = $NpmPrefixRoot
  $env:NPM_CONFIG_CACHE = Join-Path $HomeRoot ".npm-cache"
  $env:XDG_CONFIG_HOME = Join-Path $HomeRoot ".config"
  $env:XDG_CACHE_HOME = Join-Path $HomeRoot ".cache"
  $env:XDG_DATA_HOME = Join-Path $HomeRoot ".local/share"
  $env:APPDATA = $AppDataRoot
  $env:LOCALAPPDATA = $LocalAppDataRoot
  $env:GIT_CONFIG_GLOBAL = Join-Path $HomeRoot ".gitconfig"
  $env:GIT_CONFIG_NOSYSTEM = "1"
  $env:HARNESS_ACCEPTANCE_REPO = $CheckoutRoot
  $env:HARNESS_ACCEPTANCE_REF = $HarnessRef
  $env:HARNESS_ACCEPTANCE_HOME = $HomeRoot
  $env:HARNESS_ACCEPTANCE_USERPROFILE = $UserProfileRoot
  $env:HARNESS_ACCEPTANCE_CODEX_HOME = $CodexRoot
  $env:HARNESS_ACCEPTANCE_NPM_PREFIX = $NpmPrefixRoot
  $env:HARNESS_ACCEPTANCE_PROJECT = $ProjectRoot
  $env:HARNESS_ACCEPTANCE_CONTRACT = $ProjectContractIsolated
  $env:HARNESS_ACCEPTANCE_LIVE = if ($Live) { "1" } else { "0" }
  $env:NO_UPDATE_NOTIFIER = "1"
  Initialize-WindowsNpmPrefixIdentity $AppDataRoot $NpmPrefixRoot | Out-Null
  $pathEntries = @($IsolatedNpmPathEntries)
  if ($Live) {
    $pathEntries += $BootstrapBasePathEntries
  }
  else {
    $pathEntries += $OriginalPathEntries
  }
  $env:PATH = $pathEntries -join [System.IO.Path]::PathSeparator
  New-Item -ItemType File -Path $env:GIT_CONFIG_GLOBAL -Force | Out-Null

  $sourceStart = [DateTime]::UtcNow
  $localSource = $null
  if (Test-Path -LiteralPath $HarnessSource -PathType Container) {
    $localSource = Get-FullPath $HarnessSource
  }
  if (-not $Live -and $null -eq $localSource) {
    throw (
      "Offline acceptance requires HarnessSource to be an existing local " +
      "directory; remote sources require explicit -Live."
    )
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required to materialize an exact Harness source/ref."
  }
  $sourceValue = if ($null -ne $localSource) {
    $localSource
  }
  else {
    $HarnessSource
  }
  Invoke-NativeCommand "git" @(
    "clone",
    "--no-checkout",
    "--no-hardlinks",
    $sourceValue,
    $CheckoutRoot
  ) "Harness clone failed"
  Invoke-NativeCommand "git" @(
    "-C",
    $CheckoutRoot,
    "checkout",
    "--detach",
    $HarnessRef
  ) "Harness ref checkout failed"
  $sourceCommandCount = 2
  if ($Live -and $null -ne $localSource) {
    Invoke-NativeCommand "git" @(
      "-C",
      $CheckoutRoot,
      "remote",
      "set-url",
      "origin",
      $PublicHarnessOrigin
    ) "Could not assign the fixed public Harness origin"
    $sourceCommandCount++
  }
  $CheckoutOrigin = (& git -C $CheckoutRoot remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($CheckoutOrigin)) {
    throw "Could not resolve the materialized Harness checkout origin."
  }
  $ResolvedRef = (& git -C $CheckoutRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or
      $ResolvedRef -notmatch '^[a-f0-9]{40}$') {
    throw "Could not resolve the materialized Harness ref."
  }
  Assert-NoClaudeDirectories "source" $AuditRoots
  Assert-BootstrapArtifacts $CheckoutRoot
  $TokenValues["{thirdPartySourceSha256}"] = Get-ThirdPartySourceSha256 `
    $CheckoutRoot $HomeRoot $ProjectRoot
  $PhaseRecords.Add([ordered]@{
    name = "source"
    status = "passed"
    commandCount = $sourceCommandCount
    startedAt = $sourceStart.ToString("o")
    completedAt = [DateTime]::UtcNow.ToString("o")
  })

  Invoke-AcceptancePhase "bootstrap" $Phases["bootstrap"]
  Assert-BootstrapArtifacts $CheckoutRoot
  if ($Live) {
    $env:PATH = @(
      $IsolatedNpmPathEntries + $OriginalPathEntries
    ) -join [System.IO.Path]::PathSeparator
    Assert-IsolatedCommand "trellis" $NpmPrefixRoot
    Assert-IsolatedCommand "ccg" $NpmPrefixRoot
  }

  Invoke-AcceptancePhase "plugin" $Phases["plugin"]
  Assert-PluginArtifacts $CodexRoot

  # Plugin registration updates Codex config.toml. Codex mode must claim the
  # converged file after that mutation so the final doctor digest stays valid.
  Invoke-AcceptancePhase "ccgCodexMode" $Phases["ccgCodexMode"]
  Assert-CcgArtifacts $CodexRoot

  Invoke-AcceptancePhase "globalSkills" $Phases["globalSkills"]
  Assert-GlobalSkillArtifacts @($HomeRoot, $UserProfileRoot)

  Invoke-AcceptancePhase "trellisProjectInit" $Phases["trellisProjectInit"]
  Assert-TrellisProjectArtifacts $ProjectRoot

  Invoke-AcceptancePhase "projectInit" $Phases["projectInit"]
  Assert-ProjectArtifacts $ProjectRoot "approved"
  if ($PhaseOutputs["projectInit"] -notmatch
      '"status"\s*:\s*"approved-awaiting-gates"') {
    throw "project-init did not report status 'approved-awaiting-gates'."
  }

  Invoke-AcceptancePhase "gates" $Phases["gates"]
  Assert-ProjectArtifacts $ProjectRoot "approved"

  Invoke-AcceptancePhase "markReady" $Phases["markReady"]
  Assert-ProjectArtifacts $ProjectRoot "ready"
  Assert-NoClaudeDirectories "complete" $AuditRoots
}
catch {
  $RunError = $_
}
finally {
  $claudeDirectoryCount = @(Find-ClaudeDirectories $AuditRoots).Count
  $report = [ordered]@{
    schemaVersion = 1
    status = if ($null -eq $RunError) { "passed" } else { "failed" }
    mode = if ($Live) { "live" } else { "offline" }
    source = $HarnessSource
    checkoutOrigin = $CheckoutOrigin
    requestedRef = $HarnessRef
    resolvedRef = if ($null -ne $ResolvedRef) { $ResolvedRef } else { $null }
    startedAt = $StartedAt.ToString("o")
    completedAt = [DateTime]::UtcNow.ToString("o")
    isolation = [ordered]@{
      workingRoot = $WorkingRoot
      home = $HomeRoot
      userProfile = $UserProfileRoot
      codexHome = $CodexRoot
      npmPrefix = $NpmPrefixRoot
      project = $ProjectRoot
    }
    phases = $PhaseRecords.ToArray()
    approvedAwaitingGatesObserved = (
      $PhaseOutputs["projectInit"] -match
        '"status"\s*:\s*"approved-awaiting-gates"'
    )
    claudeState = if ($claudeDirectoryCount -eq 0) {
      "absent-after-every-phase"
    }
    else {
      "violation"
    }
    claudeDirectoryCount = $claudeDirectoryCount
    error = if ($null -eq $RunError) {
      $null
    }
    else {
      $RunError.Exception.Message
    }
  }
  $ReportJson = $report | ConvertTo-Json -Depth 8
  $FinalizationError = $null
  try {
    if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
      $canonicalReport = Get-FullPath $ReportPath
      $reportParent = Split-Path -Parent $canonicalReport
      if (-not [string]::IsNullOrWhiteSpace($reportParent)) {
        New-Item -ItemType Directory -Path $reportParent -Force | Out-Null
      }
      Set-Content -LiteralPath $canonicalReport -Value $ReportJson -Encoding utf8NoBOM
    }
  }
  catch {
    $FinalizationError = $_
  }

  try {
    if ($CreatedWorkingRoot -and -not $KeepTemporary) {
      Assert-SafeGeneratedCleanup $WorkingRoot
      if (Test-Path -LiteralPath $WorkingRoot) {
        Remove-Item -LiteralPath $WorkingRoot -Recurse -Force
      }
    }
  }
  catch {
    if ($null -eq $FinalizationError) {
      $FinalizationError = $_
    }
  }
  if ($null -eq $RunError -and $null -ne $FinalizationError) {
    $RunError = $FinalizationError
  }
}

Write-Output $ReportJson
if ($null -ne $RunError) {
  Write-Error "Clean-install acceptance failed: $($RunError.Exception.Message)"
  exit 1
}
