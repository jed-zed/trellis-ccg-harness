BeforeAll {
    . (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar.ps1')
    . (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-sidebar-watch.ps1')
    function New-ModeSnapshot([string]$Label='Pro',[int]$Count=1) {
        [pscustomobject]@{SelectedModeLabel=$Label;SelectedModeControlCount=$Count;SelectedModeIsPro=($Label -ceq 'Pro');ComposerCount=1;LoginCount=0;SecurityChallengeCount=0;Generating=$false}
    }
    function New-ModeAction([int]$Index=5) { [pscustomobject]@{ok=$true;phase='slider';index=$Index;count=5;currentLabel=@('Instant','Medium','High','Extra High','Pro')[$Index-1];selectedModelLabels=@('GPT-6')} }
    $script:modeTarget=[pscustomobject]@{BrowserId='b';ProfileId='p';TabId='1';SessionKey='b:p:1';ProfileLabel='test';Origin='https://chatgpt.com';Url='https://chatgpt.com/';UrlExact=$false}
}
Describe 'Independent webpage strength contract' {
BeforeEach {
    $Script:ThinkingModeManualRootOverride=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    $Script:RequestedThinkingMode='Pro';$Script:ThinkingModeExplicit=$false;$Script:LastSelectedThinkingMode=''
    Mock Start-Sleep {}
    Mock Close-AgentBrowserThinkingMenu {}
}

    It 'defaults to Pro and keeps all five real labels' {
        (ConvertTo-CanonicalThinkingMode '') | Should -Be 'Pro'
        foreach($label in @('Instant','Medium','High','Extra High','Pro')){ (ConvertTo-CanonicalThinkingMode $label.ToLowerInvariant()) | Should -Be $label }
    }
    It 'maps localized aliases but does not pretend Codex xhigh is a webpage strength' {
        (ConvertTo-CanonicalThinkingMode ([string][char]0x6781+[char]0x9ad8)) | Should -Be 'Extra High'
        (ConvertTo-CanonicalThinkingMode 'extra-high') | Should -Be 'Extra High'
        (ConvertTo-CanonicalThinkingMode 'xhigh') | Should -Be 'xhigh'
    }
    It 'does not mutate an already selected requested mode' {
        $Script:RequestedThinkingMode='Extra High'
        Mock Get-AgentBrowserThinkingAction {throw 'selection must not run'}
        (Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot 'Extra High')).SelectedModeLabel | Should -Be 'Extra High'
        Should -Invoke Get-AgentBrowserThinkingAction -Times 0 -Exactly
    }
    It 'rejects missing or ambiguous controls' {
        {Assert-AgentBrowserSelectedPro (New-ModeSnapshot 'High' 0)} | Should -Throw '*control*'
        {Assert-AgentBrowserSelectedPro (New-ModeSnapshot 'High' 2)} | Should -Throw '*control*'
    }
    It 'rejects post-fill drift for an explicit non-Pro choice before send' {
        $Script:RequestedThinkingMode='Extra High'
        {Assert-AgentBrowserPostFillReady (New-ModeSnapshot 'Pro')} | Should -Throw '*requested*'
    }
    It 'requires a unique live strength match and never fills or clicks send for unknown modes' {
        $Script:RequestedThinkingMode='xhigh'
        Mock Get-AgentBrowserThinkingAction {New-ModeAction}
        Mock Get-AgentBrowserThinkingInventory {[pscustomobject]@{options=@([pscustomobject]@{index=5;label='Pro';canonical='Pro'})}}
        Mock Invoke-AgentBrowserBoundMouseClick {}
        Mock Invoke-AgentBrowserCliJson {throw 'fill/send must not run'}
        {Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot)} | Should -Throw '*unavailable*'
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
    It 'rejects duplicate aliases in the live menu' {
        $Script:RequestedThinkingMode='Extra High'
        Mock Get-AgentBrowserThinkingAction {New-ModeAction}
        Mock Get-AgentBrowserThinkingInventory {[pscustomobject]@{options=@([pscustomobject]@{index=3;label='Extra High';canonical='Extra High'},[pscustomobject]@{index=4;label='extra-high';canonical='Extra High'})}}
        Mock Invoke-AgentBrowserBoundMouseClick {}
        {Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot)} | Should -Throw '*ambiguous*'
    }
    It 're-reads the selected mode after switching and leaves the underlying model unchanged' {
        $Script:RequestedThinkingMode='Extra High'
        Mock Get-AgentBrowserThinkingAction {New-ModeAction}
        Mock Get-AgentBrowserThinkingInventory {[pscustomobject]@{options=@([pscustomobject]@{index=4;label='Extra High';canonical='Extra High'})}}
        Mock Invoke-ThinkingSliderStep {New-ModeAction 4}
        Mock Invoke-AgentBrowserBoundMouseClick {}
        Mock Get-AgentBrowserPageSnapshot {New-ModeSnapshot 'Extra High'}
        (Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot)).SelectedModeLabel | Should -Be 'Extra High'
        $Script:LastSelectedThinkingMode | Should -Be 'Extra High'
        Should -Invoke Get-AgentBrowserPageSnapshot -Times 1 -Exactly
    }
    It 'rejects an unchanged slider after a requested step' {
        Mock Get-AgentBrowserThinkingAction {New-ModeAction}
        {Invoke-ThinkingSliderStep $script:modeTarget (New-ModeAction) -1} | Should -Throw '*not independently confirmed*'
    }
    It 'rejects any simultaneous model change' {
        Mock Get-AgentBrowserThinkingAction {$a=New-ModeAction 4;$a.selectedModelLabels=@('different-model');$a}
        {Invoke-ThinkingSliderStep $script:modeTarget (New-ModeAction) -1} | Should -Throw '*unchanged model*'
    }
    It 'inherits the original mode on recovery without selecting a page' {
        (Restore-ThinkingModeFromState @{thinkingMode='Extra High'}) | Should -Be 'Extra High'
        $Script:RequestedThinkingMode | Should -Be 'Extra High'
    }
    It 'rejects an explicit recovery mismatch and defaults historical records to Pro' {
        $Script:ThinkingModeExplicit=$true
        {Restore-ThinkingModeFromState @{thinkingMode='High'}} | Should -Throw '*original request*'
        $Script:ThinkingModeExplicit=$false
        (Restore-ThinkingModeFromState @{}) | Should -Be 'Pro'
    }
    It 'keeps actual Pro indicators distinct from acceptance of other strengths' {
        $Script:RequestedThinkingMode='High'
        (Test-AgentBrowserThinkingMode (New-ModeSnapshot 'High')) | Should -BeTrue
        (New-ModeSnapshot 'High').SelectedModeIsPro | Should -BeFalse
        (Test-AgentBrowserThinkingMode (New-ModeSnapshot 'Pro')) | Should -BeFalse
    }
}

Describe 'UTF-8 subprocess and watcher propagation' {
    BeforeEach { $Script:RequestedThinkingMode='Extra High';$Script:ThinkingModeExplicit=$false }
    It 'decodes multilingual native JSON without inheriting a legacy console code page' {
        Mock Resolve-AgentBrowserCliExecutable { (Get-Command node.exe).Source }
        $result=Invoke-AgentBrowserCliJson -Arguments @('-e','process.stdout.write(JSON.stringify({ok:true,result:{status:"success",label:"\u6781\u9ad8",quoted:"a\\b\"c"}}))')
        $result.result.label | Should -Be ([string][char]0x6781+[char]0x9ad8)
    }
    It 'passes Extra High to the atomic send subprocess without changing the CCG workflow mode' {
        Mock Invoke-WatchAdapterProcess { param($Arguments) $script:capturedModeArguments=@($Arguments);[pscustomobject]@{ExitCode=0;Payload=@{ok=$true}} }
        $null=Invoke-WatchAdapterSend -AdapterPath 'adapter.ps1' -PromptFile 'prompt.md' -EvidenceDirectory $TestDrive -IdempotencyKeyValue 'mode-test' -CodexThreadIdValue '019fa981-725e-7f02-93a7-bb1e1b7aefd3'
        $index=[array]::IndexOf($script:capturedModeArguments,'-ThinkingMode')
        $index | Should -BeGreaterThan 0
        $script:capturedModeArguments[$index+1] | Should -Be 'Extra High'
    }
    It 'inherits unsent recovery mode before passing any adapter arguments' {
        [IO.File]::WriteAllText((Join-Path $TestDrive 'state.json'),' {"thinkingMode":"High"}',[Text.UTF8Encoding]::new($false))
        Mock Invoke-WatchAdapterProcess { param($Arguments) $script:capturedModeArguments=@($Arguments);[pscustomobject]@{ExitCode=0;Payload=@{ok=$true}} }
        $null=Invoke-WatchAdapterSend -AdapterPath 'adapter.ps1' -PromptFile 'prompt.md' -EvidenceDirectory $TestDrive -IdempotencyKeyValue 'mode-test' -CodexThreadIdValue '019fa981-725e-7f02-93a7-bb1e1b7aefd3' -ResumeUnsent
        $script:capturedModeArguments[([array]::IndexOf($script:capturedModeArguments,'-ThinkingMode')+1)] | Should -Be 'High'
    }
}

Describe 'Manual webpage strength waiting and independent recovery' {
    BeforeEach {
        $Script:RequestedThinkingMode='Extra High';$Script:ThinkingModeExplicit=$true
        $Script:ThinkingModeManualRootOverride=Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        Mock Invoke-AgentBrowserBoundMouseClick {throw 'manual wait must not click'}
        Mock Invoke-AgentBrowserCliJson {throw 'manual wait must not fill or send'}
    }
    It 'automatically switches an ordinary mismatch without requesting manual help' {
        Mock Ensure-AgentBrowserThinkingMode {New-ModeSnapshot 'Extra High'}
        (Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot 'High')).SelectedModeLabel | Should -Be 'Extra High'
        (Read-AgentBrowserManualThinkingGate $script:modeTarget) | Should -BeNullOrEmpty
    }
    It 'requests once on changed slider structure then waits without repeating automatic selection' {
        Mock Ensure-AgentBrowserThinkingMode {Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeUnavailable' -Message 'changed slider' -Details @{reason='thinking-slider-unavailable'}}
        $notifications=@()
        foreach($n in 1..2){try{Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot 'High')}catch{(Get-ExceptionCategory $_.Exception)|Should -Be 'ThinkingModeManualSelectionRequired';$notifications+=((Get-ExceptionDetails $_.Exception).userNotificationNeeded)}}
        $notifications[0]|Should -BeTrue;$notifications[1]|Should -BeFalse
        Should -Invoke Ensure-AgentBrowserThinkingMode -Times 1 -Exactly
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
    It 're-reads the original target and resumes only after the requested manual choice is proved' {
        try{Request-AgentBrowserManualThinkingMode $script:modeTarget 'changed'}catch{}
        Mock Ensure-AgentBrowserThinkingMode {throw 'must not automatically switch while waiting'}
        (Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot 'Extra High')).SelectedModeLabel|Should -Be 'Extra High'
        (Read-AgentBrowserManualThinkingGate $script:modeTarget).status|Should -Be 'resolved-by-observation'
        Should -Invoke Ensure-AgentBrowserThinkingMode -Times 0 -Exactly
    }
    It 'a claim of manual completion cannot replace an observed matching strength' {
        try{Request-AgentBrowserManualThinkingMode $script:modeTarget 'changed'}catch{}
        Mock Ensure-AgentBrowserThinkingMode {throw 'must not automatically switch'}
        {Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot 'High')}|Should -Throw '*manually*'
        (Read-AgentBrowserManualThinkingGate $script:modeTarget).status|Should -Be 'waiting-for-user'
        Should -Invoke Invoke-AgentBrowserBoundMouseClick -Times 0 -Exactly
    }
    It 'does not ask manual help for a known good menu missing an explicitly unavailable label' {
        Mock Ensure-AgentBrowserThinkingMode {Throw-SidebarError -ExitCode 23 -Category 'ThinkingModeUnavailable' -Message 'requested label unavailable' -Details @{available=@('Pro');matchCount=0}}
        try{Ensure-AgentBrowserProMode $script:modeTarget (New-ModeSnapshot 'High')}catch{(Get-ExceptionCategory $_.Exception)|Should -Be 'ThinkingModeUnavailable'}
        (Read-AgentBrowserManualThinkingGate $script:modeTarget)|Should -BeNullOrEmpty
    }
}

Describe 'set-mode stays within the bound empty homepage' {
    BeforeEach {
        $Command = 'set-mode'
        $TimeoutSeconds = 900
        $PollMilliseconds = 500
        $ResponseTimeoutSeconds = 7200
        $FreshConversation = $false
        $ResumeUnsent = $false
        $ExpectedConversationUrl = ''
        $Script:RequestedThinkingMode = 'Extra High'
        $Script:ThinkingModeExplicit = $true
        $script:setModeSnapshot = New-ModeSnapshot 'High'
        $script:setModeSnapshot | Add-Member -NotePropertyMembers @{
            Url = 'https://chatgpt.com/'; UrlExact = $false; UserTurns = @(); Responses = @(); ComposerValue = ''
        }
        Mock Resolve-AgentBrowserCommandTarget { $script:modeTarget }
        Mock Enter-UiMutex { [pscustomobject]@{} }
        Mock Exit-UiMutex {}
        Mock Get-AgentBrowserPageSnapshot { $script:setModeSnapshot }
        Mock Ensure-AgentBrowserProMode { param($Snapshot) $Snapshot }
        Mock New-AgentBrowserStatusPayload { @{ ok = $true; command = 'status' } }
        Mock Invoke-AgentBrowserCliJson { throw 'set-mode must never fill or send' }
    }
    It 'selects the requested strength without invoking fill or send' {
        (Invoke-MainCommand).command | Should -Be 'set-mode'
        Should -Invoke Ensure-AgentBrowserProMode -Times 1 -Exactly
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
    It 'rejects a draft, transcript, conversation or active generation before selecting' -TestCases @(
        @{ Field = 'ComposerValue'; Value = 'existing draft' }
        @{ Field = 'UserTurns'; Value = @('existing user turn') }
        @{ Field = 'Responses'; Value = @('existing answer') }
        @{ Field = 'Url'; Value = 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' }
        @{ Field = 'Generating'; Value = $true }
    ) {
        param($Field, $Value)
        $script:setModeSnapshot.$Field = $Value
        { Invoke-MainCommand } | Should -Throw
        Should -Invoke Ensure-AgentBrowserProMode -Times 0 -Exactly
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
}
