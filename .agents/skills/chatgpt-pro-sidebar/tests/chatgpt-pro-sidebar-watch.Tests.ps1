#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
# Source encoding: UTF-8 with BOM.

BeforeAll {
    $watcherPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar-watch.ps1'
    . $watcherPath

    $script:BoundUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
    $script:ThreadId = '019fa981-725e-7f02-93a7-bb1e1b7aefd3'

    function New-TestTargetBinding {
        param([string]$Url = $script:BoundUrl)

        [pscustomobject]@{
            browserId = 'browser-1'
            profileId = 'profile-1'
            profileLabel = 'work'
            tabId = '101'
            sessionKey = 'browser-1:profile-1:101'
            origin = 'https://chatgpt.com'
            url = $Url
        }
    }

    function New-WatchProbe {
        param(
            [bool]$Generating,
            [string]$Url = $script:BoundUrl,
            [bool]$UrlExact = $true,
            [int]$ExitCode = 0,
            [string]$Category = ''
        )

        $payload = [pscustomobject]@{
            ok = $ExitCode -eq 0
            generating = $Generating
            url = $Url
            urlExact = $UrlExact
            category = $Category
            targetBinding = New-TestTargetBinding -Url $Url
        }
        [pscustomobject]@{ ExitCode = $ExitCode; Payload = $payload }
    }

    function New-WatchFixtureEvidence {
        param(
            [Parameter(Mandatory = $true)][string]$Directory,
            [string]$Phase = 'sent'
        )

        $null = New-Item -ItemType Directory -Path $Directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $Directory 'state.json') -Value ([ordered]@{
            schemaVersion = 1
            phase = $Phase
            transport = 'agent-browser-cli-v2'
            conversationUrlBound = $script:BoundUrl
            targetBinding = New-TestTargetBinding
            promptSha256 = ('a' * 64)
            idempotencyKeySha256 = ('b' * 64)
            responseDeadlineAtUtc = [datetime]::UtcNow.AddHours(2).ToString('o')
        })
    }

    function New-WorkerState {
        param(
            [Parameter(Mandatory = $true)][string]$Directory,
            [Parameter(Mandatory = $true)][string]$Token,
            [bool]$DisableWake
        )

        Write-WatchJsonAtomic -Path (Join-Path $Directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcher = $Script:WatcherName
            watcherId = [guid]::NewGuid().ToString()
            phase = 'running'
            processId = $PID
            evidenceDirectory = $Directory
            transport = 'agent-browser-cli-v2'
            conversationUrl = $script:BoundUrl
            targetBinding = New-TestTargetBinding
            codexThreadId = $script:ThreadId
            pollSeconds = 1
            stableStopPolls = 1
            maxProbeFailures = 2
            timeoutSeconds = 30
            finalizeTimeoutSeconds = 5
            responseDeadlineAtUtc = [datetime]::UtcNow.AddHours(2).ToString('o')
            noWake = $DisableWake
            workerTokenSha256 = Get-WatchSha256Text -Text $Token
        })
    }

    function New-BatchFixture {
        param(
            [Parameter(Mandatory = $true)][string]$Root,
            [int]$RoundCount = 1,
            [string]$ThreadId = $script:ThreadId,
            [int]$MaxConcurrency = 3,
            [AllowNull()][Nullable[int]]$TimeoutSeconds = $null
        )

        $null = New-Item -ItemType Directory -Path $Root -Force
        $rounds = @(
            foreach ($index in 1..$RoundCount) {
                $prompt = Join-Path $Root ("prompt-$index.md")
                $evidence = Join-Path $Root ("evidence-$index")
                [System.IO.File]::WriteAllText($prompt, "request $index", $Script:Utf8NoBom)
                $null = New-Item -ItemType Directory -Path $evidence -Force
                [ordered]@{
                    roundId = "round-$index"
                    promptPath = $prompt
                    evidenceDirectory = $evidence
                    idempotencyKey = "batch-key-$index"
                    targetBinding = [ordered]@{
                        browserId = 'browser-1'
                        profileId = 'profile-1'
                        tabId = [string](100 + $index)
                        sessionKey = "browser-1:profile-1:$($index + 100)"
                    }
                }
            }
        )
        $manifest = [ordered]@{
            schemaVersion = 1
            codexThreadId = $ThreadId
            maxConcurrency = $MaxConcurrency
            rounds = $rounds
        }
        if ($null -ne $TimeoutSeconds) {
            $manifest.timeoutSeconds = [int]$TimeoutSeconds
        }
        $path = Join-Path $Root 'batch-manifest.json'
        Write-WatchJsonAtomic -Path $path -Value $manifest
        return $path
    }

    function Set-AdapterTerminalFixture {
        param(
            [Parameter(Mandatory = $true)][string]$Directory,
            [Parameter(Mandatory = $true)][ValidateSet('retry-not-submitted', 'recovery-required')][string]$Outcome,
            [string]$ThreadId = $script:ThreadId
        )

        New-WatchFixtureEvidence -Directory $Directory -Phase 'send-uncertain'
        $state = Read-WatchJson -Path (Join-Path $Directory 'state.json') -Required
        $state.conversationUrlBound = ''
        $state.targetBinding.url = 'https://chatgpt.com/'
        $state | Add-Member -NotePropertyName conversationUrlBeforeSend -NotePropertyValue '' -Force
        $state | Add-Member -NotePropertyName codexThreadId -NotePropertyValue $ThreadId -Force
        $state | Add-Member -NotePropertyName automaticResendAllowed -NotePropertyValue $false -Force
        $state | Add-Member -NotePropertyName submissionAcknowledged -NotePropertyValue $false -Force
        $state | Add-Member -NotePropertyName retryOutcome -NotePropertyValue $Outcome -Force
        $attempts = if ($Outcome -eq 'retry-not-submitted') {
            @(
                [ordered]@{
                    attempt = 1
                    outcome = 'proved-not-submitted'
                    exactConversationUrl = ''
                    userTurnObserved = $false
                    generatingObserved = $false
                    composerSha256Observed = $state.promptSha256
                },
                [ordered]@{
                    attempt = 2
                    outcome = 'retry-not-submitted'
                    exactConversationUrl = ''
                    userTurnObserved = $false
                    generatingObserved = $false
                    composerSha256Observed = $state.promptSha256
                }
            )
        }
        else {
            @(
                [ordered]@{
                    attempt = 1
                    outcome = 'recovery-required'
                    exactConversationUrl = ''
                    userTurnObserved = $false
                    generatingObserved = $false
                    composerSha256Observed = ''
                }
            )
        }
        $state | Add-Member -NotePropertyName attemptCount -NotePropertyValue $attempts.Count -Force
        $state | Add-Member -NotePropertyName attempts -NotePropertyValue $attempts -Force
        Write-WatchJsonAtomic -Path (Join-Path $Directory 'state.json') -Value $state
        return $state
    }

    function Write-TerminalOutcomeWatcher {
        param(
            [Parameter(Mandatory = $true)][string]$Path,
            [Parameter(Mandatory = $true)][ValidateSet('retry-not-submitted', 'recovery-required')][string]$Outcome
        )

        $category = if ($Outcome -eq 'retry-not-submitted') { 'RetryNotSubmitted' } else { 'RecoveryRequired' }
        $source = @'
param(
    [Parameter(Position = 0)][string]$Command,
    [string]$EvidenceDir,
    [string]$CodexThreadId,
    [string]$PromptPath,
    [string]$IdempotencyKey,
    [string]$BrowserId,
    [string]$Profile,
    [string]$TabId,
    [string]$SessionKey,
    [int]$TimeoutSeconds,
    [string]$ResponseDeadlineAtUtc,
    [int]$SlotId,
    [string]$CapacityClaimId
)
if ($SlotId -lt 1 -or [string]::IsNullOrWhiteSpace($CapacityClaimId)) {
    throw 'The batch child did not receive its parent capacity claim.'
}
$outcome = '__OUTCOME__'
$category = '__CATEGORY__'
$promptSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$attempts = if ($outcome -eq 'retry-not-submitted') {
    @(
        [ordered]@{ attempt = 1; outcome = 'proved-not-submitted'; exactConversationUrl = ''; userTurnObserved = $false; generatingObserved = $false; composerSha256Observed = $promptSha },
        [ordered]@{ attempt = 2; outcome = 'retry-not-submitted'; exactConversationUrl = ''; userTurnObserved = $false; generatingObserved = $false; composerSha256Observed = $promptSha }
    )
}
else {
    @([ordered]@{ attempt = 1; outcome = 'recovery-required'; exactConversationUrl = ''; userTurnObserved = $false; generatingObserved = $false; composerSha256Observed = '' })
}
$state = [ordered]@{
    phase = 'send-uncertain'
    transport = 'agent-browser-cli-v2'
    codexThreadId = $CodexThreadId
    conversationUrlBound = ''
    submissionAcknowledged = $false
    automaticResendAllowed = $false
    promptSha256 = $promptSha
    retryOutcome = $outcome
    attemptCount = $attempts.Count
    attempts = $attempts
}
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir 'state.json'), ($state | ConvertTo-Json -Depth 10), $utf8)
$event = [ordered]@{
    status = 'stopped-unverified'
    terminalOutcome = $outcome
    watcherId = [guid]::NewGuid().ToString()
    codexThreadId = $CodexThreadId
    requiresCodexReview = $true
    automaticResendAllowed = $false
}
$watchState = [ordered]@{
    phase = 'terminal'
    terminalStatus = 'stopped-unverified'
    rootWait = $true
    codexThreadId = $CodexThreadId
    watcherId = $event.watcherId
}
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir 'watch-state.json'), ($watchState | ConvertTo-Json -Depth 10), $utf8)
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir 'watch-event.json'), ($event | ConvertTo-Json -Depth 10), $utf8)
[ordered]@{
    ok = $true
    command = 'run-root'
    terminalStatus = 'stopped-unverified'
    terminalOutcome = $outcome
    category = $category
    submissionAcknowledged = $false
    watcherId = $event.watcherId
    codexThreadId = $CodexThreadId
} | ConvertTo-Json -Compress
'@
        $source = $source.Replace('__OUTCOME__', $Outcome).Replace('__CATEGORY__', $category)
        [System.IO.File]::WriteAllText($Path, $source, [System.Text.UTF8Encoding]::new($true))
    }
}

Describe 'Atomic watcher JSON state' {
    It 'retries a transient sharing violation during an atomic replacement' {
        $path = Join-Path $TestDrive 'transient-watch-state.json'
        $ready = Join-Path $TestDrive 'transient-watch-state.ready'
        $childPath = Join-Path $TestDrive 'hold-watch-state.ps1'
        [System.IO.File]::WriteAllText($path, '{"phase":"completed"}', $Script:Utf8NoBom)
        [System.IO.File]::WriteAllText($childPath, @'
param([string]$Path, [string]$Ready)
$stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'None')
try {
    [System.IO.File]::WriteAllText($Ready, 'ready')
    Start-Sleep -Milliseconds 55
}
finally {
    $stream.Dispose()
}
'@, [System.Text.UTF8Encoding]::new($true))
        $process = Start-Process powershell.exe -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-File', ('"' + $childPath + '"'),
            '-Path', ('"' + $path + '"'), '-Ready', ('"' + $ready + '"')
        ) -PassThru -WindowStyle Hidden
        try {
            $deadline = [datetime]::UtcNow.AddSeconds(2)
            while (-not [System.IO.File]::Exists($ready) -and [datetime]::UtcNow -lt $deadline) {
                Start-Sleep -Milliseconds 10
            }
            [System.IO.File]::Exists($ready) | Should -BeTrue
            (Read-WatchJson -Path $path -Required).phase | Should -Be 'completed'
        }
        finally {
            $process.WaitForExit(2000) | Out-Null
            if (-not $process.HasExited) { $process.Kill() }
            $process.Dispose()
        }
    }

    It 'keeps persistently malformed JSON fail-closed after bounded rereads' {
        $path = Join-Path $TestDrive 'malformed-watch-state.json'
        [System.IO.File]::WriteAllText($path, '{', $Script:Utf8NoBom)

        { Read-WatchJson -Path $path -Required } | Should -Throw '*Invalid JSON file: malformed-watch-state.json*'
    }
}

Describe 'Watcher binding validation' {
    It 'reads ordered command results without dropping their fields' {
        Get-WatchProperty ([ordered]@{ started = $true }) 'started' $false | Should -BeTrue
    }

    It 'accepts a UUID thread id and rejects ambiguous values' {
        Test-WatchThreadId -Value $script:ThreadId | Should -BeTrue
        Test-WatchThreadId -Value 'last' | Should -BeFalse
        Test-WatchThreadId -Value '' | Should -BeFalse
    }

    It 'accepts only one exact ChatGPT conversation URL' {
        Test-WatchConversationUrl -Value $script:BoundUrl | Should -BeTrue
        Test-WatchConversationUrl -Value 'https://chatgpt.com/c/conversation_123' | Should -BeTrue
        Test-WatchConversationUrl -Value 'https://chatgpt.com/g/custom-gpt_1/c/conversation_123' | Should -BeTrue
        Test-WatchConversationUrl -Value 'https://chatgpt.com/' | Should -BeFalse
        Test-WatchConversationUrl -Value 'https://chatgpt.com/g/custom-gpt_1' | Should -BeFalse
        Test-WatchConversationUrl -Value 'https://chatgpt.com/c/short' | Should -BeFalse
        Test-WatchConversationUrl -Value 'https://www.chatgpt.com/c/conversation_123' | Should -BeFalse
        Test-WatchConversationUrl -Value ($script:BoundUrl + '?leak=1') | Should -BeFalse
        Test-WatchConversationUrl -Value 'https://example.com/c/12345678-1234-1234-1234-123456789abc' | Should -BeFalse
    }

    It 'rejects every launcher mode except RootWait' {
        $output = @(
            & powershell.exe -NoProfile -File $watcherPath `
                start `
                -EvidenceDir $TestDrive `
                -CodexThreadId $script:ThreadId `
                -TimeoutSeconds 7300 2>&1
        )
        $LASTEXITCODE | Should -Be 1
        $payload = $output[-1] | ConvertFrom-Json
        $payload.category | Should -Be 'WatcherError'
        $payload.message | Should -Match 'must be started with RootWait'
    }

    It 'enforces the fixed two-hour timeout ceiling' {
        {
            Assert-WatchConfiguration `
                -ConfiguredTimeoutSeconds 8000 `
                -ConfiguredFinalizeTimeoutSeconds 45
        } | Should -Throw '*between 1 and 7200*'

        {
            Assert-WatchConfiguration `
                -ConfiguredTimeoutSeconds 1 `
                -ConfiguredFinalizeTimeoutSeconds 45
        } | Should -Not -Throw
    }

    It 'loads the post-send evidence binding' {
        $directory = Join-Path $TestDrive 'binding'
        New-WatchFixtureEvidence -Directory $directory
        $binding = Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId

        $binding.Phase | Should -Be 'sent'
        $binding.Transport | Should -Be 'agent-browser-cli-v2'
        $binding.ConversationUrl | Should -Be $script:BoundUrl
        $binding.TargetBinding.sessionKey | Should -Be 'browser-1:profile-1:101'
        $binding.CodexThreadId | Should -Be $script:ThreadId
    }

    It 'accepts only an acknowledged fresh sent state whose exact URL is pending' {
        $directory = Join-Path $TestDrive 'pending-url-binding'
        New-WatchFixtureEvidence -Directory $directory
        $state = Read-WatchJson -Path (Join-Path $directory 'state.json') -Required
        $state.conversationUrlBound = ''
        $state.targetBinding.url = 'https://chatgpt.com/'
        $state | Add-Member -NotePropertyName conversationUrlBeforeSend -NotePropertyValue '' -Force
        $state | Add-Member -NotePropertyName conversationUrlBindingPending -NotePropertyValue $true -Force
        $state | Add-Member -NotePropertyName submissionAcknowledged -NotePropertyValue $true -Force
        $state | Add-Member -NotePropertyName invokeAttempted -NotePropertyValue $true -Force
        $state | Add-Member -NotePropertyName invokeReturned -NotePropertyValue $true -Force
        $state | Add-Member -NotePropertyName automaticResendAllowed -NotePropertyValue $false -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state

        $binding = Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $binding.ConversationUrl | Should -Be ''
        $binding.UrlBindingPending | Should -BeTrue

        $state.phase = 'send-uncertain'
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state
        {
            Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId
        } | Should -Throw '*exact ChatGPT conversation URL*'
    }

    It 'treats bounded browser identities as opaque instead of parsing their format' {
        $directory = Join-Path $TestDrive 'opaque-browser-identity'
        New-WatchFixtureEvidence -Directory $directory
        $state = Read-WatchJson -Path (Join-Path $directory 'state.json') -Required
        $state.targetBinding.sessionKey = 'opaque:session/ABC_1'
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state

        (Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId).TargetBinding.sessionKey |
            Should -Be 'opaque:session/ABC_1'
    }

    It 'rejects a completed evidence directory as a new watcher source' {
        $directory = Join-Path $TestDrive 'completed'
        New-WatchFixtureEvidence -Directory $directory -Phase 'completed'
        {
            Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId
        } | Should -Throw '*post-send evidence phase*'
    }

    It 'rejects a changed or non-conversation URL before launch' {
        $directory = Join-Path $TestDrive 'bad-url'
        New-WatchFixtureEvidence -Directory $directory
        $state = Read-WatchJson -Path (Join-Path $directory 'state.json') -Required
        $state.conversationUrlBound = 'https://chatgpt.com/'
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state

        {
            Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId
        } | Should -Throw '*exact ChatGPT conversation URL*'
    }
}

Describe 'Bounded adapter process execution' {
    It 'does not wait for an inherited stdout handle after the adapter exits' {
        $adapterPath = Join-Path $TestDrive 'adapter-with-inherited-stdout.ps1'
        $childPidPath = Join-Path $TestDrive 'inherited-child.pid'
        $adapterSource = @'
param(
    [Parameter(Position = 0)][string]$Command,
    [string]$BrowserId,
    [string]$Profile,
    [string]$TabId,
    [string]$SessionKey,
    [string]$ExpectedConversationUrl,
    [string]$CodexThreadId
)
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = 'powershell.exe'
$startInfo.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 30"'
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$child = [System.Diagnostics.Process]::Start($startInfo)
[System.IO.File]::WriteAllText($env:WATCH_TEST_CHILD_PID_FILE, [string]$child.Id)
[Console]::Out.WriteLine('{"ok":true,"generating":false}')
'@
        [System.IO.File]::WriteAllText($adapterPath, $adapterSource, [System.Text.UTF8Encoding]::new($true))
        $previousPidFile = $env:WATCH_TEST_CHILD_PID_FILE
        $env:WATCH_TEST_CHILD_PID_FILE = $childPidPath
        $timer = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $result = Invoke-WatchAdapterStatus -AdapterPath $adapterPath -TargetBinding (New-TestTargetBinding) -CodexThreadIdValue $script:ThreadId
            $timer.Stop()

            $result.ExitCode | Should -Be 0
            $result.Payload.ok | Should -BeTrue
            $timer.Elapsed.TotalSeconds | Should -BeLessThan 10
        }
        finally {
            $env:WATCH_TEST_CHILD_PID_FILE = $previousPidFile
            if (Test-Path -LiteralPath $childPidPath) {
                $childPid = [int][System.IO.File]::ReadAllText($childPidPath)
                Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'treats the adapter generation-active status as a successful watcher observation' {
        Mock Invoke-WatchAdapterProcess {
            [pscustomobject]@{
                ExitCode = 24
                Payload = [pscustomobject]@{
                    ok = $false
                    category = 'GenerationAlreadyActive'
                    details = [pscustomobject]@{
                        ok = $true
                        command = 'status'
                        generating = $true
                        url = $script:BoundUrl
                        urlExact = $true
                        targetBinding = New-TestTargetBinding
                    }
                }
            }
        }

        $result = Invoke-WatchAdapterStatus -AdapterPath 'adapter.ps1' -TargetBinding (New-TestTargetBinding) -CodexThreadIdValue $script:ThreadId

        $result.ExitCode | Should -Be 0
        $result.Payload.generating | Should -BeTrue
        $result.Payload.url | Should -Be $script:BoundUrl
    }

    It 'does not normalize malformed generation-active error details' {
        Mock Invoke-WatchAdapterProcess {
            [pscustomobject]@{
                ExitCode = 24
                Payload = [pscustomobject]@{
                    ok = $false
                    category = 'GenerationAlreadyActive'
                    details = [pscustomobject]@{ ok = $true; command = 'status'; generating = $false }
                }
            }
        }

        $result = Invoke-WatchAdapterStatus -AdapterPath 'adapter.ps1' -TargetBinding (New-TestTargetBinding) -CodexThreadIdValue $script:ThreadId

        $result.ExitCode | Should -Be 24
        $result.Payload.category | Should -Be 'GenerationAlreadyActive'
    }
}

Describe 'Atomic RootWait round' {
    BeforeEach {
        $script:roundDirectory = Join-Path $TestDrive ('run-root-' + [guid]::NewGuid().ToString('N'))
        $null = New-Item -ItemType Directory -Path $script:roundDirectory -Force
        $script:roundPrompt = Join-Path $script:roundDirectory 'request.md'
        [System.IO.File]::WriteAllText($script:roundPrompt, 'bounded request', [System.Text.UTF8Encoding]::new($false))
        $script:roundOrder = [System.Collections.ArrayList]::new()
        $script:roundDeadline = [DateTime]::UtcNow.AddHours(2).ToString('o')
        $Script:CapacityRootOverride = Join-Path $TestDrive ('round-capacity-' + [guid]::NewGuid().ToString('N'))
        $script:roundClaim = Acquire-CapacitySlot `
            -ThreadId $script:ThreadId `
            -RoundId 'atomic-root-round' `
            -EvidenceDirectory $script:roundDirectory
        $null = Set-CapacitySlotClaim -Id $script:roundClaim.slotId -ClaimId $script:roundClaim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $false
        })

        Mock Get-WatchAdapterPath { 'adapter.ps1' }
        Mock Get-WatchEvidenceBinding {
            $null = $script:roundOrder.Add('binding')
            [pscustomobject]@{ Phase = 'sent'; ResponseDeadlineAtUtc = $script:roundDeadline }
        }
        Mock Start-WatchProcess {
            $null = $script:roundOrder.Add('start')
            [pscustomobject]@{ started = $true; reused = $false }
        }
        Mock Wait-RootWatchEvent {
            $null = $script:roundOrder.Add('wait')
            [pscustomobject]@{
                watcherId = 'watcher-1'
                codexThreadId = $script:ThreadId
                terminalStatus = 'completed'
                eventFile = $Script:EventFileName
            }
        }
    }

    AfterEach {
        $Script:CapacityRootOverride = $null
    }

    It 'forwards one bounded send request to the adapter' {
        $script:adapterArguments = $null
        Mock Invoke-WatchAdapterProcess {
            param($Arguments, $ProcessTimeoutSeconds)
            $script:adapterArguments = @($Arguments)
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true } }
        }

        $null = Invoke-WatchAdapterSend `
            -AdapterPath 'adapter.ps1' `
            -PromptFile $script:roundPrompt `
            -EvidenceDirectory $script:roundDirectory `
            -IdempotencyKeyValue 'atomic-root-round-forward' `
            -CodexThreadIdValue $script:ThreadId `
            -BrowserIdValue 'browser-1' `
            -ProfileValue 'profile-1' `
            -TabIdValue '101' `
            -SessionKeyValue 'browser-1:profile-1:101' `
            -ResponseTimeoutSecondsValue 3210 `
            -ResponseDeadlineAtUtcValue $script:roundDeadline `
            -RequireFreshConversation

        $script:adapterArguments | Should -Contain 'send'
        $script:adapterArguments | Should -Contain '-PromptPath'
        $script:adapterArguments | Should -Contain $script:roundPrompt
        $script:adapterArguments | Should -Contain '-IdempotencyKey'
        $script:adapterArguments | Should -Contain 'atomic-root-round-forward'
        $script:adapterArguments | Should -Contain '-CodexThreadId'
        $script:adapterArguments | Should -Contain $script:ThreadId
        $script:adapterArguments | Should -Contain '-BrowserId'
        $script:adapterArguments | Should -Contain 'browser-1:profile-1:101'
        $script:adapterArguments[$script:adapterArguments.IndexOf('-ResponseTimeoutSeconds') + 1] | Should -Be '3210'
        $script:adapterArguments[$script:adapterArguments.IndexOf('-ResponseDeadlineAtUtc') + 1] | Should -Be $script:roundDeadline
        $script:adapterArguments | Should -Contain '-FreshConversation'
        Should -Invoke Invoke-WatchAdapterProcess -Times 1 -Exactly -ParameterFilter {
            $ProcessTimeoutSeconds -eq 600
        }
    }

    It 'sends, starts the watcher, and waits in one ordered command' {
        Mock Invoke-WatchAdapterSend {
            $null = $script:roundOrder.Add('send')
            [pscustomobject]@{
                ExitCode = 0
                Payload = [pscustomobject]@{
                    ok = $true
                    submittedExactlyOnce = $true
                    sendActionInvokedOnce = $true
                    submissionAcknowledged = $true
                }
            }
        }

        $result = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-round-1' `
            -CapacitySlotId $script:roundClaim.slotId `
            -CapacityClaimId $script:roundClaim.claimId

        @($script:roundOrder) | Should -Be @('send', 'binding', 'start', 'wait')
        $result.command | Should -Be 'run-root'
        $result.terminalStatus | Should -Be 'completed'
        $result.submittedExactlyOnce | Should -BeTrue
        $result.acknowledgementPending | Should -BeTrue
        $result.pollingConsumesModelTokens | Should -BeFalse
        Should -Invoke Invoke-WatchAdapterSend -Times 1 -Exactly -ParameterFilter {
            $ResponseTimeoutSecondsValue -eq 7200
        }
        Should -Invoke Start-WatchProcess -Times 1 -Exactly
        Should -Invoke Wait-RootWatchEvent -Times 1 -Exactly
    }

    It 'continues observation when the adapter process fails after waitable evidence exists' {
        Mock Invoke-WatchAdapterSend {
            $null = $script:roundOrder.Add('send')
            throw 'adapter process ended after the click boundary'
        }
        Mock Get-WatchEvidenceBinding {
            $null = $script:roundOrder.Add('binding')
            [pscustomobject]@{ Phase = 'send-uncertain'; ResponseDeadlineAtUtc = $script:roundDeadline }
        }

        $result = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-round-2' `
            -CapacitySlotId $script:roundClaim.slotId `
            -CapacityClaimId $script:roundClaim.claimId

        @($script:roundOrder) | Should -Be @('send', 'binding', 'start', 'wait')
        $result.evidencePhaseAtStart | Should -Be 'send-uncertain'
        $result.sendFailure | Should -Match 'after the click boundary'
        Should -Invoke Start-WatchProcess -Times 1 -Exactly
    }

    It 'does not start a watcher when send has no waitable post-send evidence' {
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{
                ExitCode = 23
                Payload = [pscustomobject]@{ ok = $false; message = 'composer unavailable' }
            }
        }
        Mock Get-WatchEvidenceBinding { throw 'current phase is pre-invoke-failed' }

        {
            Invoke-RootWaitRound `
                -EvidenceDirectory $script:roundDirectory `
                -ThreadId $script:ThreadId `
                -PromptFile $script:roundPrompt `
                -IdempotencyKeyValue 'atomic-root-round-3' `
                -CapacitySlotId $script:roundClaim.slotId `
                -CapacityClaimId $script:roundClaim.claimId
        } | Should -Throw '*composer unavailable*'
        Should -Invoke Start-WatchProcess -Times 0 -Exactly
        Should -Invoke Wait-RootWatchEvent -Times 0 -Exactly
    }

    It 'subtracts adapter time from the durable two-hour response deadline' {
        $startedAt = [datetime]'2026-08-09T00:00:00Z'
        $deadline = $startedAt.AddSeconds(7200)
        $script:capturedWaitTimeout = 0
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{
                ExitCode = 0
                Payload = [pscustomobject]@{
                    ok = $true
                    submissionAcknowledged = $true
                    responseDeadlineAtUtc = $deadline.ToString('o')
                }
            }
        }
        Mock Get-WatchEvidenceBinding {
            [pscustomobject]@{
                Phase = 'sent'
                ResponseDeadlineAtUtc = $deadline.ToString('o')
            }
        }
        Mock Wait-RootWatchEvent {
            param($WaitTimeoutSeconds)
            $script:capturedWaitTimeout = $WaitTimeoutSeconds
            [pscustomobject]@{
                watcherId = 'watcher-deadline'
                codexThreadId = $script:ThreadId
                terminalStatus = 'completed'
                eventFile = $Script:EventFileName
            }
        }

        $result = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-deadline' `
            -CapacitySlotId $script:roundClaim.slotId `
            -CapacityClaimId $script:roundClaim.claimId `
            -NowAction { $startedAt.AddSeconds(120) }

        $script:capturedWaitTimeout | Should -Be 7080
        $result.responseDeadlineAtUtc | Should -Be $deadline.ToString('o')
    }

    It 'does not round a nearly expired response deadline back up to thirty seconds' {
        $now = [datetime]'2026-08-09T00:00:04Z'
        $deadline = [datetime]'2026-08-09T00:00:05Z'
        $script:capturedStartTimeout = 0
        $script:capturedWaitTimeout = 0
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; responseDeadlineAtUtc = $deadline.ToString('o') } }
        }
        Mock Get-WatchEvidenceBinding {
            [pscustomobject]@{ Phase = 'sent'; ResponseDeadlineAtUtc = $deadline.ToString('o') }
        }
        Mock Start-WatchProcess {
            param($WatcherTimeoutSeconds)
            $script:capturedStartTimeout = $WatcherTimeoutSeconds
            [pscustomobject]@{ started = $true; reused = $false }
        }
        Mock Wait-RootWatchEvent {
            param($WaitTimeoutSeconds)
            $script:capturedWaitTimeout = $WaitTimeoutSeconds
            [pscustomobject]@{ watcherId = 'watcher-near-deadline'; codexThreadId = $script:ThreadId; terminalStatus = 'completed' }
        }

        $null = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-near-deadline' `
            -CapacitySlotId $script:roundClaim.slotId `
            -CapacityClaimId $script:roundClaim.claimId `
            -NowAction { $now }

        $script:capturedStartTimeout | Should -Be 1
        $script:capturedWaitTimeout | Should -Be 1
    }

    It 'returns retry-not-submitted to the original task without starting a watcher' {
        $null = Set-AdapterTerminalFixture -Directory $script:roundDirectory -Outcome 'retry-not-submitted'
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{
                ExitCode = 26
                Payload = [pscustomobject]@{ ok = $false; category = 'RetryNotSubmitted' }
            }
        }

        $result = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-retry-not-submitted' `
            -CapacitySlotId $script:roundClaim.slotId `
            -CapacityClaimId $script:roundClaim.claimId
        $event = Read-WatchJson -Path (Join-Path $script:roundDirectory $Script:EventFileName) -Required

        $result.terminalStatus | Should -Be 'stopped-unverified'
        $result.terminalOutcome | Should -Be 'retry-not-submitted'
        $result.codexThreadId | Should -Be $script:ThreadId
        $result.watcherStarted | Should -BeFalse
        $event.terminalOutcome | Should -Be 'retry-not-submitted'
        $event.codexThreadId | Should -Be $script:ThreadId
        $event.automaticResendAllowed | Should -BeFalse
        Should -Invoke Get-WatchEvidenceBinding -Times 0 -Exactly
        Should -Invoke Start-WatchProcess -Times 0 -Exactly
        Should -Invoke Wait-RootWatchEvent -Times 0 -Exactly
    }

    It 'rejects incomplete retry proof before RootWait terminal projection' {
        $state = Set-AdapterTerminalFixture -Directory $script:roundDirectory -Outcome 'retry-not-submitted'
        $state.attempts[0].exactConversationUrl = $script:BoundUrl
        Write-WatchJsonAtomic -Path (Join-Path $script:roundDirectory 'state.json') -Value $state
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{ ExitCode = 26; Payload = [pscustomobject]@{ ok = $false; category = 'RetryNotSubmitted' } }
        }

        $category = ''
        try {
            $null = Invoke-RootWaitRound `
                -EvidenceDirectory $script:roundDirectory `
                -ThreadId $script:ThreadId `
                -PromptFile $script:roundPrompt `
                -IdempotencyKeyValue 'atomic-root-invalid-proof' `
                -CapacitySlotId $script:roundClaim.slotId `
                -CapacityClaimId $script:roundClaim.claimId
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        Test-Path -LiteralPath (Join-Path $script:roundDirectory $Script:EventFileName) | Should -BeFalse
        Should -Invoke Start-WatchProcess -Times 0 -Exactly
    }

    It 'returns recovery-required to the original task without starting a watcher' {
        $null = Set-AdapterTerminalFixture -Directory $script:roundDirectory -Outcome 'recovery-required'
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{
                ExitCode = 27
                Payload = [pscustomobject]@{ ok = $false; category = 'RecoveryRequired' }
            }
        }

        $result = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-recovery-required' `
            -CapacitySlotId $script:roundClaim.slotId `
            -CapacityClaimId $script:roundClaim.claimId
        $event = Read-WatchJson -Path (Join-Path $script:roundDirectory $Script:EventFileName) -Required

        $result.terminalStatus | Should -Be 'stopped-unverified'
        $result.terminalOutcome | Should -Be 'recovery-required'
        $result.sendCategory | Should -Be 'RecoveryRequired'
        $result.codexThreadId | Should -Be $script:ThreadId
        $result.watcherStarted | Should -BeFalse
        $event.terminalOutcome | Should -Be 'recovery-required'
        $event.codexThreadId | Should -Be $script:ThreadId
        Should -Invoke Get-WatchEvidenceBinding -Times 0 -Exactly
        Should -Invoke Start-WatchProcess -Times 0 -Exactly
        Should -Invoke Wait-RootWatchEvent -Times 0 -Exactly
    }

    It 'rejects expired adapter terminal outcomes instead of materializing an event' -TestCases @(
        @{ Outcome = 'retry-not-submitted'; Category = 'RetryNotSubmitted' }
        @{ Outcome = 'recovery-required'; Category = 'RecoveryRequired' }
    ) {
        param($Outcome, $Category)
        $deadline = [datetime]'2026-08-09T00:00:05Z'
        $state = Set-AdapterTerminalFixture -Directory $script:roundDirectory -Outcome $Outcome
        $state.responseDeadlineAtUtc = $deadline.ToString('o')
        Write-WatchJsonAtomic -Path (Join-Path $script:roundDirectory 'state.json') -Value $state
        Mock Invoke-WatchAdapterSend {
            [pscustomobject]@{ ExitCode = 26; Payload = [pscustomobject]@{ ok = $false; category = $Category } }
        }

        {
            Invoke-RootWaitRound `
                -EvidenceDirectory $script:roundDirectory `
                -ThreadId $script:ThreadId `
                -PromptFile $script:roundPrompt `
                -IdempotencyKeyValue ("atomic-root-expired-$Outcome") `
                -CapacitySlotId $script:roundClaim.slotId `
                -CapacityClaimId $script:roundClaim.claimId `
                -NowAction { $deadline.AddSeconds(1) }
        } | Should -Throw '*after the absolute response deadline*'

        Test-Path -LiteralPath (Join-Path $script:roundDirectory $Script:EventFileName) | Should -BeFalse
        Should -Invoke Start-WatchProcess -Times 0 -Exactly
        Should -Invoke Wait-RootWatchEvent -Times 0 -Exactly
    }
}

Describe 'Batch RootWait capacity' {
    BeforeEach {
        $Script:CapacityRootOverride = Join-Path $TestDrive ('capacity-' + [guid]::NewGuid().ToString('N'))
        $script:originalWatcherScriptPath = $Script:WatcherScriptPath
    }

    AfterEach {
        $Script:CapacityRootOverride = $null
        $Script:WatcherScriptPath = $script:originalWatcherScriptPath
    }

    It 'versions only capacity claims and exposes their pre-send state' {
        $directory = Join-Path $TestDrive 'capacity-schema'
        $null = New-Item -ItemType Directory -Path $directory -Force

        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'capacity-schema' -EvidenceDirectory $directory
        $stored = Read-WatchJson -Path (Get-CapacitySlotPath -Id $claim.slotId) -Required
        $diagnostic = (Get-CapacitySlots).slots[0]
        $manifestPath = New-BatchFixture -Root (Join-Path $TestDrive 'capacity-schema-manifest')

        $stored.schemaVersion | Should -Be 2
        $stored.phase | Should -Be 'slot-acquired-pre-send'
        $stored.submissionAttempted | Should -BeFalse
        $diagnostic.schemaVersion | Should -Be 2
        $diagnostic.submissionAttempted | Should -BeFalse
        $diagnostic.submissionAttemptedAtUtc | Should -BeNullOrEmpty
        $Script:WatcherSchemaVersion | Should -Be 1
        (Read-WatchJson -Path $manifestPath -Required).schemaVersion | Should -Be 1
    }

    It 'crosses the capacity submission boundary only immediately before adapter send' {
        $directory = Join-Path $TestDrive 'capacity-send-boundary'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive 'capacity-send-boundary.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        $script:beforeAdapter = $null
        $script:atAdapter = $null
        $script:attemptedAt = ''
        $script:secondTransitionCategory = ''
        Mock Get-WatchAdapterPath {
            $slot = (Get-CapacitySlots).slots[0]
            $stored = Read-WatchJson -Path (Get-CapacitySlotPath -Id $slot.slotId) -Required
            $script:beforeAdapter = [bool]$stored.submissionAttempted
            return 'adapter.ps1'
        }
        Mock Invoke-WatchAdapterSend {
            param($EvidenceDirectory)
            $slot = (Get-CapacitySlots).slots[0]
            $stored = Read-WatchJson -Path (Get-CapacitySlotPath -Id $slot.slotId) -Required
            $script:atAdapter = [bool]$stored.submissionAttempted
            $script:attemptedAt = [string]$stored.submissionAttemptedAtUtc
            try {
                $null = Confirm-CapacitySubmissionAttempt -Id $slot.slotId -ClaimId $stored.claimId
            }
            catch {
                $script:secondTransitionCategory = [string]$_.Exception.Data['Category']
            }
            $null = Set-AdapterTerminalFixture -Directory $EvidenceDirectory -Outcome 'retry-not-submitted'
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true } }
        }

        $result = Invoke-CapacityBoundRootWaitRound `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -PromptFile $prompt `
            -IdempotencyKeyValue 'capacity-send-boundary'

        $script:beforeAdapter | Should -BeFalse
        $script:atAdapter | Should -BeTrue
        $script:attemptedAt | Should -Not -BeNullOrEmpty
        $script:secondTransitionCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        $result.terminalOutcome | Should -Be 'retry-not-submitted'
        Should -Invoke Invoke-WatchAdapterSend -Times 1 -Exactly
    }

    It 'releases an unambiguous schema 2 run-starting false claim as never-invoked' {
        $directory = Join-Path $TestDrive 'capacity-never-invoked'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'never-invoked' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = 2
            phase = 'run-starting'
            submissionAttempted = $false
            ownerPid = 999999
            ownerProcessStartedAtUtc = '2026-08-14T00:00:00Z'
        })
        Mock Invoke-WatchAdapterSend { throw 'adapter must not be invoked during release' }
        Mock Start-BatchRoundProcess { throw 'child must not be started during release' }

        $release = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId

        $release.proof | Should -Be 'never-invoked'
        (Get-CapacitySlots).slots.Count | Should -Be 0
        Should -Invoke Invoke-WatchAdapterSend -Times 0 -Exactly
        Should -Invoke Start-BatchRoundProcess -Times 0 -Exactly
    }

    It 'keeps contradictory durable evidence isolated from never-invoked recovery' -TestCases @(
        @{ AdapterPhase = 'sent' }
        @{ AdapterPhase = 'send-uncertain' }
    ) {
        param($AdapterPhase)
        $directory = Join-Path $TestDrive ("capacity-never-invoked-conflict-$AdapterPhase")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'never-invoked-conflict' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = 2
            phase = 'run-starting'
            submissionAttempted = $false
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value ([ordered]@{
            phase = $AdapterPhase
            invokeAttempted = $true
            automaticResendAllowed = $false
        })
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'keeps every lone durable watcher artifact isolated from never-invoked recovery' -TestCases @(
        @{ ArtifactName = 'watch-state.json' }
        @{ ArtifactName = 'watch-event.json' }
        @{ ArtifactName = 'evidence.json' }
    ) {
        param($ArtifactName)
        $safeName = $ArtifactName.Replace('.', '-')
        $directory = Join-Path $TestDrive ("capacity-never-invoked-artifact-$safeName")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'never-invoked-artifact' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = 2
            phase = 'run-starting'
            submissionAttempted = $false
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $ArtifactName) -Value ([ordered]@{
            incomplete = $true
        })
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects legacy run-starting false claims as ambiguous recovery state' {
        $directory = Join-Path $TestDrive 'capacity-legacy-run-starting'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'legacy-run-starting' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = 1
            phase = 'run-starting'
            submissionAttempted = $false
            ownerPid = 999999
            ownerProcessStartedAtUtc = '2026-08-14T00:00:00Z'
        })
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects run-starting claims missing versioned submission fields' -TestCases @(
        @{ MissingField = 'schemaVersion' }
        @{ MissingField = 'submissionAttempted' }
    ) {
        param($MissingField)
        $directory = Join-Path $TestDrive ("capacity-missing-$MissingField")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'missing-field' -EvidenceDirectory $directory
        $storedPath = Get-CapacitySlotPath -Id $claim.slotId
        $stored = Read-WatchJson -Path $storedPath -Required
        $stored.phase = 'run-starting'
        $stored.ownerPid = 999999
        $stored.ownerProcessStartedAtUtc = '2026-08-14T00:00:00Z'
        $stored.PSObject.Properties.Remove($MissingField)
        Write-WatchJsonAtomic -Path $storedPath -Value $stored
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects a non-boolean submissionAttempted value as ambiguous recovery state' {
        $directory = Join-Path $TestDrive 'capacity-non-boolean-submission'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'non-boolean-submission' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = 2
            phase = 'run-starting'
            submissionAttempted = 'false'
        })
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects noncanonical schema values at handoff, submission, and never-invoked release' -TestCases @(
        @{ Name = 'string'; Value = '2' }
        @{ Name = 'decimal'; Value = [decimal]2 }
        @{ Name = 'rounded-double'; Value = [double]1.6 }
        @{ Name = 'null'; Value = $null }
        @{ Name = 'array'; Value = @(2) }
        @{ Name = 'object'; Value = [pscustomobject]@{ value = 2 } }
    ) {
        param($Name, $Value)
        $directory = Join-Path $TestDrive ("capacity-schema-$Name")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId "schema-$Name" -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = $Value
            phase = 'run-starting'
            submissionAttempted = $false
            ownerPid = 999999
            ownerProcessStartedAtUtc = '2026-08-14T00:00:00Z'
        })
        if ($Name -eq 'decimal') {
            $slotPath = Get-CapacitySlotPath -Id $claim.slotId
            $raw = [System.IO.File]::ReadAllText($slotPath, $Script:Utf8NoBom)
            $raw = [regex]::Replace($raw, '("schemaVersion"\s*:\s*)2(?=\s*,)', '${1}2.0', 1)
            [System.IO.File]::WriteAllText($slotPath, $raw, $Script:Utf8NoBom)
        }
        $handoffCategory = ''
        $confirmCategory = ''
        $releaseCategory = ''

        try {
            $null = Get-ValidatedCapacityHandoff `
                -Id $claim.slotId `
                -ClaimId $claim.claimId `
                -ThreadId $script:ThreadId `
                -EvidenceDirectory $directory
        }
        catch { $handoffCategory = [string]$_.Exception.Data['Category'] }
        try { $null = Confirm-CapacitySubmissionAttempt -Id $claim.slotId -ClaimId $claim.claimId }
        catch { $confirmCategory = [string]$_.Exception.Data['Category'] }
        try { $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId }
        catch { $releaseCategory = [string]$_.Exception.Data['Category'] }

        $handoffCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        $confirmCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        $releaseCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects impossible never-invoked claim markers' -TestCases @(
        @{ Name = 'attempt-time'; Changes = @{ submissionAttemptedAtUtc = '2026-08-14T00:00:00Z' } }
        @{ Name = 'watcher'; Changes = @{ watcherId = [guid]::NewGuid().ToString() } }
        @{ Name = 'terminal'; Changes = @{ terminalStatus = 'completed' } }
    ) {
        param($Name, $Changes)
        $directory = Join-Path $TestDrive ("capacity-impossible-$Name")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId "impossible-$Name" -EvidenceDirectory $directory
        $updates = [ordered]@{
            phase = 'run-starting'
            submissionAttempted = $false
            ownerPid = 999999
            ownerProcessStartedAtUtc = '2026-08-14T00:00:00Z'
        }
        foreach ($key in $Changes.Keys) { $updates[$key] = $Changes[$key] }
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes $updates
        $releaseCategory = ''

        try { $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId }
        catch { $releaseCategory = [string]$_.Exception.Data['Category'] }

        $releaseCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects an invalid capacity CAS before adapter invocation' -TestCases @(
        @{ SchemaVersion = 1; Phase = 'run-starting'; SubmissionAttempted = $false }
        @{ SchemaVersion = 2; Phase = 'run-starting'; SubmissionAttempted = $true }
        @{ SchemaVersion = 2; Phase = 'slot-acquired-pre-send'; SubmissionAttempted = $false }
    ) {
        param($SchemaVersion, $Phase, $SubmissionAttempted)
        $directory = Join-Path $TestDrive ("capacity-cas-rejected-$SchemaVersion-$Phase-$SubmissionAttempted")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive ("capacity-cas-rejected-$SchemaVersion-$Phase-$SubmissionAttempted.md")
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'cas-rejected' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = $SchemaVersion
            phase = $Phase
            submissionAttempted = $SubmissionAttempted
        })
        Mock Get-WatchAdapterPath { 'adapter.ps1' }
        Mock Invoke-WatchAdapterSend { throw 'adapter must not be invoked' }
        $category = ''

        try {
            $null = Invoke-RootWaitRound `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'cas-rejected' `
                -CapacitySlotId $claim.slotId `
                -CapacityClaimId $claim.claimId
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        Should -Invoke Invoke-WatchAdapterSend -Times 0 -Exactly
    }

    It 'blocks direct run-root at the per-task and global capacity limits before adapter invocation' {
        $prompt = Join-Path $TestDrive 'direct-capacity-prompt.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        Mock Invoke-RootWaitRound { throw 'adapter must not be invoked' }

        $Script:CapacityRootOverride = Join-Path $TestDrive 'direct-thread-capacity'
        foreach ($index in 1..3) {
            $directory = Join-Path $TestDrive ("direct-thread-$index")
            $null = New-Item -ItemType Directory -Path $directory -Force
            (Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId "occupied-$index" -EvidenceDirectory $directory).acquired | Should -BeTrue
        }
        $blockedDirectory = Join-Path $TestDrive 'direct-thread-blocked'
        $null = New-Item -ItemType Directory -Path $blockedDirectory -Force
        $threadCategory = ''
        try {
            $null = Invoke-CapacityBoundRootWaitRound `
                -EvidenceDirectory $blockedDirectory `
                -ThreadId $script:ThreadId `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'direct-thread-blocked'
        }
        catch {
            $threadCategory = [string]$_.Exception.Data['Category']
        }
        $threadCategory | Should -Be 'ConcurrencySlotQueued'

        $Script:CapacityRootOverride = Join-Path $TestDrive 'direct-global-capacity'
        foreach ($thread in @([guid]::NewGuid().ToString(), [guid]::NewGuid().ToString())) {
            foreach ($index in 1..3) {
                $directory = Join-Path $TestDrive ("direct-global-$thread-$index")
                $null = New-Item -ItemType Directory -Path $directory -Force
                (Acquire-CapacitySlot -ThreadId $thread -RoundId "occupied-$index" -EvidenceDirectory $directory).acquired | Should -BeTrue
            }
        }
        $globalDirectory = Join-Path $TestDrive 'direct-global-blocked'
        $null = New-Item -ItemType Directory -Path $globalDirectory -Force
        $globalCategory = ''
        try {
            $null = Invoke-CapacityBoundRootWaitRound `
                -EvidenceDirectory $globalDirectory `
                -ThreadId ([guid]::NewGuid().ToString()) `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'direct-global-blocked'
        }
        catch {
            $globalCategory = [string]$_.Exception.Data['Category']
        }
        $globalCategory | Should -Be 'ConcurrencySlotQueued'
        Should -Invoke Invoke-RootWaitRound -Times 0 -Exactly
    }

    It 'reuses one parent capacity claim in a child run-root without acquiring again' {
        $directory = Join-Path $TestDrive 'capacity-handoff'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive 'capacity-handoff-prompt.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'handoff-round' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $false
        })
        Mock Acquire-CapacitySlot { throw 'child must not double-acquire capacity' }
        Mock Get-WatchAdapterPath { 'adapter.ps1' }
        Mock Invoke-WatchAdapterSend {
            param($EvidenceDirectory)
            $null = Set-AdapterTerminalFixture -Directory $EvidenceDirectory -Outcome 'retry-not-submitted'
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true } }
        }

        $result = Invoke-CapacityBoundRootWaitRound `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -PromptFile $prompt `
            -IdempotencyKeyValue 'handoff-key' `
            -CapacitySlotId $claim.slotId `
            -CapacityClaimId $claim.claimId

        $stored = Read-WatchJson -Path (Get-CapacitySlotPath -Id $claim.slotId) -Required
        $result.terminalOutcome | Should -Be 'retry-not-submitted'
        $stored.claimId | Should -Be $claim.claimId
        $stored.submissionAttempted | Should -BeTrue
        $stored.submissionAttemptedAtUtc | Should -Not -BeNullOrEmpty
        (Get-CapacitySlots).slots.Count | Should -Be 1
        Should -Invoke Acquire-CapacitySlot -Times 0 -Exactly
        Should -Invoke Invoke-WatchAdapterSend -Times 1 -Exactly
    }

    It 'rejects a mismatched child capacity claim before adapter invocation' {
        $directory = Join-Path $TestDrive 'capacity-handoff-mismatch'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive 'capacity-handoff-mismatch-prompt.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'handoff-mismatch' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $false
        })
        Mock Invoke-WatchAdapterSend { throw 'adapter must not be invoked' }
        $category = ''

        try {
            $null = Invoke-CapacityBoundRootWaitRound `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'handoff-mismatch-key' `
                -CapacitySlotId $claim.slotId `
                -CapacityClaimId ([guid]::NewGuid().ToString())
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
        Should -Invoke Invoke-WatchAdapterSend -Times 0 -Exactly
    }

    It 'rejects legacy or already-advanced child handoffs before adapter invocation' -TestCases @(
        @{ SchemaVersion = 1; SubmissionAttempted = $false }
        @{ SchemaVersion = 2; SubmissionAttempted = $true }
    ) {
        param($SchemaVersion, $SubmissionAttempted)
        $directory = Join-Path $TestDrive ("capacity-handoff-rejected-$SchemaVersion-$SubmissionAttempted")
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive ("capacity-handoff-rejected-$SchemaVersion-$SubmissionAttempted.md")
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'handoff-rejected' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            schemaVersion = $SchemaVersion
            phase = 'run-starting'
            submissionAttempted = $SubmissionAttempted
        })
        Mock Invoke-WatchAdapterSend { throw 'adapter must not be invoked' }
        $category = ''

        try {
            $null = Invoke-CapacityBoundRootWaitRound `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'handoff-rejected' `
                -CapacitySlotId $claim.slotId `
                -CapacityClaimId $claim.claimId
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
        Should -Invoke Invoke-WatchAdapterSend -Times 0 -Exactly
    }

    It 'requires owner completion before a live never-invoked claim can be released' {
        $directory = Join-Path $TestDrive 'capacity-live-never-invoked'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'live-never-invoked' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $false
        })
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }
        $release = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        $release.proof | Should -Be 'never-invoked'
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'preserves never-launched for a dead slot-acquired-pre-send claim' {
        $directory = Join-Path $TestDrive 'capacity-never-launched'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'never-launched' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            ownerPid = 999999
            ownerProcessStartedAtUtc = '2026-08-14T00:00:00Z'
        })

        $release = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId

        $release.proof | Should -Be 'never-launched'
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'releases a direct run-root only after durable terminal proof' {
        $directory = Join-Path $TestDrive 'direct-terminal-release'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive 'direct-terminal-prompt.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        Mock Invoke-RootWaitRound {
            param($EvidenceDirectory, $ThreadId)
            Write-WatchJsonAtomic -Path (Join-Path $EvidenceDirectory $Script:StateFileName) -Value ([ordered]@{
                phase = 'terminal'; terminalStatus = 'completed'; codexThreadId = $ThreadId; watcherId = 'direct-terminal-watcher'
            })
            Write-WatchJsonAtomic -Path (Join-Path $EvidenceDirectory $Script:EventFileName) -Value ([ordered]@{
                status = 'completed'; codexThreadId = $ThreadId; watcherId = 'direct-terminal-watcher'; requiresCodexReview = $true; automaticResendAllowed = $false
            })
            [ordered]@{ terminalStatus = 'completed'; terminalOutcome = '' }
        }

        $result = Invoke-CapacityBoundRootWaitRound `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -PromptFile $prompt `
            -IdempotencyKeyValue 'direct-terminal-key'

        $result.terminalStatus | Should -Be 'completed'
        (Get-CapacitySlots).slots.Count | Should -Be 0
        Should -Invoke Invoke-RootWaitRound -Times 1 -Exactly
    }

    It 'releases a direct run-root after durable pre-click failure proof' {
        $directory = Join-Path $TestDrive 'direct-pre-click-release'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $prompt = Join-Path $TestDrive 'direct-pre-click-prompt.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)
        Mock Invoke-RootWaitRound {
            param($EvidenceDirectory)
            Write-WatchJsonAtomic -Path (Join-Path $EvidenceDirectory 'state.json') -Value ([ordered]@{
                phase = 'pre-invoke-failed'; invokeAttempted = $false
            })
            throw 'adapter rejected before invocation'
        }

        {
            Invoke-CapacityBoundRootWaitRound `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'direct-pre-click-key'
        } | Should -Throw '*before invocation*'

        (Get-CapacitySlots).slots.Count | Should -Be 0
        Should -Invoke Invoke-RootWaitRound -Times 1 -Exactly
    }

    It 'releases direct retry-not-submitted proof but retains recovery-required isolation' {
        $prompt = Join-Path $TestDrive 'direct-terminal-outcome-prompt.md'
        [System.IO.File]::WriteAllText($prompt, 'bounded request', $Script:Utf8NoBom)

        $retryDirectory = Join-Path $TestDrive 'direct-retry-release'
        $null = New-Item -ItemType Directory -Path $retryDirectory -Force
        Mock Invoke-RootWaitRound {
            param($EvidenceDirectory)
            $null = Set-AdapterTerminalFixture -Directory $EvidenceDirectory -Outcome 'retry-not-submitted'
            [ordered]@{ terminalStatus = 'stopped-unverified'; terminalOutcome = 'retry-not-submitted' }
        }
        $retry = Invoke-CapacityBoundRootWaitRound `
            -EvidenceDirectory $retryDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $prompt `
            -IdempotencyKeyValue 'direct-retry-key'
        $retry.terminalOutcome | Should -Be 'retry-not-submitted'
        (Get-CapacitySlots).slots.Count | Should -Be 0

        $recoveryDirectory = Join-Path $TestDrive 'direct-recovery-retained'
        $null = New-Item -ItemType Directory -Path $recoveryDirectory -Force
        Mock Invoke-RootWaitRound {
            param($EvidenceDirectory)
            $null = Set-AdapterTerminalFixture -Directory $EvidenceDirectory -Outcome 'recovery-required'
            [ordered]@{ terminalStatus = 'stopped-unverified'; terminalOutcome = 'recovery-required' }
        }
        $category = ''
        try {
            $null = Invoke-CapacityBoundRootWaitRound `
                -EvidenceDirectory $recoveryDirectory `
                -ThreadId $script:ThreadId `
                -PromptFile $prompt `
                -IdempotencyKeyValue 'direct-recovery-key'
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'defaults batches to 7200 seconds and rejects duplicate keys or path escape' {
        $root = Join-Path $TestDrive 'manifest-validation'
        $path = New-BatchFixture -Root $root -RoundCount 2
        (Read-RootWaitBatchManifest -Path $path).TimeoutSeconds | Should -Be 7200

        $manifest = Read-WatchJson -Path $path -Required
        $manifest.rounds[1].idempotencyKey = $manifest.rounds[0].idempotencyKey
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Read-RootWaitBatchManifest -Path $path } | Should -Throw '*idempotencyKey*unique*'

        $manifest.rounds[1].idempotencyKey = 'unique-again'
        $outside = Join-Path $TestDrive 'outside.md'
        [System.IO.File]::WriteAllText($outside, 'outside', $Script:Utf8NoBom)
        $manifest.rounds[1].promptPath = $outside
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Read-RootWaitBatchManifest -Path $path } | Should -Throw '*inside the batch manifest directory*'

        $tooLong = New-BatchFixture -Root (Join-Path $TestDrive 'manifest-too-long') -TimeoutSeconds 7201
        { Read-RootWaitBatchManifest -Path $tooLong } | Should -Throw '*between 30 and 7200*'
    }

    It 'rejects key prompt and target bounds before capacity acquisition' {
        $root = Join-Path $TestDrive 'manifest-admission-bounds'
        $path = New-BatchFixture -Root $root
        $manifest = Read-WatchJson -Path $path -Required
        Mock Acquire-CapacitySlot { throw 'capacity must not be acquired' }
        Mock Start-BatchRoundProcess { throw 'child must not start' }

        $manifest.rounds[0].idempotencyKey = 'k' * 129
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Invoke-RootWaitBatch -Path $path -ExpectedThreadId $script:ThreadId } | Should -Throw '*idempotencyKey*1 and 128*'

        $manifest.rounds[0].idempotencyKey = 'invalid/key'
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Invoke-RootWaitBatch -Path $path -ExpectedThreadId $script:ThreadId } | Should -Throw '*idempotencyKey*1 and 128*'

        $manifest.rounds[0].idempotencyKey = 'valid-key'
        [System.IO.File]::WriteAllText($manifest.rounds[0].promptPath, ('p' * 24001), $Script:Utf8NoBom)
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Invoke-RootWaitBatch -Path $path -ExpectedThreadId $script:ThreadId } | Should -Throw '*prompt*24000*'

        [System.IO.File]::WriteAllText($manifest.rounds[0].promptPath, ('p' * 24000), $Script:Utf8NoBom)
        $manifest.rounds[0].targetBinding.browserId = ('b' * 513)
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Invoke-RootWaitBatch -Path $path -ExpectedThreadId $script:ThreadId } | Should -Throw '*targetBinding*browserId*'

        $manifest.rounds[0].targetBinding.browserId = "browser`r`n2"
        Write-WatchJsonAtomic -Path $path -Value $manifest
        { Invoke-RootWaitBatch -Path $path -ExpectedThreadId $script:ThreadId } | Should -Throw '*targetBinding*browserId*'
        Should -Invoke Acquire-CapacitySlot -Times 0 -Exactly
        Should -Invoke Start-BatchRoundProcess -Times 0 -Exactly
    }

    It 'passes the exact final second and absolute batch deadline to a child round' {
        $manifestPath = New-BatchFixture -Root (Join-Path $TestDrive 'batch-final-second') -TimeoutSeconds 30
        $script:batchClock = [datetime]'2026-08-09T00:00:00Z'
        $script:batchClockCalls = 0
        $script:capturedRoundTimeout = 0
        $script:capturedRoundDeadline = ''
        Mock Start-BatchRoundProcess {
            param($Round, $ThreadId, $RoundTimeoutSeconds, $RoundDeadlineAtUtc, $RuntimeDirectory, $CapacitySlotId, $CapacityClaimId)
            $script:capturedRoundTimeout = $RoundTimeoutSeconds
            $script:capturedRoundDeadline = $RoundDeadlineAtUtc
            $script:capturedCapacitySlotId = $CapacitySlotId
            $script:capturedCapacityClaimId = $CapacityClaimId
            $process = [pscustomobject]@{ Id = $PID; HasExited = $true }
            $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
            $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
            [pscustomobject]@{ Process = $process; StdoutPath = ''; StderrPath = '' }
        }
        Mock Read-BatchRoundProcessResult {
            [ordered]@{
                roundId = 'round-1'; status = 'completed'; terminalStatus = 'completed'; terminalOutcome = ''
                errorCategory = $null; submissionAcknowledged = $true; watcherId = 'watcher-final-second'
            }
        }

        $result = Invoke-RootWaitBatch `
            -Path $manifestPath `
            -ExpectedThreadId $script:ThreadId `
            -NowAction {
                $script:batchClockCalls++
                if ($script:batchClockCalls -ge 3) { return $script:batchClock.AddSeconds(29) }
                return $script:batchClock
            } `
            -SleepAction { }

        $result.allSucceeded | Should -BeTrue
        $script:capturedRoundTimeout | Should -Be 1
        $script:capturedRoundDeadline | Should -Be '2026-08-09T00:00:30.0000000Z'
        $script:capturedCapacitySlotId | Should -BeGreaterThan 0
        $script:capturedCapacityClaimId | Should -Not -BeNullOrEmpty
    }

    It 'does not start a child after capacity acquisition reaches the batch deadline' {
        $manifestPath = New-BatchFixture -Root (Join-Path $TestDrive 'batch-deadline-before-start') -TimeoutSeconds 30
        $script:batchClock = [datetime]'2026-08-09T00:00:00Z'
        $script:batchClockCalls = 0
        Mock Start-BatchRoundProcess { throw 'must not start at or after the absolute deadline' }

        $result = Invoke-RootWaitBatch `
            -Path $manifestPath `
            -ExpectedThreadId $script:ThreadId `
            -NowAction {
                $script:batchClockCalls++
                if ($script:batchClockCalls -ge 3) { return $script:batchClock.AddSeconds(30) }
                return $script:batchClock
            } `
            -SleepAction { }

        $result.items[0].status | Should -Be 'queued-timeout'
        $result.items[0].errorCategory | Should -Be 'ConcurrencySlotTimeout'
        Should -Invoke Start-BatchRoundProcess -Times 0 -Exactly
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'releases the parent claim when a child exits before the submission CAS' {
        $manifestPath = New-BatchFixture -Root (Join-Path $TestDrive 'batch-child-pre-cas-exit') -TimeoutSeconds 30
        $script:childClaimId = ''
        $script:childSubmissionAttempted = $null
        $process = [pscustomobject]@{ Id = $PID; HasExited = $true }
        $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
        $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
        Mock Start-BatchRoundProcess {
            param($CapacitySlotId, $CapacityClaimId)
            $stored = Read-WatchJson -Path (Get-CapacitySlotPath -Id $CapacitySlotId) -Required
            $script:childClaimId = $CapacityClaimId
            $script:childSubmissionAttempted = [bool]$stored.submissionAttempted
            [pscustomobject]@{ Process = $process; StdoutPath = ''; StderrPath = '' }
        }
        Mock Read-BatchRoundProcessResult {
            [ordered]@{
                roundId = 'round-1'; status = 'recovery-required'; terminalStatus = ''; terminalOutcome = ''
                errorCategory = 'ConcurrencySlotRecoveryRequired'; submissionAcknowledged = $false; watcherId = ''
            }
        }
        Mock Invoke-WatchAdapterSend { throw 'adapter must not be invoked by the batch parent' }

        $result = Invoke-RootWaitBatch -Path $manifestPath -ExpectedThreadId $script:ThreadId -SleepAction { }

        $script:childClaimId | Should -Not -BeNullOrEmpty
        $script:childSubmissionAttempted | Should -BeFalse
        $result.allSucceeded | Should -BeFalse
        (Get-CapacitySlots).slots.Count | Should -Be 0
        Should -Invoke Invoke-WatchAdapterSend -Times 0 -Exactly
    }

    It 'recognizes a live owner from its recorded UTC process start time' {
        $identity = Get-CapacityProcessIdentity
        $claimPath = Join-Path $TestDrive 'owner-claim.json'
        Write-WatchJsonAtomic -Path $claimPath -Value ([ordered]@{
            ownerPid = $identity.processId
            ownerProcessStartedAtUtc = $identity.processStartedAtUtc
        })
        $claim = Read-WatchJson -Path $claimPath

        Test-CapacityOwnerAlive -Claim $claim | Should -BeTrue
    }

    It 'retries a transient sharing violation while reading a completed child result' {
        $directory = Join-Path $TestDrive 'batch-read-sharing'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $stdout = Join-Path $directory 'stdout.log'
        [System.IO.File]::WriteAllText($stdout, '{"terminalStatus":"completed","submissionAcknowledged":true}', $Script:Utf8NoBom)
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value ([ordered]@{
            phase = 'completed'; submissionAcknowledged = $true
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            phase = 'terminal'; terminalStatus = 'completed'; rootWait = $true; codexThreadId = $script:ThreadId; watcherId = 'sharing-watcher'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            status = 'completed'; watcherId = 'sharing-watcher'; codexThreadId = $script:ThreadId; requiresCodexReview = $true; automaticResendAllowed = $false
        })
        $process = [pscustomobject]@{}
        $script:processDisposed = 0
        $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { }
        $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $script:processDisposed++ }
        $started = [datetime]::UtcNow
        $activeRound = [pscustomobject]@{
            Process = $process
            StdoutPath = $stdout
            ThreadId = $script:ThreadId
            Round = [pscustomobject]@{
                RoundId = 'sharing-retry'
                EvidenceDirectory = $directory
                TargetBinding = $null
            }
            SlotId = 1
            QueuedAt = $started
            StartedAt = $started
        }
        $locked = [System.IO.File]::Open($stdout, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $script:sleepAttempts = 0
        try {
            $result = Read-BatchRoundProcessResult `
                -ActiveRound $activeRound `
                -CompletedAt $started.AddSeconds(1) `
                -SleepAction { $script:sleepAttempts++ }
        }
        finally {
            $locked.Dispose()
        }

        $script:sleepAttempts | Should -Be 19
        $script:processDisposed | Should -Be 1
        $result.terminalStatus | Should -Be 'completed'
        $result.submissionAcknowledged | Should -BeTrue
    }

    It 'does not accept nonterminal durable evidence when child stdout remains locked' {
        $directory = Join-Path $TestDrive 'batch-read-nonterminal'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $stdout = Join-Path $directory 'stdout.log'
        [System.IO.File]::WriteAllText($stdout, '{"terminalStatus":"completed"}', $Script:Utf8NoBom)
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value ([ordered]@{
            phase = 'send-uncertain'; submissionAcknowledged = $false; automaticResendAllowed = $false
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            status = 'send-uncertain'; watcherId = 'nonterminal-watcher'
        })
        $process = [pscustomobject]@{}
        $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { }
        $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
        $started = [datetime]::UtcNow
        $activeRound = [pscustomobject]@{
            Process = $process
            StdoutPath = $stdout
            Round = [pscustomobject]@{
                RoundId = 'nonterminal-evidence'
                EvidenceDirectory = $directory
                TargetBinding = $null
            }
            SlotId = 1
            QueuedAt = $started
            StartedAt = $started
        }
        $locked = [System.IO.File]::Open($stdout, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        try {
            $result = Read-BatchRoundProcessResult `
                -ActiveRound $activeRound `
                -CompletedAt $started.AddSeconds(1) `
                -SleepAction { }
        }
        finally {
            $locked.Dispose()
        }

        $result.status | Should -Be 'recovery-required'
        $result.terminalStatus | Should -BeNullOrEmpty
        $result.errorCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        $result.submissionAcknowledged | Should -BeFalse
    }

    It 'rejects completed stdout when durable watcher identity does not match' {
        $directory = Join-Path $TestDrive 'batch-read-wrong-thread'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $stdout = Join-Path $directory 'stdout.log'
        [System.IO.File]::WriteAllText($stdout, '{"terminalStatus":"completed","watcherId":"stdout-watcher"}', $Script:Utf8NoBom)
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            phase = 'terminal'; terminalStatus = 'completed'; rootWait = $true; codexThreadId = ([guid]::NewGuid().ToString()); watcherId = 'durable-watcher'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            status = 'completed'; watcherId = 'durable-watcher'; codexThreadId = ([guid]::NewGuid().ToString()); requiresCodexReview = $true; automaticResendAllowed = $false
        })
        $process = [pscustomobject]@{}
        $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { }
        $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
        $started = [datetime]::UtcNow
        $activeRound = [pscustomobject]@{
            Process = $process; StdoutPath = $stdout; ThreadId = $script:ThreadId
            Round = [pscustomobject]@{ RoundId = 'wrong-thread'; EvidenceDirectory = $directory; TargetBinding = $null }
            SlotId = 1; QueuedAt = $started; StartedAt = $started
        }

        $result = Read-BatchRoundProcessResult -ActiveRound $activeRound -CompletedAt $started.AddSeconds(1)

        $result.status | Should -Be 'recovery-required'
        $result.terminalStatus | Should -BeNullOrEmpty
        $result.errorCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
    }

    It 'enforces three slots per task and six slots globally' {
        $secondThread = [guid]::NewGuid().ToString()
        $thirdThread = [guid]::NewGuid().ToString()
        $claims = [System.Collections.ArrayList]::new()
        foreach ($thread in @($script:ThreadId, $secondThread)) {
            foreach ($index in 1..3) {
                $directory = Join-Path $TestDrive ("slot-$thread-$index")
                $null = New-Item -ItemType Directory -Path $directory -Force
                $claim = Acquire-CapacitySlot -ThreadId $thread -RoundId "round-$index" -EvidenceDirectory $directory
                $claim.acquired | Should -BeTrue
                $null = $claims.Add($claim)
            }
            $extraDirectory = Join-Path $TestDrive ("extra-$thread")
            $null = New-Item -ItemType Directory -Path $extraDirectory -Force
            $extra = Acquire-CapacitySlot -ThreadId $thread -RoundId 'round-extra' -EvidenceDirectory $extraDirectory
            $extra.acquired | Should -BeFalse
            $extra.category | Should -Be 'ConcurrencySlotQueued'
        }

        $seventhDirectory = Join-Path $TestDrive 'seventh'
        $null = New-Item -ItemType Directory -Path $seventhDirectory -Force
        $seventh = Acquire-CapacitySlot -ThreadId $thirdThread -RoundId 'round-7' -EvidenceDirectory $seventhDirectory
        $seventh.acquired | Should -BeFalse
        $seventh.reason | Should -Be 'global-capacity'
        (Get-CapacitySlots).slots.Count | Should -Be 6

        foreach ($claim in $claims) {
            $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{ phase = 'pre-click-unsent' })
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
    }

    It 'keeps an unproved orphan isolated and releases only durable safe states' {
        $orphanClaims = [System.Collections.ArrayList]::new()
        foreach ($index in 1..3) {
            $directory = Join-Path $TestDrive ("orphan-$index")
            $null = New-Item -ItemType Directory -Path $directory -Force
            $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId "orphan-$index" -EvidenceDirectory $directory
            $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
                phase = 'run-starting'
                submissionAttempted = $true
                ownerPid = 999999
                ownerProcessStartedAtUtc = '2026-08-07T00:00:00Z'
            })
            $null = $orphanClaims.Add($claim)
        }
        $blockedDirectory = Join-Path $TestDrive 'blocked-by-orphan'
        $null = New-Item -ItemType Directory -Path $blockedDirectory -Force
        $blocked = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'blocked' -EvidenceDirectory $blockedDirectory
        $blocked.acquired | Should -BeFalse
        $blocked.category | Should -Be 'ConcurrencySlotRecoveryRequired'
        { Release-CapacitySlot -Id $orphanClaims[0].slotId } | Should -Throw '*terminal or pre-click state is not proven*'

        $safeDirectory = $orphanClaims[0].claim.evidenceDirectory
        Write-WatchJsonAtomic -Path (Join-Path $safeDirectory 'state.json') -Value ([ordered]@{
            phase = 'send-uncertain'
            automaticResendAllowed = $false
        })
        { Release-CapacitySlot -Id $orphanClaims[0].slotId -OwnerCompletionObserved } | Should -Throw '*terminal or pre-click state is not proven*'

        Write-WatchJsonAtomic -Path (Join-Path $safeDirectory 'state.json') -Value ([ordered]@{
            phase = 'pre-invoke-failed'
            invokeAttempted = $false
        })
        (Release-CapacitySlot -Id $orphanClaims[0].slotId).proof | Should -Be 'durable-pre-click-unsent'
    }

    It 'releases retry-not-submitted only from the complete durable second-attempt proof' {
        $directory = Join-Path $TestDrive 'retry-not-submitted-release'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'retry-not-submitted' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $true
        })
        $null = Set-AdapterTerminalFixture -Directory $directory -Outcome 'retry-not-submitted'

        $release = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved

        $release.proof | Should -Be 'durable-retry-not-submitted'
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'releases a retry preparation failure only after one durable proved-not-submitted attempt' {
        $directory = Join-Path $TestDrive 'retry-preparation-failed-release'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'retry-preparation-failed' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $true
        })
        $state = Set-AdapterTerminalFixture -Directory $directory -Outcome 'retry-not-submitted'
        $state.attemptCount = 1
        $state.attempts = @($state.attempts[0])
        $state | Add-Member -NotePropertyName retryPreparationFailedBeforeClick -NotePropertyValue $true -Force
        $state | Add-Member -NotePropertyName retryFailureCategory -NotePropertyValue 'AgentBrowserTargetMissing' -Force
        $state | Add-Member -NotePropertyName retryFailureMessage -NotePropertyValue 'retry target disappeared before fill' -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state

        $release = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved

        $release.proof | Should -Be 'durable-retry-not-submitted'
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'rejects an incomplete retry-not-submitted proof and retains the slot' {
        $directory = Join-Path $TestDrive 'retry-not-submitted-incomplete'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'retry-incomplete' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $true
        })
        $state = Set-AdapterTerminalFixture -Directory $directory -Outcome 'retry-not-submitted'
        $state.attempts[1].composerSha256Observed = ('c' * 64)
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'rejects every historical attempt mutation and retains the slot' {
        $directory = Join-Path $TestDrive 'retry-history-incomplete'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'retry-history' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $true
        })
        $state = Set-AdapterTerminalFixture -Directory $directory -Outcome 'retry-not-submitted'
        $state.attempts[0].exactConversationUrl = $script:BoundUrl
        $state.attempts[1].attempt = 1
        Write-WatchJsonAtomic -Path (Join-Path $directory 'state.json') -Value $state

        $category = ''
        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'does not report batch success when terminal slot release fails' {
        $manifestPath = New-BatchFixture -Root (Join-Path $TestDrive 'release-failure-batch') -TimeoutSeconds 30
        $process = [pscustomobject]@{ Id = $PID; HasExited = $true }
        $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
        $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { }
        Mock Start-BatchRoundProcess { [pscustomobject]@{ Process = $process; StdoutPath = ''; StderrPath = '' } }
        Mock Read-BatchRoundProcessResult {
            [ordered]@{ roundId = 'round-1'; status = 'completed'; terminalStatus = 'completed'; terminalOutcome = ''; errorCategory = $null; watcherId = 'release-failure-watcher' }
        }
        Mock Release-CapacitySlot {
            $exception = [System.InvalidOperationException]::new('release proof failed')
            $exception.Data['Category'] = 'ConcurrencySlotRecoveryRequired'
            throw $exception
        }

        $result = Invoke-RootWaitBatch -Path $manifestPath -ExpectedThreadId $script:ThreadId -SleepAction { }

        $result.items[0].status | Should -Be 'recovery-required'
        $result.items[0].errorCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        $result.allSucceeded | Should -BeFalse
    }

    It 'returns ConcurrencySlotRecoveryRequired and retains a recovery-required slot' {
        $directory = Join-Path $TestDrive 'recovery-required-release'
        $null = New-Item -ItemType Directory -Path $directory -Force
        $claim = Acquire-CapacitySlot -ThreadId $script:ThreadId -RoundId 'recovery-required' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes ([ordered]@{
            phase = 'run-starting'; submissionAttempted = $true
        })
        $null = Set-AdapterTerminalFixture -Directory $directory -Outcome 'recovery-required'
        $category = ''

        try {
            $null = Release-CapacitySlot -Id $claim.slotId -ExpectedClaimId $claim.claimId -OwnerCompletionObserved
        }
        catch {
            $category = [string]$_.Exception.Data['Category']
        }

        $category | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }

    It 'returns queued-timeout without starting a browser process' {
        $otherThreads = @([guid]::NewGuid().ToString(), [guid]::NewGuid().ToString())
        $claims = [System.Collections.ArrayList]::new()
        foreach ($thread in $otherThreads) {
            foreach ($index in 1..3) {
                $directory = Join-Path $TestDrive ("occupied-$thread-$index")
                $null = New-Item -ItemType Directory -Path $directory -Force
                $null = $claims.Add((Acquire-CapacitySlot -ThreadId $thread -RoundId "occupied-$index" -EvidenceDirectory $directory))
            }
        }
        $manifestPath = New-BatchFixture -Root (Join-Path $TestDrive 'queued-batch') -TimeoutSeconds 30
        $script:batchClock = [datetime]'2026-08-07T00:00:00Z'
        Mock Start-BatchRoundProcess { throw 'must not start' }

        $result = Invoke-RootWaitBatch `
            -Path $manifestPath `
            -ExpectedThreadId $script:ThreadId `
            -NowAction { $script:batchClock = $script:batchClock.AddSeconds(31); $script:batchClock } `
            -SleepAction { param($milliseconds) }

        $result.items.Count | Should -Be 1
        $result.items[0].status | Should -Be 'queued-timeout'
        $result.items[0].errorCategory | Should -Be 'ConcurrencySlotTimeout'
        $result.items[0].submissionAcknowledged | Should -BeFalse
        Should -Invoke Start-BatchRoundProcess -Times 0 -Exactly
    }

    It 'runs at most three local child rounds and writes one atomic batch result' {
        $root = Join-Path $TestDrive 'four-round-batch'
        $manifestPath = New-BatchFixture -Root $root -RoundCount 4 -TimeoutSeconds 30
        $fakeWatcher = Join-Path $root 'fake-watch.ps1'
        $fakeSource = @'
param(
    [Parameter(Position = 0)][string]$Command,
    [string]$EvidenceDir,
    [string]$CodexThreadId,
    [string]$PromptPath,
    [string]$IdempotencyKey,
    [string]$BrowserId,
    [string]$Profile,
    [string]$TabId,
    [string]$SessionKey,
    [int]$TimeoutSeconds,
    [string]$ResponseDeadlineAtUtc,
    [int]$SlotId,
    [string]$CapacityClaimId
)
if ($SlotId -lt 1 -or [string]::IsNullOrWhiteSpace($CapacityClaimId)) {
    throw 'The batch child did not receive its parent capacity claim.'
}
Start-Sleep -Milliseconds 300
$watcherId = [guid]::NewGuid().ToString()
$utf8 = [System.Text.UTF8Encoding]::new($false)
$watchState = [ordered]@{
    phase = 'terminal'
    terminalStatus = 'completed'
    rootWait = $true
    codexThreadId = $CodexThreadId
    watcherId = $watcherId
}
$event = [ordered]@{
    status = 'completed'
    watcherId = $watcherId
    codexThreadId = $CodexThreadId
    requiresCodexReview = $true
    automaticResendAllowed = $false
}
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir 'watch-state.json'), ($watchState | ConvertTo-Json -Depth 10), $utf8)
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir 'watch-event.json'), ($event | ConvertTo-Json -Depth 10), $utf8)
[ordered]@{
    ok = $true
    command = 'run-root'
    terminalStatus = 'completed'
    submissionAcknowledged = $true
    watcherId = $watcherId
} | ConvertTo-Json -Compress
'@
        [System.IO.File]::WriteAllText($fakeWatcher, $fakeSource, [System.Text.UTF8Encoding]::new($true))
        $Script:WatcherScriptPath = $fakeWatcher

        $result = Invoke-RootWaitBatch -Path $manifestPath -ExpectedThreadId $script:ThreadId

        $result.allSucceeded | Should -BeTrue
        $result.items.Count | Should -Be 4
        $result.maxObservedConcurrency | Should -Be 3
        @($result.items | Where-Object { $_.terminalStatus -eq 'completed' }).Count | Should -Be 4
        Test-Path -LiteralPath (Join-Path $root $Script:BatchResultFileName) | Should -BeTrue
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'does not count retry-not-submitted as batch success and safely releases its slot' {
        $root = Join-Path $TestDrive 'retry-not-submitted-batch'
        $manifestPath = New-BatchFixture -Root $root -TimeoutSeconds 30
        $fakeWatcher = Join-Path $root 'retry-not-submitted-watch.ps1'
        Write-TerminalOutcomeWatcher -Path $fakeWatcher -Outcome 'retry-not-submitted'
        $Script:WatcherScriptPath = $fakeWatcher

        $result = Invoke-RootWaitBatch -Path $manifestPath -ExpectedThreadId $script:ThreadId

        $result.allSucceeded | Should -BeFalse
        $result.items[0].terminalStatus | Should -Be 'stopped-unverified'
        $result.items[0].terminalOutcome | Should -Be 'retry-not-submitted'
        (Get-CapacitySlots).slots.Count | Should -Be 0
    }

    It 'does not count recovery-required as batch success and retains its slot' {
        $root = Join-Path $TestDrive 'recovery-required-batch'
        $manifestPath = New-BatchFixture -Root $root -TimeoutSeconds 30
        $fakeWatcher = Join-Path $root 'recovery-required-watch.ps1'
        Write-TerminalOutcomeWatcher -Path $fakeWatcher -Outcome 'recovery-required'
        $Script:WatcherScriptPath = $fakeWatcher

        $result = Invoke-RootWaitBatch -Path $manifestPath -ExpectedThreadId $script:ThreadId

        $result.allSucceeded | Should -BeFalse
        $result.items[0].terminalStatus | Should -Be 'stopped-unverified'
        $result.items[0].terminalOutcome | Should -Be 'recovery-required'
        $result.items[0].status | Should -Be 'recovery-required'
        $result.items[0].errorCategory | Should -Be 'ConcurrencySlotRecoveryRequired'
        (Get-CapacitySlots).slots.Count | Should -Be 1
    }
}

Describe 'Token-free watcher state machine' {
    It 'polls locally until a stable stop and finalizes a complete response' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $true))
        $queue.Enqueue((New-WatchProbe -Generating $true))
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $observed = [System.Collections.ArrayList]::new()
        $finalizeCounter = [pscustomobject]@{ Value = 0 }
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                $finalizeCounter.Value++
                [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; completed = $true } }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $now } `
            -ObservationAction { param($record) $null = $observed.Add($record) }

        $result.Status | Should -Be 'completed'
        $result.Observations | Should -Be 4
        $finalizeCounter.Value | Should -Be 1
        $observed.Count | Should -Be 4
    }

    It 'observes the fresh root until the same window exposes its first exact URL' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $true -Url 'https://chatgpt.com/' -UrlExact $false))
        $queue.Enqueue((New-WatchProbe -Generating $false -Url $script:BoundUrl -UrlExact $true))
        $observed = [System.Collections.ArrayList]::new()
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl '' `
            -UrlBindingPending `
            -StablePollCount 1 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                [pscustomobject]@{
                    ExitCode = 0
                    Payload = [pscustomobject]@{ ok = $true; completed = $true; conversationUrl = $script:BoundUrl }
                }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $now } `
            -ObservationAction { param($record) $null = $observed.Add($record) }

        $result.Status | Should -Be 'completed'
        @($observed | Where-Object { $_.boundConversationUrl -eq $script:BoundUrl }).Count | Should -Be 1
        $observed[0].urlExact | Should -BeFalse
        $observed[0].matchedBoundUrl | Should -BeFalse
    }

    It 'fails closed if the URL changes after a pending fresh send binds its first exact URL' {
        $otherUrl = 'https://chatgpt.com/c/abcdef12-1234-1234-1234-123456789abc'
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $true -Url $script:BoundUrl -UrlExact $true))
        $queue.Enqueue((New-WatchProbe -Generating $false -Url $otherUrl -UrlExact $true))
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl '' `
            -UrlBindingPending `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction { throw 'must not finalize a changed conversation' } `
            -SleepAction { param($seconds) } `
            -NowAction { $now }

        $result.Status | Should -Be 'conversation-changed'
        $result.Reason | Should -Be 'bound-conversation-url-mismatch'
    }

    It 'wakes adjudication when generation stopped but finalization failed' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 1 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                [pscustomobject]@{ ExitCode = 28; Payload = [pscustomobject]@{ ok = $false; category = 'ResponseNotCompleted' } }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $now }

        $result.Status | Should -Be 'stopped-unverified'
        $result.FinalizeResult.ExitCode | Should -Be 28
    }

    It 'keeps monitoring when queued generation has not started before finalization times out' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $queue.Enqueue((New-WatchProbe -Generating $true))
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $finalizers = [System.Collections.Queue]::new()
        $finalizers.Enqueue(
            [pscustomobject]@{
                ExitCode = 27
                Payload = [pscustomobject]@{ ok = $false; category = 'ResponseTimeout' }
            }
        )
        $finalizers.Enqueue(
            [pscustomobject]@{
                ExitCode = 0
                Payload = [pscustomobject]@{ ok = $true; completed = $true }
            }
        )
        $observed = [System.Collections.ArrayList]::new()
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction { $finalizers.Dequeue() } `
            -SleepAction { param($seconds) } `
            -NowAction { $now } `
            -ObservationAction { param($record) $null = $observed.Add($record) }

        $result.Status | Should -Be 'completed'
        $result.Observations | Should -Be 5
        $finalizers.Count | Should -Be 0
        @(
            $observed | Where-Object {
                $_ -is [System.Collections.IDictionary] -and
                $_.Contains('awaitingGeneration') -and
                $_['awaitingGeneration']
            }
        ).Count | Should -Be 1
    }

    It 'retries UI mutex contention while finalizing the stopped response' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $finalizers = [System.Collections.Queue]::new()
        1..2 | ForEach-Object {
            $finalizers.Enqueue(
                [pscustomobject]@{
                    ExitCode = 32
                    Payload = [pscustomobject]@{ ok = $false; category = 'ConcurrentUiOperation' }
                }
            )
        }
        $finalizers.Enqueue(
            [pscustomobject]@{
                ExitCode = 0
                Payload = [pscustomobject]@{ ok = $true; completed = $true }
            }
        )
        $observed = [System.Collections.ArrayList]::new()
        $sleepCounter = [pscustomobject]@{ Value = 0 }
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 1 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction { $finalizers.Dequeue() } `
            -SleepAction { param($seconds) $sleepCounter.Value++ } `
            -NowAction { $now } `
            -ObservationAction { param($record) $null = $observed.Add($record) }

        $result.Status | Should -Be 'completed'
        $result.Observations | Should -Be 3
        $finalizers.Count | Should -Be 0
        $sleepCounter.Value | Should -Be 2
        @(
            $observed | Where-Object {
                $_ -is [System.Collections.IDictionary] -and
                $_.Contains('phase') -and
                $_['phase'] -eq 'finalize' -and
                $_['deferred']
            }
        ).Count | Should -Be 2
    }

    It 'bounds repeated finalizer contention by the overall watcher timeout' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $times = [System.Collections.Queue]::new()
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:31Z')
        $finalizeCounter = [pscustomobject]@{ Value = 0 }

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 1 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 30 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                $finalizeCounter.Value++
                [pscustomobject]@{
                    ExitCode = 32
                    Payload = [pscustomobject]@{ ok = $false; category = 'ConcurrentUiOperation' }
                }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $times.Dequeue() }

        $result.Status | Should -Be 'timeout'
        $result.FinalizeResult.ExitCode | Should -Be 32
        $result.Observations | Should -Be 2
        $finalizeCounter.Value | Should -Be 1
    }

    It 'finalizes the first stable-stop probe admitted before the overall deadline' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $times = [System.Collections.Queue]::new()
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:29Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:31Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:31Z')
        $finalizeCounter = [pscustomobject]@{ Value = 0 }

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 1 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 30 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                $finalizeCounter.Value++
                [pscustomobject]@{
                    ExitCode = 0
                    Payload = [pscustomobject]@{ ok = $true; completed = $true }
                }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $times.Dequeue() }

        $result.Status | Should -Be 'completed'
        $finalizeCounter.Value | Should -Be 1
    }

    It 'keeps monitoring through a temporarily unavailable bound surface' {
        $queue = [System.Collections.Queue]::new()
        1..3 | ForEach-Object {
            $queue.Enqueue((New-WatchProbe -Generating $false -ExitCode 20 -Category 'AgentBrowserTargetMissing'))
        }
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $now = [datetime]'2026-07-28T20:00:00Z'
        $finalizeCounter = [pscustomobject]@{ Value = 0 }
        $observed = [System.Collections.ArrayList]::new()

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 1 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                $finalizeCounter.Value++
                [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; completed = $true } }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $now } `
            -ObservationAction { param($record) $null = $observed.Add($record) }

        $result.Status | Should -Be 'completed'
        $result.ConsecutiveProbeFailures | Should -Be 0
        $finalizeCounter.Value | Should -Be 1
        @($observed | Where-Object {
            $_ -is [System.Collections.IDictionary] -and
            $_.Contains('category') -and
            $_['category'] -eq 'AgentBrowserTargetMissing' -and
            $_['deferred']
        }).Count | Should -Be 3
    }

    It 'times out with pending recovery when the bound surface never reappears' {
        $times = [System.Collections.Queue]::new()
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:31Z')

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 30 `
            -SleepSeconds 5 `
            -ProbeAction { New-WatchProbe -Generating $false -ExitCode 20 -Category 'AgentBrowserTargetMissing' } `
            -FinalizeAction { throw 'must not finalize' } `
            -SleepAction { param($seconds) } `
            -NowAction { $times.Dequeue() }

        $event = New-WatchEvent -WatchState ([pscustomobject]@{
            evidenceDirectory = 'evidence'
            conversationUrl = $script:BoundUrl
            transport = 'agent-browser-cli-v2'
            targetBinding = New-TestTargetBinding
            codexThreadId = $script:ThreadId
        }) -LoopResult $result
        $result.Status | Should -Be 'timeout'
        $result.ConsecutiveProbeFailures | Should -Be 0
        $result.LastFailureCategory | Should -Be 'AgentBrowserTargetMissing'
        $event.recoveryStatus | Should -Be 'pending-manual'
        $event.recoveryReason | Should -Be 'bound-surface-unavailable'
        $event.recoveryCategory | Should -Be 'AgentBrowserTargetMissing'
        $event.automaticResendAllowed | Should -BeFalse
    }

    It 'still fails closed after bounded non-surface probe failures' {
        $queue = [System.Collections.Queue]::new()
        1..3 | ForEach-Object {
            $queue.Enqueue((New-WatchProbe -Generating $false -ExitCode 99 -Category 'ProbeUnavailable'))
        }
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction { throw 'must not finalize' } `
            -SleepAction { param($seconds) } `
            -NowAction { $now }

        $result.Status | Should -Be 'probe-failed'
        $result.ConsecutiveProbeFailures | Should -Be 3
        $result.LastFailureCategory | Should -Be 'ProbeUnavailable'
    }

    It 'defers UI mutex contention without losing a stable stop observation' {
        $queue = [System.Collections.Queue]::new()
        $queue.Enqueue((New-WatchProbe -Generating $false))
        1..3 | ForEach-Object {
            $queue.Enqueue((New-WatchProbe -Generating $false -ExitCode 32 -Category 'ConcurrentUiOperation'))
        }
        $queue.Enqueue((New-WatchProbe -Generating $false))
        $observed = [System.Collections.ArrayList]::new()
        $now = [datetime]'2026-07-28T20:00:00Z'

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction {
                [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; completed = $true } }
            } `
            -SleepAction { param($seconds) } `
            -NowAction { $now } `
            -ObservationAction { param($record) $null = $observed.Add($record) }

        $result.Status | Should -Be 'completed'
        $result.Observations | Should -Be 5
        $result.ConsecutiveProbeFailures | Should -Be 0
        @(
            $observed | Where-Object {
                $_ -is [System.Collections.IDictionary] -and
                $_.Contains('deferred') -and
                $_['deferred']
            }
        ).Count | Should -Be 3
    }

    It 'fails closed when the selected conversation changes' {
        $now = [datetime]'2026-07-28T20:00:00Z'
        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction {
                New-WatchProbe -Generating $false -Url 'https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
            } `
            -FinalizeAction { throw 'must not finalize' } `
            -SleepAction { param($seconds) } `
            -NowAction { $now }

        $result.Status | Should -Be 'conversation-changed'
        $result.Observations | Should -Be 1
        (New-WatchEvent -WatchState ([pscustomobject]@{
            conversationUrl = $script:BoundUrl
        }) -LoopResult $result).recoveryStatus | Should -Be 'pending-manual'
    }

    It 'times out without invoking a probe or finalizer after the deadline' {
        $times = [System.Collections.Queue]::new()
        $times.Enqueue([datetime]'2026-07-28T20:00:00Z')
        $times.Enqueue([datetime]'2026-07-28T20:00:31Z')
        $probeCount = 0
        $finalizeCount = 0

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 30 `
            -SleepSeconds 5 `
            -ProbeAction { $probeCount++; New-WatchProbe -Generating $true } `
            -FinalizeAction { $finalizeCount++; $null } `
            -SleepAction { param($seconds) } `
            -NowAction { $times.Dequeue() }

        $result.Status | Should -Be 'timeout'
        $probeCount | Should -Be 0
        $finalizeCount | Should -Be 0
    }
}

Describe 'Local continuation contract' {

    It 'acknowledges an exact agent-monitor event without synthesizing a Stop callback' {
        $directory = Join-Path $TestDrive 'acknowledge-agent-monitor'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            noWake = $true
            agentMonitor = $true
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            status = 'completed'
            requiresCodexReview = $true
            automaticResendAllowed = $false
        })

        $first = Acknowledge-AgentMonitor -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $second = Acknowledge-AgentMonitor -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $first.reused | Should -BeFalse
        $second.reused | Should -BeTrue
        $acknowledgement.transport | Should -Be 'codex-agent-monitor'
        $acknowledgement.acknowledgementType | Should -Be 'codex-agent-monitor-reviewed'
        $acknowledgement.codexThreadId | Should -Be $script:ThreadId
        $acknowledgement.watcherId | Should -Be $watcherId
    }

    It 'waits locally for and acknowledges one exact root-wait event' {
        $directory = Join-Path $TestDrive 'root-wait-terminal'
        $watcherId = [guid]::NewGuid().ToString()
        $statePath = Join-Path $directory $Script:StateFileName
        $eventPath = Join-Path $directory $Script:EventFileName
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path $statePath -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            phase = 'running'
            noWake = $true
            rootWait = $true
            responseDeadlineAtUtc = '2026-08-05T20:00:00Z'
        })

        $wait = Wait-RootWatchEvent `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -WaitTimeoutSeconds 30 `
            -NowAction { [datetime]'2026-08-05T18:00:00Z' } `
            -SleepAction {
                Write-WatchJsonAtomic -Path $eventPath -Value ([ordered]@{
                    schemaVersion = 1
                    watcherId = $watcherId
                    codexThreadId = $script:ThreadId
                    status = 'completed'
                    requiresCodexReview = $true
                    automaticResendAllowed = $false
                })
                $terminalState = Read-WatchJson -Path $statePath -Required
                $terminalState | Add-Member -NotePropertyName phase -NotePropertyValue 'terminal' -Force
                $terminalState | Add-Member -NotePropertyName terminalStatus -NotePropertyValue 'completed' -Force
                Write-WatchJsonAtomic -Path $statePath -Value $terminalState
            }
        $first = Acknowledge-RootWait -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $second = Acknowledge-RootWait -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $wait.command | Should -Be 'wait-root'
        $wait.terminalStatus | Should -Be 'completed'
        $wait.watcherId | Should -Be $watcherId
        $first.reused | Should -BeFalse
        $second.reused | Should -BeTrue
        $acknowledgement.transport | Should -Be 'codex-root-wait'
        $acknowledgement.acknowledgementType | Should -Be 'codex-root-wait-reviewed'
    }

    It 'rejects a root-wait event from another watcher' {
        $directory = Join-Path $TestDrive 'root-wait-watcher-mismatch'
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = [guid]::NewGuid().ToString()
            codexThreadId = $script:ThreadId
            noWake = $true
            rootWait = $true
            responseDeadlineAtUtc = [datetime]::UtcNow.AddHours(2).ToString('o')
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = [guid]::NewGuid().ToString()
            codexThreadId = $script:ThreadId
            status = 'completed'
            requiresCodexReview = $true
            automaticResendAllowed = $false
        })

        { Wait-RootWatchEvent -EvidenceDirectory $directory -ThreadId $script:ThreadId -WaitTimeoutSeconds 30 } |
            Should -Throw '*another watcher*'
    }

    It 'times out the root file wait without creating continuation evidence' {
        $directory = Join-Path $TestDrive 'root-wait-timeout'
        $watcherId = [guid]::NewGuid().ToString()
        $times = [System.Collections.Queue]::new()
        $times.Enqueue([datetime]'2026-08-05T18:00:00Z')
        $times.Enqueue([datetime]'2026-08-05T18:00:00Z')
        $times.Enqueue([datetime]'2026-08-05T18:00:31Z')
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            noWake = $true
            rootWait = $true
            responseDeadlineAtUtc = '2026-08-05T20:00:00Z'
        })

        {
            Wait-RootWatchEvent `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -WaitTimeoutSeconds 30 `
                -NowAction { $times.Dequeue() } `
                -SleepAction { throw 'must not sleep after deadline' }
        } | Should -Throw '*Timed out waiting*'
        Test-Path -LiteralPath (Join-Path $directory $Script:ContinuationAckFileName) | Should -BeFalse
    }

    It 'does not grant a fresh root-wait budget after the response deadline expired' {
        $directory = Join-Path $TestDrive 'root-wait-response-deadline-expired'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            phase = 'running'
            processId = $PID
            noWake = $true
            rootWait = $true
            responseDeadlineAtUtc = '2026-08-05T18:00:00Z'
        })

        {
            Wait-RootWatchEvent `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -WaitTimeoutSeconds 7200 `
                -NowAction { [datetime]'2026-08-05T18:00:01Z' } `
                -SleepAction { throw 'must not sleep after the response deadline' }
        } | Should -Throw '*response deadline expired*'
    }

    It 'rejects a terminal root-wait event that appears after the original response deadline' {
        $directory = Join-Path $TestDrive 'root-wait-late-terminal-event'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            phase = 'terminal'
            terminalStatus = 'completed'
            noWake = $true
            rootWait = $true
            responseDeadlineAtUtc = '2026-08-05T18:00:00Z'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            status = 'completed'
            requiresCodexReview = $true
            automaticResendAllowed = $false
        })

        {
            Wait-RootWatchEvent `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -WaitTimeoutSeconds 30 `
                -NowAction { [datetime]'2026-08-05T18:00:01Z' }
        } | Should -Throw '*response deadline expired*'
    }

    It 'terminates root wait when the watcher process exits without an event' {
        $directory = Join-Path $TestDrive 'root-wait-worker-crashed'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            phase = 'running'
            processId = 424242
            noWake = $true
            rootWait = $true
            automaticResendAllowed = $false
            responseDeadlineAtUtc = '2026-08-05T20:00:00Z'
        })

        $wait = Wait-RootWatchEvent `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -WaitTimeoutSeconds 30 `
            -NowAction { [datetime]'2026-08-05T18:00:00Z' } `
            -SleepAction { } `
            -ProcessAliveAction { $false }
        $event = Read-WatchJson -Path (Join-Path $directory $Script:EventFileName) -Required
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $wait.terminalStatus | Should -Be 'worker-crashed'
        $event.reason | Should -Be 'root-wait-worker-not-running'
        $event.requiresCodexReview | Should -BeTrue
        $event.automaticResendAllowed | Should -BeFalse
        $state.phase | Should -Be 'terminal'
        $state.terminalStatus | Should -Be 'worker-crashed'
    }

    It 'rejects agent-monitor acknowledgement when continuation transport is undeclared' {
        $directory = Join-Path $TestDrive 'reject-monitor-ack-undeclared'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            noWake = $false
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            status = 'completed'
            requiresCodexReview = $true
            automaticResendAllowed = $false
        })

        { Acknowledge-AgentMonitor -EvidenceDirectory $directory -ThreadId $script:ThreadId } |
            Should -Throw '*no supported local continuation transport*'
    }

    It 'rejects a non-terminal agent-monitor event' {
        $directory = Join-Path $TestDrive 'reject-monitor-ack-for-running-event'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            noWake = $true
            agentMonitor = $true
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            status = 'running'
            requiresCodexReview = $true
            automaticResendAllowed = $false
        })

        { Acknowledge-AgentMonitor -EvidenceDirectory $directory -ThreadId $script:ThreadId } |
            Should -Throw '*terminal no-resend event*'
    }

    It 'contains no CLI resume or Desktop composer callback' {
        $source = [System.IO.File]::ReadAllText($watcherPath)

        $source | Should -Not -Match '(?i)codex\.cmd'
        $source | Should -Not -Match '(?i)exec\s+resume'
        $source | Should -Not -Match '(?i)desktop-wake'
        $source | Should -Not -Match 'Invoke-WatchDesktopWake'
        $source | Should -Not -Match 'CodexWakeModel'
    }

    It 'contains no encoded command or execution policy bypass launcher' {
        $source = [System.IO.File]::ReadAllText($watcherPath)

        $source | Should -Not -Match ('Encoded' + 'Command')
        $source | Should -Not -Match ('ExecutionPolicy' + '\s+' + 'Bypass')
    }

    It 'keeps the V2 runtime RootWait-only without a Stop Hook surface' {
        $source = [System.IO.File]::ReadAllText($watcherPath)
        $skillDocument = Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'SKILL.md')

        $source | Should -Not -Match 'Register-WatchStopHook|Acknowledge-WatchContinuation|codex-stop-hook|stop-hook-v[12]'
        $skillDocument | Should -Match 'never registers a Stop Hook'
        $skillDocument | Should -Match 'pure local RootWait watcher'
    }

    It 'preserves root-wait transport when the detached worker completes' {
        $directory = Join-Path $TestDrive 'worker-root-wait'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $true
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required
        $state | Add-Member -NotePropertyName rootWait -NotePropertyValue $true -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value $state

        Mock Invoke-WatchAdapterStatus {
            New-WatchProbe -Generating $false
        }
        Mock Invoke-WatchAdapterFinalize {
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; completed = $true } }
        }

        $result = Invoke-WatchWorker `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -Token $token `
            -RootWait
        $terminalState = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $result.terminalStatus | Should -Be 'completed'
        $result.continuationTransport | Should -Be 'codex-root-wait'
        $terminalState.rootWait | Should -BeTrue
    }

    It 'keeps the worker alive through temporary bound-surface loss without rebinding or resending' {
        $directory = Join-Path $TestDrive 'worker-recovery-resume'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $true
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required
        $state | Add-Member -NotePropertyName rootWait -NotePropertyValue $true -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value $state
        $probes = [System.Collections.Queue]::new()
        $probes.Enqueue((New-WatchProbe -Generating $false -ExitCode 20 -Category 'AgentBrowserTargetMissing'))
        $probes.Enqueue((New-WatchProbe -Generating $false -ExitCode 20 -Category 'AgentBrowserTargetMissing'))
        $probes.Enqueue((New-WatchProbe -Generating $false))

        Mock Invoke-WatchAdapterStatus {
            $probes.Dequeue()
        }
        Mock Invoke-WatchAdapterFinalize {
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; completed = $true } }
        }
        Mock Start-Sleep { }

        $result = Invoke-WatchWorker -EvidenceDirectory $directory -ThreadId $script:ThreadId -Token $token -RootWait
        $event = Read-WatchJson -Path (Join-Path $directory $Script:EventFileName) -Required
        $terminalState = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $result.terminalStatus | Should -Be 'completed'
        $event.recoveryStatus | Should -Be 'not-pending'
        $event.conversationUrl | Should -Be $script:BoundUrl
        $event.transport | Should -Be 'agent-browser-cli-v2'
        $event.targetBinding.sessionKey | Should -Be 'browser-1:profile-1:101'
        $event.automaticResendAllowed | Should -BeFalse
        $terminalState.phase | Should -Be 'terminal'
        Should -Invoke Invoke-WatchAdapterFinalize -Times 1 -Exactly
    }

    It 'records a terminal worker crash when adapter setup fails before polling' {
        $directory = Join-Path $TestDrive 'worker-setup-failure'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $true
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required
        $state | Add-Member -NotePropertyName rootWait -NotePropertyValue $true -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value $state

        Mock Get-WatchAdapterPath {
            throw 'adapter unavailable'
        }

        $result = Invoke-WatchWorker `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -Token $token `
            -ExpectedWatcherId $state.watcherId `
            -RootWait
        $event = Read-WatchJson -Path (Join-Path $directory $Script:EventFileName) -Required
        $terminalState = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $result.terminalStatus | Should -Be 'worker-crashed'
        $event.status | Should -Be 'worker-crashed'
        $event.watcherId | Should -Be $state.watcherId
        $terminalState.phase | Should -Be 'terminal'
        $terminalState.terminalStatus | Should -Be 'worker-crashed'
    }

    It 'records a bound terminal event when launcher state is unreadable' {
        $directory = Join-Path $TestDrive 'worker-state-unreadable'
        $null = [System.IO.Directory]::CreateDirectory($directory)
        $watcherId = [guid]::NewGuid().ToString()
        [System.IO.File]::WriteAllText(
            (Join-Path $directory $Script:StateFileName),
            '{invalid',
            $Script:Utf8NoBom
        )

        $result = Invoke-WatchWorker `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -Token ([guid]::NewGuid().ToString('N')) `
            -ExpectedWatcherId $watcherId `
            -AgentMonitor
        $event = Read-WatchJson -Path (Join-Path $directory $Script:EventFileName) -Required
        $terminalState = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $result.terminalStatus | Should -Be 'worker-crashed'
        $result.continuationTransport | Should -Be 'codex-agent-monitor'
        $event.status | Should -Be 'worker-crashed'
        $event.watcherId | Should -Be $watcherId
        $event.codexThreadId | Should -Be $script:ThreadId
        $terminalState.noWake | Should -BeTrue
        $terminalState.agentMonitor | Should -BeTrue
    }
}

Describe 'Detached launcher behavior' {
    It 'serializes watcher starts for the same evidence directory' {
        $directory = Join-Path $TestDrive 'launcher-mutex'
        New-WatchFixtureEvidence -Directory $directory
        $mutex = Enter-WatchStartMutex -EvidenceDirectory $directory
        try {
            $quotedWatcher = $watcherPath.Replace("'", "''")
            $quotedDirectory = $directory.Replace("'", "''")
            $childPath = Join-Path $TestDrive 'watcher-mutex-child.ps1'
            $childCommand = @"
. '$quotedWatcher'
try {
    `$childMutex = Enter-WatchStartMutex -EvidenceDirectory '$quotedDirectory' -TimeoutMilliseconds 150
    Exit-WatchStartMutex -Mutex `$childMutex
    exit 0
}
catch {
    exit 41
}
"@
            [System.IO.File]::WriteAllText($childPath, $childCommand, [System.Text.UTF8Encoding]::new($true))
            & powershell.exe -NoProfile -File $childPath
            $LASTEXITCODE | Should -Be 41
        }
        finally {
            Exit-WatchStartMutex -Mutex $mutex
        }
    }

    It 'returns promptly with one process id and reuses an active watcher' {
        $directory = Join-Path $TestDrive "launcher's evidence"
        New-WatchFixtureEvidence -Directory $directory
        $script:fakePid = $PID
        $script:launch = $null

        Mock Start-Process {
            $script:launch = [pscustomobject]@{
                FilePath = $FilePath
                ArgumentList = @($ArgumentList)
                WindowStyle = $WindowStyle
            }
            [pscustomobject]@{ Id = $script:fakePid }
        }

        $first = Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId -RootWait
        $second = Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId -RootWait

        $first.started | Should -BeTrue
        $first.pollingConsumesModelTokens | Should -BeFalse
        $first.continuationTransport | Should -Be 'codex-root-wait'
        $second.started | Should -BeFalse
        $second.reused | Should -BeTrue
        $second.processId | Should -Be $PID
        $script:launch.FilePath | Should -Be 'powershell.exe'
        $script:launch.WindowStyle | Should -Be 'Hidden'
        $script:launch.ArgumentList | Should -Contain '-File'
        $script:launch.ArgumentList | Should -Contain ('"' + $watcherPath + '"')
        $script:launch.ArgumentList | Should -Contain ('"' + $directory + '"')
        $script:launch.ArgumentList | Should -Not -Contain '-WindowStyle'
        Assert-MockCalled Start-Process -Times 1
    }

    It 'does not launch a watcher after the adapter response deadline expired' {
        $directory = Join-Path $TestDrive 'launcher-expired-response-deadline'
        New-WatchFixtureEvidence -Directory $directory
        $adapterStatePath = Join-Path $directory 'state.json'
        $adapterState = Read-WatchJson -Path $adapterStatePath -Required
        $adapterState | Add-Member -NotePropertyName responseDeadlineAtUtc -NotePropertyValue ([DateTime]::UtcNow.AddSeconds(-1).ToString('o')) -Force
        Write-WatchJsonAtomic -Path $adapterStatePath -Value $adapterState
        Mock Start-Process { throw 'must not launch after the absolute deadline' }

        {
            Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId -RootWait
        } | Should -Throw '*response deadline expired*'
        Should -Invoke Start-Process -Times 0 -Exactly
    }

    It 'rejects the deprecated model-monitor launcher mode' {
        $directory = Join-Path $TestDrive 'launcher-agent-monitor'
        New-WatchFixtureEvidence -Directory $directory
        $script:launchArguments = $null
        Mock Start-Process {
            $script:launchArguments = @($ArgumentList)
            [pscustomobject]@{ Id = $PID }
        }

        {
            Start-WatchProcess `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -AgentMonitor
        } | Should -Throw '*supports RootWait only*'
        Should -Invoke Start-Process -Times 0 -Exactly
    }

    It 'uses the pure-script root-wait transport' {
        $directory = Join-Path $TestDrive 'launcher-root-wait'
        New-WatchFixtureEvidence -Directory $directory
        $script:launchArguments = $null
        $script:launchStdout = $null
        $script:launchStderr = $null
        Mock Start-Process {
            $script:launchArguments = @($ArgumentList)
            $script:launchStdout = $RedirectStandardOutput
            $script:launchStderr = $RedirectStandardError
            [pscustomobject]@{ Id = $PID }
        }

        $result = Start-WatchProcess `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -RootWait
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $result.started | Should -BeTrue
        $result.continuationTransport | Should -Be 'codex-root-wait'
        $result.launcherHostRetained | Should -BeFalse
        $state.noWake | Should -BeTrue
        $state.rootWait | Should -BeTrue
        $state.launcherHostRetained | Should -BeFalse
        $script:launchArguments | Should -Contain '-NoWake'
        $script:launchArguments | Should -Contain '-RootWait'
        $script:launchStdout | Should -Be (Join-Path $directory $Script:WorkerStdoutFileName)
        $script:launchStderr | Should -Be (Join-Path $directory $Script:WorkerStderrFileName)
    }

    It 'retains the launcher host only when root-wait explicitly requests it' {
        $directory = Join-Path $TestDrive 'launcher-root-wait-retained'
        New-WatchFixtureEvidence -Directory $directory
        Mock Start-Process { [pscustomobject]@{ Id = $PID } }
        Mock Wait-Process { }

        $result = Start-WatchProcess `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -RootWait `
            -KeepLauncherAlive
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        $result.launcherHostRetained | Should -BeTrue
        $state.launcherHostRetained | Should -BeTrue
        Should -Invoke Wait-Process -Times 1 -Exactly -ParameterFilter { $Id -contains $PID }
    }

    It 'rejects launcher retention outside root-wait mode' {
        $directory = Join-Path $TestDrive 'launcher-retained-invalid-mode'
        New-WatchFixtureEvidence -Directory $directory
        Mock Start-Process { throw 'must not launch' }

        {
            Start-WatchProcess `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -KeepLauncherAlive
        } | Should -Throw '*valid only with RootWait*'
        Should -Invoke Start-Process -Times 0 -Exactly
    }

    It 'rejects changing root-wait evidence to another continuation transport' {
        $directory = Join-Path $TestDrive 'launcher-root-wait-mode-change'
        New-WatchFixtureEvidence -Directory $directory
        Mock Start-Process { [pscustomobject]@{ Id = $PID } }

        $null = Start-WatchProcess `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -RootWait

        { Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId -AgentMonitor } |
            Should -Throw '*supports RootWait only*'
    }

    It 'rejects launching without the selected RootWait transport' {
        $directory = Join-Path $TestDrive 'launcher-missing-root-wait'
        New-WatchFixtureEvidence -Directory $directory
        Mock Start-Process { [pscustomobject]@{ Id = $PID } }

        { Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId } |
            Should -Throw '*supports RootWait only*'
        Should -Invoke Start-Process -Times 0 -Exactly
    }

    It 'rejects an ambiguous worker process path' {
        {
            New-WatchWorkerArgumentList `
                -ScriptPath 'C:\bad"path\watcher.ps1' `
                -EvidenceDirectory $TestDrive `
                -ThreadId $script:ThreadId `
                -Token ([guid]::NewGuid().ToString('N')) `
                -ExpectedWatcherId ([guid]::NewGuid().ToString())
        } | Should -Throw '*cannot contain a double quote*'
    }

    It 'reports an existing terminal watcher without launching another process' {
        $directory = Join-Path $TestDrive 'terminal-reuse'
        New-WatchFixtureEvidence -Directory $directory
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            watcherId = [guid]::NewGuid().ToString()
            phase = 'terminal'
            processId = 999999
            noWake = $true
            rootWait = $true
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            status = 'completed'
        })
        Mock Start-Process { throw 'must not relaunch' }

        $result = Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId -RootWait

        $result.started | Should -BeFalse
        $result.alreadyTerminal | Should -BeTrue
        Assert-MockCalled Start-Process -Times 0
    }

    It 'rejects stale state instead of pretending monitoring is active' {
        $directory = Join-Path $TestDrive 'stale-state'
        New-WatchFixtureEvidence -Directory $directory
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            watcherId = [guid]::NewGuid().ToString()
            phase = 'running'
            processId = 999999
            noWake = $true
            rootWait = $true
        })
        Mock Start-Process { throw 'must not relaunch' }

        {
            Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId -RootWait
        } | Should -Throw '*stale watcher state*'
        Assert-MockCalled Start-Process -Times 0
    }
}
