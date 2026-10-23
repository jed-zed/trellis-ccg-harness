#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    . (Join-Path $PSScriptRoot '../scripts/chatgpt-pro-sidebar.ps1')
    function New-CompletedClaimRegressionRound {
        param($Directory,$Binding,[string]$Key,[string]$PromptText,[string]$Reply)
        Write-Utf8NoBomAtomic -Path (Join-Path $Directory 'prompt.md') -Text $PromptText
        $state=New-SendIntentState -PromptSha256 (Get-Sha256Text -Text $PromptText) -IdempotencyKeyValue $Key -IdempotencyKeySha256 (Get-Sha256Text -Text $Key) -BaselineHashes @() -ConversationUrlBeforeSend $Binding.url -Transport $Script:AgentBrowserTransport -TargetBinding $Binding -CodexThreadIdValue $script:thread -TargetClaimKeySha256 (Get-AgentBrowserTargetClaimDescriptor -Binding $Binding).KeySha256
        $state.phase='sent'
        $state['baselineUserTurnSha256']=@()
        $state['submissionAcknowledged']=$true
        $response=[pscustomobject]@{Content=$Reply;ContentSha256=(Get-Sha256Text -Text $Reply)}
        $null=Complete-Evidence -EvidenceDirectory $Directory -State $state -Response $response -ConversationUrl $Binding.url -TransientObservationCount 0 -CodexThreadIdValue $script:thread
    }
    function Set-RegressionClaim {
        Write-JsonAtomic -Path $script:claimPath -Value $script:claim
    }
    function Assert-ReextractConflict {
        try { Invoke-AgentBrowserReextract -EvidenceDirectory $script:original -ThreadId $script:thread; throw 'Expected rejection.' }
        catch { (Get-ExceptionCategory -Exception $_.Exception) | Should -BeExactly 'AgentBrowserTargetClaimConflict' }
        Should -Invoke Get-AgentBrowserWaitObservation -Times 0 -Exactly
    }
}
Describe 'Historical completed-round reextraction ownership' {
    BeforeEach {
        $script:thread='12345678-1234-1234-1234-123456789abc'
        $script:original=Join-Path $TestDrive 'original'
        $script:successor=Join-Path $TestDrive 'successor'
        $script:TargetClaimRootOverride=Join-Path $TestDrive 'claims'
        foreach($path in @($script:original,$script:successor,$script:TargetClaimRootOverride)) {[IO.Directory]::CreateDirectory($path) | Out-Null}
        $binding=[ordered]@{browserId='browser-test';profileId='profile-test';tabId='123';sessionKey='browser-test:profile-test:123';origin='https://chatgpt.com';url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'}
        New-CompletedClaimRegressionRound -Directory $script:original -Binding $binding -Key 'original-round' -PromptText 'original prompt' -Reply "original reply`ncomplete code"
        New-CompletedClaimRegressionRound -Directory $script:successor -Binding $binding -Key 'successor-round' -PromptText 'later prompt' -Reply 'later reply'
        $script:sourceState=Read-EvidenceState -Directory $script:original
        $script:ownerState=Read-EvidenceState -Directory $script:successor
        $script:key=$script:sourceState.targetClaimKeySha256
        $script:claimPath=Join-Path $script:TargetClaimRootOverride ($script:key+'.json')
        $script:claim=[ordered]@{schemaVersion=1;tool='chatgpt-pro-sidebar';targetClaimKeySha256=$script:key;scope='conversation';codexThreadId=$script:thread;evidenceDirectory=$script:successor;idempotencyKeySha256=$script:ownerState.idempotencyKeySha256;targetBinding=$script:ownerState.targetBinding;automaticResendAllowed=$false}
        Set-RegressionClaim
        Mock Invoke-AgentBrowserCliJson {throw 'Offline reextraction must not invoke a browser.'}
        Mock Get-AgentBrowserWaitObservation {
            [pscustomobject]@{Transient=$false;Target=$script:sourceState.targetBinding;Snapshot=[pscustomobject]@{
                Url=$script:sourceState.conversationUrlBound;Generating=$false
                UserTurns=@([pscustomobject]@{ContentSha256=$script:sourceState.promptSha256},[pscustomobject]@{ContentSha256=$script:ownerState.promptSha256})
                Responses=@([pscustomobject]@{Content=[IO.File]::ReadAllText((Join-Path $script:original 'response.md'));ContentSha256=$script:sourceState.responseSha256;Truncated=$false},[pscustomobject]@{Content='later reply';ContentSha256=$script:ownerState.responseSha256;Truncated=$false})
            }}
        }
    }
    It 'reextracts the original completed reply after a same-thread successor completes without changing originals or claim' {
        $before=@{}
        foreach($file in Get-ChildItem -LiteralPath $script:original -File) {$before[$file.Name]=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))}
        $claimBefore=[IO.File]::ReadAllText($script:claimPath)
        $result=Invoke-AgentBrowserReextract -EvidenceDirectory $script:original -ThreadId $script:thread
        $receipt=[IO.File]::ReadAllText($result.receiptFile) | ConvertFrom-Json
        $receipt.responseIndex | Should -Be 0
        $receipt.newWebRequests | Should -Be 0
        [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $result.receiptFile) 'response.md')) | Should -BeExactly ([IO.File]::ReadAllText((Join-Path $script:original 'response.md')))
        foreach($file in Get-ChildItem -LiteralPath $script:original -File) {[Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)) | Should -BeExactly $before[$file.Name]}
        [IO.File]::ReadAllText($script:claimPath) | Should -BeExactly $claimBefore
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
    It 'keeps ordinary completed-response ownership exact' {
        {Get-CompletedResponseResult -EvidenceDirectory $script:original -CodexThreadIdValue $script:thread} | Should -Throw '*another task or round*'
    }
    It 'rejects a successor that is still <Phase>' -ForEach @(@{Phase='sent'},@{Phase='send-uncertain'},@{Phase='send-intent'},@{Phase='pre-invoke-failed'}) {
        $script:ownerState.phase=$Phase
        Write-EvidenceState -Directory $script:successor -State $script:ownerState
        Assert-ReextractConflict
    }
    It 'rejects another task claim' {
        $script:claim.codexThreadId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        Set-RegressionClaim
        Assert-ReextractConflict
    }
    It 'rejects successor binding drift in <Field>' -ForEach @(@{Field='profileId';Value='different-profile'},@{Field='url';Value='https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}) {
        $script:ownerState.targetBinding.$Field=$Value
        Write-EvidenceState -Directory $script:successor -State $script:ownerState
        Assert-ReextractConflict
    }
    It 'rejects successor idempotency drift' {
        $script:ownerState.idempotencyKeySha256='a'*64
        Write-EvidenceState -Directory $script:successor -State $script:ownerState
        Assert-ReextractConflict
    }
    It 'holds the stable claim lock before ownership validation and through observation then releases it' {
        Mock Get-AgentBrowserWaitObservation {
            {Reserve-AgentBrowserTargetClaim -CodexThreadIdValue $script:thread -EvidenceDirectory (Join-Path $TestDrive 'competing') -IdempotencyKeySha256Value ('b'*64) -Binding $script:sourceState.targetBinding} | Should -Throw '*updating or observing*'
            throw 'Synthetic observation stop.'
        }
        {Invoke-AgentBrowserReextract -EvidenceDirectory $script:original -ThreadId $script:thread} | Should -Throw '*Synthetic observation stop*'
        $lock=Enter-AgentBrowserTargetClaimLock -Path $script:claimPath -KeySha256 $script:key
        $lock.Dispose()
    }
    It 'rejects an already busy stable claim before observing and leaves the owner intact' {
        $lock=Enter-AgentBrowserTargetClaimLock -Path $script:claimPath -KeySha256 $script:key
        try {
            {Invoke-AgentBrowserReextract -EvidenceDirectory $script:original -ThreadId $script:thread} | Should -Throw '*updating or observing*'
            Should -Invoke Get-AgentBrowserWaitObservation -Times 0 -Exactly
        } finally {$lock.Dispose()}
    }
}
