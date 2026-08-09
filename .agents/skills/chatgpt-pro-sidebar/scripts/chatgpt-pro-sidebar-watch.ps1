#requires -Version 5.1
# Source encoding: UTF-8 with BOM.
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command,

    [string]$EvidenceDir,
    [string]$ManifestPath,
    [string]$CodexThreadId = $env:CODEX_THREAD_ID,
    [string]$PromptPath,
    [string]$IdempotencyKey,
    [string]$ResponseDeadlineAtUtc,
    [string]$WorkerToken,
    [string]$WatcherId,
    [string]$BrowserId,
    [string]$Profile,
    [string]$TabId,
    [string]$SessionKey,
    [int]$SlotId,

    [int]$PollSeconds = 5,
    [int]$StableStopPolls = 2,
    [int]$MaxProbeFailures = 3,
    [int]$TimeoutSeconds = 7200,
    [int]$FinalizeTimeoutSeconds = 45,

    [switch]$NoWake,
    [switch]$AgentMonitor,
    [switch]$RootWait,
    [switch]$FreshConversation,
    [switch]$KeepLauncherAlive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Script:WatcherName = 'chatgpt-pro-sidebar-watch'
$Script:WatcherSchemaVersion = 1
$Script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$Script:WatcherScriptPath = $PSCommandPath
$Script:StateFileName = 'watch-state.json'
$Script:EventFileName = 'watch-event.json'
$Script:StopHookClaimFileName = 'watch-stop-hook.claim'
$Script:CallbackFileName = 'watch-callback.json'
$Script:ContinuationAckFileName = 'watch-continuation-ack.json'
$Script:LogFileName = 'watch.log'
$Script:WorkerStdoutFileName = 'watch-worker.stdout.log'
$Script:WorkerStderrFileName = 'watch-worker.stderr.log'
$Script:StopHookRegistryDirectoryName = 'stop-hook-v2'
$Script:LegacyStopHookRegistryDirectoryName = 'stop-hook-v1'
$Script:MaximumStopHookWaitSeconds = 7400
$Script:StopHookRegistryRootOverride = $null
$Script:CapacityRootOverride = $null
$Script:CapacityDirectoryName = 'concurrency-v1'
$Script:CapacitySlotCount = 6
$Script:PerThreadSlotCount = 3
$Script:MaximumBatchRounds = 32
$Script:BatchResultFileName = 'batch-result.json'
$Script:SurfaceFailureCategories = @(
    'AgentBrowserCliFailed',
    'AgentBrowserCliLaunchFailed',
    'AgentBrowserTargetMissing',
    'AgentBrowserPageStateInvalid'
)
$Script:TerminalStatuses = @(
    'completed',
    'stopped-unverified',
    'probe-failed',
    'conversation-changed',
    'timeout',
    'worker-crashed'
)

function Get-WatchProperty {
    param(
        $InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $InputObject) {
        return $Default
    }
    if ($InputObject -is [System.Collections.IDictionary] -and $InputObject.Contains($Name)) {
        return $InputObject[$Name]
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $Default
    }
    return $property.Value
}

function Get-WatchContinuationTransport {
    param([Parameter(Mandatory = $true)]$State)

    $agentMonitor = [bool](Get-WatchProperty $State 'agentMonitor' $false)
    $rootWait = [bool](Get-WatchProperty $State 'rootWait' $false)
    if ($agentMonitor -and $rootWait) {
        throw 'Watcher state contains multiple local continuation transports.'
    }
    if ($rootWait) {
        return 'codex-root-wait'
    }
    if ($agentMonitor) {
        return 'codex-agent-monitor'
    }
    if ([bool](Get-WatchProperty $State 'noWake' $false)) {
        return 'disabled'
    }
    return 'codex-stop-hook'
}

function Get-WatchSha256Text {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $Script:Utf8NoBom.GetBytes($Text)
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Enter-WatchStartMutex {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [int]$TimeoutMilliseconds = 30000
    )

    if ($TimeoutMilliseconds -lt 0) {
        throw 'Watcher start mutex timeout must be non-negative.'
    }
    $identity = [System.IO.Path]::GetFullPath($EvidenceDirectory)
    $identity = $identity.TrimEnd([System.IO.Path]::DirectorySeparatorChar).ToLowerInvariant()
    $mutexName = 'Local\ChatGptProSidebarWatchStart-' + (Get-WatchSha256Text -Text $identity)
    $mutex = [System.Threading.Mutex]::new($false, $mutexName)
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne($TimeoutMilliseconds)
        }
        catch [System.Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            throw 'Timed out waiting for another watcher start operation on this evidence directory.'
        }
        return $mutex
    }
    catch {
        if (-not $acquired) {
            $mutex.Dispose()
        }
        throw
    }
}

function Exit-WatchStartMutex {
    param([AllowNull()]$Mutex)

    if ($null -eq $Mutex) {
        return
    }
    try {
        $Mutex.ReleaseMutex()
    }
    finally {
        $Mutex.Dispose()
    }
}

function Write-WatchTextAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $directory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($Path))
    if (-not [System.IO.Directory]::Exists($directory)) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }

    $temporary = Join-Path $directory (([System.IO.Path]::GetFileName($Path)) + '.tmp.' + $PID + '.' + [guid]::NewGuid().ToString('N'))
    $backup = Join-Path $directory (([System.IO.Path]::GetFileName($Path)) + '.bak.' + $PID + '.' + [guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllText($temporary, $Text, $Script:Utf8NoBom)
        if ([System.IO.File]::Exists($Path)) {
            [System.IO.File]::Replace($temporary, $Path, $backup, $true)
            if ([System.IO.File]::Exists($backup)) {
                [System.IO.File]::Delete($backup)
            }
        }
        else {
            [System.IO.File]::Move($temporary, $Path)
        }
    }
    finally {
        foreach ($leftover in @($temporary, $backup)) {
            if ([System.IO.File]::Exists($leftover)) {
                [System.IO.File]::Delete($leftover)
            }
        }
    }
}

function Write-WatchJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 12
    Write-WatchTextAtomic -Path $Path -Text ($json + [Environment]::NewLine)
}

function Read-WatchJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$Required
    )

    if (-not [System.IO.File]::Exists($Path)) {
        if ($Required) {
            throw ('Required JSON file is missing: ' + [System.IO.Path]::GetFileName($Path))
        }
        return $null
    }
    try {
        return [System.IO.File]::ReadAllText($Path, $Script:Utf8NoBom) | ConvertFrom-Json
    }
    catch {
        throw ('Invalid JSON file: ' + [System.IO.Path]::GetFileName($Path))
    }
}

function Write-WatchLog {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)]$Record
    )

    $path = Join-Path $EvidenceDirectory $Script:LogFileName
    if ([System.IO.File]::Exists($path) -and (Get-Item -LiteralPath $path).Length -ge 2097152) {
        return
    }
    $line = ($Record | ConvertTo-Json -Depth 6 -Compress) + [Environment]::NewLine
    [System.IO.File]::AppendAllText($path, $line, $Script:Utf8NoBom)
}

function Resolve-WatchEvidenceDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'EvidenceDir is required.'
    }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not [System.IO.Directory]::Exists($fullPath)) {
        throw 'EvidenceDir must be an existing directory.'
    }
    return $fullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
}

function Test-WatchThreadId {
    param([AllowNull()][string]$Value)
    return -not [string]::IsNullOrWhiteSpace($Value) -and
        $Value -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
}

function Test-WatchConversationUrl {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }
    $uri = $null
    if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$uri)) {
        return $false
    }
    if (
        $uri.Scheme -ne 'https' -or
        -not $uri.IsDefaultPort -or
        $uri.DnsSafeHost.ToLowerInvariant() -notin @('chatgpt.com', 'www.chatgpt.com') -or
        -not [string]::IsNullOrEmpty($uri.UserInfo)
    ) {
        return $false
    }

    $path = $uri.AbsolutePath
    if ($path.Length -gt 1) {
        $path = $path.TrimEnd('/')
    }
    $conversationSegment = '[A-Za-z0-9_-]{8,128}'
    $gptSegment = '[A-Za-z0-9_-]{1,128}'
    if ($path -notmatch ('^/(?:g/' + $gptSegment + '/)?c/' + $conversationSegment + '$')) {
        return $false
    }

    $builder = [System.UriBuilder]::new($uri)
    $builder.Host = 'chatgpt.com'
    $builder.Path = $path
    $builder.Query = ''
    $builder.Fragment = ''
    $builder.UserName = ''
    $builder.Password = ''
    $builder.Port = -1
    return $builder.Uri.AbsoluteUri -ceq $Value
}

function Get-WatchEvidenceBinding {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId
    )

    if (-not (Test-WatchThreadId -Value $ThreadId)) {
        throw 'CodexThreadId must be a UUID. Pass the current CODEX_THREAD_ID explicitly when it is not inherited.'
    }

    $state = Read-WatchJson -Path (Join-Path $EvidenceDirectory 'state.json') -Required
    $phase = [string](Get-WatchProperty $state 'phase' '')
    if (@('sent', 'send-intent', 'send-uncertain') -notcontains $phase) {
        throw ('Watcher requires a post-send evidence phase; current phase is ' + $phase + '.')
    }
    if ([string](Get-WatchProperty $state 'transport' '') -cne 'agent-browser-cli-v2') {
        throw 'Watcher requires agent-browser-cli-v2 evidence; incomplete windows-uia evidence is historical only.'
    }

    $conversationUrl = [string](Get-WatchProperty $state 'conversationUrlBound' '')
    $urlBindingPending = (
        [string](Get-WatchProperty $state 'phase' '') -eq 'sent' -and
        [bool](Get-WatchProperty $state 'conversationUrlBindingPending' $false) -and
        [bool](Get-WatchProperty $state 'submissionAcknowledged' $false) -and
        [bool](Get-WatchProperty $state 'invokeAttempted' $false) -and
        [bool](Get-WatchProperty $state 'invokeReturned' $false) -and
        -not [bool](Get-WatchProperty $state 'automaticResendAllowed' $true) -and
        [string]::IsNullOrWhiteSpace([string](Get-WatchProperty $state 'conversationUrlBeforeSend' '')) -and
        [string]::IsNullOrWhiteSpace($conversationUrl)
    )
    if (-not (Test-WatchConversationUrl -Value $conversationUrl) -and -not $urlBindingPending) {
        throw 'state.json does not bind one exact ChatGPT conversation URL.'
    }

    $targetBinding = Get-WatchProperty $state 'targetBinding' $null
    if ($null -eq $targetBinding) {
        throw 'state.json does not bind one agent-browser-cli target.'
    }
    foreach ($name in @('browserId', 'profileId', 'tabId', 'sessionKey')) {
        $value = [string](Get-WatchProperty $targetBinding $name '')
        if ([string]::IsNullOrWhiteSpace($value) -or $value.Length -gt 512 -or $value -match '[\r\n]') {
            throw ('state.json targetBinding has an invalid ' + $name + '.')
        }
    }
    if ([string](Get-WatchProperty $targetBinding 'origin' '') -cne 'https://chatgpt.com') {
        throw 'state.json targetBinding origin is not canonical ChatGPT.'
    }
    $targetUrl = [string](Get-WatchProperty $targetBinding 'url' '')
    if ($targetUrl -cne 'https://chatgpt.com/' -and -not (Test-WatchConversationUrl -Value $targetUrl)) {
        throw 'state.json targetBinding URL is not a supported canonical ChatGPT URL.'
    }
    if (-not [string]::IsNullOrWhiteSpace($conversationUrl) -and $targetUrl -cne $conversationUrl) {
        throw 'state.json targetBinding URL does not match the bound conversation URL.'
    }

    $responseDeadlineAtUtc = [string](Get-WatchProperty $state 'responseDeadlineAtUtc' '')
    $null = Get-WatchRemainingDeadlineSeconds `
        -DeadlineAtUtc $responseDeadlineAtUtc `
        -RequestedTimeoutSeconds 7200

    return [pscustomobject]@{
        Phase = $phase
        Transport = 'agent-browser-cli-v2'
        ConversationUrl = $conversationUrl
        UrlBindingPending = $urlBindingPending
        TargetBinding = $targetBinding
        PromptSha256 = [string](Get-WatchProperty $state 'promptSha256' '')
        IdempotencyKeySha256 = [string](Get-WatchProperty $state 'idempotencyKeySha256' '')
        ResponseDeadlineAtUtc = $responseDeadlineAtUtc
        CodexThreadId = $ThreadId
    }
}

function Get-WatchRemainingDeadlineSeconds {
    param(
        [AllowEmptyString()][string]$DeadlineAtUtc,
        [Parameter(Mandatory = $true)][int]$RequestedTimeoutSeconds,
        [scriptblock]$NowAction = { [datetime]::UtcNow }
    )

    if ([string]::IsNullOrWhiteSpace($DeadlineAtUtc)) {
        throw 'Adapter evidence has no responseDeadlineAtUtc; RootWait cannot synthesize a new wait budget.'
    }
    try {
        $deadline = [datetimeoffset]::Parse(
            $DeadlineAtUtc,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal
        ).UtcDateTime
    }
    catch {
        throw 'Adapter responseDeadlineAtUtc is invalid.'
    }
    $remaining = [int][Math]::Ceiling(($deadline - ([datetime](& $NowAction)).ToUniversalTime()).TotalSeconds)
    if ($remaining -le 0) {
        return 0
    }
    return [Math]::Min($RequestedTimeoutSeconds, $remaining)
}

function Get-WatchStopHookRegistryRoot {
    if (-not [string]::IsNullOrWhiteSpace([string]$Script:StopHookRegistryRootOverride)) {
        return [System.IO.Path]::GetFullPath([string]$Script:StopHookRegistryRootOverride)
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is unavailable for the Stop Hook registry.'
    }
    return [System.IO.Path]::GetFullPath(
        (Join-Path (Join-Path $env:LOCALAPPDATA 'ChatGptProSidebar') $Script:StopHookRegistryDirectoryName)
    )
}

function Get-WatchStopHookRegistrationPath {
    param(
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$WatcherId
    )

    if (-not (Test-WatchThreadId -Value $ThreadId)) {
        throw 'Cannot register a Stop Hook continuation for an invalid thread id.'
    }
    $parsedWatcherId = [guid]::Empty
    if (-not [guid]::TryParse($WatcherId, [ref]$parsedWatcherId)) {
        throw 'Cannot register a Stop Hook continuation for an invalid watcher id.'
    }
    $threadDirectory = Join-Path (Get-WatchStopHookRegistryRoot) ($ThreadId.ToLowerInvariant())
    return Join-Path $threadDirectory ($parsedWatcherId.ToString().ToLowerInvariant() + '.json')
}

function Register-WatchStopHook {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$WatcherId,
        [Parameter(Mandatory = $true)][int]$WatcherTimeoutSeconds,
        [Parameter(Mandatory = $true)][int]$FinalizeTimeout
    )

    $boundedWaitSeconds = $WatcherTimeoutSeconds + $FinalizeTimeout + 120
    if ($boundedWaitSeconds -gt $Script:MaximumStopHookWaitSeconds) {
        throw "Watcher timeout exceeds the $($Script:MaximumStopHookWaitSeconds)-second Stop Hook horizon."
    }
    $registrationPath = Get-WatchStopHookRegistrationPath -ThreadId $ThreadId -WatcherId $WatcherId
    $registration = [ordered]@{
        schemaVersion = $Script:WatcherSchemaVersion
        transport = 'codex-stop-hook'
        phase = 'registered'
        registeredAtUtc = [datetime]::UtcNow.ToString('o')
        hookDeadlineUtc = [datetime]::UtcNow.AddSeconds($boundedWaitSeconds).ToString('o')
        codexThreadId = $ThreadId.ToLowerInvariant()
        watcherId = $WatcherId
        evidenceDirectory = [System.IO.Path]::GetFullPath($EvidenceDirectory)
        stateFile = $Script:StateFileName
        eventFile = $Script:EventFileName
        claimFile = $Script:StopHookClaimFileName
        callbackFile = $Script:CallbackFileName
    }
    Write-WatchJsonAtomic -Path $registrationPath -Value $registration
    return $registrationPath
}

function Assert-WatchConfiguration {
    param(
        [switch]$DisableStopHookHorizon,
        [int]$ConfiguredTimeoutSeconds = $TimeoutSeconds,
        [int]$ConfiguredFinalizeTimeoutSeconds = $FinalizeTimeoutSeconds
    )

    if ($PollSeconds -lt 1 -or $PollSeconds -gt 60) {
        throw 'PollSeconds must be between 1 and 60.'
    }
    if ($StableStopPolls -lt 1 -or $StableStopPolls -gt 10) {
        throw 'StableStopPolls must be between 1 and 10.'
    }
    if ($MaxProbeFailures -lt 1 -or $MaxProbeFailures -gt 20) {
        throw 'MaxProbeFailures must be between 1 and 20.'
    }
    if ($ConfiguredTimeoutSeconds -lt 1 -or $ConfiguredTimeoutSeconds -gt 7200) {
        throw 'TimeoutSeconds must be between 1 and 7200.'
    }
    if ($ConfiguredFinalizeTimeoutSeconds -lt 5 -or $ConfiguredFinalizeTimeoutSeconds -gt 300) {
        throw 'FinalizeTimeoutSeconds must be between 5 and 300.'
    }
    if (-not $DisableStopHookHorizon) {
        $maximumWatcherTimeoutSeconds = $Script:MaximumStopHookWaitSeconds - $ConfiguredFinalizeTimeoutSeconds - 120
        if ($ConfiguredTimeoutSeconds -gt $maximumWatcherTimeoutSeconds) {
            throw "TimeoutSeconds must be between 1 and $maximumWatcherTimeoutSeconds for the Stop Hook horizon."
        }
    }
}

function Get-WatchAdapterPath {
    $path = Join-Path $PSScriptRoot 'chatgpt-pro-sidebar.ps1'
    if (-not [System.IO.File]::Exists($path)) {
        throw 'The side-panel adapter script is missing.'
    }
    return $path
}

function ConvertFrom-AdapterOutput {
    param(
        [AllowEmptyCollection()][object[]]$Output,
        [int]$ExitCode
    )

    $json = $null
    $text = @($Output | ForEach-Object { [string]$_ }) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($text)) {
        try {
            $json = $text | ConvertFrom-Json
            if ($json -is [System.Array] -or $null -eq $json -or @($json.PSObject.Properties).Count -eq 0) {
                $json = $null
            }
        }
        catch {
            $json = $null
        }
    }
    return [pscustomobject]@{
        ExitCode = $ExitCode
        Payload = $json
    }
}

function ConvertTo-WatchWindowsProcessArgument {
    param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq [char]'\') {
            $backslashes++
            continue
        }
        if ($character -eq [char]'"') {
            [void]$builder.Append([char]'\', (($backslashes * 2) + 1))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append([char]'\', $backslashes)
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append([char]'\', ($backslashes * 2))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-WatchAdapterProcess {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][int]$ProcessTimeoutSeconds
    )

    if ($ProcessTimeoutSeconds -lt 1 -or $ProcessTimeoutSeconds -gt 600) {
        throw 'Adapter process timeout must be between 1 and 600 seconds.'
    }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'powershell.exe'
    $startInfo.Arguments = @($Arguments | ForEach-Object {
        ConvertTo-WatchWindowsProcessArgument -Value ([string]$_)
    }) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw 'The adapter process could not be started.'
        }
        $stdoutLine = $process.StandardOutput.ReadLineAsync()
        $stderrDrain = $process.StandardError.ReadToEndAsync()
        $deadline = [DateTime]::UtcNow.AddSeconds($ProcessTimeoutSeconds)
        while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 25
        }
        if (-not $process.HasExited) {
            try { & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null } catch { }
            throw 'The bounded adapter process timed out.'
        }

        $stdout = ''
        if ($stdoutLine.Wait(2000)) {
            $stdout = [string]$stdoutLine.Result
        }
        return ConvertFrom-AdapterOutput -Output @($stdout) -ExitCode ([int]$process.ExitCode)
    }
    finally {
        if ($null -ne $process) {
            try { $process.StandardOutput.Dispose() } catch { }
            try { $process.StandardError.Dispose() } catch { }
            $process.Dispose()
        }
    }
}

function Invoke-WatchAdapterStatus {
    param(
        [Parameter(Mandatory = $true)][string]$AdapterPath,
        [Parameter(Mandatory = $true)]$TargetBinding,
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue
    )

    $arguments = @(
        '-NoProfile', '-NonInteractive', '-File', $AdapterPath, 'status',
        '-BrowserId', [string](Get-WatchProperty $TargetBinding 'browserId' ''),
        '-Profile', [string](Get-WatchProperty $TargetBinding 'profileId' ''),
        '-TabId', [string](Get-WatchProperty $TargetBinding 'tabId' ''),
        '-SessionKey', [string](Get-WatchProperty $TargetBinding 'sessionKey' ''),
        '-CodexThreadId', $CodexThreadIdValue
    )
    $expectedUrl = [string](Get-WatchProperty $TargetBinding 'url' '')
    if (Test-WatchConversationUrl -Value $expectedUrl) {
        $arguments += @('-ExpectedConversationUrl', $expectedUrl)
    }
    $result = Invoke-WatchAdapterProcess -Arguments $arguments -ProcessTimeoutSeconds 120
    $payload = Get-WatchProperty $result 'Payload' $null
    if (
        [int](Get-WatchProperty $result 'ExitCode' 99) -eq 24 -and
        [string](Get-WatchProperty $payload 'category' '') -eq 'GenerationAlreadyActive'
    ) {
        $details = Get-WatchProperty $payload 'details' $null
        if (
            $null -ne $details -and
            [bool](Get-WatchProperty $details 'ok' $false) -and
            [string](Get-WatchProperty $details 'command' '') -eq 'status' -and
            [bool](Get-WatchProperty $details 'generating' $false)
        ) {
            return [pscustomobject]@{ ExitCode = 0; Payload = $details }
        }
    }
    return $result
}

function Invoke-WatchAdapterFinalize {
    param(
        [Parameter(Mandatory = $true)][string]$AdapterPath,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][int]$FinalizeTimeout,
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue
    )

    $arguments = @(
        '-NoProfile', '-NonInteractive', '-File', $AdapterPath, 'wait',
        '-EvidenceDir', $EvidenceDirectory,
        '-CodexThreadId', $CodexThreadIdValue,
        '-TimeoutSeconds', [string]$FinalizeTimeout,
        '-PollMilliseconds', '1000'
    )
    return Invoke-WatchAdapterProcess `
        -Arguments $arguments `
        -ProcessTimeoutSeconds ([Math]::Min(600, $FinalizeTimeout + 60))
}

function Invoke-WatchAdapterSend {
    param(
        [Parameter(Mandatory = $true)][string]$AdapterPath,
        [Parameter(Mandatory = $true)][string]$PromptFile,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$IdempotencyKeyValue,
        [Parameter(Mandatory = $true)][string]$CodexThreadIdValue,
        [AllowEmptyString()][string]$BrowserIdValue = '',
        [AllowEmptyString()][string]$ProfileValue = '',
        [AllowEmptyString()][string]$TabIdValue = '',
        [AllowEmptyString()][string]$SessionKeyValue = '',
        [int]$ResponseTimeoutSecondsValue = $TimeoutSeconds,
        [AllowEmptyString()][string]$ResponseDeadlineAtUtcValue = '',
        [switch]$RequireFreshConversation
    )

    if ([string]::IsNullOrWhiteSpace($PromptFile)) {
        throw 'PromptPath is required for run-root.'
    }
    if ([string]::IsNullOrWhiteSpace($IdempotencyKeyValue)) {
        throw 'IdempotencyKey is required for run-root.'
    }
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-File', $AdapterPath, 'send',
        '-PromptPath', $PromptFile,
        '-EvidenceDir', $EvidenceDirectory,
        '-IdempotencyKey', $IdempotencyKeyValue,
        '-CodexThreadId', $CodexThreadIdValue,
        '-ResponseTimeoutSeconds', [string]$ResponseTimeoutSecondsValue
    )
    $targetParts = @($BrowserIdValue, $ProfileValue, $TabIdValue, $SessionKeyValue)
    $targetPartCount = @($targetParts | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
    if ($targetPartCount -ne 0 -and $targetPartCount -ne 4) {
        throw 'BrowserId, Profile, TabId, and SessionKey must be supplied together for run-root.'
    }
    if ($targetPartCount -eq 4) {
        $arguments += @(
            '-BrowserId', $BrowserIdValue,
            '-Profile', $ProfileValue,
            '-TabId', $TabIdValue,
            '-SessionKey', $SessionKeyValue
        )
    }
    if ($RequireFreshConversation) {
        $arguments += '-FreshConversation'
    }
    if (-not [string]::IsNullOrWhiteSpace($ResponseDeadlineAtUtcValue)) {
        $arguments += @('-ResponseDeadlineAtUtc', $ResponseDeadlineAtUtcValue)
    }
    return Invoke-WatchAdapterProcess -Arguments $arguments -ProcessTimeoutSeconds 600
}

function Invoke-WatchLoop {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$BoundConversationUrl,
        [switch]$UrlBindingPending,
        [Parameter(Mandatory = $true)][int]$StablePollCount,
        [Parameter(Mandatory = $true)][int]$FailureLimit,
        [Parameter(Mandatory = $true)][int]$OverallTimeoutSeconds,
        [Parameter(Mandatory = $true)][int]$SleepSeconds,
        [Parameter(Mandatory = $true)][scriptblock]$ProbeAction,
        [Parameter(Mandatory = $true)][scriptblock]$FinalizeAction,
        [Parameter(Mandatory = $true)][scriptblock]$SleepAction,
        [Parameter(Mandatory = $true)][scriptblock]$NowAction,
        [scriptblock]$ObservationAction = { param($record) }
    )

    $started = & $NowAction
    $stableStopped = 0
    $consecutiveFailures = 0
    $lastFailureCategory = ''
    $observations = 0
    $generationObserved = $false

    while ($true) {
        $now = & $NowAction
        if (($now - $started).TotalSeconds -ge $OverallTimeoutSeconds) {
            return [pscustomobject]@{
                Status = 'timeout'
                Reason = 'overall-timeout'
                Observations = $observations
                ConsecutiveProbeFailures = $consecutiveFailures
                LastFailureCategory = $lastFailureCategory
                FinalizeResult = $null
            }
        }

        $probe = $null
        try {
            $probe = & $ProbeAction
        }
        catch {
            $probe = [pscustomobject]@{ ExitCode = 99; Payload = $null }
        }
        $observations++

        $exitCode = [int](Get-WatchProperty $probe 'ExitCode' 99)
        $payload = Get-WatchProperty $probe 'Payload' $null
        $ok = $exitCode -eq 0 -and $null -ne $payload -and [bool](Get-WatchProperty $payload 'ok' $false)

        if (-not $ok) {
            $category = [string](Get-WatchProperty $payload 'category' 'ProbeUnavailable')
            if ($exitCode -eq 32 -and $category -eq 'ConcurrentUiOperation') {
                & $ObservationAction ([ordered]@{
                    atUtc = ([datetime](& $NowAction)).ToUniversalTime().ToString('o')
                    exitCode = $exitCode
                    ok = $false
                    category = $category
                    deferred = $true
                    consecutiveFailures = $consecutiveFailures
                })
                & $SleepAction $SleepSeconds
                continue
            }

            if ($Script:SurfaceFailureCategories -contains $category) {
                $consecutiveFailures = 0
                $lastFailureCategory = $category
                $stableStopped = 0
                & $ObservationAction ([ordered]@{
                    atUtc = ([datetime](& $NowAction)).ToUniversalTime().ToString('o')
                    exitCode = $exitCode
                    ok = $false
                    category = $category
                    deferred = $true
                    recoveryPending = $true
                    consecutiveFailures = 0
                })
                & $SleepAction $SleepSeconds
                continue
            }

            $consecutiveFailures++
            $lastFailureCategory = $category
            $stableStopped = 0
            & $ObservationAction ([ordered]@{
                atUtc = ([datetime](& $NowAction)).ToUniversalTime().ToString('o')
                exitCode = $exitCode
                ok = $false
                category = $category
                consecutiveFailures = $consecutiveFailures
            })
            if ($consecutiveFailures -ge $FailureLimit) {
                return [pscustomobject]@{
                    Status = 'probe-failed'
                    Reason = 'consecutive-probe-failures'
                    Observations = $observations
                    ConsecutiveProbeFailures = $consecutiveFailures
                    LastFailureCategory = $lastFailureCategory
                    FinalizeResult = $null
                }
            }
            & $SleepAction $SleepSeconds
            continue
        }

        $consecutiveFailures = 0
        $lastFailureCategory = ''
        $currentUrl = [string](Get-WatchProperty $payload 'url' '')
        $urlExact = [bool](Get-WatchProperty $payload 'urlExact' $false)
        $boundOnThisProbe = ''
        if ($UrlBindingPending -and $urlExact -and (Test-WatchConversationUrl -Value $currentUrl)) {
            $BoundConversationUrl = $currentUrl
            $UrlBindingPending = $false
            $boundOnThisProbe = $currentUrl
        }
        elseif (-not $UrlBindingPending -and (-not $urlExact -or $currentUrl -ne $BoundConversationUrl)) {
            & $ObservationAction ([ordered]@{
                atUtc = ([datetime](& $NowAction)).ToUniversalTime().ToString('o')
                exitCode = 0
                ok = $true
                generating = [bool](Get-WatchProperty $payload 'generating' $false)
                urlExact = $urlExact
                matchedBoundUrl = $false
            })
            return [pscustomobject]@{
                Status = 'conversation-changed'
                Reason = 'bound-conversation-url-mismatch'
                Observations = $observations
                ConsecutiveProbeFailures = 0
                FinalizeResult = $null
            }
        }

        $generating = [bool](Get-WatchProperty $payload 'generating' $false)
        if ($generating) {
            $generationObserved = $true
            $stableStopped = 0
        }
        else {
            $stableStopped++
        }
        & $ObservationAction ([ordered]@{
            atUtc = ([datetime](& $NowAction)).ToUniversalTime().ToString('o')
            exitCode = 0
            ok = $true
            generating = $generating
            urlExact = $urlExact
            matchedBoundUrl = -not [bool]$UrlBindingPending
            generationObserved = $generationObserved
            stableStoppedPolls = $stableStopped
            urlBindingPending = [bool]$UrlBindingPending
            boundConversationUrl = $boundOnThisProbe
        })

        if ($stableStopped -ge $StablePollCount) {
            $lastFinalize = $null
            $finalizeAttempted = $false
            while ($true) {
                $finalizeNow = & $NowAction
                if ($finalizeAttempted -and ($finalizeNow - $started).TotalSeconds -ge $OverallTimeoutSeconds) {
                    return [pscustomobject]@{
                        Status = 'timeout'
                        Reason = 'overall-timeout'
                        Observations = $observations
                        ConsecutiveProbeFailures = 0
                        FinalizeResult = $lastFinalize
                    }
                }

                $finalize = $null
                $finalizeAttempted = $true
                try {
                    $finalize = & $FinalizeAction
                }
                catch {
                    $finalize = [pscustomobject]@{ ExitCode = 99; Payload = $null }
                }
                $lastFinalize = $finalize
                $finalizeExitCode = [int](Get-WatchProperty $finalize 'ExitCode' 99)
                $finalizePayload = Get-WatchProperty $finalize 'Payload' $null
                $finalizeCategory = [string](Get-WatchProperty $finalizePayload 'category' '')
                if ($finalizeExitCode -eq 32 -and $finalizeCategory -eq 'ConcurrentUiOperation') {
                    $observations++
                    & $ObservationAction ([ordered]@{
                        atUtc = ([datetime]$finalizeNow).ToUniversalTime().ToString('o')
                        phase = 'finalize'
                        exitCode = $finalizeExitCode
                        ok = $false
                        category = $finalizeCategory
                        deferred = $true
                        consecutiveFailures = 0
                    })
                    & $SleepAction $SleepSeconds
                    continue
                }

                if (-not $generationObserved -and $finalizeCategory -eq 'ResponseTimeout') {
                    $stableStopped = 0
                    & $ObservationAction ([ordered]@{
                        atUtc = ([datetime]$finalizeNow).ToUniversalTime().ToString('o')
                        phase = 'finalize'
                        exitCode = $finalizeExitCode
                        ok = $false
                        category = $finalizeCategory
                        deferred = $true
                        awaitingGeneration = $true
                        consecutiveFailures = 0
                    })
                    break
                }

                if ($UrlBindingPending -and $finalizeCategory -eq 'ExactConversationUrlUnavailable') {
                    $stableStopped = 0
                    & $ObservationAction ([ordered]@{
                        atUtc = ([datetime]$finalizeNow).ToUniversalTime().ToString('o')
                        phase = 'finalize'
                        exitCode = $finalizeExitCode
                        ok = $false
                        category = $finalizeCategory
                        deferred = $true
                        urlBindingPending = $true
                        consecutiveFailures = 0
                    })
                    break
                }

                $status = 'stopped-unverified'
                $reason = 'generation-stopped-but-response-not-finalized'
                if ($finalizeExitCode -eq 0 -and [bool](Get-WatchProperty $finalizePayload 'ok' $false)) {
                    $status = 'completed'
                    $reason = 'stable-stop-and-response-finalized'
                }
                return [pscustomobject]@{
                    Status = $status
                    Reason = $reason
                    Observations = $observations
                    ConsecutiveProbeFailures = 0
                    FinalizeResult = $finalize
                }
            }
        }

        & $SleepAction $SleepSeconds
    }
}

function New-WatchEvent {
    param(
        [Parameter(Mandatory = $true)]$WatchState,
        [Parameter(Mandatory = $true)]$LoopResult
    )

    $finalize = Get-WatchProperty $LoopResult 'FinalizeResult' $null
    $finalizePayload = Get-WatchProperty $finalize 'Payload' $null
    $status = [string](Get-WatchProperty $LoopResult 'Status' 'worker-crashed')
    $terminalOutcome = [string](Get-WatchProperty $LoopResult 'TerminalOutcome' '')
    $errorCategory = [string](Get-WatchProperty $LoopResult 'ErrorCategory' '')
    $lastFailureCategory = [string](Get-WatchProperty $LoopResult 'LastFailureCategory' '')
    $recoveryPending = (
        $terminalOutcome -eq 'recovery-required' -or
        $status -eq 'conversation-changed' -or
        $Script:SurfaceFailureCategories -contains $lastFailureCategory
    )
    $recoveryReason = if ($status -eq 'conversation-changed') {
        'bound-conversation-changed'
    }
    elseif ($terminalOutcome -eq 'recovery-required') {
        'submission-state-unconfirmed'
    }
    elseif ($recoveryPending) {
        'bound-surface-unavailable'
    }
    else {
        ''
    }
    $recoveryCategory = if ($status -eq 'conversation-changed') {
        'ConversationUrlChanged'
    }
    elseif ($terminalOutcome -eq 'recovery-required') {
        'RecoveryRequired'
    }
    else {
        $lastFailureCategory
    }
    $event = [ordered]@{
        schemaVersion = $Script:WatcherSchemaVersion
        watcher = $Script:WatcherName
        watcherId = [string](Get-WatchProperty $WatchState 'watcherId' '')
        status = $status
        reason = [string](Get-WatchProperty $LoopResult 'Reason' 'unexpected-worker-failure')
        terminalAtUtc = [datetime]::UtcNow.ToString('o')
        requiresCodexReview = $true
        automaticResendAllowed = $false
        recoveryStatus = if ($recoveryPending) { 'pending-manual' } else { 'not-pending' }
        recoveryReason = $recoveryReason
        recoveryCategory = $recoveryCategory
        evidenceDirectory = [string](Get-WatchProperty $WatchState 'evidenceDirectory' '')
        transport = [string](Get-WatchProperty $WatchState 'transport' '')
        conversationUrl = [string](Get-WatchProperty $WatchState 'conversationUrl' '')
        targetBinding = Get-WatchProperty $WatchState 'targetBinding' $null
        codexThreadId = [string](Get-WatchProperty $WatchState 'codexThreadId' '')
        observations = [int](Get-WatchProperty $LoopResult 'Observations' 0)
        consecutiveProbeFailures = [int](Get-WatchProperty $LoopResult 'ConsecutiveProbeFailures' 0)
        finalize = [ordered]@{
            attempted = $null -ne $finalize
            exitCode = if ($null -eq $finalize) { $null } else { [int](Get-WatchProperty $finalize 'ExitCode' 99) }
            category = if ($null -eq $finalizePayload) { $null } else { [string](Get-WatchProperty $finalizePayload 'category' '') }
            completed = if ($null -eq $finalizePayload) { $false } else { [bool](Get-WatchProperty $finalizePayload 'completed' $false) }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($terminalOutcome)) {
        $event.terminalOutcome = $terminalOutcome
    }
    if (-not [string]::IsNullOrWhiteSpace($errorCategory)) {
        $event.errorCategory = $errorCategory
    }
    return $event
}

function Wait-WatchLauncherState {
    param(
        [Parameter(Mandatory = $true)][string]$StatePath,
        [Parameter(Mandatory = $true)][string]$ExpectedWatcherId
    )

    $deadline = [datetime]::UtcNow.AddSeconds(10)
    while ([datetime]::UtcNow -lt $deadline) {
        $state = Read-WatchJson -Path $StatePath
        if ($null -ne $state -and
            [string](Get-WatchProperty $state 'watcherId' '') -eq $ExpectedWatcherId -and
            [int](Get-WatchProperty $state 'processId' 0) -eq $PID) {
            return $state
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Worker could not confirm its launcher state.'
}

function Invoke-WatchWorker {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$Token,
        [string]$ExpectedWatcherId = '',
        [switch]$DisableWake,
        [switch]$AgentMonitor,
        [switch]$RootWait
    )

    $statePath = Join-Path $EvidenceDirectory $Script:StateFileName
    $eventPath = Join-Path $EvidenceDirectory $Script:EventFileName
    $state = [pscustomobject]@{
        watcherId = $ExpectedWatcherId
        phase = 'running'
        processId = $PID
        evidenceDirectory = $EvidenceDirectory
        transport = 'agent-browser-cli-v2'
        conversationUrl = ''
        targetBinding = $null
        codexThreadId = $ThreadId
        noWake = [bool]($DisableWake -or $AgentMonitor -or $RootWait)
        agentMonitor = [bool]$AgentMonitor
        rootWait = [bool]$RootWait
    }
    $loopResult = $null
    $stateReadFailure = $null
    try {
        $state = Read-WatchJson -Path $statePath -Required
    }
    catch {
        $stateReadFailure = $_
    }

    if ($null -eq $stateReadFailure) {
        $stateWatcherId = [string](Get-WatchProperty $state 'watcherId' '')
        if (-not [string]::IsNullOrWhiteSpace($ExpectedWatcherId) -and $stateWatcherId -ne $ExpectedWatcherId) {
            throw 'Worker watcher id does not match the launcher state.'
        }
        $ExpectedWatcherId = $stateWatcherId
        $expectedTokenHash = [string](Get-WatchProperty $state 'workerTokenSha256' '')
        if ([string]::IsNullOrWhiteSpace($Token) -or (Get-WatchSha256Text -Text $Token) -ne $expectedTokenHash) {
            throw 'Worker token does not match the launcher state.'
        }
        try {
            $state = Wait-WatchLauncherState -StatePath $statePath -ExpectedWatcherId $ExpectedWatcherId
            $adapterPath = Get-WatchAdapterPath
            $boundUrl = [string](Get-WatchProperty $state 'conversationUrl' '')
            $loopResult = Invoke-WatchLoop `
                -BoundConversationUrl $boundUrl `
                -UrlBindingPending:([bool](Get-WatchProperty $state 'urlBindingPending' $false)) `
                -StablePollCount ([int](Get-WatchProperty $state 'stableStopPolls' 2)) `
                -FailureLimit ([int](Get-WatchProperty $state 'maxProbeFailures' 3)) `
                -OverallTimeoutSeconds ([int](Get-WatchProperty $state 'timeoutSeconds' 7200)) `
                -SleepSeconds ([int](Get-WatchProperty $state 'pollSeconds' 5)) `
                -ProbeAction {
                    $probe = Invoke-WatchAdapterStatus -AdapterPath $adapterPath -TargetBinding (Get-WatchProperty $state 'targetBinding' $null) -CodexThreadIdValue $ThreadId
                    $probePayload = Get-WatchProperty $probe 'Payload' $null
                    $observedBinding = Get-WatchProperty $probePayload 'targetBinding' $null
                    if ([int](Get-WatchProperty $probe 'ExitCode' 99) -eq 0 -and $null -ne $observedBinding) {
                        $state.targetBinding = $observedBinding
                        Write-WatchJsonAtomic -Path $statePath -Value $state
                    }
                    return $probe
                } `
                -FinalizeAction {
                    Invoke-WatchAdapterFinalize `
                        -AdapterPath $adapterPath `
                        -EvidenceDirectory $EvidenceDirectory `
                        -FinalizeTimeout ([int](Get-WatchProperty $state 'finalizeTimeoutSeconds' 45)) `
                        -CodexThreadIdValue $ThreadId
                } `
                -SleepAction { param($seconds) Start-Sleep -Seconds $seconds } `
                -NowAction { [datetime]::UtcNow } `
                -ObservationAction {
                    param($record)
                    $observedBoundUrl = [string](Get-WatchProperty $record 'boundConversationUrl' '')
                    if (Test-WatchConversationUrl -Value $observedBoundUrl) {
                        $state.conversationUrl = $observedBoundUrl
                        $state.urlBindingPending = $false
                        Write-WatchJsonAtomic -Path $statePath -Value $state
                    }
                    Write-WatchLog -EvidenceDirectory $EvidenceDirectory -Record $record
                }
        }
        catch {
            $loopResult = [pscustomobject]@{
                Status = 'worker-crashed'
                Reason = 'unexpected-worker-failure'
                Observations = 0
                ConsecutiveProbeFailures = 0
                FinalizeResult = $null
            }
        }
    }
    else {
        $loopResult = [pscustomobject]@{
            Status = 'worker-crashed'
            Reason = 'unexpected-worker-failure'
            Observations = 0
            ConsecutiveProbeFailures = 0
            FinalizeResult = $null
        }
    }

    $finalize = Get-WatchProperty $loopResult 'FinalizeResult' $null
    $finalizePayload = Get-WatchProperty $finalize 'Payload' $null
    $finalConversationUrl = [string](Get-WatchProperty $finalizePayload 'conversationUrl' '')
    if (Test-WatchConversationUrl -Value $finalConversationUrl) {
        $state.conversationUrl = $finalConversationUrl
        $state.urlBindingPending = $false
    }
    $event = Complete-WatchTerminalEvidence -StatePath $statePath -EventPath $eventPath -State $state -LoopResult $loopResult

    $continuationTransport = Get-WatchContinuationTransport -State $state
    $continuationRegistered = $continuationTransport -eq 'codex-stop-hook'
    Write-WatchLog -EvidenceDirectory $EvidenceDirectory -Record ([ordered]@{
        atUtc = [datetime]::UtcNow.ToString('o')
        terminalStatus = $event.status
        continuationRegistered = $continuationRegistered
        continuationTransport = $continuationTransport
    })

    return [ordered]@{
        ok = $true
        command = 'worker'
        terminalStatus = $event.status
        eventFile = $Script:EventFileName
        continuationRegistered = $continuationRegistered
        continuationTransport = $continuationTransport
    }
}

function New-WatchWorkerArgumentList {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$Token,
        [Parameter(Mandatory = $true)][string]$ExpectedWatcherId,
        [int]$WorkerTimeoutSeconds = $TimeoutSeconds,
        [switch]$DisableWake,
        [switch]$AgentMonitor,
        [switch]$RootWait
    )

    foreach ($path in @($ScriptPath, $EvidenceDirectory)) {
        if ($path.Contains('"')) {
            throw 'Watcher process paths cannot contain a double quote.'
        }
    }

    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-File',
        ('"' + $ScriptPath + '"'),
        'worker',
        '-EvidenceDir',
        ('"' + $EvidenceDirectory + '"'),
        '-CodexThreadId',
        $ThreadId,
        '-WorkerToken',
        $Token,
        '-WatcherId',
        $ExpectedWatcherId,
        '-PollSeconds',
        [string]$PollSeconds,
        '-StableStopPolls',
        [string]$StableStopPolls,
        '-MaxProbeFailures',
        [string]$MaxProbeFailures,
        '-TimeoutSeconds',
        [string]$WorkerTimeoutSeconds,
        '-FinalizeTimeoutSeconds',
        [string]$FinalizeTimeoutSeconds
    )
    if ($DisableWake) {
        $arguments += '-NoWake'
    }
    if ($AgentMonitor) {
        $arguments += '-AgentMonitor'
    }
    if ($RootWait) {
        $arguments += '-RootWait'
    }
    return $arguments
}

function Complete-WatchTerminalEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$StatePath,
        [Parameter(Mandatory = $true)][string]$EventPath,
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)]$LoopResult
    )

    $event = New-WatchEvent -WatchState $State -LoopResult $LoopResult
    Write-WatchJsonAtomic -Path $EventPath -Value $event
    $State | Add-Member -NotePropertyName phase -NotePropertyValue 'terminal' -Force
    $State | Add-Member -NotePropertyName terminalStatus -NotePropertyValue $event.status -Force
    $State | Add-Member -NotePropertyName terminalAtUtc -NotePropertyValue $event.terminalAtUtc -Force
    if (-not [string]::IsNullOrWhiteSpace([string](Get-WatchProperty $event 'terminalOutcome' ''))) {
        $State | Add-Member -NotePropertyName terminalOutcome -NotePropertyValue $event.terminalOutcome -Force
    }
    if (-not [string]::IsNullOrWhiteSpace([string](Get-WatchProperty $event 'errorCategory' ''))) {
        $State | Add-Member -NotePropertyName errorCategory -NotePropertyValue $event.errorCategory -Force
    }
    if ($event.recoveryStatus -eq 'pending-manual') {
        $State | Add-Member -NotePropertyName recoveryStatus -NotePropertyValue $event.recoveryStatus -Force
        $State | Add-Member -NotePropertyName recoveryReason -NotePropertyValue $event.recoveryReason -Force
        $State | Add-Member -NotePropertyName recoveryCategory -NotePropertyValue $event.recoveryCategory -Force
        $State | Add-Member -NotePropertyName recoveryPendingAtUtc -NotePropertyValue $event.terminalAtUtc -Force
    }
    Write-WatchJsonAtomic -Path $StatePath -Value $State
    return $event
}

function Complete-RootWaitTerminalFromAdapterState {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)]$AdapterState,
        [Parameter(Mandatory = $true)][string]$Status,
        [Parameter(Mandatory = $true)][string]$Reason,
        [AllowEmptyString()][string]$TerminalOutcome = '',
        [AllowEmptyString()][string]$ErrorCategory = ''
    )

    $watcherId = [string](Get-WatchProperty $AdapterState 'watcherId' '')
    if ([string]::IsNullOrWhiteSpace($watcherId)) {
        $watcherId = [guid]::NewGuid().ToString()
    }
    $AdapterState | Add-Member -NotePropertyName watcherId -NotePropertyValue $watcherId -Force
    $AdapterState | Add-Member -NotePropertyName evidenceDirectory -NotePropertyValue $EvidenceDirectory -Force
    $AdapterState | Add-Member -NotePropertyName conversationUrl -NotePropertyValue ([string](Get-WatchProperty $AdapterState 'conversationUrlBound' '')) -Force
    $AdapterState | Add-Member -NotePropertyName codexThreadId -NotePropertyValue $ThreadId.ToLowerInvariant() -Force
    $AdapterState | Add-Member -NotePropertyName rootWait -NotePropertyValue $true -Force
    $AdapterState | Add-Member -NotePropertyName noWake -NotePropertyValue $true -Force
    $loopResult = [pscustomobject]@{
        Status = $Status
        Reason = $Reason
        TerminalOutcome = $TerminalOutcome
        ErrorCategory = $ErrorCategory
        Observations = 0
        ConsecutiveProbeFailures = 0
        FinalizeResult = $null
    }
    $event = Complete-WatchTerminalEvidence `
        -StatePath (Join-Path $EvidenceDirectory $Script:StateFileName) `
        -EventPath (Join-Path $EvidenceDirectory $Script:EventFileName) `
        -State $AdapterState `
        -LoopResult $loopResult
    return [pscustomobject]@{ State = $AdapterState; Event = $event }
}

function Start-WatchProcess {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [int]$WatcherTimeoutSeconds = $TimeoutSeconds,
        [switch]$DisableContinuation,
        [switch]$AgentMonitor,
        [switch]$RootWait,
        [switch]$KeepLauncherAlive
    )

    $mutex = Enter-WatchStartMutex -EvidenceDirectory $EvidenceDirectory
    try {
        return Start-WatchProcessExclusive @PSBoundParameters
    }
    finally {
        Exit-WatchStartMutex -Mutex $mutex
    }
}

function Start-WatchProcessExclusive {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [int]$WatcherTimeoutSeconds = $TimeoutSeconds,
        [switch]$DisableContinuation,
        [switch]$AgentMonitor,
        [switch]$RootWait,
        [switch]$KeepLauncherAlive
    )

    if (([int][bool]$DisableContinuation + [int][bool]$AgentMonitor + [int][bool]$RootWait) -gt 1) {
        throw 'DisableContinuation, AgentMonitor, and RootWait are mutually exclusive.'
    }
    if ($KeepLauncherAlive -and -not $RootWait) {
        throw 'KeepLauncherAlive is valid only with RootWait.'
    }
    if (-not $RootWait -or $DisableContinuation -or $AgentMonitor) {
        throw 'The V2 watcher supports RootWait only; Stop Hook and model-monitor continuations are disabled.'
    }
    $disableStopHook = $true
    $requestedTransport = 'codex-root-wait'
    Assert-WatchConfiguration `
        -DisableStopHookHorizon:$disableStopHook `
        -ConfiguredTimeoutSeconds $WatcherTimeoutSeconds `
        -ConfiguredFinalizeTimeoutSeconds $FinalizeTimeoutSeconds
    $binding = Get-WatchEvidenceBinding -EvidenceDirectory $EvidenceDirectory -ThreadId $ThreadId
    $statePath = Join-Path $EvidenceDirectory $Script:StateFileName
    $eventPath = Join-Path $EvidenceDirectory $Script:EventFileName
    $existing = Read-WatchJson -Path $statePath
    if ($null -ne $existing) {
        $existingTransport = Get-WatchContinuationTransport -State $existing
        if ($existingTransport -ne $requestedTransport) {
            throw 'Existing watcher continuation transport does not match the requested mode.'
        }
        $existingPid = [int](Get-WatchProperty $existing 'processId' 0)
        $existingPhase = [string](Get-WatchProperty $existing 'phase' '')
        $alive = $false
        if ($existingPid -gt 0) {
            $alive = $null -ne (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)
        }
        if (-not ($alive -and $existingPhase -eq 'running') -and -not [System.IO.File]::Exists($eventPath)) {
            throw 'A stale watcher state exists without a terminal event. Inspect watch-state.json and watch.log before starting another watcher.'
        }
        return [ordered]@{
            ok = $true
            command = 'start'
            started = $false
            reused = $alive -and $existingPhase -eq 'running'
            alreadyTerminal = [System.IO.File]::Exists($eventPath)
            processId = $existingPid
            watcherId = [string](Get-WatchProperty $existing 'watcherId' '')
            stateFile = $Script:StateFileName
            eventFile = if ([System.IO.File]::Exists($eventPath)) { $Script:EventFileName } else { $null }
            continuationRegistered = $existingTransport -eq 'codex-stop-hook'
            continuationTransport = $existingTransport
        }
    }

    $WatcherTimeoutSeconds = Get-WatchRemainingDeadlineSeconds `
        -DeadlineAtUtc ([string](Get-WatchProperty $binding 'ResponseDeadlineAtUtc' '')) `
        -RequestedTimeoutSeconds $WatcherTimeoutSeconds
    if ($WatcherTimeoutSeconds -le 0) {
        throw 'The original response deadline expired before the watcher could start.'
    }

    $watcherId = [guid]::NewGuid().ToString()
    $token = [guid]::NewGuid().ToString('N')
    $state = [ordered]@{
        schemaVersion = $Script:WatcherSchemaVersion
        watcher = $Script:WatcherName
        watcherId = $watcherId
        phase = 'starting'
        createdAtUtc = [datetime]::UtcNow.ToString('o')
        processId = 0
        evidenceDirectory = $EvidenceDirectory
        evidencePhaseAtStart = $binding.Phase
        transport = $binding.Transport
        conversationUrl = $binding.ConversationUrl
        urlBindingPending = $binding.UrlBindingPending
        targetBinding = $binding.TargetBinding
        promptSha256 = $binding.PromptSha256
        idempotencyKeySha256 = $binding.IdempotencyKeySha256
        responseDeadlineAtUtc = $binding.ResponseDeadlineAtUtc
        codexThreadId = $binding.CodexThreadId
        pollSeconds = $PollSeconds
        stableStopPolls = $StableStopPolls
        maxProbeFailures = $MaxProbeFailures
        timeoutSeconds = $WatcherTimeoutSeconds
        finalizeTimeoutSeconds = $FinalizeTimeoutSeconds
        noWake = [bool]$disableStopHook
        agentMonitor = [bool]$AgentMonitor
        rootWait = [bool]$RootWait
        launcherHostRetained = [bool]$KeepLauncherAlive
        workerTokenSha256 = Get-WatchSha256Text -Text $token
    }
    Write-WatchJsonAtomic -Path $statePath -Value $state

    $stopHookRegistrationPath = $null

    $workerArguments = New-WatchWorkerArgumentList `
        -ScriptPath $Script:WatcherScriptPath `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -Token $token `
        -ExpectedWatcherId $watcherId `
        -WorkerTimeoutSeconds $WatcherTimeoutSeconds `
        -DisableWake:$disableStopHook `
        -AgentMonitor:$AgentMonitor `
        -RootWait:$RootWait

    try {
        $workerStdoutPath = Join-Path $EvidenceDirectory $Script:WorkerStdoutFileName
        $workerStderrPath = Join-Path $EvidenceDirectory $Script:WorkerStderrFileName
        $process = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList $workerArguments `
            -RedirectStandardOutput $workerStdoutPath `
            -RedirectStandardError $workerStderrPath `
            -WindowStyle Hidden `
            -PassThru
        $state.phase = 'running'
        $state.processId = [int]$process.Id
        $state.startedAtUtc = [datetime]::UtcNow.ToString('o')
        Write-WatchJsonAtomic -Path $statePath -Value $state
    }
    catch {
        $state.phase = 'launch-failed'
        $state.terminalAtUtc = [datetime]::UtcNow.ToString('o')
        Write-WatchJsonAtomic -Path $statePath -Value $state
        throw
    }

    if ($KeepLauncherAlive) {
        Wait-Process -Id ([int]$process.Id) -ErrorAction SilentlyContinue
    }

    return [ordered]@{
        ok = $true
        command = 'start'
        started = $true
        reused = $false
        processId = [int]$process.Id
        watcherId = $watcherId
        codexThreadId = $binding.CodexThreadId
        stateFile = $Script:StateFileName
        eventFile = $Script:EventFileName
        noWake = [bool]$disableStopHook
        agentMonitor = [bool]$AgentMonitor
        rootWait = [bool]$RootWait
        launcherHostRetained = [bool]$KeepLauncherAlive
        continuationRegistered = $false
        continuationTransport = $requestedTransport
        stopHookRegistrationPath = $stopHookRegistrationPath
        pollingConsumesModelTokens = $false
    }
}

function Get-WatchStatus {
    param([Parameter(Mandatory = $true)][string]$EvidenceDirectory)

    $state = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:StateFileName) -Required
    $event = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:EventFileName)
    $processId = [int](Get-WatchProperty $state 'processId' 0)
    $alive = $false
    if ($processId -gt 0) {
        $alive = $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
    }
    return [ordered]@{
        ok = $true
        command = 'status'
        watcherId = [string](Get-WatchProperty $state 'watcherId' '')
        phase = [string](Get-WatchProperty $state 'phase' '')
        processId = $processId
        processAlive = $alive
        terminalStatus = if ($null -eq $event) { $null } else { [string](Get-WatchProperty $event 'status' '') }
        eventFile = if ($null -eq $event) { $null } else { $Script:EventFileName }
        continuationRequested = [System.IO.File]::Exists((Join-Path $EvidenceDirectory $Script:StopHookClaimFileName))
        continuationAcknowledged = [System.IO.File]::Exists((Join-Path $EvidenceDirectory $Script:ContinuationAckFileName))
        continuationTransport = Get-WatchContinuationTransport -State $state
        pollingConsumesModelTokens = $false
    }
}

function Acknowledge-WatchContinuation {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId
    )

    if (-not (Test-WatchThreadId -Value $ThreadId)) {
        throw 'CodexThreadId must be the exact current Codex thread UUID.'
    }
    $state = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:StateFileName) -Required
    $event = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:EventFileName)
    $claim = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:StopHookClaimFileName) -Required
    $watcherId = [string](Get-WatchProperty $state 'watcherId' '')
    $expectedThreadId = $ThreadId.ToLowerInvariant()
    if ([string](Get-WatchProperty $state 'codexThreadId' '') -ne $expectedThreadId -or
        [string](Get-WatchProperty $claim 'codexThreadId' '') -ne $expectedThreadId) {
        throw 'Continuation evidence belongs to another Codex task.'
    }
    $claimWatcherId = [string](Get-WatchProperty $claim 'watcherId' '')
    $claimStatus = [string](Get-WatchProperty $claim 'terminalStatus' '')
    $registrationPath = [string](Get-WatchProperty $state 'stopHookRegistrationPath' '')
    $registrationParent = if ([string]::IsNullOrWhiteSpace($registrationPath)) {
        ''
    }
    else {
        Split-Path -Parent $registrationPath
    }
    $isLegacyClaim = (
        [string]::IsNullOrWhiteSpace($claimWatcherId) -and
        -not [string]::IsNullOrWhiteSpace($registrationParent) -and
        (Split-Path -Leaf $registrationParent) -eq $Script:LegacyStopHookRegistryDirectoryName
    )
    $isSynthesizedStatus = @('worker-crashed', 'timeout') -contains $claimStatus
    if ($isSynthesizedStatus) {
        $callback = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:CallbackFileName) -Required
        $callbackWatcherId = [string](Get-WatchProperty $callback 'watcherId' '')
        $isLegacyCallback = $isLegacyClaim -and [string]::IsNullOrWhiteSpace($callbackWatcherId)
        if (
            [string](Get-WatchProperty $callback 'codexThreadId' '') -ne $expectedThreadId -or
            ($callbackWatcherId -ne $watcherId -and -not $isLegacyCallback) -or
            [string](Get-WatchProperty $callback 'terminalStatus' '') -ne $claimStatus -or
            [bool](Get-WatchProperty $callback 'continuationRequested' $false) -ne $true
        ) {
            throw 'Synthesized continuation callback does not match the reviewed claim.'
        }
        $status = $claimStatus
    }
    else {
        $status = if ($null -eq $event) { '' } else { [string](Get-WatchProperty $event 'status' '') }
        if ([string]::IsNullOrWhiteSpace($status)) {
            throw 'A terminal watch event or matching synthesized claim is required before acknowledgement.'
        }
        if ($claimStatus -ne $status) {
            throw 'Continuation claim terminal status does not match the reviewed result.'
        }
    }
    if ($claimWatcherId -ne $watcherId -and -not $isLegacyClaim) {
        throw 'Continuation claim belongs to another watcher.'
    }
    $acknowledgement = [ordered]@{
        schemaVersion = $Script:WatcherSchemaVersion
        transport = 'codex-stop-hook'
        acknowledged = $true
        acknowledgementType = 'codex-reviewed'
        acknowledgedAtUtc = [datetime]::UtcNow.ToString('o')
        codexThreadId = $expectedThreadId
        watcherId = $watcherId
        terminalStatus = $status
    }
    Write-WatchJsonAtomic -Path (Join-Path $EvidenceDirectory $Script:ContinuationAckFileName) -Value $acknowledgement
    return [ordered]@{
        ok = $true
        command = 'acknowledge'
        acknowledged = $true
        watcherId = $watcherId
        codexThreadId = $expectedThreadId
        terminalStatus = $status
        acknowledgementFile = $Script:ContinuationAckFileName
    }
}

function Get-ValidatedLocalContinuationEvent {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$Transport,
        [Parameter(Mandatory = $true)][string]$ModeLabel
    )

    if (-not (Test-WatchThreadId -Value $ThreadId)) {
        throw 'CodexThreadId must be the exact current Codex thread UUID.'
    }
    $state = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:StateFileName) -Required
    $event = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:EventFileName) -Required
    if ((Get-WatchContinuationTransport -State $state) -ne $Transport) {
        throw "Watcher evidence was not started in $ModeLabel mode."
    }
    $expectedThreadId = $ThreadId.ToLowerInvariant()
    $watcherId = [string](Get-WatchProperty $state 'watcherId' '')
    $status = [string](Get-WatchProperty $event 'status' '')
    if ([string](Get-WatchProperty $state 'codexThreadId' '') -ne $expectedThreadId -or
        [string](Get-WatchProperty $event 'codexThreadId' '') -ne $expectedThreadId) {
        throw "$ModeLabel evidence belongs to another Codex task."
    }
    if ([string]::IsNullOrWhiteSpace($watcherId) -or
        [string](Get-WatchProperty $event 'watcherId' '') -ne $watcherId) {
        throw "$ModeLabel event belongs to another watcher."
    }
    if ($Script:TerminalStatuses -notcontains $status -or
        [bool](Get-WatchProperty $event 'requiresCodexReview' $false) -ne $true -or
        [bool](Get-WatchProperty $event 'automaticResendAllowed' $true) -ne $false) {
        throw "$ModeLabel acknowledgement requires one terminal no-resend event pending Codex review."
    }

    return [pscustomobject]@{
        State = $state
        Event = $event
        ThreadId = $expectedThreadId
        WatcherId = $watcherId
        Status = $status
    }
}

function Wait-RootWatchEvent {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [int]$WaitTimeoutSeconds = $TimeoutSeconds,
        [scriptblock]$NowAction = { [datetime]::UtcNow },
        [scriptblock]$SleepAction = { Start-Sleep -Milliseconds 500 },
        [scriptblock]$ProcessAliveAction = { param($ProcessId) $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) }
    )

    if ($WaitTimeoutSeconds -lt 1 -or $WaitTimeoutSeconds -gt 7200) {
        throw 'WaitTimeoutSeconds must be between 1 and 7200.'
    }
    if (-not (Test-WatchThreadId -Value $ThreadId)) {
        throw 'CodexThreadId must be the exact current Codex thread UUID.'
    }
    $expectedThreadId = $ThreadId.ToLowerInvariant()
    $statePath = Join-Path $EvidenceDirectory $Script:StateFileName
    $eventPath = Join-Path $EvidenceDirectory $Script:EventFileName
    $state = Read-WatchJson -Path $statePath -Required
    if ((Get-WatchContinuationTransport -State $state) -ne 'codex-root-wait') {
        throw 'Watcher evidence was not started in root-wait mode.'
    }
    $watcherId = [string](Get-WatchProperty $state 'watcherId' '')
    if ([string](Get-WatchProperty $state 'codexThreadId' '') -ne $expectedThreadId) {
        throw 'Root-wait evidence belongs to another Codex task.'
    }
    if ([string]::IsNullOrWhiteSpace($watcherId)) {
        throw 'Root-wait evidence has no watcher identity.'
    }
    $responseDeadlineAtUtc = [string](Get-WatchProperty $state 'responseDeadlineAtUtc' '')
    if ([string]::IsNullOrWhiteSpace($responseDeadlineAtUtc)) {
        $adapterState = Read-WatchJson -Path (Join-Path $EvidenceDirectory 'state.json')
        $responseDeadlineAtUtc = [string](Get-WatchProperty $adapterState 'responseDeadlineAtUtc' '')
    }
    if ([string]::IsNullOrWhiteSpace($responseDeadlineAtUtc)) {
        throw 'Root-wait evidence has no responseDeadlineAtUtc.'
    }

    $started = [datetime](& $NowAction)
    while ($true) {
        if ((Get-WatchRemainingDeadlineSeconds -DeadlineAtUtc $responseDeadlineAtUtc -RequestedTimeoutSeconds $WaitTimeoutSeconds -NowAction $NowAction) -le 0) {
            throw 'The original response deadline expired while waiting for the root-wait watcher event.'
        }
        if ([System.IO.File]::Exists($eventPath)) {
            $validated = Get-ValidatedLocalContinuationEvent `
                -EvidenceDirectory $EvidenceDirectory `
                -ThreadId $expectedThreadId `
                -Transport 'codex-root-wait' `
                -ModeLabel 'Root-wait'
            $phase = [string](Get-WatchProperty $validated.State 'phase' '')
            if ($phase -eq 'terminal') {
                if ([string](Get-WatchProperty $validated.State 'terminalStatus' '') -ne $validated.Status) {
                    throw 'Root-wait terminal state does not match its event.'
                }
                if ((Get-WatchRemainingDeadlineSeconds -DeadlineAtUtc $responseDeadlineAtUtc -RequestedTimeoutSeconds $WaitTimeoutSeconds -NowAction $NowAction) -le 0) {
                    throw 'The original response deadline expired before the root-wait terminal event was accepted.'
                }
                return [ordered]@{
                    ok = $true
                    command = 'wait-root'
                    watcherId = $validated.WatcherId
                    codexThreadId = $validated.ThreadId
                    terminalStatus = $validated.Status
                    terminalOutcome = [string](Get-WatchProperty $validated.Event 'terminalOutcome' '')
                    eventFile = $Script:EventFileName
                    pollingConsumesModelTokens = $false
                }
            }
            if (@('starting', 'running') -notcontains $phase) {
                throw 'Root-wait event appeared with an invalid watcher phase.'
            }
        }
        if (([datetime](& $NowAction) - $started).TotalSeconds -ge $WaitTimeoutSeconds) {
            throw 'Timed out waiting for the root-wait watcher event.'
        }
        $processId = [int](Get-WatchProperty $state 'processId' 0)
        if ($processId -gt 0 -and -not [bool](& $ProcessAliveAction $processId)) {
            $loopResult = [pscustomobject]@{
                Status = 'worker-crashed'
                Reason = 'root-wait-worker-not-running'
                Observations = 0
                ConsecutiveProbeFailures = 0
                FinalizeResult = $null
            }
            $null = Complete-WatchTerminalEvidence -StatePath $statePath -EventPath $eventPath -State $state -LoopResult $loopResult
            continue
        }
        & $SleepAction
        $state = Read-WatchJson -Path $statePath -Required
        if ((Get-WatchContinuationTransport -State $state) -ne 'codex-root-wait' -or
            [string](Get-WatchProperty $state 'codexThreadId' '') -ne $expectedThreadId -or
            [string](Get-WatchProperty $state 'watcherId' '') -ne $watcherId) {
            throw 'Root-wait watcher binding changed while waiting.'
        }
    }
}

function Acknowledge-LocalContinuation {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$Transport,
        [Parameter(Mandatory = $true)][string]$ModeLabel,
        [Parameter(Mandatory = $true)][string]$AcknowledgementType,
        [Parameter(Mandatory = $true)][string]$CommandName
    )

    $validated = Get-ValidatedLocalContinuationEvent `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -Transport $Transport `
        -ModeLabel $ModeLabel

    $acknowledgementPath = Join-Path $EvidenceDirectory $Script:ContinuationAckFileName
    $stableFields = [ordered]@{
        schemaVersion = $Script:WatcherSchemaVersion
        transport = $Transport
        acknowledged = $true
        acknowledgementType = $AcknowledgementType
        codexThreadId = $validated.ThreadId
        watcherId = $validated.WatcherId
        terminalStatus = $validated.Status
    }
    $existing = Read-WatchJson -Path $acknowledgementPath
    if ($null -ne $existing) {
        foreach ($name in $stableFields.Keys) {
            if ((Get-WatchProperty $existing $name $null) -ne $stableFields[$name]) {
                throw "Existing watcher acknowledgement conflicts with the $ModeLabel review."
            }
        }
    }
    else {
        $acknowledgement = [ordered]@{}
        foreach ($name in $stableFields.Keys) {
            $acknowledgement[$name] = $stableFields[$name]
        }
        $acknowledgement.acknowledgedAtUtc = [datetime]::UtcNow.ToString('o')
        Write-WatchJsonAtomic -Path $acknowledgementPath -Value $acknowledgement
    }
    return [ordered]@{
        ok = $true
        command = $CommandName
        acknowledged = $true
        reused = $null -ne $existing
        watcherId = $validated.WatcherId
        codexThreadId = $validated.ThreadId
        terminalStatus = $validated.Status
        acknowledgementFile = $Script:ContinuationAckFileName
    }
}

function Acknowledge-AgentMonitor {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId
    )

    return Acknowledge-LocalContinuation `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -Transport 'codex-agent-monitor' `
        -ModeLabel 'Agent-monitor' `
        -AcknowledgementType 'codex-agent-monitor-reviewed' `
        -CommandName 'acknowledge-monitor'
}

function Acknowledge-RootWait {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId
    )

    return Acknowledge-LocalContinuation `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -Transport 'codex-root-wait' `
        -ModeLabel 'Root-wait' `
        -AcknowledgementType 'codex-root-wait-reviewed' `
        -CommandName 'acknowledge-root'
}

function Get-CapacityRoot {
    if (-not [string]::IsNullOrWhiteSpace($Script:CapacityRootOverride)) {
        $root = [System.IO.Path]::GetFullPath($Script:CapacityRootOverride)
    }
    else {
        $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        if ([string]::IsNullOrWhiteSpace($localAppData)) {
            throw 'LocalAppData is unavailable for GPT Pro capacity claims.'
        }
        $root = Join-Path (Join-Path $localAppData 'ChatGptProSidebar') $Script:CapacityDirectoryName
    }
    if (-not [System.IO.Directory]::Exists($root)) {
        [System.IO.Directory]::CreateDirectory($root) | Out-Null
    }
    return $root
}

function Enter-CapacityMutex {
    param([int]$TimeoutMilliseconds = 30000)

    $identity = (Get-CapacityRoot).ToLowerInvariant()
    $mutex = [System.Threading.Mutex]::new(
        $false,
        ('Local\ChatGptProSidebarCapacity-' + (Get-WatchSha256Text -Text $identity))
    )
    $acquired = $false
    try {
        try { $acquired = $mutex.WaitOne($TimeoutMilliseconds) }
        catch [System.Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) {
            throw 'Timed out waiting for the GPT Pro capacity mutex.'
        }
        return $mutex
    }
    catch {
        if (-not $acquired) { $mutex.Dispose() }
        throw
    }
}

function Exit-CapacityMutex {
    param([AllowNull()]$Mutex)
    Exit-WatchStartMutex -Mutex $Mutex
}

function Get-CapacitySlotPath {
    param([Parameter(Mandatory = $true)][ValidateRange(1, 6)][int]$Id)
    return Join-Path (Get-CapacityRoot) ('slot-' + $Id + '.json')
}

function Write-CapacityClaimCreateNew {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $json = ($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    $bytes = $Script:Utf8NoBom.GetBytes($json)
    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
}

function Get-CapacityProcessIdentity {
    param([int]$ProcessId = $PID)

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return [ordered]@{
            processId = $ProcessId
            processStartedAtUtc = $process.StartTime.ToUniversalTime().ToString('o')
        }
    }
    catch {
        return [ordered]@{ processId = $ProcessId; processStartedAtUtc = '' }
    }
}

function Test-CapacityOwnerAlive {
    param([Parameter(Mandatory = $true)]$Claim)

    $ownerPid = [int](Get-WatchProperty $Claim 'ownerPid' 0)
    $expectedStartValue = Get-WatchProperty $Claim 'ownerProcessStartedAtUtc' $null
    if ($ownerPid -le 0 -or $null -eq $expectedStartValue -or [string]::IsNullOrWhiteSpace([string]$expectedStartValue)) {
        return $false
    }
    try {
        $actual = (Get-Process -Id $ownerPid -ErrorAction Stop).StartTime.ToUniversalTime()
        $expected = if ($expectedStartValue -is [datetime]) {
            $expectedStartValue.ToUniversalTime()
        }
        elseif ($expectedStartValue -is [datetimeoffset]) {
            $expectedStartValue.UtcDateTime
        }
        else {
            [datetimeoffset]::ParseExact(
                [string]$expectedStartValue,
                'o',
                [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::None
            ).UtcDateTime
        }
        return [Math]::Abs(($actual - $expected).TotalSeconds) -lt 1
    }
    catch {
        return $false
    }
}

function Get-CapacityReleaseProof {
    param(
        [Parameter(Mandatory = $true)]$Claim,
        [switch]$OwnerCompletionObserved
    )

    if (-not $OwnerCompletionObserved -and (Test-CapacityOwnerAlive -Claim $Claim)) {
        return [pscustomobject]@{ safe = $false; reason = 'owner-still-running' }
    }
    $directory = [string](Get-WatchProperty $Claim 'evidenceDirectory' '')
    $adapterState = if ([string]::IsNullOrWhiteSpace($directory)) {
        $null
    }
    else {
        Read-WatchJson -Path (Join-Path $directory 'state.json')
    }
    $retryOutcome = [string](Get-WatchProperty $adapterState 'retryOutcome' '')
    if (-not [string]::IsNullOrWhiteSpace($retryOutcome)) {
        if ($retryOutcome -ne 'retry-not-submitted') {
            return [pscustomobject]@{ safe = $false; reason = 'adapter-recovery-required' }
        }
        if (
            [string](Get-WatchProperty $adapterState 'codexThreadId' '') -eq [string](Get-WatchProperty $Claim 'codexThreadId' '') -and
            -not [bool](Get-WatchProperty $adapterState 'automaticResendAllowed' $true)
        ) {
            $attempts = @(Get-WatchProperty $adapterState 'attempts' @())
            $retryPreparationFailed = [bool](Get-WatchProperty $adapterState 'retryPreparationFailedBeforeClick' $false)
            $expectedAttemptCount = if ($retryPreparationFailed) { 1 } else { 2 }
            $proofAttemptNumber = if ($retryPreparationFailed) { 1 } else { 2 }
            $proofOutcome = if ($retryPreparationFailed) { 'proved-not-submitted' } else { 'retry-not-submitted' }
            $proofAttempt = @($attempts | Where-Object { [int](Get-WatchProperty $_ 'attempt' 0) -eq $proofAttemptNumber })
            $promptSha256 = [string](Get-WatchProperty $adapterState 'promptSha256' '')
            if (
                [int](Get-WatchProperty $adapterState 'attemptCount' 0) -eq $expectedAttemptCount -and
                $attempts.Count -eq $expectedAttemptCount -and
                (-not $retryPreparationFailed -or -not [string]::IsNullOrWhiteSpace([string](Get-WatchProperty $adapterState 'retryFailureCategory' ''))) -and
                $proofAttempt.Count -eq 1 -and
                [string](Get-WatchProperty $proofAttempt[0] 'outcome' '') -eq $proofOutcome -and
                [string]::IsNullOrWhiteSpace([string](Get-WatchProperty $proofAttempt[0] 'exactConversationUrl' '')) -and
                -not [bool](Get-WatchProperty $proofAttempt[0] 'userTurnObserved' $true) -and
                -not [bool](Get-WatchProperty $proofAttempt[0] 'generatingObserved' $true) -and
                -not [string]::IsNullOrWhiteSpace($promptSha256) -and
                [string](Get-WatchProperty $proofAttempt[0] 'composerSha256Observed' '') -eq $promptSha256
            ) {
                return [pscustomobject]@{ safe = $true; reason = 'durable-retry-not-submitted' }
            }
        }
        return [pscustomobject]@{ safe = $false; reason = 'retry-not-submitted-proof-incomplete' }
    }
    $claimPhase = [string](Get-WatchProperty $Claim 'phase' '')
    if ($claimPhase -eq 'terminal') {
        return [pscustomobject]@{ safe = $true; reason = 'terminal-claim' }
    }
    if ($claimPhase -eq 'pre-click-unsent') {
        return [pscustomobject]@{ safe = $true; reason = 'pre-click-unsent-claim' }
    }
    if ($claimPhase -eq 'slot-acquired-pre-send' -and -not (Test-CapacityOwnerAlive -Claim $Claim)) {
        return [pscustomobject]@{ safe = $true; reason = 'never-launched' }
    }

    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        $adapterPhase = [string](Get-WatchProperty $adapterState 'phase' '')
        if ($adapterPhase -eq 'pre-invoke-failed' -and -not [bool](Get-WatchProperty $adapterState 'invokeAttempted' $true)) {
            return [pscustomobject]@{ safe = $true; reason = 'durable-pre-click-unsent' }
        }
        if ($adapterPhase -eq 'completed') {
            return [pscustomobject]@{ safe = $true; reason = 'durable-adapter-terminal' }
        }
        $watchState = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName)
        $event = Read-WatchJson -Path (Join-Path $directory $Script:EventFileName)
        $eventStatus = [string](Get-WatchProperty $event 'status' '')
        if (
            [string](Get-WatchProperty $watchState 'phase' '') -eq 'terminal' -and
            $Script:TerminalStatuses -contains $eventStatus -and
            [string](Get-WatchProperty $watchState 'codexThreadId' '') -eq [string](Get-WatchProperty $Claim 'codexThreadId' '')
        ) {
            return [pscustomobject]@{ safe = $true; reason = 'durable-watcher-terminal' }
        }
    }
    return [pscustomobject]@{ safe = $false; reason = 'terminal-state-not-proven' }
}

function Set-CapacitySlotClaim {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 6)][int]$Id,
        [Parameter(Mandatory = $true)][string]$ClaimId,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Changes
    )

    $mutex = Enter-CapacityMutex
    try {
        $path = Get-CapacitySlotPath -Id $Id
        $claim = Read-WatchJson -Path $path -Required
        if ([string](Get-WatchProperty $claim 'claimId' '') -ne $ClaimId) {
            throw 'Capacity slot ownership changed.'
        }
        foreach ($name in $Changes.Keys) {
            $claim | Add-Member -NotePropertyName $name -NotePropertyValue $Changes[$name] -Force
        }
        Write-WatchJsonAtomic -Path $path -Value $claim
        return $claim
    }
    finally {
        Exit-CapacityMutex -Mutex $mutex
    }
}

function Release-CapacitySlot {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 6)][int]$Id,
        [AllowEmptyString()][string]$ExpectedClaimId = '',
        [switch]$OwnerCompletionObserved
    )

    $mutex = Enter-CapacityMutex
    try {
        $path = Get-CapacitySlotPath -Id $Id
        $claim = Read-WatchJson -Path $path -Required
        if (-not [string]::IsNullOrWhiteSpace($ExpectedClaimId) -and
            [string](Get-WatchProperty $claim 'claimId' '') -ne $ExpectedClaimId) {
            throw 'Capacity slot ownership changed.'
        }
        $proof = Get-CapacityReleaseProof -Claim $claim -OwnerCompletionObserved:$OwnerCompletionObserved
        if (-not $proof.safe) {
            $exception = [System.InvalidOperationException]::new(
                'Capacity slot cannot be released because terminal or pre-click state is not proven.'
            )
            $exception.Data['Category'] = 'ConcurrencySlotRecoveryRequired'
            throw $exception
        }
        [System.IO.File]::Delete($path)
        return [ordered]@{ ok = $true; command = 'release-slot'; slotId = $Id; proof = $proof.reason }
    }
    finally {
        Exit-CapacityMutex -Mutex $mutex
    }
}

function Acquire-CapacitySlot {
    param(
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$RoundId,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory
    )

    $mutex = Enter-CapacityMutex
    try {
        $claims = [System.Collections.ArrayList]::new()
        $unsafeOrphan = $false
        $unsafeThreadOrphan = $false
        foreach ($id in 1..$Script:CapacitySlotCount) {
            $path = Get-CapacitySlotPath -Id $id
            $claim = Read-WatchJson -Path $path
            if ($null -eq $claim) { continue }
            if (-not (Test-CapacityOwnerAlive -Claim $claim)) {
                $proof = Get-CapacityReleaseProof -Claim $claim
                if ($proof.safe) {
                    [System.IO.File]::Delete($path)
                    continue
                }
                $unsafeOrphan = $true
                if ([string](Get-WatchProperty $claim 'codexThreadId' '') -eq $ThreadId) {
                    $unsafeThreadOrphan = $true
                }
            }
            $null = $claims.Add($claim)
        }
        if (@($claims | Where-Object { [string](Get-WatchProperty $_ 'codexThreadId' '') -eq $ThreadId }).Count -ge $Script:PerThreadSlotCount) {
            $category = if ($unsafeThreadOrphan) { 'ConcurrencySlotRecoveryRequired' } else { 'ConcurrencySlotQueued' }
            return [pscustomobject]@{ acquired = $false; category = $category; reason = 'per-thread-capacity' }
        }
        $usedIds = @($claims | ForEach-Object { [int](Get-WatchProperty $_ 'slotId' 0) })
        $freeId = @(1..$Script:CapacitySlotCount | Where-Object { $usedIds -notcontains $_ } | Select-Object -First 1)
        if ($freeId.Count -eq 0) {
            $category = if ($unsafeOrphan) { 'ConcurrencySlotRecoveryRequired' } else { 'ConcurrencySlotQueued' }
            return [pscustomobject]@{ acquired = $false; category = $category; reason = 'global-capacity' }
        }
        $slotIdValue = [int]$freeId[0]
        $claimId = [guid]::NewGuid().ToString()
        $owner = Get-CapacityProcessIdentity
        $claim = [ordered]@{
            schemaVersion = 1
            slotId = $slotIdValue
            claimId = $claimId
            codexThreadId = $ThreadId
            roundId = $RoundId
            evidenceDirectory = [System.IO.Path]::GetFullPath($EvidenceDirectory)
            evidenceDirectorySha256 = Get-WatchSha256Text -Text ([System.IO.Path]::GetFullPath($EvidenceDirectory).ToLowerInvariant())
            watcherId = ''
            ownerPid = $owner.processId
            ownerProcessStartedAtUtc = $owner.processStartedAtUtc
            phase = 'slot-acquired-pre-send'
            submissionAttempted = $false
            acquiredAtUtc = [datetime]::UtcNow.ToString('o')
        }
        Write-CapacityClaimCreateNew -Path (Get-CapacitySlotPath -Id $slotIdValue) -Value $claim
        return [pscustomobject]@{ acquired = $true; slotId = $slotIdValue; claimId = $claimId; claim = $claim }
    }
    finally {
        Exit-CapacityMutex -Mutex $mutex
    }
}

function Get-CapacitySlots {
    $items = foreach ($id in 1..$Script:CapacitySlotCount) {
        $claim = Read-WatchJson -Path (Get-CapacitySlotPath -Id $id)
        if ($null -eq $claim) { continue }
        [ordered]@{
            slotId = $id
            codexThreadId = [string](Get-WatchProperty $claim 'codexThreadId' '')
            roundId = [string](Get-WatchProperty $claim 'roundId' '')
            evidenceDirectorySha256 = [string](Get-WatchProperty $claim 'evidenceDirectorySha256' '')
            watcherId = [string](Get-WatchProperty $claim 'watcherId' '')
            ownerPid = [int](Get-WatchProperty $claim 'ownerPid' 0)
            ownerProcessStartedAtUtc = [string](Get-WatchProperty $claim 'ownerProcessStartedAtUtc' '')
            ownerAlive = Test-CapacityOwnerAlive -Claim $claim
            phase = [string](Get-WatchProperty $claim 'phase' '')
        }
    }
    return [ordered]@{ ok = $true; command = 'slots'; slots = @($items) }
}

function Resolve-BatchContainedPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [System.IO.Path]::IsPathRooted($Path)) {
        throw "$Label must be an absolute path."
    }
    $full = [System.IO.Path]::GetFullPath($Path)
    $prefix = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside the batch manifest directory."
    }
    $cursor = if ([System.IO.File]::Exists($full)) { [System.IO.Path]::GetDirectoryName($full) } else { $full }
    while (-not [string]::IsNullOrWhiteSpace($cursor) -and $cursor.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        if (([System.IO.File]::GetAttributes($cursor) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Label cannot cross a reparse point."
        }
        $cursor = [System.IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}

function Read-RootWaitBatchManifest {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [System.IO.File]::Exists($Path)) {
        throw 'ManifestPath must be an existing JSON file.'
    }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetDirectoryName($fullPath)
    $manifest = Read-WatchJson -Path $fullPath -Required
    if ([int](Get-WatchProperty $manifest 'schemaVersion' 0) -ne 1) {
        throw 'Batch manifest schemaVersion must be 1.'
    }
    $threadId = [string](Get-WatchProperty $manifest 'codexThreadId' '')
    if (-not (Test-WatchThreadId -Value $threadId)) {
        throw 'Batch manifest codexThreadId must be an exact UUID.'
    }
    $maxConcurrency = [int](Get-WatchProperty $manifest 'maxConcurrency' 3)
    if ($maxConcurrency -lt 1 -or $maxConcurrency -gt $Script:PerThreadSlotCount) {
        throw 'Batch maxConcurrency must be between 1 and 3.'
    }
    $batchTimeout = [int](Get-WatchProperty $manifest 'timeoutSeconds' 7200)
    if ($batchTimeout -lt 30 -or $batchTimeout -gt 7200) {
        throw 'Batch timeoutSeconds must be between 30 and 7200.'
    }
    $rounds = @(Get-WatchProperty $manifest 'rounds' @())
    if ($rounds.Count -lt 1 -or $rounds.Count -gt $Script:MaximumBatchRounds) {
        throw "Batch rounds must contain between 1 and $($Script:MaximumBatchRounds) items."
    }
    $seenRoundIds = @{}
    $seenKeys = @{}
    $seenEvidence = @{}
    $seenTargets = @{}
    $normalized = [System.Collections.ArrayList]::new()
    foreach ($round in $rounds) {
        $roundId = [string](Get-WatchProperty $round 'roundId' '')
        if ($roundId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $seenRoundIds.ContainsKey($roundId)) {
            throw 'Batch roundId values must be unique bounded identifiers.'
        }
        $seenRoundIds[$roundId] = $true
        $key = [string](Get-WatchProperty $round 'idempotencyKey' '')
        if ([string]::IsNullOrWhiteSpace($key) -or $key.Length -gt 512 -or $seenKeys.ContainsKey($key)) {
            throw 'Batch idempotencyKey values must be non-empty, unique, and at most 512 characters.'
        }
        $seenKeys[$key] = $true
        $prompt = Resolve-BatchContainedPath -Path ([string](Get-WatchProperty $round 'promptPath' '')) -Root $root -Label 'promptPath'
        $evidence = Resolve-BatchContainedPath -Path ([string](Get-WatchProperty $round 'evidenceDirectory' '')) -Root $root -Label 'evidenceDirectory'
        if (-not [System.IO.File]::Exists($prompt)) { throw 'Every batch promptPath must exist.' }
        if (-not [System.IO.Directory]::Exists($evidence)) { throw 'Every batch evidenceDirectory must exist.' }
        if (@([System.IO.Directory]::EnumerateFileSystemEntries($evidence)).Count -ne 0) {
            throw 'Every batch evidenceDirectory must be empty before its first send.'
        }
        $evidenceKey = $evidence.ToLowerInvariant()
        if ($seenEvidence.ContainsKey($evidenceKey)) { throw 'Batch evidenceDirectory values must be unique.' }
        $seenEvidence[$evidenceKey] = $true
        $target = Get-WatchProperty $round 'targetBinding' $null
        $targetValues = @(
            [string](Get-WatchProperty $target 'browserId' ''),
            [string](Get-WatchProperty $target 'profileId' ''),
            [string](Get-WatchProperty $target 'tabId' ''),
            [string](Get-WatchProperty $target 'sessionKey' '')
        )
        $targetCount = @($targetValues | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        if ($targetCount -ne 0 -and $targetCount -ne 4) {
            throw 'Each batch targetBinding must be complete or omitted.'
        }
        if ($rounds.Count -gt 1 -and $targetCount -ne 4) {
            throw 'Multi-round batches require one complete targetBinding per round.'
        }
        if ($targetCount -eq 4) {
            $targetKey = $targetValues -join [char]31
            if ($seenTargets.ContainsKey($targetKey)) {
                throw 'Batch targetBinding values must be unique.'
            }
            $seenTargets[$targetKey] = $true
        }
        $null = $normalized.Add([pscustomobject]@{
            RoundId = $roundId
            PromptPath = $prompt
            EvidenceDirectory = $evidence
            IdempotencyKey = $key
            TargetBinding = $target
            FreshConversation = [bool](Get-WatchProperty $round 'freshConversation' $false)
        })
    }
    return [pscustomobject]@{
        Path = $fullPath
        Root = $root
        CodexThreadId = $threadId.ToLowerInvariant()
        MaxConcurrency = $maxConcurrency
        TimeoutSeconds = $batchTimeout
        Rounds = @($normalized)
        ResultPath = Join-Path $root $Script:BatchResultFileName
    }
}

function New-BatchRoundArgumentList {
    param(
        [Parameter(Mandatory = $true)]$Round,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][int]$RoundTimeoutSeconds,
        [Parameter(Mandatory = $true)][string]$RoundDeadlineAtUtc
    )

    foreach ($path in @($Script:WatcherScriptPath, $Round.PromptPath, $Round.EvidenceDirectory)) {
        if ([string]$path -match '"') { throw 'Batch process paths cannot contain a double quote.' }
    }
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-File', $Script:WatcherScriptPath, 'run-root',
        '-EvidenceDir', $Round.EvidenceDirectory,
        '-CodexThreadId', $ThreadId,
        '-PromptPath', $Round.PromptPath,
        '-IdempotencyKey', [string]$Round.IdempotencyKey,
        '-TimeoutSeconds', [string]$RoundTimeoutSeconds,
        '-ResponseDeadlineAtUtc', $RoundDeadlineAtUtc
    )
    $target = $Round.TargetBinding
    if ($null -ne $target) {
        $arguments += @(
            '-BrowserId', [string](Get-WatchProperty $target 'browserId' ''),
            '-Profile', [string](Get-WatchProperty $target 'profileId' ''),
            '-TabId', [string](Get-WatchProperty $target 'tabId' ''),
            '-SessionKey', [string](Get-WatchProperty $target 'sessionKey' '')
        )
    }
    if ($Round.FreshConversation) { $arguments += '-FreshConversation' }
    return @($arguments | ForEach-Object { ConvertTo-WatchWindowsProcessArgument -Value ([string]$_) })
}

function Start-BatchRoundProcess {
    param(
        [Parameter(Mandatory = $true)]$Round,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][int]$RoundTimeoutSeconds,
        [Parameter(Mandatory = $true)][string]$RoundDeadlineAtUtc,
        [Parameter(Mandatory = $true)][string]$RuntimeDirectory
    )

    $stdout = Join-Path $RuntimeDirectory ($Round.RoundId + '.stdout.log')
    $stderr = Join-Path $RuntimeDirectory ($Round.RoundId + '.stderr.log')
    $process = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList (New-BatchRoundArgumentList -Round $Round -ThreadId $ThreadId -RoundTimeoutSeconds $RoundTimeoutSeconds -RoundDeadlineAtUtc $RoundDeadlineAtUtc) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    return [pscustomobject]@{ Process = $process; StdoutPath = $stdout; StderrPath = $stderr }
}

function Read-BatchRoundProcessResult {
    param(
        [Parameter(Mandatory = $true)]$ActiveRound,
        [Parameter(Mandatory = $true)][datetime]$CompletedAt,
        [scriptblock]$ReadLinesAction = {
            param($Path)
            [System.IO.File]::ReadAllLines($Path, $Script:Utf8NoBom)
        },
        [scriptblock]$SleepAction = { Start-Sleep -Milliseconds 50 }
    )

    $process = $ActiveRound.Process
    $process.WaitForExit()
    try { $process.Dispose() } catch { }
    $payload = $null
    if ([System.IO.File]::Exists($ActiveRound.StdoutPath)) {
        foreach ($attempt in 1..20) {
            try {
                $lines = @(& $ReadLinesAction $ActiveRound.StdoutPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                break
            }
            catch {
                $failure = $_.Exception
                $isIoFailure = $false
                while ($null -ne $failure) {
                    if ($failure -is [System.IO.IOException]) {
                        $isIoFailure = $true
                        break
                    }
                    $failure = $failure.InnerException
                }
                if (-not $isIoFailure) { throw }
                if ($attempt -eq 20) {
                    $lines = @()
                    break
                }
                & $SleepAction
            }
        }
        if ($lines.Count -gt 0) {
            try { $payload = $lines[-1] | ConvertFrom-Json } catch { $payload = $null }
        }
    }
    $state = Read-WatchJson -Path (Join-Path $ActiveRound.Round.EvidenceDirectory 'state.json')
    $event = Read-WatchJson -Path (Join-Path $ActiveRound.Round.EvidenceDirectory $Script:EventFileName)
    $terminalStatus = [string](Get-WatchProperty $payload 'terminalStatus' '')
    if ([string]::IsNullOrWhiteSpace($terminalStatus)) {
        $eventStatus = [string](Get-WatchProperty $event 'status' '')
        if ($Script:TerminalStatuses -contains $eventStatus) {
            $terminalStatus = $eventStatus
        }
    }
    $errorCategory = [string](Get-WatchProperty $payload 'category' '')
    if ([string]::IsNullOrWhiteSpace($errorCategory)) {
        $errorCategory = [string](Get-WatchProperty $state 'preInvokeFailureCategory' '')
    }
    $terminalOutcome = [string](Get-WatchProperty $payload 'terminalOutcome' '')
    if ([string]::IsNullOrWhiteSpace($terminalOutcome)) {
        $terminalOutcome = [string](Get-WatchProperty $event 'terminalOutcome' '')
    }
    if ([string]::IsNullOrWhiteSpace($terminalOutcome)) {
        $terminalOutcome = [string](Get-WatchProperty $state 'retryOutcome' '')
    }
    $target = Get-WatchProperty $state 'targetBinding' $ActiveRound.Round.TargetBinding
    $conversationUrl = [string](Get-WatchProperty $state 'conversationUrlBound' '')
    if ([string]::IsNullOrWhiteSpace($conversationUrl)) {
        $conversationUrl = [string](Get-WatchProperty $event 'conversationUrl' '')
    }
    return [ordered]@{
        roundId = $ActiveRound.Round.RoundId
        status = if ([string]::IsNullOrWhiteSpace($terminalStatus)) { 'failed' } else { $terminalStatus }
        terminalStatus = $terminalStatus
        terminalOutcome = $terminalOutcome
        errorCategory = if ([string]::IsNullOrWhiteSpace($errorCategory)) { $null } else { $errorCategory }
        submissionAcknowledged = [bool](Get-WatchProperty $payload 'submissionAcknowledged' (Get-WatchProperty $state 'submissionAcknowledged' $false))
        targetBinding = $target
        conversationUrl = $conversationUrl
        promptSha256 = [string](Get-WatchProperty $state 'promptSha256' '')
        responseSha256 = [string](Get-WatchProperty $state 'responseSha256' '')
        evidenceSha256 = [string](Get-WatchProperty $state 'evidenceSha256' '')
        watcherId = [string](Get-WatchProperty $payload 'watcherId' (Get-WatchProperty $event 'watcherId' ''))
        evidenceDirectory = $ActiveRound.Round.EvidenceDirectory
        slotId = $ActiveRound.SlotId
        slotWaitMilliseconds = [math]::Round(($ActiveRound.StartedAt - $ActiveRound.QueuedAt).TotalMilliseconds)
        runDurationMilliseconds = [math]::Round(($CompletedAt - $ActiveRound.StartedAt).TotalMilliseconds)
    }
}

function Invoke-RootWaitBatch {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowEmptyString()][string]$ExpectedThreadId = '',
        [scriptblock]$NowAction = { [datetime]::UtcNow },
        [scriptblock]$SleepAction = { param($milliseconds) Start-Sleep -Milliseconds $milliseconds }
    )

    $manifest = Read-RootWaitBatchManifest -Path $Path
    if (-not [string]::IsNullOrWhiteSpace($ExpectedThreadId) -and
        $manifest.CodexThreadId -ne $ExpectedThreadId.ToLowerInvariant()) {
        throw 'Batch manifest belongs to another Codex task.'
    }
    $batchId = [guid]::NewGuid().ToString()
    $runtime = Join-Path $manifest.Root ('.batch-runtime-' + $batchId)
    [System.IO.Directory]::CreateDirectory($runtime) | Out-Null
    $startedAt = & $NowAction
    $deadline = $startedAt.AddSeconds($manifest.TimeoutSeconds)
    $queued = [System.Collections.ArrayList]::new()
    foreach ($round in $manifest.Rounds) {
        $null = $queued.Add([pscustomobject]@{ Round = $round; QueuedAt = $startedAt })
    }
    $active = [System.Collections.ArrayList]::new()
    $results = [System.Collections.ArrayList]::new()
    $maxObserved = 0

    while ($queued.Count -gt 0 -or $active.Count -gt 0) {
        $now = & $NowAction
        while ($queued.Count -gt 0 -and $active.Count -lt $manifest.MaxConcurrency -and $now -lt $deadline) {
            $queuedItem = $queued[0]
            $slot = Acquire-CapacitySlot `
                -ThreadId $manifest.CodexThreadId `
                -RoundId $queuedItem.Round.RoundId `
                -EvidenceDirectory $queuedItem.Round.EvidenceDirectory
            if (-not $slot.acquired) {
                if ($slot.category -eq 'ConcurrencySlotRecoveryRequired') {
                    $null = $results.Add([ordered]@{
                        roundId = $queuedItem.Round.RoundId
                        status = 'recovery-required'
                        terminalStatus = ''
                        errorCategory = 'ConcurrencySlotRecoveryRequired'
                        submissionAcknowledged = $false
                        targetBinding = $queuedItem.Round.TargetBinding
                        conversationUrl = ''
                        promptSha256 = ''
                        responseSha256 = ''
                        evidenceSha256 = ''
                        watcherId = ''
                        evidenceDirectory = $queuedItem.Round.EvidenceDirectory
                        slotId = $null
                        slotWaitMilliseconds = [math]::Round(($now - $queuedItem.QueuedAt).TotalMilliseconds)
                        runDurationMilliseconds = 0
                    })
                    $queued.RemoveAt(0)
                    continue
                }
                break
            }
            $now = & $NowAction
            if ($now -ge $deadline) {
                $null = Set-CapacitySlotClaim -Id $slot.slotId -ClaimId $slot.claimId -Changes ([ordered]@{
                    phase = 'pre-click-unsent'; submissionAttempted = $false
                })
                $null = Release-CapacitySlot -Id $slot.slotId -ExpectedClaimId $slot.claimId -OwnerCompletionObserved
                break
            }
            $null = $queued.RemoveAt(0)
            $null = Set-CapacitySlotClaim -Id $slot.slotId -ClaimId $slot.claimId -Changes ([ordered]@{
                phase = 'run-starting'; submissionAttempted = $true
            })
            $remaining = [int][Math]::Ceiling(($deadline - $now).TotalSeconds)
            try {
                $started = Start-BatchRoundProcess `
                    -Round $queuedItem.Round `
                    -ThreadId $manifest.CodexThreadId `
                    -RoundTimeoutSeconds $remaining `
                    -RoundDeadlineAtUtc $deadline.ToUniversalTime().ToString('o') `
                    -RuntimeDirectory $runtime
            }
            catch {
                $null = Set-CapacitySlotClaim -Id $slot.slotId -ClaimId $slot.claimId -Changes ([ordered]@{
                    phase = 'pre-click-unsent'; submissionAttempted = $false
                })
                $null = Release-CapacitySlot -Id $slot.slotId -ExpectedClaimId $slot.claimId -OwnerCompletionObserved
                throw
            }
            $owner = Get-CapacityProcessIdentity -ProcessId $started.Process.Id
            $null = Set-CapacitySlotClaim -Id $slot.slotId -ClaimId $slot.claimId -Changes ([ordered]@{
                ownerPid = $owner.processId
                ownerProcessStartedAtUtc = $owner.processStartedAtUtc
            })
            $null = $active.Add([pscustomobject]@{
                Round = $queuedItem.Round
                QueuedAt = $queuedItem.QueuedAt
                StartedAt = $now
                SlotId = $slot.slotId
                ClaimId = $slot.claimId
                Process = $started.Process
                StdoutPath = $started.StdoutPath
                StderrPath = $started.StderrPath
            })
            $maxObserved = [Math]::Max($maxObserved, $active.Count)
            $now = & $NowAction
        }

        foreach ($item in @($active)) {
            $item.Process.Refresh()
            if (-not $item.Process.HasExited) { continue }
            $completedAt = & $NowAction
            $result = Read-BatchRoundProcessResult -ActiveRound $item -CompletedAt $completedAt
            $null = $results.Add($result)
            if (
                $Script:TerminalStatuses -contains $result.terminalStatus -and
                [string]::IsNullOrWhiteSpace([string]$result.terminalOutcome)
            ) {
                $null = Set-CapacitySlotClaim -Id $item.SlotId -ClaimId $item.ClaimId -Changes ([ordered]@{
                    phase = 'terminal'; watcherId = $result.watcherId; terminalStatus = $result.terminalStatus
                })
            }
            try {
                $null = Release-CapacitySlot -Id $item.SlotId -ExpectedClaimId $item.ClaimId -OwnerCompletionObserved
            }
            catch {
                $result.status = 'recovery-required'
                $result.errorCategory = 'ConcurrencySlotRecoveryRequired'
            }
            $item.Process.Dispose()
            $null = $active.Remove($item)
        }

        $now = & $NowAction
        if ($now -ge $deadline -and $queued.Count -gt 0) {
            foreach ($queuedItem in @($queued)) {
                $null = $results.Add([ordered]@{
                    roundId = $queuedItem.Round.RoundId
                    status = 'queued-timeout'
                    terminalStatus = ''
                    errorCategory = 'ConcurrencySlotTimeout'
                    submissionAcknowledged = $false
                    targetBinding = $queuedItem.Round.TargetBinding
                    conversationUrl = ''
                    promptSha256 = ''
                    responseSha256 = ''
                    evidenceSha256 = ''
                    watcherId = ''
                    evidenceDirectory = $queuedItem.Round.EvidenceDirectory
                    slotId = $null
                    slotWaitMilliseconds = [math]::Round(($now - $queuedItem.QueuedAt).TotalMilliseconds)
                    runDurationMilliseconds = 0
                })
            }
            $queued.Clear()
        }

        $batchState = [ordered]@{
            schemaVersion = 1
            batchId = $batchId
            command = 'run-batch-root'
            codexThreadId = $manifest.CodexThreadId
            status = if ($queued.Count -eq 0 -and $active.Count -eq 0) { 'terminal' } else { 'running' }
            allSucceeded = $false
            maxConcurrency = $manifest.MaxConcurrency
            maxObservedConcurrency = $maxObserved
            pollingConsumesModelTokens = $false
            startedAtUtc = $startedAt.ToString('o')
            resultFile = $Script:BatchResultFileName
            items = @($results)
        }
        Write-WatchJsonAtomic -Path $manifest.ResultPath -Value $batchState
        if ($queued.Count -gt 0 -or $active.Count -gt 0) {
            & $SleepAction 100
        }
    }

    $final = Read-WatchJson -Path $manifest.ResultPath -Required
    $final.allSucceeded = @($final.items).Count -eq $manifest.Rounds.Count -and
        @($final.items | Where-Object { $_.terminalStatus -ne 'completed' }).Count -eq 0
    $final | Add-Member -NotePropertyName completedAtUtc -NotePropertyValue ((& $NowAction).ToString('o')) -Force
    Write-WatchJsonAtomic -Path $manifest.ResultPath -Value $final
    return $final
}

function Invoke-RootWaitRound {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$PromptFile,
        [Parameter(Mandatory = $true)][string]$IdempotencyKeyValue,
        [AllowEmptyString()][string]$BrowserIdValue = '',
        [AllowEmptyString()][string]$ProfileValue = '',
        [AllowEmptyString()][string]$TabIdValue = '',
        [AllowEmptyString()][string]$SessionKeyValue = '',
        [AllowEmptyString()][string]$ResponseDeadlineAtUtcValue = '',
        [switch]$RequireFreshConversation,
        [scriptblock]$NowAction = { [datetime]::UtcNow }
    )

    if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 7200) {
        throw 'TimeoutSeconds must be between 1 and 7200 for run-root.'
    }
    $adapterPath = Get-WatchAdapterPath
    $sendResult = $null
    $sendFailure = ''
    try {
        $sendResult = Invoke-WatchAdapterSend `
            -AdapterPath $adapterPath `
            -PromptFile $PromptFile `
            -EvidenceDirectory $EvidenceDirectory `
            -IdempotencyKeyValue $IdempotencyKeyValue `
            -CodexThreadIdValue $ThreadId `
            -BrowserIdValue $BrowserIdValue `
            -ProfileValue $ProfileValue `
            -TabIdValue $TabIdValue `
            -SessionKeyValue $SessionKeyValue `
            -ResponseTimeoutSecondsValue $TimeoutSeconds `
            -ResponseDeadlineAtUtcValue $ResponseDeadlineAtUtcValue `
            -RequireFreshConversation:$RequireFreshConversation
    }
    catch {
        $sendFailure = $_.Exception.Message
    }

    $sendPayload = Get-WatchProperty $sendResult 'Payload' $null
    $adapterState = Read-WatchJson -Path (Join-Path $EvidenceDirectory 'state.json')
    $terminalOutcome = [string](Get-WatchProperty $adapterState 'retryOutcome' '')
    if (-not [string]::IsNullOrWhiteSpace($terminalOutcome)) {
        if (@('retry-not-submitted', 'recovery-required') -notcontains $terminalOutcome) {
            throw ('Adapter returned an unsupported retryOutcome: ' + $terminalOutcome + '.')
        }
        if (
            [string](Get-WatchProperty $adapterState 'transport' '') -cne 'agent-browser-cli-v2' -or
            [string](Get-WatchProperty $adapterState 'codexThreadId' '') -ne $ThreadId.ToLowerInvariant() -or
            [bool](Get-WatchProperty $adapterState 'automaticResendAllowed' $true)
        ) {
            throw 'Adapter terminal outcome is not bound to this no-resend Codex task.'
        }
        $terminalDeadlineAtUtc = [string](Get-WatchProperty $adapterState 'responseDeadlineAtUtc' '')
        $null = Get-WatchRemainingDeadlineSeconds `
            -DeadlineAtUtc $terminalDeadlineAtUtc `
            -RequestedTimeoutSeconds $TimeoutSeconds `
            -NowAction $NowAction
        $terminalCategory = if ($terminalOutcome -eq 'retry-not-submitted') { 'RetryNotSubmitted' } else { 'RecoveryRequired' }
        $completed = Complete-RootWaitTerminalFromAdapterState `
            -EvidenceDirectory $EvidenceDirectory `
            -ThreadId $ThreadId `
            -AdapterState $adapterState `
            -Status 'stopped-unverified' `
            -Reason ('adapter-' + $terminalOutcome) `
            -TerminalOutcome $terminalOutcome `
            -ErrorCategory $terminalCategory
        return [ordered]@{
            ok = $true
            command = 'run-root'
            sendExitCode = Get-WatchProperty $sendResult 'ExitCode' $null
            sendOk = Get-WatchProperty $sendPayload 'ok' $null
            sendCategory = Get-WatchProperty $sendPayload 'category' $terminalCategory
            sendFailure = if ([string]::IsNullOrWhiteSpace($sendFailure)) { $null } else { $sendFailure }
            submittedExactlyOnce = Get-WatchProperty $sendPayload 'submittedExactlyOnce' $null
            sendActionInvokedOnce = Get-WatchProperty $sendPayload 'sendActionInvokedOnce' $null
            submissionAcknowledged = Get-WatchProperty $sendPayload 'submissionAcknowledged' $false
            evidencePhaseAtStart = [string](Get-WatchProperty $adapterState 'phase' '')
            watcherStarted = $false
            watcherReused = $false
            watcherId = [string](Get-WatchProperty $completed.Event 'watcherId' '')
            codexThreadId = [string](Get-WatchProperty $completed.Event 'codexThreadId' '')
            terminalStatus = [string](Get-WatchProperty $completed.Event 'status' '')
            terminalOutcome = $terminalOutcome
            category = $terminalCategory
            responseDeadlineAtUtc = $terminalDeadlineAtUtc
            eventFile = $Script:EventFileName
            continuationTransport = 'codex-root-wait'
            pollingConsumesModelTokens = $false
            acknowledgementPending = $true
        }
    }

    try {
        $binding = Get-WatchEvidenceBinding -EvidenceDirectory $EvidenceDirectory -ThreadId $ThreadId
    }
    catch {
        $payload = Get-WatchProperty $sendResult 'Payload' $null
        $message = [string](Get-WatchProperty $payload 'message' '')
        if (-not [string]::IsNullOrWhiteSpace($sendFailure)) {
            throw ('Adapter send failed before a waitable post-send state: ' + $sendFailure)
        }
        if (-not [string]::IsNullOrWhiteSpace($message)) {
            throw ('Adapter send failed before a waitable post-send state: ' + $message)
        }
        throw
    }

    $responseDeadlineAtUtc = [string](Get-WatchProperty $binding 'ResponseDeadlineAtUtc' '')
    if ([string]::IsNullOrWhiteSpace($responseDeadlineAtUtc)) {
        $responseDeadlineAtUtc = [string](Get-WatchProperty $sendPayload 'responseDeadlineAtUtc' '')
    }
    if ([string]::IsNullOrWhiteSpace($responseDeadlineAtUtc)) {
        throw 'Adapter post-click evidence has no responseDeadlineAtUtc; run-root cannot synthesize a new deadline.'
    }
    $remainingSeconds = Get-WatchRemainingDeadlineSeconds `
        -DeadlineAtUtc $responseDeadlineAtUtc `
        -RequestedTimeoutSeconds $TimeoutSeconds `
        -NowAction $NowAction
    if ($remainingSeconds -le 0) {
        if ($null -eq $adapterState) {
            $adapterState = Read-WatchJson -Path (Join-Path $EvidenceDirectory 'state.json') -Required
        }
        $completed = Complete-RootWaitTerminalFromAdapterState `
            -EvidenceDirectory $EvidenceDirectory `
            -ThreadId $ThreadId `
            -AdapterState $adapterState `
            -Status 'timeout' `
            -Reason 'response-deadline-expired-before-watcher-start'
        return [ordered]@{
            ok = $true
            command = 'run-root'
            sendExitCode = Get-WatchProperty $sendResult 'ExitCode' $null
            sendOk = Get-WatchProperty $sendPayload 'ok' $null
            sendCategory = Get-WatchProperty $sendPayload 'category' $null
            sendFailure = if ([string]::IsNullOrWhiteSpace($sendFailure)) { $null } else { $sendFailure }
            submittedExactlyOnce = Get-WatchProperty $sendPayload 'submittedExactlyOnce' $null
            sendActionInvokedOnce = Get-WatchProperty $sendPayload 'sendActionInvokedOnce' $null
            submissionAcknowledged = Get-WatchProperty $sendPayload 'submissionAcknowledged' $null
            evidencePhaseAtStart = $binding.Phase
            watcherStarted = $false
            watcherReused = $false
            watcherId = [string](Get-WatchProperty $completed.Event 'watcherId' '')
            codexThreadId = [string](Get-WatchProperty $completed.Event 'codexThreadId' '')
            terminalStatus = 'timeout'
            terminalOutcome = ''
            responseDeadlineAtUtc = $responseDeadlineAtUtc
            eventFile = $Script:EventFileName
            continuationTransport = 'codex-root-wait'
            pollingConsumesModelTokens = $false
            acknowledgementPending = $true
        }
    }
    $startResult = Start-WatchProcess `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -WatcherTimeoutSeconds $remainingSeconds `
        -RootWait
    $waitResult = Wait-RootWatchEvent `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -WaitTimeoutSeconds $remainingSeconds

    return [ordered]@{
        ok = $true
        command = 'run-root'
        sendExitCode = Get-WatchProperty $sendResult 'ExitCode' $null
        sendOk = Get-WatchProperty $sendPayload 'ok' $null
        sendCategory = Get-WatchProperty $sendPayload 'category' $null
        sendFailure = if ([string]::IsNullOrWhiteSpace($sendFailure)) { $null } else { $sendFailure }
        submittedExactlyOnce = Get-WatchProperty $sendPayload 'submittedExactlyOnce' $null
        sendActionInvokedOnce = Get-WatchProperty $sendPayload 'sendActionInvokedOnce' $null
        submissionAcknowledged = Get-WatchProperty $sendPayload 'submissionAcknowledged' $null
        evidencePhaseAtStart = $binding.Phase
        watcherStarted = [bool](Get-WatchProperty $startResult 'started' $false)
        watcherReused = [bool](Get-WatchProperty $startResult 'reused' $false)
        watcherId = [string](Get-WatchProperty $waitResult 'watcherId' '')
        codexThreadId = [string](Get-WatchProperty $waitResult 'codexThreadId' '')
        terminalStatus = [string](Get-WatchProperty $waitResult 'terminalStatus' '')
        terminalOutcome = [string](Get-WatchProperty $waitResult 'terminalOutcome' '')
        responseDeadlineAtUtc = $responseDeadlineAtUtc
        eventFile = [string](Get-WatchProperty $waitResult 'eventFile' $Script:EventFileName)
        continuationTransport = 'codex-root-wait'
        pollingConsumesModelTokens = $false
        acknowledgementPending = $true
    }
}

function Invoke-WatchMain {
    if (@('run-root', 'run-batch-root', 'slots', 'release-slot', 'start', 'worker', 'status', 'wait-root', 'acknowledge', 'acknowledge-monitor', 'acknowledge-root') -notcontains $Command) {
        throw 'Command must be run-root, run-batch-root, slots, release-slot, start, worker, status, wait-root, acknowledge, acknowledge-monitor, or acknowledge-root.'
    }
    if (-not [string]::IsNullOrWhiteSpace($ResponseDeadlineAtUtc) -and $Command -ne 'run-root') {
        throw 'ResponseDeadlineAtUtc is valid only with run-root.'
    }
    switch ($Command) {
        'run-batch-root' {
            if ($NoWake -or $AgentMonitor -or $RootWait -or $KeepLauncherAlive -or $FreshConversation) {
                throw 'run-batch-root owns each RootWait lifecycle; watcher mode switches are invalid.'
            }
            return Invoke-RootWaitBatch -Path $ManifestPath -ExpectedThreadId $CodexThreadId
        }
        'slots' {
            return Get-CapacitySlots
        }
        'release-slot' {
            if ($SlotId -lt 1 -or $SlotId -gt $Script:CapacitySlotCount) {
                throw 'SlotId must be between 1 and 6.'
            }
            return Release-CapacitySlot -Id $SlotId
        }
        'run-root' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            if ($NoWake -or $AgentMonitor -or $KeepLauncherAlive) {
                throw 'run-root owns the RootWait lifecycle; NoWake, AgentMonitor, and KeepLauncherAlive are invalid.'
            }
            return Invoke-RootWaitRound `
                -EvidenceDirectory $directory `
                -ThreadId $CodexThreadId `
                -PromptFile $PromptPath `
                -IdempotencyKeyValue $IdempotencyKey `
                -BrowserIdValue $BrowserId `
                -ProfileValue $Profile `
                -TabIdValue $TabId `
                -SessionKeyValue $SessionKey `
                -ResponseDeadlineAtUtcValue $ResponseDeadlineAtUtc `
                -RequireFreshConversation:$FreshConversation
        }
        'start' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            if (-not $RootWait -or $NoWake -or $AgentMonitor) {
                throw 'The V2 watcher must be started with RootWait; NoWake, AgentMonitor, and Stop Hook modes are disabled.'
            }
            return Start-WatchProcess `
                -EvidenceDirectory $directory `
                -ThreadId $CodexThreadId `
                -DisableContinuation:$NoWake `
                -AgentMonitor:$AgentMonitor `
                -RootWait:$RootWait `
                -KeepLauncherAlive:$KeepLauncherAlive
        }
        'worker' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            if (-not $RootWait -or $AgentMonitor) {
                throw 'The V2 worker is internal to RootWait; Stop Hook and model-monitor workers are disabled.'
            }
            return Invoke-WatchWorker `
                -EvidenceDirectory $directory `
                -ThreadId $CodexThreadId `
                -Token $WorkerToken `
                -ExpectedWatcherId $WatcherId `
                -DisableWake:($NoWake -or $AgentMonitor -or $RootWait) `
                -AgentMonitor:$AgentMonitor `
                -RootWait:$RootWait
        }
        'status' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            return Get-WatchStatus -EvidenceDirectory $directory
        }
        'wait-root' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            return Wait-RootWatchEvent `
                -EvidenceDirectory $directory `
                -ThreadId $CodexThreadId `
                -WaitTimeoutSeconds $TimeoutSeconds
        }
        'acknowledge' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            return Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $CodexThreadId
        }
        'acknowledge-monitor' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            return Acknowledge-AgentMonitor -EvidenceDirectory $directory -ThreadId $CodexThreadId
        }
        'acknowledge-root' {
            $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
            return Acknowledge-RootWait -EvidenceDirectory $directory -ThreadId $CodexThreadId
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        [Console]::OutputEncoding = $Script:Utf8NoBom
    }
    catch { }
    try {
        $result = Invoke-WatchMain
        $result | ConvertTo-Json -Depth 10 -Compress
        exit 0
    }
    catch {
        $category = 'WatcherError'
        if ($_.Exception.Data.Contains('Category')) {
            $category = [string]$_.Exception.Data['Category']
        }
        [ordered]@{
            ok = $false
            command = $Command
            code = 1
            category = $category
            message = $_.Exception.Message
        } | ConvertTo-Json -Depth 6 -Compress
        exit 1
    }
}
