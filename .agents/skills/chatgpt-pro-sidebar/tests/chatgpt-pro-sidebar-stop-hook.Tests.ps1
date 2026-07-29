#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
# Source encoding: UTF-8 with BOM.

BeforeAll {
    $script:HookPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar-stop-hook.py'
    $script:ThreadId = '019fa981-725e-7f02-93a7-bb1e1b7aefd3'

    function Write-TestJson {
        param(
            [Parameter(Mandatory = $true)][string]$Path,
            [Parameter(Mandatory = $true)]$Value
        )

        $directory = [System.IO.Path]::GetDirectoryName($Path)
        $null = [System.IO.Directory]::CreateDirectory($directory)
        $json = $Value | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText(
            $Path,
            $json + [Environment]::NewLine,
            [System.Text.UTF8Encoding]::new($false)
        )
    }

    function New-TestRegistration {
        param(
            [Parameter(Mandatory = $true)][string]$Registry,
            [Parameter(Mandatory = $true)][string]$Evidence,
            [string]$WatcherId = '',
            [switch]$Legacy
        )

        if ([string]::IsNullOrWhiteSpace($WatcherId)) {
            $WatcherId = [guid]::NewGuid().ToString()
        }
        $null = [System.IO.Directory]::CreateDirectory($Evidence)
        Write-TestJson -Path (Join-Path $Evidence 'watch-state.json') -Value ([ordered]@{
            phase = 'running'
        })
        $registrationPath = if ($Legacy) {
            Join-Path $Registry ($script:ThreadId + '.json')
        } else {
            Join-Path (Join-Path $Registry $script:ThreadId) ($WatcherId.ToLowerInvariant() + '.json')
        }
        Write-TestJson -Path $registrationPath -Value ([ordered]@{
            schemaVersion = 1
            transport = 'codex-stop-hook'
            phase = 'registered'
            hookDeadlineUtc = [datetime]::UtcNow.AddSeconds(30).ToString('o')
            codexThreadId = $script:ThreadId
            watcherId = $WatcherId
            evidenceDirectory = $Evidence
        })
    }

    function Invoke-TestStopHook {
        param(
            [Parameter(Mandatory = $true)][string]$Registry,
            [hashtable]$Payload = @{ session_id = $script:ThreadId }
        )

        $payloadJson = $Payload | ConvertTo-Json -Compress
        $output = @(
            $payloadJson |
                & python $script:HookPath `
                    --registry-root $Registry `
                    --max-wait-seconds 2 `
                    --poll-milliseconds 25
        )
        [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = @($output)
        }
    }

    function Invoke-TestStopHookBytes {
        param(
            [Parameter(Mandatory = $true)][string]$Registry,
            [Parameter(Mandatory = $true)][byte[]]$PayloadBytes
        )

        $python = (Get-Command python -ErrorAction Stop).Source
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $python
        $startInfo.Arguments = (
            '"{0}" --registry-root "{1}" --max-wait-seconds 2 --poll-milliseconds 25' -f
                $script:HookPath,
                $Registry
        )
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        $null = $process.Start()
        $process.StandardInput.BaseStream.Write($PayloadBytes, 0, $PayloadBytes.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()

        [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = @(
                $stdout -split '\r?\n' |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            )
            Error = $stderr
        }
    }
}

Describe 'Codex Stop Hook helper' {
    It 'exits quietly when the current task has no watcher registration' {
        $registry = Join-Path $TestDrive 'registry-none'
        $null = [System.IO.Directory]::CreateDirectory($registry)

        $result = Invoke-TestStopHook -Registry $registry

        $result.ExitCode | Should -Be 0
        $result.Output.Count | Should -Be 0
    }

    It 'replays one same-task continuation until Codex acknowledges it' {
        $registry = Join-Path $TestDrive 'registry-terminal'
        $evidence = Join-Path $TestDrive 'evidence-terminal'
        New-TestRegistration -Registry $registry -Evidence $evidence
        Write-TestJson -Path (Join-Path $evidence 'watch-event.json') -Value ([ordered]@{
            status = 'completed'
            requiresCodexReview = $true
            automaticResendAllowed = $false
        })

        $first = Invoke-TestStopHook -Registry $registry
        $second = Invoke-TestStopHook -Registry $registry
        $decision = $first.Output[0] | ConvertFrom-Json
        $replayDecision = $second.Output[0] | ConvertFrom-Json
        $callback = Get-Content -LiteralPath (Join-Path $evidence 'watch-callback.json') -Raw | ConvertFrom-Json

        $first.ExitCode | Should -Be 0
        $first.Output.Count | Should -Be 1
        $decision.decision | Should -Be 'block'
        $decision.reason | Should -Match ([regex]::Escape((Join-Path $evidence 'watch-event.json')))
        $callback.transport | Should -Be 'codex-stop-hook'
        $callback.continuationRequested | Should -BeTrue
        $callback.codexThreadId | Should -Be $script:ThreadId
        Test-Path -LiteralPath (Join-Path $evidence 'watch-stop-hook.claim') | Should -BeTrue
        $second.Output.Count | Should -Be 1
        $replayDecision.reason | Should -Match ([regex]::Escape((Join-Path $evidence 'watch-event.json')))

        $registration = Get-Content -LiteralPath (
            Get-ChildItem -LiteralPath (Join-Path $registry $script:ThreadId) -Filter '*.json'
        ).FullName -Raw | ConvertFrom-Json
        Write-TestJson -Path (Join-Path $evidence 'watch-continuation-ack.json') -Value ([ordered]@{
            schemaVersion = 1
            acknowledged = $true
            codexThreadId = $script:ThreadId
            watcherId = $registration.watcherId
        })
        $third = Invoke-TestStopHook -Registry $registry
        $third.Output.Count | Should -Be 0
    }

    It 'fans in all terminal registrations and preserves pending work' {
        $registry = Join-Path $TestDrive 'registry-fan-in'
        $firstEvidence = Join-Path $TestDrive 'evidence-fan-in-first'
        $secondEvidence = Join-Path $TestDrive 'evidence-fan-in-second'
        $pendingEvidence = Join-Path $TestDrive 'evidence-fan-in-pending'
        New-TestRegistration -Registry $registry -Evidence $firstEvidence
        New-TestRegistration -Registry $registry -Evidence $secondEvidence
        New-TestRegistration -Registry $registry -Evidence $pendingEvidence
        Write-TestJson -Path (Join-Path $firstEvidence 'watch-event.json') -Value ([ordered]@{
            status = 'completed'
        })
        Write-TestJson -Path (Join-Path $secondEvidence 'watch-event.json') -Value ([ordered]@{
            status = 'probe-failed'
        })

        $result = Invoke-TestStopHook -Registry $registry
        $decision = $result.Output[0] | ConvertFrom-Json

        $result.ExitCode | Should -Be 0
        $result.Output.Count | Should -Be 1
        $decision.decision | Should -Be 'block'
        $decision.reason | Should -Match '2 ChatGPT Pro watcher registration'
        $decision.reason | Should -Match ([regex]::Escape($firstEvidence))
        $decision.reason | Should -Match ([regex]::Escape($secondEvidence))
        Test-Path -LiteralPath (Join-Path $firstEvidence 'watch-stop-hook.claim') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $secondEvidence 'watch-stop-hook.claim') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $pendingEvidence 'watch-stop-hook.claim') | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $pendingEvidence 'watch-callback.json') | Should -BeFalse
    }

    It 'reads one legacy v1 registration during migration' {
        $registry = Join-Path $TestDrive 'registry-legacy'
        $evidence = Join-Path $TestDrive 'evidence-legacy'
        New-TestRegistration -Registry $registry -Evidence $evidence -Legacy
        Write-TestJson -Path (Join-Path $evidence 'watch-event.json') -Value ([ordered]@{
            status = 'completed'
        })

        $result = Invoke-TestStopHook -Registry $registry
        $decision = $result.Output[0] | ConvertFrom-Json

        $result.ExitCode | Should -Be 0
        $decision.decision | Should -Be 'block'
        Test-Path -LiteralPath (Join-Path $evidence 'watch-stop-hook.claim') | Should -BeTrue
    }

    It 'accepts UTF-8 BOM hook input from Codex Desktop' {
        $registry = Join-Path $TestDrive 'registry-utf8-bom'
        $evidence = Join-Path $TestDrive 'evidence-utf8-bom'
        New-TestRegistration -Registry $registry -Evidence $evidence
        Write-TestJson -Path (Join-Path $evidence 'watch-event.json') -Value ([ordered]@{
            status = 'completed'
        })
        $payloadJson = @{ session_id = $script:ThreadId } | ConvertTo-Json -Compress
        $encoding = [System.Text.UTF8Encoding]::new($true)
        $payloadBytes = $encoding.GetPreamble() + $encoding.GetBytes($payloadJson)

        $result = Invoke-TestStopHookBytes -Registry $registry -PayloadBytes $payloadBytes
        $decision = $result.Output[0] | ConvertFrom-Json

        $result.ExitCode | Should -Be 0
        $result.Error | Should -BeNullOrEmpty
        $decision.decision | Should -Be 'block'
        Test-Path -LiteralPath (Join-Path $evidence 'watch-callback.json') | Should -BeTrue
    }

    It 'accepts UTF-16 LE hook input from Codex Desktop' {
        $registry = Join-Path $TestDrive 'registry-utf16'
        $evidence = Join-Path $TestDrive 'evidence-utf16'
        New-TestRegistration -Registry $registry -Evidence $evidence
        Write-TestJson -Path (Join-Path $evidence 'watch-event.json') -Value ([ordered]@{
            status = 'completed'
        })
        $payloadJson = @{ session_id = $script:ThreadId } | ConvertTo-Json -Compress
        $encoding = [System.Text.UnicodeEncoding]::new($false, $true)
        $payloadBytes = $encoding.GetPreamble() + $encoding.GetBytes($payloadJson)

        $result = Invoke-TestStopHookBytes -Registry $registry -PayloadBytes $payloadBytes
        $decision = $result.Output[0] | ConvertFrom-Json

        $result.ExitCode | Should -Be 0
        $result.Error | Should -BeNullOrEmpty
        $decision.decision | Should -Be 'block'
        Test-Path -LiteralPath (Join-Path $evidence 'watch-callback.json') | Should -BeTrue
    }

    It 'ignores the continuation turn marked stop_hook_active' {
        $registry = Join-Path $TestDrive 'registry-active'
        $evidence = Join-Path $TestDrive 'evidence-active'
        New-TestRegistration -Registry $registry -Evidence $evidence
        Write-TestJson -Path (Join-Path $evidence 'watch-event.json') -Value ([ordered]@{
            status = 'completed'
        })

        $result = Invoke-TestStopHook -Registry $registry -Payload @{
            session_id = $script:ThreadId
            stop_hook_active = $true
        }

        $result.ExitCode | Should -Be 0
        $result.Output.Count | Should -Be 0
        Test-Path -LiteralPath (Join-Path $evidence 'watch-stop-hook.claim') | Should -BeFalse
    }

    It 'continues review when the watcher launch failed without an event' {
        $registry = Join-Path $TestDrive 'registry-launch-failed'
        $evidence = Join-Path $TestDrive 'evidence-launch-failed'
        New-TestRegistration -Registry $registry -Evidence $evidence
        Write-TestJson -Path (Join-Path $evidence 'watch-state.json') -Value ([ordered]@{
            phase = 'launch-failed'
        })

        $result = Invoke-TestStopHook -Registry $registry
        $decision = $result.Output[0] | ConvertFrom-Json

        $result.ExitCode | Should -Be 0
        $decision.decision | Should -Be 'block'
        $decision.reason | Should -Match 'worker-crashed'
    }
}
