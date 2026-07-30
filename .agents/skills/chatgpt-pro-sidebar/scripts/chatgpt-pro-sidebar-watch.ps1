#requires -Version 5.1
# Source encoding: UTF-8 with BOM.
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command,

    [string]$EvidenceDir,
    [string]$CodexThreadId = $env:CODEX_THREAD_ID,
    [string]$WorkerToken,

    [int]$PollSeconds = 5,
    [int]$StableStopPolls = 2,
    [int]$MaxProbeFailures = 3,
    [int]$TimeoutSeconds = 7200,
    [int]$FinalizeTimeoutSeconds = 45,

    [switch]$NoWake
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
$Script:StopHookRegistryDirectoryName = 'stop-hook-v2'
$Script:LegacyStopHookRegistryDirectoryName = 'stop-hook-v1'
$Script:MaximumStopHookWaitSeconds = 7400
$Script:StopHookRegistryRootOverride = $null

function Get-WatchProperty {
    param(
        $InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $InputObject) {
        return $Default
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $Default
    }
    return $property.Value
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

    $conversationUrl = [string](Get-WatchProperty $state 'conversationUrlBound' '')
    if (-not (Test-WatchConversationUrl -Value $conversationUrl)) {
        throw 'state.json does not bind one exact ChatGPT conversation URL.'
    }

    $windowRuntimeId = [string](Get-WatchProperty $state 'windowRuntimeId' '')
    if ($windowRuntimeId -notmatch '^[0-9.-]{1,256}$') {
        throw 'state.json does not bind one valid Codex window runtime ID.'
    }

    return [pscustomobject]@{
        Phase = $phase
        ConversationUrl = $conversationUrl
        WindowRuntimeId = $windowRuntimeId
        PromptSha256 = [string](Get-WatchProperty $state 'promptSha256' '')
        IdempotencyKeySha256 = [string](Get-WatchProperty $state 'idempotencyKeySha256' '')
        CodexThreadId = $ThreadId
    }
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
    if ($ConfiguredTimeoutSeconds -lt 30 -or $ConfiguredTimeoutSeconds -gt 86400) {
        throw 'TimeoutSeconds must be between 30 and 86400.'
    }
    if ($ConfiguredFinalizeTimeoutSeconds -lt 5 -or $ConfiguredFinalizeTimeoutSeconds -gt 300) {
        throw 'FinalizeTimeoutSeconds must be between 5 and 300.'
    }
    if (-not $DisableStopHookHorizon) {
        $maximumWatcherTimeoutSeconds = $Script:MaximumStopHookWaitSeconds - $ConfiguredFinalizeTimeoutSeconds - 120
        if ($ConfiguredTimeoutSeconds -gt $maximumWatcherTimeoutSeconds) {
            throw "TimeoutSeconds must be between 30 and $maximumWatcherTimeoutSeconds for the Stop Hook horizon."
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
    foreach ($item in @($Output)) {
        $text = [string]$item
        if ($text.TrimStart().StartsWith('{')) {
            try {
                $json = $text | ConvertFrom-Json
            }
            catch {
                continue
            }
        }
    }
    return [pscustomobject]@{
        ExitCode = $ExitCode
        Payload = $json
    }
}

function Invoke-WatchAdapterStatus {
    param(
        [Parameter(Mandatory = $true)][string]$AdapterPath,
        [Parameter(Mandatory = $true)][string]$WindowRuntimeId
    )

    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $AdapterPath status -WindowRuntimeId $WindowRuntimeId -NoPanelRecovery -NoFocusRestore 2>&1)
    $exitCode = $LASTEXITCODE
    return ConvertFrom-AdapterOutput -Output $output -ExitCode $exitCode
}

function Invoke-WatchAdapterFinalize {
    param(
        [Parameter(Mandatory = $true)][string]$AdapterPath,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$WindowRuntimeId,
        [Parameter(Mandatory = $true)][int]$FinalizeTimeout
    )

    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $AdapterPath wait -EvidenceDir $EvidenceDirectory -WindowRuntimeId $WindowRuntimeId -TimeoutSeconds $FinalizeTimeout -PollMilliseconds 1000 -NoPanelRecovery -NoFocusRestore 2>&1)
    $exitCode = $LASTEXITCODE
    return ConvertFrom-AdapterOutput -Output $output -ExitCode $exitCode
}

function Invoke-WatchLoop {
    param(
        [Parameter(Mandatory = $true)][string]$BoundConversationUrl,
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
    $observations = 0

    while ($true) {
        $now = & $NowAction
        if (($now - $started).TotalSeconds -ge $OverallTimeoutSeconds) {
            return [pscustomobject]@{
                Status = 'timeout'
                Reason = 'overall-timeout'
                Observations = $observations
                ConsecutiveProbeFailures = $consecutiveFailures
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

            $consecutiveFailures++
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
                    FinalizeResult = $null
                }
            }
            & $SleepAction $SleepSeconds
            continue
        }

        $consecutiveFailures = 0
        $currentUrl = [string](Get-WatchProperty $payload 'url' '')
        $urlExact = [bool](Get-WatchProperty $payload 'urlExact' $false)
        if (-not $urlExact -or $currentUrl -ne $BoundConversationUrl) {
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
            urlExact = $true
            matchedBoundUrl = $true
            stableStoppedPolls = $stableStopped
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
    return [ordered]@{
        schemaVersion = $Script:WatcherSchemaVersion
        watcher = $Script:WatcherName
        watcherId = [string](Get-WatchProperty $WatchState 'watcherId' '')
        status = [string](Get-WatchProperty $LoopResult 'Status' 'worker-crashed')
        reason = [string](Get-WatchProperty $LoopResult 'Reason' 'unexpected-worker-failure')
        terminalAtUtc = [datetime]::UtcNow.ToString('o')
        requiresCodexReview = $true
        automaticResendAllowed = $false
        evidenceDirectory = [string](Get-WatchProperty $WatchState 'evidenceDirectory' '')
        conversationUrl = [string](Get-WatchProperty $WatchState 'conversationUrl' '')
        windowRuntimeId = [string](Get-WatchProperty $WatchState 'windowRuntimeId' '')
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
        [Parameter(Mandatory = $true)][string]$Token
    )

    $statePath = Join-Path $EvidenceDirectory $Script:StateFileName
    $eventPath = Join-Path $EvidenceDirectory $Script:EventFileName
    $state = Read-WatchJson -Path $statePath -Required
    $expectedTokenHash = [string](Get-WatchProperty $state 'workerTokenSha256' '')
    if ([string]::IsNullOrWhiteSpace($Token) -or (Get-WatchSha256Text -Text $Token) -ne $expectedTokenHash) {
        throw 'Worker token does not match the launcher state.'
    }
    $state = Wait-WatchLauncherState -StatePath $statePath -ExpectedWatcherId ([string](Get-WatchProperty $state 'watcherId' ''))

    $adapterPath = Get-WatchAdapterPath
    $boundUrl = [string](Get-WatchProperty $state 'conversationUrl' '')
    $runtimeId = [string](Get-WatchProperty $state 'windowRuntimeId' '')
    $loopResult = $null
    try {
        $loopResult = Invoke-WatchLoop `
            -BoundConversationUrl $boundUrl `
            -StablePollCount ([int](Get-WatchProperty $state 'stableStopPolls' 2)) `
            -FailureLimit ([int](Get-WatchProperty $state 'maxProbeFailures' 3)) `
            -OverallTimeoutSeconds ([int](Get-WatchProperty $state 'timeoutSeconds' 7200)) `
            -SleepSeconds ([int](Get-WatchProperty $state 'pollSeconds' 5)) `
            -ProbeAction { Invoke-WatchAdapterStatus -AdapterPath $adapterPath -WindowRuntimeId $runtimeId } `
            -FinalizeAction {
                Invoke-WatchAdapterFinalize `
                    -AdapterPath $adapterPath `
                    -EvidenceDirectory $EvidenceDirectory `
                    -WindowRuntimeId $runtimeId `
                    -FinalizeTimeout ([int](Get-WatchProperty $state 'finalizeTimeoutSeconds' 45))
            } `
            -SleepAction { param($seconds) Start-Sleep -Seconds $seconds } `
            -NowAction { [datetime]::UtcNow } `
            -ObservationAction { param($record) Write-WatchLog -EvidenceDirectory $EvidenceDirectory -Record $record }
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

    $event = New-WatchEvent -WatchState $state -LoopResult $loopResult
    Write-WatchJsonAtomic -Path $eventPath -Value $event
    $state.phase = 'terminal'
    $state | Add-Member -NotePropertyName terminalStatus -NotePropertyValue $event.status -Force
    $state | Add-Member -NotePropertyName terminalAtUtc -NotePropertyValue $event.terminalAtUtc -Force
    Write-WatchJsonAtomic -Path $statePath -Value $state

    $continuationRegistered = -not [bool](Get-WatchProperty $state 'noWake' $false)
    Write-WatchLog -EvidenceDirectory $EvidenceDirectory -Record ([ordered]@{
        atUtc = [datetime]::UtcNow.ToString('o')
        terminalStatus = $event.status
        continuationRegistered = $continuationRegistered
        continuationTransport = if ($continuationRegistered) { 'codex-stop-hook' } else { 'disabled' }
    })

    return [ordered]@{
        ok = $true
        command = 'worker'
        terminalStatus = $event.status
        eventFile = $Script:EventFileName
        continuationRegistered = $continuationRegistered
        continuationTransport = if ($continuationRegistered) { 'codex-stop-hook' } else { 'disabled' }
    }
}

function ConvertTo-EncodedWorkerCommand {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [Parameter(Mandatory = $true)][string]$Token,
        [switch]$DisableWake
    )

    function Quote-PowerShellLiteral {
        param([Parameter(Mandatory = $true)][string]$Value)
        return "'" + $Value.Replace("'", "''") + "'"
    }

    $parts = @(
        '& ' + (Quote-PowerShellLiteral -Value $ScriptPath),
        'worker',
        '-EvidenceDir ' + (Quote-PowerShellLiteral -Value $EvidenceDirectory),
        '-CodexThreadId ' + (Quote-PowerShellLiteral -Value $ThreadId),
        '-WorkerToken ' + (Quote-PowerShellLiteral -Value $Token),
        '-PollSeconds ' + $PollSeconds,
        '-StableStopPolls ' + $StableStopPolls,
        '-MaxProbeFailures ' + $MaxProbeFailures,
        '-TimeoutSeconds ' + $TimeoutSeconds,
        '-FinalizeTimeoutSeconds ' + $FinalizeTimeoutSeconds
    )
    if ($DisableWake) {
        $parts += '-NoWake'
    }
    $commandText = $parts -join ' '
    return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($commandText))
}

function Start-WatchProcess {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
        [Parameter(Mandatory = $true)][string]$ThreadId,
        [switch]$DisableContinuation
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
        [switch]$DisableContinuation
    )

    Assert-WatchConfiguration `
        -DisableStopHookHorizon:$DisableContinuation `
        -ConfiguredTimeoutSeconds $TimeoutSeconds `
        -ConfiguredFinalizeTimeoutSeconds $FinalizeTimeoutSeconds
    $binding = Get-WatchEvidenceBinding -EvidenceDirectory $EvidenceDirectory -ThreadId $ThreadId
    $statePath = Join-Path $EvidenceDirectory $Script:StateFileName
    $eventPath = Join-Path $EvidenceDirectory $Script:EventFileName
    $existing = Read-WatchJson -Path $statePath
    if ($null -ne $existing) {
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
        }
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
        conversationUrl = $binding.ConversationUrl
        windowRuntimeId = $binding.WindowRuntimeId
        promptSha256 = $binding.PromptSha256
        idempotencyKeySha256 = $binding.IdempotencyKeySha256
        codexThreadId = $binding.CodexThreadId
        pollSeconds = $PollSeconds
        stableStopPolls = $StableStopPolls
        maxProbeFailures = $MaxProbeFailures
        timeoutSeconds = $TimeoutSeconds
        finalizeTimeoutSeconds = $FinalizeTimeoutSeconds
        noWake = [bool]$DisableContinuation
        workerTokenSha256 = Get-WatchSha256Text -Text $token
    }
    Write-WatchJsonAtomic -Path $statePath -Value $state

    $stopHookRegistrationPath = $null
    if (-not $DisableContinuation) {
        $stopHookRegistrationPath = Register-WatchStopHook `
            -EvidenceDirectory $EvidenceDirectory `
            -ThreadId $binding.CodexThreadId `
            -WatcherId $watcherId `
            -WatcherTimeoutSeconds $TimeoutSeconds `
            -FinalizeTimeout $FinalizeTimeoutSeconds
        $state.stopHookRegistrationPath = $stopHookRegistrationPath
        Write-WatchJsonAtomic -Path $statePath -Value $state
    }

    $encoded = ConvertTo-EncodedWorkerCommand `
        -ScriptPath $Script:WatcherScriptPath `
        -EvidenceDirectory $EvidenceDirectory `
        -ThreadId $ThreadId `
        -Token $token `
        -DisableWake:$DisableContinuation

    try {
        $process = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', $encoded) `
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
        noWake = [bool]$DisableContinuation
        continuationRegistered = -not [bool]$DisableContinuation
        continuationTransport = if ($DisableContinuation) { 'disabled' } else { 'codex-stop-hook' }
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
        continuationTransport = if ([bool](Get-WatchProperty $state 'noWake' $false)) { 'disabled' } else { 'codex-stop-hook' }
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
    $event = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:EventFileName) -Required
    $claim = Read-WatchJson -Path (Join-Path $EvidenceDirectory $Script:StopHookClaimFileName) -Required
    $watcherId = [string](Get-WatchProperty $state 'watcherId' '')
    $expectedThreadId = $ThreadId.ToLowerInvariant()
    if ([string](Get-WatchProperty $state 'codexThreadId' '') -ne $expectedThreadId -or
        [string](Get-WatchProperty $claim 'codexThreadId' '') -ne $expectedThreadId) {
        throw 'Continuation evidence belongs to another Codex task.'
    }
    $status = [string](Get-WatchProperty $event 'status' '')
    if ([string]::IsNullOrWhiteSpace($status)) {
        throw 'A terminal watch event is required before acknowledgement.'
    }
    $claimWatcherId = [string](Get-WatchProperty $claim 'watcherId' '')
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
        (Split-Path -Leaf $registrationParent) -eq $Script:LegacyStopHookRegistryDirectoryName -and
        [string](Get-WatchProperty $claim 'terminalStatus' '') -eq $status
    )
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

function Invoke-WatchMain {
    if (@('start', 'worker', 'status', 'acknowledge') -notcontains $Command) {
        throw 'Command must be start, worker, status, or acknowledge.'
    }
    $directory = Resolve-WatchEvidenceDirectory -Path $EvidenceDir
    switch ($Command) {
        'start' {
            return Start-WatchProcess -EvidenceDirectory $directory -ThreadId $CodexThreadId -DisableContinuation:$NoWake
        }
        'worker' {
            return Invoke-WatchWorker -EvidenceDirectory $directory -ThreadId $CodexThreadId -Token $WorkerToken
        }
        'status' {
            return Get-WatchStatus -EvidenceDirectory $directory
        }
        'acknowledge' {
            return Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $CodexThreadId
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
        [ordered]@{
            ok = $false
            command = $Command
            code = 1
            category = 'WatcherError'
            message = $_.Exception.Message
        } | ConvertTo-Json -Depth 6 -Compress
        exit 1
    }
}
