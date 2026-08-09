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
    [int]$TimeoutSeconds
)
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

    It 'keeps the legacy timeout range when Stop Hook continuation is disabled' {
        {
            Assert-WatchConfiguration `
                -DisableStopHookHorizon `
                -ConfiguredTimeoutSeconds 8000 `
                -ConfiguredFinalizeTimeoutSeconds 45
        } | Should -Not -Throw

        {
            Assert-WatchConfiguration `
                -ConfiguredTimeoutSeconds 8000 `
                -ConfiguredFinalizeTimeoutSeconds 45
        } | Should -Throw '*Stop Hook horizon*'
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

        Mock Get-WatchAdapterPath { 'adapter.ps1' }
        Mock Get-WatchEvidenceBinding {
            $null = $script:roundOrder.Add('binding')
            [pscustomobject]@{ Phase = 'sent' }
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
            -IdempotencyKeyValue 'atomic-root-round-1'

        @($script:roundOrder) | Should -Be @('send', 'binding', 'start', 'wait')
        $result.command | Should -Be 'run-root'
        $result.terminalStatus | Should -Be 'completed'
        $result.submittedExactlyOnce | Should -BeTrue
        $result.acknowledgementPending | Should -BeTrue
        $result.pollingConsumesModelTokens | Should -BeFalse
        Should -Invoke Invoke-WatchAdapterSend -Times 1 -Exactly
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
            [pscustomobject]@{ Phase = 'send-uncertain' }
        }

        $result = Invoke-RootWaitRound `
            -EvidenceDirectory $script:roundDirectory `
            -ThreadId $script:ThreadId `
            -PromptFile $script:roundPrompt `
            -IdempotencyKeyValue 'atomic-root-round-2'

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
                -IdempotencyKeyValue 'atomic-root-round-3'
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
            -NowAction { $startedAt.AddSeconds(120) }

        $script:capturedWaitTimeout | Should -Be 7080
        $result.responseDeadlineAtUtc | Should -Be $deadline.ToString('o')
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
            -IdempotencyKeyValue 'atomic-root-retry-not-submitted'
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
            -IdempotencyKeyValue 'atomic-root-recovery-required'
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
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            status = 'completed'; watcherId = 'sharing-watcher'
        })
        $process = [pscustomobject]@{}
        $script:processDisposed = 0
        $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { }
        $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $script:processDisposed++ }
        $started = [datetime]::UtcNow
        $activeRound = [pscustomobject]@{
            Process = $process
            StdoutPath = $stdout
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

        $result.status | Should -Be 'failed'
        $result.terminalStatus | Should -BeNullOrEmpty
        $result.submissionAcknowledged | Should -BeFalse
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
    [int]$TimeoutSeconds
)
Start-Sleep -Milliseconds 300
[ordered]@{
    ok = $true
    command = 'run-root'
    terminalStatus = 'completed'
    submissionAcknowledged = $true
    watcherId = [guid]::NewGuid().ToString()
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

Describe 'Codex Stop Hook continuation contract' {
    BeforeEach {
        $Script:StopHookRegistryRootOverride = Join-Path $TestDrive ('stop-hook-registry-' + [guid]::NewGuid().ToString('N'))
    }

    AfterEach {
        $Script:StopHookRegistryRootOverride = $null
    }

    It 'durably acknowledges a reviewed terminal continuation' {
        $directory = Join-Path $TestDrive 'acknowledge-terminal'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            status = 'probe-failed'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StopHookClaimFileName) -Value ([ordered]@{
            schemaVersion = 1
            codexThreadId = $script:ThreadId
            watcherId = $watcherId
            terminalStatus = 'probe-failed'
        })

        $result = Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $result.acknowledged | Should -BeTrue
        $acknowledgement.acknowledgementType | Should -Be 'codex-reviewed'
        $acknowledgement.codexThreadId | Should -Be $script:ThreadId
        $acknowledgement.watcherId | Should -Be $watcherId
        $acknowledgement.terminalStatus | Should -Be 'probe-failed'
    }

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
        Test-Path -LiteralPath (Join-Path $directory $Script:StopHookClaimFileName) | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $directory $Script:CallbackFileName) | Should -BeFalse
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
        Test-Path -LiteralPath (Join-Path $directory $Script:StopHookClaimFileName) | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $directory $Script:CallbackFileName) | Should -BeFalse
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
        $times.Enqueue([datetime]'2026-08-05T18:00:31Z')
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            noWake = $true
            rootWait = $true
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

    It 'rejects agent-monitor acknowledgement for a Stop Hook watcher' {
        $directory = Join-Path $TestDrive 'reject-monitor-ack-for-stop'
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
            Should -Throw '*not started in agent-monitor mode*'
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

    It 'acknowledges an eventless worker crash only when claim and callback match' {
        $directory = Join-Path $TestDrive 'acknowledge-eventless-worker-crash'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            phase = 'launch-failed'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StopHookClaimFileName) -Value ([ordered]@{
            schemaVersion = 1
            codexThreadId = $script:ThreadId
            watcherId = $watcherId
            terminalStatus = 'worker-crashed'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:CallbackFileName) -Value ([ordered]@{
            schemaVersion = 1
            continuationRequested = $true
            codexThreadId = $script:ThreadId
            watcherId = $watcherId
            terminalStatus = 'worker-crashed'
        })

        $result = Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $result.acknowledged | Should -BeTrue
        $acknowledgement.watcherId | Should -Be $watcherId
        $acknowledgement.terminalStatus | Should -Be 'worker-crashed'
        [System.IO.File]::Exists((Join-Path $directory $Script:EventFileName)) | Should -BeFalse
    }

    It 'rejects an eventless continuation when its callback does not match' {
        $directory = Join-Path $TestDrive 'reject-eventless-callback-mismatch'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StopHookClaimFileName) -Value ([ordered]@{
            schemaVersion = 1
            codexThreadId = $script:ThreadId
            watcherId = $watcherId
            terminalStatus = 'timeout'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:CallbackFileName) -Value ([ordered]@{
            schemaVersion = 1
            continuationRequested = $true
            codexThreadId = $script:ThreadId
            watcherId = [guid]::NewGuid().ToString()
            terminalStatus = 'timeout'
        })

        { Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $script:ThreadId } |
            Should -Throw '*callback does not match*'
    }

    It 'preserves a synthesized timeout when a terminal event arrives before acknowledgement' {
        $directory = Join-Path $TestDrive 'acknowledge-timeout-with-late-event'
        $watcherId = [guid]::NewGuid().ToString()
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            status = 'completed'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StopHookClaimFileName) -Value ([ordered]@{
            schemaVersion = 1
            codexThreadId = $script:ThreadId
            watcherId = $watcherId
            terminalStatus = 'timeout'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:CallbackFileName) -Value ([ordered]@{
            schemaVersion = 1
            continuationRequested = $true
            codexThreadId = $script:ThreadId
            watcherId = $watcherId
            terminalStatus = 'timeout'
        })

        $result = Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $result.acknowledged | Should -BeTrue
        $result.terminalStatus | Should -Be 'timeout'
        $acknowledgement.terminalStatus | Should -Be 'timeout'
    }

    It 'acknowledges one matching legacy v1 claim without a watcher id' {
        $directory = Join-Path $TestDrive 'acknowledge-legacy-terminal'
        $watcherId = [guid]::NewGuid().ToString()
        $legacyRegistrationPath = Join-Path (
            Join-Path $TestDrive $Script:LegacyStopHookRegistryDirectoryName
        ) ($script:ThreadId + '.json')
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            stopHookRegistrationPath = $legacyRegistrationPath
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            schemaVersion = 1
            status = 'completed'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StopHookClaimFileName) -Value ([ordered]@{
            schemaVersion = 1
            codexThreadId = $script:ThreadId
            terminalStatus = 'completed'
        })

        $result = Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $result.acknowledged | Should -BeTrue
        $acknowledgement.watcherId | Should -Be $watcherId
        $acknowledgement.terminalStatus | Should -Be 'completed'
    }

    It 'acknowledges a synthesized legacy v1 timeout when claim and callback omit watcher ids' {
        $directory = Join-Path $TestDrive 'acknowledge-legacy-timeout'
        $watcherId = [guid]::NewGuid().ToString()
        $legacyRegistrationPath = Join-Path (
            Join-Path $TestDrive $Script:LegacyStopHookRegistryDirectoryName
        ) ($script:ThreadId + '.json')
        $null = New-Item -ItemType Directory -Path $directory -Force
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            schemaVersion = 1
            watcherId = $watcherId
            codexThreadId = $script:ThreadId
            stopHookRegistrationPath = $legacyRegistrationPath
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StopHookClaimFileName) -Value ([ordered]@{
            schemaVersion = 1
            codexThreadId = $script:ThreadId
            terminalStatus = 'timeout'
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:CallbackFileName) -Value ([ordered]@{
            schemaVersion = 1
            continuationRequested = $true
            codexThreadId = $script:ThreadId
            terminalStatus = 'timeout'
        })

        $result = Acknowledge-WatchContinuation -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $acknowledgement = Read-WatchJson -Path (Join-Path $directory $Script:ContinuationAckFileName) -Required

        $result.acknowledged | Should -BeTrue
        $result.watcherId | Should -Be $watcherId
        $acknowledgement.terminalStatus | Should -Be 'timeout'
    }

    It 'registers one exact thread and bounded evidence directory' {
        $directory = Join-Path $TestDrive 'registration'
        New-WatchFixtureEvidence -Directory $directory
        $watcherId = [guid]::NewGuid().ToString()

        $path = Register-WatchStopHook `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -WatcherId $watcherId `
            -WatcherTimeoutSeconds 7200 `
            -FinalizeTimeout 45
        $registration = Read-WatchJson -Path $path -Required

        $expectedDirectory = Join-Path $Script:StopHookRegistryRootOverride $script:ThreadId
        $path | Should -Be (Join-Path $expectedDirectory ($watcherId.ToLowerInvariant() + '.json'))
        $registration.transport | Should -Be 'codex-stop-hook'
        $registration.codexThreadId | Should -Be $script:ThreadId
        $registration.watcherId | Should -Be $watcherId
        $registration.evidenceDirectory | Should -Be ([System.IO.Path]::GetFullPath($directory))
        $registration.claimFile | Should -Be 'watch-stop-hook.claim'
        ([datetime]$registration.hookDeadlineUtc) | Should -BeLessThan ([datetime]::UtcNow.AddSeconds(7401))
    }

    It 'rejects watcher durations beyond the Stop Hook horizon' {
        $directory = Join-Path $TestDrive 'registration-too-long'
        New-WatchFixtureEvidence -Directory $directory

        {
            Register-WatchStopHook `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -WatcherId ([guid]::NewGuid().ToString()) `
                -WatcherTimeoutSeconds 7300 `
                -FinalizeTimeout 45
        } | Should -Throw '*Stop Hook horizon*'
        @(Get-ChildItem -LiteralPath $Script:StopHookRegistryRootOverride -Recurse -File -ErrorAction SilentlyContinue).Count |
            Should -Be 0
    }

    It 'keeps two watcher registrations for the same Codex task' {
        $firstDirectory = Join-Path $TestDrive 'registration-first'
        $secondDirectory = Join-Path $TestDrive 'registration-second'
        New-WatchFixtureEvidence -Directory $firstDirectory
        New-WatchFixtureEvidence -Directory $secondDirectory
        $firstWatcherId = [guid]::NewGuid().ToString()
        $secondWatcherId = [guid]::NewGuid().ToString()

        $firstPath = Register-WatchStopHook `
            -EvidenceDirectory $firstDirectory `
            -ThreadId $script:ThreadId `
            -WatcherId $firstWatcherId `
            -WatcherTimeoutSeconds 7200 `
            -FinalizeTimeout 45
        $secondPath = Register-WatchStopHook `
            -EvidenceDirectory $secondDirectory `
            -ThreadId $script:ThreadId `
            -WatcherId $secondWatcherId `
            -WatcherTimeoutSeconds 7200 `
            -FinalizeTimeout 45

        $firstPath | Should -Not -Be $secondPath
        Test-Path -LiteralPath $firstPath | Should -BeTrue
        Test-Path -LiteralPath $secondPath | Should -BeTrue
        (Get-ChildItem -LiteralPath (Split-Path -Parent $firstPath) -Filter '*.json').Count | Should -Be 2
        (Read-WatchJson -Path $firstPath -Required).evidenceDirectory |
            Should -Be ([System.IO.Path]::GetFullPath($firstDirectory))
        (Read-WatchJson -Path $secondPath -Required).evidenceDirectory |
            Should -Be ([System.IO.Path]::GetFullPath($secondDirectory))
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

    It 'records no continuation when worker runs in no-wake mode' {
        $directory = Join-Path $TestDrive 'worker-no-wake'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $true

        Mock Invoke-WatchAdapterStatus {
            New-WatchProbe -Generating $false
        }
        Mock Invoke-WatchAdapterFinalize {
            [pscustomobject]@{ ExitCode = 0; Payload = [pscustomobject]@{ ok = $true; completed = $true } }
        }

        $result = Invoke-WatchWorker -EvidenceDirectory $directory -ThreadId $script:ThreadId -Token $token

        $result.terminalStatus | Should -Be 'completed'
        $result.continuationRegistered | Should -BeFalse
        $result.continuationTransport | Should -Be 'disabled'
        Test-Path -LiteralPath (Join-Path $directory $Script:EventFileName) | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $directory $Script:StopHookClaimFileName) | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $directory $Script:CallbackFileName) | Should -BeFalse
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
        $result.continuationRegistered | Should -BeFalse
        $result.continuationTransport | Should -Be 'codex-root-wait'
        $terminalState.rootWait | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $directory $Script:StopHookClaimFileName) | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $directory $Script:CallbackFileName) | Should -BeFalse
    }

    It 'keeps the worker alive through temporary bound-surface loss without rebinding or resending' {
        $directory = Join-Path $TestDrive 'worker-recovery-resume'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $true
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

        $result = Invoke-WatchWorker -EvidenceDirectory $directory -ThreadId $script:ThreadId -Token $token
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

    It 'writes the terminal event and leaves continuation to the registered Stop Hook' {
        $directory = Join-Path $TestDrive 'worker-hook'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $false

        Mock Invoke-WatchAdapterStatus {
            New-WatchProbe -Generating $false
        }
        Mock Invoke-WatchAdapterFinalize {
            [pscustomobject]@{ ExitCode = 28; Payload = [pscustomobject]@{ ok = $false; category = 'ResponseNotCompleted' } }
        }

        $result = Invoke-WatchWorker -EvidenceDirectory $directory -ThreadId $script:ThreadId -Token $token
        $event = Read-WatchJson -Path (Join-Path $directory $Script:EventFileName) -Required

        $result.terminalStatus | Should -Be 'stopped-unverified'
        $result.continuationRegistered | Should -BeTrue
        $result.continuationTransport | Should -Be 'codex-stop-hook'
        $event.automaticResendAllowed | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $directory $Script:CallbackFileName) | Should -BeFalse
    }

    It 'records a terminal worker crash when adapter setup fails before polling' {
        $directory = Join-Path $TestDrive 'worker-setup-failure'
        New-WatchFixtureEvidence -Directory $directory
        $token = [guid]::NewGuid().ToString('N')
        New-WorkerState -Directory $directory -Token $token -DisableWake $false
        $state = Read-WatchJson -Path (Join-Path $directory $Script:StateFileName) -Required

        Mock Get-WatchAdapterPath {
            throw 'adapter unavailable'
        }

        $result = Invoke-WatchWorker `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -Token $token `
            -ExpectedWatcherId $state.watcherId
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
    BeforeEach {
        $Script:StopHookRegistryRootOverride = Join-Path $TestDrive ('stop-hook-registry-' + [guid]::NewGuid().ToString('N'))
    }

    AfterEach {
        $Script:StopHookRegistryRootOverride = $null
    }

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
        $first.continuationRegistered | Should -BeFalse
        $first.continuationTransport | Should -Be 'codex-root-wait'
        $first.stopHookRegistrationPath | Should -BeNullOrEmpty
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

    It 'rejects the deprecated no-wake launcher mode' {
        $directory = Join-Path $TestDrive 'launcher-no-wake'
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

        {
            Start-WatchProcess `
                -EvidenceDirectory $directory `
                -ThreadId $script:ThreadId `
                -DisableContinuation
        } | Should -Throw '*supports RootWait only*'
        Should -Invoke Start-Process -Times 0 -Exactly
        Get-ChildItem -LiteralPath $Script:StopHookRegistryRootOverride -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
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
        Get-ChildItem -LiteralPath $Script:StopHookRegistryRootOverride -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
    }

    It 'uses the pure-script root-wait transport without a Stop registration' {
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
        $result.continuationRegistered | Should -BeFalse
        $result.continuationTransport | Should -Be 'codex-root-wait'
        $result.launcherHostRetained | Should -BeFalse
        $state.noWake | Should -BeTrue
        $state.rootWait | Should -BeTrue
        $state.launcherHostRetained | Should -BeFalse
        $script:launchArguments | Should -Contain '-NoWake'
        $script:launchArguments | Should -Contain '-RootWait'
        $script:launchStdout | Should -Be (Join-Path $directory $Script:WorkerStdoutFileName)
        $script:launchStderr | Should -Be (Join-Path $directory $Script:WorkerStderrFileName)
        Get-ChildItem -LiteralPath $Script:StopHookRegistryRootOverride -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
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
                -DisableContinuation `
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
