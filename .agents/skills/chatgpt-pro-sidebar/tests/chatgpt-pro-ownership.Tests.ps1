#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $skill = Split-Path -Parent $PSScriptRoot
    . (Join-Path $skill 'scripts/chatgpt-pro-sidebar.ps1')
    . (Join-Path $skill 'scripts/chatgpt-pro-sidebar-watch.ps1')

    function New-OwnershipPage {
        $clicked = $script:ownershipClicks -gt 0
        $filled = $script:ownershipFilled -and -not $clicked
        $page = [pscustomobject]@{
            schemaVersion = 1; origin = 'https://chatgpt.com'
            url = $(if ($clicked) { $script:ownershipUrl } else { 'https://chatgpt.com/' })
            composer = [pscustomobject]@{ count = 1; selector = '#prompt-textarea'; selectorMatchCount = 1; value = $(if ($filled) { $script:ownershipPrompt } else { '' }) }
            send = [pscustomobject]@{
                count = $(if ($filled) { 1 } else { 0 })
                selector = $(if ($filled) { 'form:has(#prompt-textarea) > button[data-testid="send-button"]:nth-child(1):not(:disabled, [aria-disabled="true"], [hidden], [aria-hidden="true"])' } else { '' })
                selectorMatchCount = $(if ($filled) { 1 } else { 0 })
                formScope = $(if ($filled) { 'form:has(#prompt-textarea)' } else { '' })
            }
            auth = [pscustomobject]@{ loginCount = 0; challengeCount = 0; proIndicatorCount = 1 }
            model = [pscustomobject]@{ controlCount = $script:ownershipControlCount; selectedLabel = $(if($script:ownershipControlCount -eq 1){$script:ownershipMode}else{''}); proSelected = ($script:ownershipControlCount -eq 1 -and $script:ownershipMode -ceq 'Pro') }
            generating = $(if ($clicked) { $script:ownershipGenerating } else { $false })
            turnExtractionIssue = $(if ($clicked) { $script:ownershipIssue } else { '' })
            userTurns = @(); assistantTurns = @(); turnLimitExceeded = $false
        }
        if ($clicked) {
            $page.userTurns = @([pscustomobject]@{ ordinal = 0; key = 'user-0'; content = $script:ownershipPrompt; truncated = $false })
            $page.assistantTurns = @([pscustomobject]@{ ordinal = 0; key = 'assistant-0'; content = 'fixture answer'; truncated = $false })
        }
        return $page
    }
}

Describe 'Temporary assistant ownership across the actual snapshot/send/wait chain' {
    BeforeEach {
        $script:ownershipThread = '019fd9c5-9497-7301-a315-6e17d0704869'
        $script:ownershipUrl = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'
        $script:ownershipPrompt = 'bounded ownership regression'
        $Script:ThinkingModeManualRootOverride = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:ownershipControlCount = 1
        $script:ownershipMode = 'Pro'
        $Script:RequestedThinkingMode = 'Pro'
        $Script:ThinkingModeExplicit = $false
        $script:ownershipClicks = 0
        $script:ownershipFilled = $false
        $script:ownershipGenerating = $true
        $script:ownershipIssue = 'AssistantOwnerMissing'
        $script:ownershipTarget = [pscustomobject]@{
            BrowserId = 'ownership-offline-browser'; ProfileId = 'profile-1'; ProfileLabel = 'test'
            TabId = '101'; SessionKey = 'ownership-offline-browser:profile-1:101'; Origin = 'https://chatgpt.com'
            Url = 'https://chatgpt.com/'; UrlExact = $false
        }
        $script:IdempotencyRootOverride = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:TargetClaimRootOverride = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:CapacityRootOverride = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        Mock Resolve-AgentBrowserTarget { $script:ownershipTarget }
        Mock Start-Sleep {}
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            switch ($Arguments[0]) {
                'fill' { $script:ownershipFilled = $true }
                'click' { $script:ownershipClicks++ }
                'exec' { }
                default { throw ('Unexpected browser operation in offline test: ' + $Arguments[0]) }
            }
            [pscustomobject]@{ ok = $true; result = [pscustomobject]@{
                status = 'success'; tab_id = '101'; session_key = 'ownership-offline-browser:profile-1:101'
                js_return = $(if ($Arguments[0] -eq 'exec') { New-OwnershipPage } else { $null })
            } }
        }
    }

    AfterEach {
        $script:IdempotencyRootOverride = $null
        $script:TargetClaimRootOverride = $null
        $script:CapacityRootOverride = $null
    }

    It 'keeps generating status observable and suppresses unowned response bodies' {
        $script:ownershipClicks = 1
        $snapshot = Get-AgentBrowserPageSnapshot -Target $script:ownershipTarget
        $status = New-AgentBrowserStatusPayload -Target $script:ownershipTarget -Snapshot $snapshot
        $status.ok | Should -BeTrue
        $status.generating | Should -BeTrue
        $status.ready | Should -BeFalse
        $status.responseOwnershipPending | Should -BeTrue
        $status.responseCount | Should -Be 0
        $status.userTurnSha256 | Should -Be @((Get-Sha256Text -Text $script:ownershipPrompt))
        $status.url | Should -Be $script:ownershipUrl
    }

    It 'rejects missing owners once stopped or when generating is not the boolean true' -TestCases @(
        @{ GeneratingValue = $false }, @{ GeneratingValue = 'true' }, @{ GeneratingValue = 1 }, @{ GeneratingValue = $null }
    ) {
        param($GeneratingValue)
        $script:ownershipClicks = 1
        $script:ownershipGenerating = $GeneratingValue
        { Get-AgentBrowserPageSnapshot -Target $script:ownershipTarget } | Should -Throw '*isolated message ownership*'
    }

    It 'rejects genuine ownership conflicts even during generation' -TestCases @(
        @{ Issue = 'MessageRoleConflict' }, @{ Issue = 'AssistantContextAmbiguous' },
        @{ Issue = 'AssistantBodyAmbiguous' }, @{ Issue = 'AssistantMessageIdAmbiguous' }, @{ Issue = 'AssistantOwnerInvalid' }
    ) {
        param($Issue)
        $script:ownershipClicks = 1
        $script:ownershipIssue = $Issue
        { Get-AgentBrowserPageSnapshot -Target $script:ownershipTarget } | Should -Throw '*isolated message ownership*'
    }

    It 'binds the first post-click URL, acknowledges once and refuses another send' -TestCases @(@{Mode='Pro'},@{Mode='Extra High'}) {
        param($Mode)
        $script:ownershipMode = $Mode
        $Script:RequestedThinkingMode = $Mode
        $Script:ThinkingModeExplicit = $true
        $directory = Join-Path $TestDrive ('first-click-'+$Mode.Replace(' ',''))
        $null = New-Item -ItemType Directory -Path $directory
        $binding = ConvertTo-AgentBrowserTargetBinding -Target $script:ownershipTarget
        $result = Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $directory -IdempotencyKeyValue 'first-click' -CodexThreadIdValue $script:ownershipThread -RequireFreshConversation -TargetBinding $binding -ObservationSecondsValue 0
        $state = Read-EvidenceState -Directory $directory
        $state.phase | Should -Be 'sent'
        $state.conversationUrlBound | Should -Be $script:ownershipUrl
        $state.submissionAcknowledged | Should -BeTrue
        $state.attemptCount | Should -Be 1
        $state.automaticResendAllowed | Should -BeFalse
        $result.conversationUrl | Should -Be $script:ownershipUrl
        $script:ownershipClicks | Should -Be 1
        { Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $directory -IdempotencyKeyValue 'first-click' -CodexThreadIdValue $script:ownershipThread -TargetBinding $binding } | Should -Throw
        $script:ownershipClicks | Should -Be 1
        Test-Path -LiteralPath (Join-Path $directory 'response.md') | Should -BeFalse
    }

    It 'starts exactly one root watcher after the real post-click pending snapshot' {
        $directory = Join-Path $TestDrive 'root-round'
        $null = New-Item -ItemType Directory -Path $directory
        $prompt = Join-Path $TestDrive 'root-prompt.md'
        [IO.File]::WriteAllText($prompt, $script:ownershipPrompt)
        $claim = Acquire-CapacitySlot -ThreadId $script:ownershipThread -RoundId 'ownership-root' -EvidenceDirectory $directory
        $null = Set-CapacitySlotClaim -Id $claim.slotId -ClaimId $claim.claimId -Changes @{ phase = 'run-starting'; submissionAttempted = $false }
        Mock Get-WatchAdapterPath { 'offline-adapter.ps1' }
        Mock Invoke-WatchAdapterSend {
            param($EvidenceDirectory, $IdempotencyKeyValue, $CodexThreadIdValue)
            $payload = Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $EvidenceDirectory -IdempotencyKeyValue $IdempotencyKeyValue -CodexThreadIdValue $CodexThreadIdValue -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:ownershipTarget) -ObservationSecondsValue 0
            [pscustomobject]@{ ExitCode = 0; Payload = $payload }
        }
        Mock Start-WatchProcess {
            param($EvidenceDirectory)
            (Read-EvidenceState -Directory $EvidenceDirectory).conversationUrlBound | Should -Be $script:ownershipUrl
            [pscustomobject]@{ started = $true; reused = $false }
        }
        Mock Wait-RootWatchEvent { [pscustomobject]@{ terminalStatus = 'completed'; watcherId = 'offline-watcher'; codexThreadId = $script:ownershipThread; eventFile = 'watch-event.json' } }
        $result = Invoke-RootWaitRound -EvidenceDirectory $directory -ThreadId $script:ownershipThread -PromptFile $prompt -IdempotencyKeyValue 'ownership-root' -RequireFreshConversation -CapacitySlotId $claim.slotId -CapacityClaimId $claim.claimId
        $result.terminalStatus | Should -Be 'completed'
        $script:ownershipClicks | Should -Be 1
        Should -Invoke Start-WatchProcess -Times 1 -Exactly
        Should -Invoke Wait-RootWatchEvent -Times 1 -Exactly
    }

    It 'recovers a bound uncertain send observationally without another click or deadline reset' -TestCases @(@{Mode='Pro'},@{Mode='Extra High'}) {
        param($Mode)
        $script:ownershipMode = $Mode
        $Script:RequestedThinkingMode = $Mode
        $Script:ThinkingModeExplicit = $true
        $directory = Join-Path $TestDrive ('recover-once-'+$Mode.Replace(' ',''))
        $null = New-Item -ItemType Directory -Path $directory
        $null = Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $directory -IdempotencyKeyValue 'recover-once' -CodexThreadIdValue $script:ownershipThread -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:ownershipTarget) -ObservationSecondsValue 0
        $state = Read-EvidenceState -Directory $directory
        $deadline = $state.responseDeadlineAtUtc
        Set-ObjectProperty -InputObject $state -Name 'phase' -Value 'send-uncertain'
        Set-ObjectProperty -InputObject $state -Name 'submissionAcknowledged' -Value $false
        Write-EvidenceState -Directory $directory -State $state
        $observation = Get-AgentBrowserWaitObservation -Binding $state.targetBinding -ExpectedConversationUrl $script:ownershipUrl
        $observation.Generating | Should -BeTrue
        @($observation.Responses).Count | Should -Be 0
        $script:ownershipGenerating = $false
        $script:ownershipIssue = ''
        $script:ownershipMode = 'Medium' # Post-send UI drift must not trigger selection or another send.
        $result = Invoke-AgentBrowserWait -EvidenceDirectory $directory -TimeoutSecondsValue 3 -PollMillisecondsValue 1 -CodexThreadIdValue $script:ownershipThread
        $result.completed | Should -BeTrue
        $final = Read-EvidenceState -Directory $directory
        $final.phase | Should -Be 'completed'
        $final.responseDeadlineAtUtc | Should -Be $deadline
        $final.attemptCount | Should -Be 1
        $final.thinkingMode | Should -Be $Mode
        (Get-CompletedResponseResult -EvidenceDirectory $directory -CodexThreadIdValue $script:ownershipThread).thinkingMode | Should -Be $Mode
        $script:ownershipClicks | Should -Be 1
    }

    It 'waits for manual selection before fill and resumes the same original request exactly once' {
        $directory=Join-Path $TestDrive 'manual-before-fill';$null=New-Item -ItemType Directory -Path $directory
        $script:ownershipControlCount=0
        $binding=ConvertTo-AgentBrowserTargetBinding $script:ownershipTarget
        {Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $directory -IdempotencyKeyValue 'manual-before-fill' -CodexThreadIdValue $script:ownershipThread -RequireFreshConversation -TargetBinding $binding -ObservationSecondsValue 0}|Should -Throw '*manually*'
        $before=Read-EvidenceState $directory
        $before.preInvokeFailureCategory|Should -Be 'ThinkingModeManualSelectionRequired'
        $before.attemptCount|Should -Be 0;$script:ownershipClicks|Should -Be 0;$script:ownershipFilled|Should -BeFalse
        $script:ownershipControlCount=1
        $null=Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $directory -IdempotencyKeyValue 'manual-before-fill' -CodexThreadIdValue $script:ownershipThread -RequireFreshConversation -TargetBinding $binding -ObservationSecondsValue 0 -ResumeUnsent
        $after=Read-EvidenceState $directory
        $after.promptSha256|Should -Be $before.promptSha256;$after.idempotencyKey|Should -Be $before.idempotencyKey
        $after.attemptCount|Should -Be 1;$script:ownershipClicks|Should -Be 1
    }

    It 'does not finalize an unowned stopped response' {
        $directory = Join-Path $TestDrive 'stopped-unowned'
        $null = New-Item -ItemType Directory -Path $directory
        $null = Invoke-AgentBrowserSend -PromptText $script:ownershipPrompt -EvidenceDirectory $directory -IdempotencyKeyValue 'stopped-unowned' -CodexThreadIdValue $script:ownershipThread -RequireFreshConversation -TargetBinding (ConvertTo-AgentBrowserTargetBinding -Target $script:ownershipTarget) -ObservationSecondsValue 0
        $script:ownershipGenerating = $false
        { Invoke-AgentBrowserWait -EvidenceDirectory $directory -TimeoutSecondsValue 3 -PollMillisecondsValue 1 -CodexThreadIdValue $script:ownershipThread } | Should -Throw '*isolated message ownership*'
        Test-Path -LiteralPath (Join-Path $directory 'response.md') | Should -BeFalse
        $script:ownershipClicks | Should -Be 1
    }
}
