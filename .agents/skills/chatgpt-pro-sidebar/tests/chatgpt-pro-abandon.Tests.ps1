#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    . (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar-watch.ps1')
    $script:OriginalAbandonmentWriter = ${function:Write-AbandonmentFileCreateNew}
    function Invoke-FixtureAbandonment {
        Abandon-CapacitySlot -Id 1 -ExpectedClaimId 'original-claim' -ThreadId 'original-thread' -RoundId 'original-round' -ExpectedClaimFile $script:ExpectedClaimFile -ArchivePath $script:ArchivePath -Reason 'User explicitly abandoned this uncertain original request.' -ExplicitAbandonment
    }
}

Describe 'Explicit abandonment releases only capacity after durable preservation' {
    BeforeEach {
        $script:FixturePath = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $Script:CapacityRootOverride = Join-Path $script:FixturePath 'capacity'
        $Script:AbandonmentIdempotencyRootOverride = Join-Path $script:FixturePath 'idempotency'
        $script:EvidencePath = Join-Path $script:FixturePath 'evidence'
        $script:ArchivePath = Join-Path $script:FixturePath 'archive'
        $script:ExpectedClaimFile = Join-Path $script:FixturePath 'expected.json'
        $null = [IO.Directory]::CreateDirectory($script:EvidencePath)
        [IO.File]::WriteAllText((Join-Path $script:EvidencePath 'original-note.txt'), 'uncertain original evidence')
        $script:Claim = [pscustomobject]@{
            schemaVersion = 1; slotId = 1; claimId = 'original-claim'; codexThreadId = 'original-thread'
            roundId = 'original-round'; evidenceDirectory = $script:EvidencePath; phase = 'run-starting'
            submissionAttempted = $true; ownerPid = 0; ownerProcessStartedAtUtc = ''
        }
        Write-CapacityClaimCreateNew -Path (Get-CapacitySlotPath -Id 1) -Value $script:Claim
        [IO.File]::Copy((Get-CapacitySlotPath -Id 1), $script:ExpectedClaimFile)
        $script:OriginalClaimBytes = [IO.File]::ReadAllBytes($script:ExpectedClaimFile)
    }

    It 'requires an explicit action and reason and leaves the slot intact' {
        { Abandon-CapacitySlot -Id 1 -ExpectedClaimId 'original-claim' -ThreadId 'original-thread' -RoundId 'original-round' -ExpectedClaimFile $script:ExpectedClaimFile -ArchivePath $script:ArchivePath -Reason 'reason' } | Should -Throw '*explicit abandonment*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
    }

    It 'rejects a replaced original claim' {
        $script:Claim.phase = 'changed'
        Write-WatchJsonAtomic -Path (Get-CapacitySlotPath -Id 1) -Value $script:Claim
        { Invoke-FixtureAbandonment } | Should -Throw '*identity changed*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
        Test-Path -LiteralPath $script:ArchivePath | Should -BeFalse
    }

    It 'rejects an active original owner' {
        $script:Claim.ownerPid = $PID
        $script:Claim.ownerProcessStartedAtUtc = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
        Write-WatchJsonAtomic -Path (Get-CapacitySlotPath -Id 1) -Value $script:Claim
        [IO.File]::Copy((Get-CapacitySlotPath -Id 1), $script:ExpectedClaimFile, $true)
        { Invoke-FixtureAbandonment } | Should -Throw '*owner is still running*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
    }

    It 'rejects an active watcher even when the capacity owner is dead' {
        Write-WatchJsonAtomic -Path (Join-Path $script:EvidencePath 'watch-state.json') -Value @{ processId = $PID }
        { Invoke-FixtureAbandonment } | Should -Throw '*Watcher process is still running*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
    }

    It 'directs provably terminal claims to the existing safe-release entry' {
        $script:Claim.phase = 'terminal'
        Write-WatchJsonAtomic -Path (Get-CapacitySlotPath -Id 1) -Value $script:Claim
        [IO.File]::Copy((Get-CapacitySlotPath -Id 1), $script:ExpectedClaimFile, $true)
        { Invoke-FixtureAbandonment } | Should -Throw '*existing safe-release*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
        Test-Path -LiteralPath $script:ArchivePath | Should -BeFalse
    }

    It 'cannot abandon a resumable preparation failure while keeping its old reservation usable' {
        Write-WatchJsonAtomic -Path (Join-Path $script:EvidencePath 'state.json') -Value @{ codexThreadId = 'original-thread'; phase = 'pre-invoke-failed' }
        $reservationPath = Get-AbandonmentIdempotencyPath -Key 'original-round'
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($reservationPath))
        [IO.File]::WriteAllText($reservationPath, 'original reservation remains owned')
        { Invoke-FixtureAbandonment } | Should -Throw '*existing safe-release*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
        Test-Path -LiteralPath $script:ArchivePath | Should -BeFalse
        [IO.File]::ReadAllText($reservationPath) | Should -BeExactly 'original reservation remains owned'
    }

    It 'retains the exact claim and original evidence when receipt persistence fails' {
        Mock Write-AbandonmentFileCreateNew {
            param($Path, $Bytes)
            if ($Path -like '*abandonment-receipt.json') { throw 'injected archive write failure' }
            & $script:OriginalAbandonmentWriter -Path $Path -Bytes $Bytes
        }
        { Invoke-FixtureAbandonment } | Should -Throw '*injected archive write failure*'
        [Convert]::ToBase64String([IO.File]::ReadAllBytes((Get-CapacitySlotPath -Id 1))) | Should -BeExactly ([Convert]::ToBase64String($script:OriginalClaimBytes))
        [IO.File]::ReadAllText((Join-Path $script:EvidencePath 'original-note.txt')) | Should -BeExactly 'uncertain original evidence'
    }

    It 'refuses release if evidence changes while it is being archived' {
        Mock Write-AbandonmentFileCreateNew {
            param($Path, $Bytes)
            & $script:OriginalAbandonmentWriter -Path $Path -Bytes $Bytes
            if ($Path -like '*claim.original.json') {
                [IO.File]::WriteAllText((Join-Path $script:EvidencePath 'original-note.txt'), 'new concurrent evidence')
            }
        }
        { Invoke-FixtureAbandonment } | Should -Throw '*Evidence changed*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
    }

    It 'does not delete a claim replaced after the receipt was persisted' {
        Mock Write-AbandonmentFileCreateNew {
            param($Path, $Bytes)
            & $script:OriginalAbandonmentWriter -Path $Path -Bytes $Bytes
            if ($Path -like '*abandonment-receipt.json') {
                $script:Claim.claimId = 'replacement-owner'
                Write-WatchJsonAtomic -Path (Get-CapacitySlotPath -Id 1) -Value $script:Claim
            }
        }
        { Invoke-FixtureAbandonment } | Should -Throw '*claim or idempotency reservation changed*'
        (Read-WatchJson -Path (Get-CapacitySlotPath -Id 1) -Required).claimId | Should -BeExactly 'replacement-owner'
    }

    It 'does not release capacity when an existing reservation changes during archival' {
        $script:ReservationPath = Get-AbandonmentIdempotencyPath -Key 'original-round'
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($script:ReservationPath))
        Write-WatchJsonAtomic -Path $script:ReservationPath -Value @{ idempotencyKeySha256 = (Get-WatchSha256Text -Text 'original-round'); automaticResendAllowed = $false }
        Mock Write-AbandonmentFileCreateNew {
            param($Path, $Bytes)
            & $script:OriginalAbandonmentWriter -Path $Path -Bytes $Bytes
            if ($Path -like '*claim.original.json') { [IO.File]::AppendAllText($script:ReservationPath, ' ') }
        }
        { Invoke-FixtureAbandonment } | Should -Throw '*Original idempotency reservation changed*'
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeTrue
    }

    It 'preserves an existing reservation, target record and uncertain state while releasing only its slot' {
        $state = @{ codexThreadId = 'original-thread'; idempotencyKey = 'original-round'; phase = 'send-uncertain'; responseDeadlineAtUtc = '2026-01-01T00:00:00Z'; automaticResendAllowed = $false }
        Write-WatchJsonAtomic -Path (Join-Path $script:EvidencePath 'state.json') -Value $state
        $reservationPath = Get-AbandonmentIdempotencyPath -Key 'original-round'
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($reservationPath))
        $reservation = '{"idempotencyKeySha256":"' + (Get-WatchSha256Text -Text 'original-round') + '","automaticResendAllowed":false,"original":true}'
        [IO.File]::WriteAllText($reservationPath, $reservation)
        $target = Join-Path $script:FixturePath 'target-reservation.json'
        [IO.File]::WriteAllText($target, 'original target ownership')
        $before = Get-AbandonmentEvidenceSnapshot -Directory $script:EvidencePath
        $result = Invoke-FixtureAbandonment
        $result.ok | Should -BeTrue
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeFalse
        [IO.File]::ReadAllText($reservationPath) | Should -BeExactly $reservation
        [IO.File]::ReadAllText($target) | Should -BeExactly 'original target ownership'
        Assert-AbandonmentEvidenceUnchanged -Expected $before -Actual (Get-AbandonmentEvidenceSnapshot -Directory $script:EvidencePath)
        Assert-AbandonmentEvidenceUnchanged -Expected $before -Actual (Get-AbandonmentEvidenceSnapshot -Directory (Join-Path $script:ArchivePath 'evidence'))
        $receipt = Read-WatchJson -Path $result.receiptPath -Required
        $receipt.deliveryOutcome | Should -BeExactly 'unproven'
        $receipt.originalPhase | Should -BeExactly 'send-uncertain'
        ([datetimeoffset]$receipt.originalResponseDeadlineAtUtc).UtcDateTime | Should -Be ([datetimeoffset]'2026-01-01T00:00:00Z').UtcDateTime
        $receipt.reservationCreated | Should -BeFalse
        [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $script:ArchivePath 'claim.original.json'))) | Should -BeExactly ([Convert]::ToBase64String($script:OriginalClaimBytes))
    }

    It 'creates a permanent abandoned reservation for missing prompt evidence and the real adapter rejects the old key' {
        $result = Invoke-FixtureAbandonment
        $reservationPath = Get-AbandonmentIdempotencyPath -Key 'original-round'
        $record = Read-WatchJson -Path $reservationPath -Required
        $record.kind | Should -BeExactly 'abandoned-request'
        $record.originalPromptSha256 | Should -BeNullOrEmpty
        $record.PSObject.Properties.Name | Should -Not -Contain 'promptSha256'
        $record.automaticResendAllowed | Should -BeFalse
        $shell = [PowerShell]::Create()
        try {
            $null = $shell.AddScript({
                param($adapter, $root)
                . $adapter
                $Script:IdempotencyRootOverride = $root
                try { Assert-GlobalIdempotencyKeyAvailable -IdempotencyKeyValue 'original-round'; 'unexpected' }
                catch { [string]$_.Exception.Data['Category'] }
                $record = Read-BridgeText -Path (Join-Path $root ((Get-Sha256Text -Text 'original-round') + '.json')) -Encoding $Script:Utf8NoBom | ConvertFrom-Json
                try { Assert-UnsentResumeRequiredProperties -Record $record -Names @('promptSha256'); 'unexpected' }
                catch { [string]$_.Exception.Data['Category'] }
            }.ToString()).AddArgument((Get-WatchAdapterPath)).AddArgument($Script:AbandonmentIdempotencyRootOverride)
            $output = @($shell.Invoke())
            @($shell.Streams.Error).Count | Should -Be 0
            $output[0].ToString() | Should -BeExactly 'GlobalDuplicateSubmissionBlocked'
            $output[1].ToString() | Should -BeExactly 'UnsentResumeProofIncomplete'
        }
        finally { $shell.Dispose() }
        Test-Path -LiteralPath $result.receiptPath | Should -BeTrue
        Test-Path -LiteralPath (Get-CapacitySlotPath -Id 1) | Should -BeFalse
    }
}
