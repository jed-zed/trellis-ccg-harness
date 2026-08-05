[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Index,
  [string]$AuthoritativeCheckout = $env:HARNESS_CCG_SOURCE_CHECKOUT
)

$ErrorActionPreference = "Stop"
$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$manifestPath = Join-Path $RepoRoot "harness.sources.json"
$thirdPartyManifestRelativePath = ".agents/skills/harness-init/assets/third-party-sources.json"
$thirdPartyManifestPath = Join-Path $RepoRoot $thirdPartyManifestRelativePath
$thirdPartyValidatorRelativePath = ".agents/skills/harness-init/scripts/third-party-approval.mjs"
$thirdPartyValidatorPath = Join-Path $RepoRoot $thirdPartyValidatorRelativePath
$trustedCommandResolverRelativePath = ".agents/skills/harness-init/scripts/trusted-command-resolver.mjs"
$trustedCommandResolverPath = Join-Path $RepoRoot $trustedCommandResolverRelativePath
# This is the SHA-256 of the validated manifest serialized as canonical two-space
# JSON with one trailing LF. It is deliberately independent from the CCG source
# provenance so a candidate/source edit cannot silently alter the public baseline.
$expectedThirdPartyManifestSha256 = "748796e09774955811aa1d4a8ed165efb865d88643d493cd9cf211d835a34850"
# Canonical UTF-8 SHA-256 (CRLF normalized to LF) of the shared validator.
# `-Index` must execute this exact staged source, never a mutable worktree copy.
$expectedThirdPartyValidatorSha256 = "b56358a5bb1e250e8289aff3a7f875a6028810ae1ab8f7900eee9688f43dcc73"
# Canonical UTF-8 SHA-256 of the validator's trusted command dependency.
$expectedTrustedCommandResolverSha256 = "febf8675ace4cf0ce353c8680aa4e3e606e424844704a85877efd7610f420d2e"

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

function Test-ReparsePoint {
  param([Parameter(Mandatory = $true)]$Item)

  return (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Assert-UnlinkedPath {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Item,
    [Parameter(Mandatory = $true)][string]$Name
  )

  # Windows Git commonly exposes cmd/bin projections as hard links. A hard
  # link is still a regular file and cannot be retargeted like a reparse-point
  # link, so reject symbolic links/junctions while preserving that native CLI.
  if (Test-ReparsePoint -Item $Item) {
    throw "$Name command must not be a symbolic link, junction, or other reparse point: $($Item.FullName)"
  }

  $parent = $Item.Directory
  while ($parent) {
    if (Test-ReparsePoint -Item $parent) {
      throw "$Name command must not be reached through a linked parent directory: $($Item.FullName)"
    }
    $parent = $parent.Parent
  }
}

function Resolve-TrustedCommandFile {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileInfo]$Item,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (Test-ReparsePoint -Item $Item) {
    try {
      $resolved = $Item.ResolveLinkTarget($true)
    }
    catch {
      throw "$Name command link target could not be resolved safely: $($Item.FullName)"
    }
    if ($null -eq $resolved -or $resolved -isnot [System.IO.FileInfo]) {
      throw "$Name command link target is not a regular executable file: $($Item.FullName)"
    }
    $Item = $resolved
  }
  Assert-UnlinkedPath -Item $Item -Name $Name
  return $Item
}

function Get-NativeExecutableFormat {
  param(
    [Parameter(Mandatory = $true)][byte[]]$Header,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $format = $null
  if (
    $Header.Length -ge 2 -and
    $Header[0] -eq 0x4d -and
    $Header[1] -eq 0x5a
  ) {
    $format = "pe"
  }
  elseif (
    $Header.Length -ge 4 -and
    $Header[0] -eq 0x7f -and
    $Header[1] -eq 0x45 -and
    $Header[2] -eq 0x4c -and
    $Header[3] -eq 0x46
  ) {
    $format = "elf"
  }
  elseif ($Header.Length -ge 4) {
    $magic = [System.BitConverter]::ToString($Header, 0, 4).Replace("-", "").ToLowerInvariant()
    if ($magic -in @(
      "feedface",
      "feedfacf",
      "cefaedfe",
      "cffaedfe",
      "cafebabe",
      "bebafeca",
      "cafebabf",
      "bfbafeca"
    )) {
      $format = "mach-o"
    }
  }

  if (-not $format) {
    throw "$Name command must be a native executable, not a script or shim."
  }
  $runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
  )
  $runningOnMacOS = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::OSX
  )
  $expected = if ($runningOnWindows) { "pe" } elseif ($runningOnMacOS) { "mach-o" } else { "elf" }
  if ($format -ne $expected) {
    throw "$Name command has native format '$format', but this platform requires '$expected'."
  }
  return $format
}

function Get-CommandStreamFingerprint {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][System.IO.FileStream]$Stream
  )

  $length = $Stream.Length
  $Stream.Position = 0
  $header = [byte[]]::new(4)
  $headerLength = $Stream.Read($header, 0, $header.Length)
  if ($headerLength -lt $header.Length) {
    $header = if ($headerLength -eq 0) {
      [byte[]]::new(0)
    }
    else {
      [byte[]]$header[0..($headerLength - 1)]
    }
  }
  $format = Get-NativeExecutableFormat -Header $header -Name $Name
  $Stream.Position = 0
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try {
    $sha256 = ([System.Convert]::ToHexString($hash.ComputeHash($Stream))).ToLowerInvariant()
  }
  finally {
    $hash.Dispose()
  }
  if ($Stream.Length -ne $length) {
    throw "$Name command changed while its identity was recorded."
  }
  return [pscustomobject]@{
    Length = [long]$length
    Sha256 = $sha256
    Format = $format
  }
}

function Get-TrustedCommandFileIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Path
  )

  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    throw "$Name command must resolve to an absolute path."
  }
  $absolute = [System.IO.Path]::GetFullPath($Path)
  if (-not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $absolute -PathType Leaf)) {
    throw "$Name command is not a regular executable file: $absolute"
  }

  $item = Microsoft.PowerShell.Management\Get-Item -LiteralPath $absolute -Force
  if ($item -isnot [System.IO.FileInfo]) {
    throw "$Name command is not a regular executable file: $absolute"
  }
  $item = Resolve-TrustedCommandFile -Item $item -Name $Name
  $absolute = [System.IO.Path]::GetFullPath($item.FullName)

  $stream = [System.IO.File]::Open(
    $absolute,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  try {
    $fingerprint = Get-CommandStreamFingerprint -Name $Name -Stream $stream
  }
  finally {
    $stream.Dispose()
  }

  $after = Microsoft.PowerShell.Management\Get-Item -LiteralPath $absolute -Force
  Assert-UnlinkedPath -Item $after -Name $Name
  if ($after.Length -ne $fingerprint.Length) {
    throw "$Name command changed while its identity was recorded."
  }

  return [pscustomobject]@{
    Name = $Name
    RealPath = [System.IO.Path]::GetFullPath($after.FullName)
    Length = [long]$fingerprint.Length
    Sha256 = $fingerprint.Sha256
    Format = $fingerprint.Format
  }
}

function Resolve-TrustedNativeCommand {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Microsoft.PowerShell.Core\Get-Command `
    -Name $Name `
    -CommandType Application `
    -ErrorAction Stop
  if ($command -is [Array]) {
    $command = $command[0]
  }
  $source = [string]$command.Source
  if ([string]::IsNullOrWhiteSpace($source)) {
    $source = [string]$command.Path
  }
  if ([string]::IsNullOrWhiteSpace($source)) {
    throw "$Name command did not resolve to an application path."
  }
  return Get-TrustedCommandFileIdentity -Name $Name -Path $source
}

function Assert-TrustedCommandIdentity {
  param([Parameter(Mandatory = $true)]$Identity)

  $actual = Get-TrustedCommandFileIdentity -Name ([string]$Identity.Name) -Path ([string]$Identity.RealPath)
  if (
    $actual.RealPath -cne [string]$Identity.RealPath -or
    $actual.Length -ne [long]$Identity.Length -or
    $actual.Sha256 -cne [string]$Identity.Sha256 -or
    $actual.Format -cne [string]$Identity.Format
  ) {
    throw "$($Identity.Name) command identity changed after verifier startup."
  }
}

function Open-TrustedCommandLease {
  param([Parameter(Mandatory = $true)]$Identity)

  $lease = [System.IO.File]::Open(
    [string]$Identity.RealPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  try {
    $fingerprint = Get-CommandStreamFingerprint -Name ([string]$Identity.Name) -Stream $lease
    $item = Microsoft.PowerShell.Management\Get-Item `
      -LiteralPath ([string]$Identity.RealPath) `
      -Force
    Assert-UnlinkedPath -Item $item -Name ([string]$Identity.Name)
    if (
      $fingerprint.Length -ne [long]$Identity.Length -or
      $fingerprint.Sha256 -cne [string]$Identity.Sha256 -or
      $fingerprint.Format -cne [string]$Identity.Format
    ) {
      throw "$($Identity.Name) command identity changed after verifier startup."
    }
    return $lease
  }
  catch {
    $lease.Dispose()
    throw
  }
}

function New-TrustedProcessStartInfo {
  param(
    [Parameter(Mandatory = $true)]$Identity,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$RedirectStandardInput
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = [string]$Identity.RealPath
  foreach ($argument in $Arguments) {
    $null = $startInfo.ArgumentList.Add([string]$argument)
  }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = [bool]$RedirectStandardInput
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  $startInfo.StandardOutputEncoding = $utf8
  $startInfo.StandardErrorEncoding = $utf8
  if ($RedirectStandardInput) {
    $startInfo.StandardInputEncoding = $utf8
  }

  # Start from an empty environment. In particular, never inherit PATH,
  # NODE_OPTIONS/NODE_PATH, loader injection, Git configuration/exec/SSH
  # overrides, or credential/helper state from the caller.
  $startInfo.Environment.Clear()
  $startInfo.Environment["LANG"] = "C"
  $startInfo.Environment["LC_ALL"] = "C"
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
  )) {
    $windowsDirectory = [System.IO.Directory]::GetParent(
      [System.Environment]::SystemDirectory
    ).FullName
    $startInfo.Environment["SystemRoot"] = $windowsDirectory
    $startInfo.Environment["WINDIR"] = $windowsDirectory
  }
  if ([string]$Identity.Name -ceq "git") {
    $nullDevice = if (
      [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::Windows
      )
    ) { "NUL" } else { "/dev/null" }
    $startInfo.Environment["GIT_CONFIG_NOSYSTEM"] = "1"
    $startInfo.Environment["GIT_CONFIG_GLOBAL"] = $nullDevice
    $startInfo.Environment["GIT_CONFIG_COUNT"] = "0"
    $startInfo.Environment["GIT_TERMINAL_PROMPT"] = "0"
    $startInfo.Environment["GIT_OPTIONAL_LOCKS"] = "0"
    $startInfo.Environment["GIT_NO_REPLACE_OBJECTS"] = "1"
  }
  return $startInfo
}

function Invoke-TrustedTextCommand {
  param(
    [Parameter(Mandatory = $true)]$Identity,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [AllowNull()][string]$InputText = $null,
    [switch]$RedirectStandardInput
  )

  $lease = Open-TrustedCommandLease -Identity $Identity
  $process = $null
  try {
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = New-TrustedProcessStartInfo `
      -Identity $Identity `
      -Arguments $Arguments `
      -RedirectStandardInput:$RedirectStandardInput
    if (-not $process.Start()) {
      throw "Unable to start trusted $($Identity.Name) command."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($RedirectStandardInput) {
      if ($null -ne $InputText) {
        $process.StandardInput.Write($InputText)
      }
      $process.StandardInput.Close()
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    return [pscustomobject]@{
      ExitCode = [int]$process.ExitCode
      Stdout = $stdout
      Stderr = $stderr
    }
  }
  finally {
    if ($process) { $process.Dispose() }
    $lease.Dispose()
    Assert-TrustedCommandIdentity -Identity $Identity
  }
}

$script:GitCommandIdentity = Resolve-TrustedNativeCommand -Name "git"
$script:NodeCommandIdentity = Resolve-TrustedNativeCommand -Name "node"

function Invoke-GitAt {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingTree,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  $commandArguments = @("-C", $WorkingTree) + @($Arguments)
  $result = Invoke-TrustedTextCommand `
    -Identity $script:GitCommandIdentity `
    -Arguments $commandArguments
  if ($result.ExitCode -ne 0) {
    $details = @($result.Stdout.Trim(), $result.Stderr.Trim()) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    throw "git $($Arguments -join ' ') failed: $($details -join [Environment]::NewLine)"
  }
  return $result.Stdout.Trim()
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
  $result = Invoke-TrustedTextCommand `
    -Identity $script:GitCommandIdentity `
    -Arguments @("-C", $RepoRoot, "cat-file", "-e", "${Treeish}:$gitPath")
  return $result.ExitCode -eq 0
}

function Get-GitTreeBytes {
  param(
    [Parameter(Mandatory = $true)][string]$Treeish,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  $gitPath = $RelativePath.Replace('\', '/')
  $startInfo = New-TrustedProcessStartInfo `
    -Identity $script:GitCommandIdentity `
    -Arguments @("-C", $RepoRoot, "cat-file", "blob", "${Treeish}:$gitPath")
  $lease = Open-TrustedCommandLease -Identity $script:GitCommandIdentity
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  $stream = $null
  try {
    if (-not $process.Start()) { throw "Unable to read staged Git blob: $RelativePath" }
    $stream = [System.IO.MemoryStream]::new()
    $copyTask = $process.StandardOutput.BaseStream.CopyToAsync($stream)
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $null = $copyTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
      throw "git cat-file blob failed for ${Treeish}:${gitPath}: $stderr"
    }
    return ,$stream.ToArray()
  }
  finally {
    if ($stream) { $stream.Dispose() }
    $process.Dispose()
    $lease.Dispose()
    Assert-TrustedCommandIdentity -Identity $script:GitCommandIdentity
  }
}

function Get-CanonicalTextSha256 {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)

  $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
  try { $text = $utf8.GetString($Bytes) }
  catch { throw "Third-party validator must be valid UTF-8 source text." }
  if ($text.Contains("`r") -and -not $text.Contains("`r`n")) {
    throw "Third-party validator has unsupported bare CR line endings."
  }
  $canonical = $text.Replace("`r`n", "`n")
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.Convert]::ToHexString($hash.ComputeHash($utf8.GetBytes($canonical)))).ToLowerInvariant()
  }
  finally { $hash.Dispose() }
}

function New-StagedValidatorFiles {
  param(
    [Parameter(Mandatory = $true)][byte[]]$ValidatorBytes,
    [Parameter(Mandatory = $true)][byte[]]$ResolverBytes
  )

  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $directory = [System.IO.Path]::GetFullPath((Join-Path $tempRoot "trellis-ccg-staged-validator-$([Guid]::NewGuid().ToString('N'))"))
  if (-not $directory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to create staged validator outside the system temp root: $directory"
  }
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $file = Join-Path $directory "third-party-approval.mjs"
  [System.IO.File]::WriteAllBytes($file, $ValidatorBytes)
  [System.IO.File]::WriteAllBytes(
    (Join-Path $directory "trusted-command-resolver.mjs"),
    $ResolverBytes
  )
  return [pscustomobject]@{ Directory = $directory; File = $file; TempRoot = $tempRoot }
}

function Remove-StagedValidatorFile {
  param([Parameter(Mandatory = $true)]$TemporaryValidator)

  $directory = [System.IO.Path]::GetFullPath([string]$TemporaryValidator.Directory)
  $tempRoot = [System.IO.Path]::GetFullPath([string]$TemporaryValidator.TempRoot)
  if (-not $directory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove staged validator outside the system temp root: $directory"
  }
  if (Test-Path -LiteralPath $directory) {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

function Get-ThirdPartyManifestSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$ValidatorPath,
    [string]$ManifestPath,
    [string]$ManifestText
  )

  if (-not (Test-Path -LiteralPath $ValidatorPath -PathType Leaf)) {
    throw "Third-party source manifest validator is missing: $ValidatorPath"
  }
  $validator = [System.IO.Path]::GetFullPath($ValidatorPath)
  $nodeProgram = @'
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const [validatorPath, mode, manifestPath] = process.argv.slice(1);
const approval = await import(pathToFileURL(validatorPath).href);
if (mode === "file") {
  const loaded = await approval.loadThirdPartySourceManifest({ manifestPath });
  process.stdout.write(loaded.manifestSha256);
} else if (mode === "text") {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const manifest = approval.validateThirdPartySourceManifest(JSON.parse(input));
  process.stdout.write(createHash("sha256").update(`${JSON.stringify(manifest, null, 2)}\n`).digest("hex"));
} else {
  throw new Error(`Unsupported third-party source manifest mode: ${mode}`);
}
'@

  if ($Mode -eq "file") {
    $result = Invoke-TrustedTextCommand `
      -Identity $script:NodeCommandIdentity `
      -Arguments @("--input-type=module", "-e", $nodeProgram, $validator, "file", $ManifestPath)
  }
  elseif ($Mode -eq "text") {
    $result = Invoke-TrustedTextCommand `
      -Identity $script:NodeCommandIdentity `
      -Arguments @("--input-type=module", "-e", $nodeProgram, $validator, "text") `
      -InputText $ManifestText `
      -RedirectStandardInput
  }
  else {
    throw "Unsupported third-party source manifest mode: $Mode"
  }
  if ($result.ExitCode -ne 0) {
    $details = @($result.Stdout.Trim(), $result.Stderr.Trim()) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    throw "Third-party source manifest validation failed: $($details -join [Environment]::NewLine)"
  }
  $digest = $result.Stdout.Trim().ToLowerInvariant()
  if ($digest -notmatch '^[0-9a-f]{64}$') {
    throw "Third-party source manifest validator returned an invalid SHA-256 digest."
  }
  return $digest
}

function Assert-ThirdPartySourceManifest {
  param(
    [Parameter(Mandatory = $true)][string]$Treeish,
    [Parameter(Mandatory = $true)][bool]$UseIndex
  )

  if ($UseIndex) {
    if (-not (Test-GitTreePath -Treeish $Treeish -RelativePath $thirdPartyManifestRelativePath)) {
      throw "Third-party source manifest is missing from the staged Git tree."
    }
    if (-not (Test-GitTreePath -Treeish $Treeish -RelativePath $thirdPartyValidatorRelativePath)) {
      throw "Third-party source manifest validator is missing from the staged Git tree."
    }
    if (-not (Test-GitTreePath -Treeish $Treeish -RelativePath $trustedCommandResolverRelativePath)) {
      throw "Trusted command resolver is missing from the staged Git tree."
    }
    $validatorBytes = Get-GitTreeBytes -Treeish $Treeish -RelativePath $thirdPartyValidatorRelativePath
    $validatorSha256 = Get-CanonicalTextSha256 -Bytes $validatorBytes
    Assert-Equal "Staged third-party source manifest validator SHA-256" $expectedThirdPartyValidatorSha256 $validatorSha256
    $resolverBytes = Get-GitTreeBytes -Treeish $Treeish -RelativePath $trustedCommandResolverRelativePath
    $resolverSha256 = Get-CanonicalTextSha256 -Bytes $resolverBytes
    Assert-Equal "Staged trusted command resolver SHA-256" $expectedTrustedCommandResolverSha256 $resolverSha256
    $temporaryValidator = New-StagedValidatorFiles -ValidatorBytes $validatorBytes -ResolverBytes $resolverBytes
    try {
      $manifestText = Get-GitTreeText -Treeish $Treeish -RelativePath $thirdPartyManifestRelativePath
      $actual = Get-ThirdPartyManifestSha256 -Mode "text" -ValidatorPath $temporaryValidator.File -ManifestText $manifestText
    }
    finally {
      Remove-StagedValidatorFile -TemporaryValidator $temporaryValidator
    }
  }
  else {
    if (-not (Test-Path -LiteralPath $thirdPartyManifestPath -PathType Leaf)) {
      throw "Third-party source manifest not found: $thirdPartyManifestPath"
    }
    if (-not (Test-Path -LiteralPath $thirdPartyValidatorPath -PathType Leaf)) {
      throw "Third-party source manifest validator not found: $thirdPartyValidatorPath"
    }
    if (-not (Test-Path -LiteralPath $trustedCommandResolverPath -PathType Leaf)) {
      throw "Trusted command resolver not found: $trustedCommandResolverPath"
    }
    $validatorSha256 = Get-CanonicalTextSha256 -Bytes ([System.IO.File]::ReadAllBytes($thirdPartyValidatorPath))
    Assert-Equal "Third-party source manifest validator SHA-256" $expectedThirdPartyValidatorSha256 $validatorSha256
    $resolverSha256 = Get-CanonicalTextSha256 -Bytes ([System.IO.File]::ReadAllBytes($trustedCommandResolverPath))
    Assert-Equal "Trusted command resolver SHA-256" $expectedTrustedCommandResolverSha256 $resolverSha256
    $actual = Get-ThirdPartyManifestSha256 -Mode "file" -ValidatorPath $thirdPartyValidatorPath -ManifestPath $thirdPartyManifestPath
  }
  Assert-Equal "Third-party source manifest canonical SHA-256" $expectedThirdPartyManifestSha256 $actual
  return $actual
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
  $sourceRoot = if ([string]::IsNullOrWhiteSpace($Checkout)) {
    $null
  }
  else {
    $Checkout
  }
  try {
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

$thirdPartyManifestSha256 = Assert-ThirdPartySourceManifest -Treeish $treeish -UseIndex ([bool]$Index)

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
    $dirtyPaths = @($staged, $unstaged, $untracked) |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    throw "CCG component is dirty (staged, unstaged, or untracked): $($dirtyPaths -join ', '). Source verification requires an exact committed snapshot."
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
  $result = Invoke-TrustedTextCommand `
    -Identity $script:GitCommandIdentity `
    -Arguments @("-C", $RepoRoot, "cat-file", "-e", $forbiddenTreeRef)
  if ($result.ExitCode -eq 0) {
    throw "Forbidden runtime path is committed in the CCG snapshot: $relativePath"
  }
}

Write-Output "Source verification passed."
Write-Output "  Trellis: $trellisVersion"
Write-Output "  CCG:      $($ccgPackage.version)"
Write-Output "  Commit:   $($manifest.ccg.commit)"
Write-Output "  Git tree: $actualTree"
Write-Output "  Source:   $($manifest.ccg.authoritativeRepository)"
Write-Output "  Third-party manifest SHA-256: $thirdPartyManifestSha256"
Write-Output "  Git command:  $($script:GitCommandIdentity.RealPath) ($($script:GitCommandIdentity.Length) bytes, SHA-256 $($script:GitCommandIdentity.Sha256))"
Write-Output "  Node command: $($script:NodeCommandIdentity.RealPath) ($($script:NodeCommandIdentity.Length) bytes, SHA-256 $($script:NodeCommandIdentity.Sha256))"

# PowerShell can propagate the last native command's non-zero status when the
# script exits on Linux. The cat-file probes above intentionally expect
# missing paths, so reset the native status after all assertions pass.
$global:LASTEXITCODE = 0
