#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
# Source encoding: UTF-8 with BOM.

BeforeAll {
    $watcherPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar-watch.ps1'
    . $watcherPath

    $script:BoundUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
    $script:ThreadId = '019fa981-725e-7f02-93a7-bb1e1b7aefd3'

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
            conversationUrlBound = $script:BoundUrl
            windowRuntimeId = '42.198798'
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
            conversationUrl = $script:BoundUrl
            windowRuntimeId = '42.198798'
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
}

Describe 'Watcher binding validation' {
    It 'accepts a UUID thread id and rejects ambiguous values' {
        Test-WatchThreadId -Value $script:ThreadId | Should -BeTrue
        Test-WatchThreadId -Value 'last' | Should -BeFalse
        Test-WatchThreadId -Value '' | Should -BeFalse
    }

    It 'accepts only one exact ChatGPT conversation URL' {
        Test-WatchConversationUrl -Value $script:BoundUrl | Should -BeTrue
        Test-WatchConversationUrl -Value 'https://chatgpt.com/' | Should -BeFalse
        Test-WatchConversationUrl -Value ($script:BoundUrl + '?leak=1') | Should -BeFalse
        Test-WatchConversationUrl -Value 'https://example.com/c/12345678-1234-1234-1234-123456789abc' | Should -BeFalse
    }

    It 'loads the post-send evidence binding' {
        $directory = Join-Path $TestDrive 'binding'
        New-WatchFixtureEvidence -Directory $directory
        $binding = Get-WatchEvidenceBinding -EvidenceDirectory $directory -ThreadId $script:ThreadId

        $binding.Phase | Should -Be 'sent'
        $binding.ConversationUrl | Should -Be $script:BoundUrl
        $binding.WindowRuntimeId | Should -Be '42.198798'
        $binding.CodexThreadId | Should -Be $script:ThreadId
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

    It 'returns one abnormal event after bounded consecutive probe failures' {
        $queue = [System.Collections.Queue]::new()
        1..3 | ForEach-Object {
            $queue.Enqueue((New-WatchProbe -Generating $false -ExitCode 21 -Category 'EmbeddedDocumentMissing'))
        }
        $now = [datetime]'2026-07-28T20:00:00Z'
        $finalizeCount = 0

        $result = Invoke-WatchLoop `
            -BoundConversationUrl $script:BoundUrl `
            -StablePollCount 2 `
            -FailureLimit 3 `
            -OverallTimeoutSeconds 300 `
            -SleepSeconds 5 `
            -ProbeAction { $queue.Dequeue() } `
            -FinalizeAction { $finalizeCount++; $null } `
            -SleepAction { param($seconds) } `
            -NowAction { $now }

        $result.Status | Should -Be 'probe-failed'
        $result.ConsecutiveProbeFailures | Should -Be 3
        $finalizeCount | Should -Be 0
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
}

Describe 'Detached launcher behavior' {
    BeforeEach {
        $Script:StopHookRegistryRootOverride = Join-Path $TestDrive ('stop-hook-registry-' + [guid]::NewGuid().ToString('N'))
    }

    AfterEach {
        $Script:StopHookRegistryRootOverride = $null
    }

    It 'returns promptly with one process id and reuses an active watcher' {
        $directory = Join-Path $TestDrive 'launcher'
        New-WatchFixtureEvidence -Directory $directory
        $script:fakePid = $PID

        Mock Start-Process {
            [pscustomobject]@{ Id = $script:fakePid }
        }

        $first = Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId
        $second = Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId

        $first.started | Should -BeTrue
        $first.pollingConsumesModelTokens | Should -BeFalse
        $first.continuationRegistered | Should -BeTrue
        $first.continuationTransport | Should -Be 'codex-stop-hook'
        Test-Path -LiteralPath $first.stopHookRegistrationPath | Should -BeTrue
        $second.started | Should -BeFalse
        $second.reused | Should -BeTrue
        $second.processId | Should -Be $PID
        Assert-MockCalled Start-Process -Times 1
    }

    It 'does not register a Stop Hook when no-wake mode is explicit' {
        $directory = Join-Path $TestDrive 'launcher-no-wake'
        New-WatchFixtureEvidence -Directory $directory
        Mock Start-Process {
            [pscustomobject]@{ Id = $PID }
        }

        $result = Start-WatchProcess `
            -EvidenceDirectory $directory `
            -ThreadId $script:ThreadId `
            -DisableContinuation

        $result.started | Should -BeTrue
        $result.continuationRegistered | Should -BeFalse
        $result.continuationTransport | Should -Be 'disabled'
        Get-ChildItem -LiteralPath $Script:StopHookRegistryRootOverride -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
    }

    It 'reports an existing terminal watcher without launching another process' {
        $directory = Join-Path $TestDrive 'terminal-reuse'
        New-WatchFixtureEvidence -Directory $directory
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:StateFileName) -Value ([ordered]@{
            watcherId = [guid]::NewGuid().ToString()
            phase = 'terminal'
            processId = 999999
        })
        Write-WatchJsonAtomic -Path (Join-Path $directory $Script:EventFileName) -Value ([ordered]@{
            status = 'completed'
        })
        Mock Start-Process { throw 'must not relaunch' }

        $result = Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId

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
        })
        Mock Start-Process { throw 'must not relaunch' }

        {
            Start-WatchProcess -EvidenceDirectory $directory -ThreadId $script:ThreadId
        } | Should -Throw '*stale watcher state*'
        Assert-MockCalled Start-Process -Times 0
    }
}
