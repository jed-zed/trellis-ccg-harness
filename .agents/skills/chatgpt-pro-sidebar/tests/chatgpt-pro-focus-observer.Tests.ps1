#requires -Version 5.1
#requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
BeforeAll {
    $observerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/chatgpt-pro-focus-observer.ps1'
    . $observerPath
    $script:binding = [pscustomobject]@{browserId='owned-browser';profileId='owned-profile';tabId='owned-tab';sessionKey='owned-session';origin='https://chatgpt.com';url='https://chatgpt.com/'}
    $script:token = '0123456789abcdef0123456789abcdef'
}
Describe 'Fixed focus observer helper' {
    BeforeEach {
        $script:operationResult = 'start'
        $script:resultSession = 'owned-session'
        Mock Invoke-AgentBrowserCliJson {
            param($Arguments)
            $script:capturedArguments = $Arguments
            [pscustomobject]@{result=[pscustomobject]@{tab_id='owned-tab';session_key=$script:resultSession;js_return=[pscustomobject]@{schemaVersion=1;ok=$true;focusRequested=$false;operation=$script:operationResult;startToken=$script:token}}}
        }
    }
    It 'parses on the current PowerShell without errors' {
        $parseTokens=$null; $parseErrors=$null
        $null=[Management.Automation.Language.Parser]::ParseFile($observerPath,[ref]$parseTokens,[ref]$parseErrors)
        @($parseErrors).Count | Should -Be 0
    }
    It 'uses only the existing exec transport with exact browser profile tab selectors' {
        $result=Invoke-AgentBrowserFocusObserver -Operation start -TargetBinding $script:binding
        $result.ok | Should -BeTrue
        $script:capturedArguments[0] | Should -Be 'exec'
        ($script:capturedArguments[2..9] -join '|') | Should -Be '--tab|owned-tab|--browser|owned-browser|--profile|owned-profile|--timeout|15'
        $script:capturedArguments[1] | Should -Match 'const action = 0; // CCG_FOCUS_ACTION'
        Should -Invoke Invoke-AgentBrowserCliJson -Times 1 -Exactly
    }
    It 'substitutes only the finite operation and validated original token' {
        $script:operationResult='read'
        $null=Invoke-AgentBrowserFocusObserver -Operation read -TargetBinding $script:binding -StartToken $script:token
        $script:capturedArguments[1] | Should -Match 'const action = 1; // CCG_FOCUS_ACTION'
        $script:capturedArguments[1] | Should -Match "const expectedStartToken = '$script:token'; // CCG_FOCUS_TOKEN"
        $script:operationResult='stop'
        $null=Invoke-AgentBrowserFocusObserver -Operation stop -TargetBinding $script:binding -StartToken $script:token
        $script:capturedArguments[1] | Should -Match 'const action = 2; // CCG_FOCUS_ACTION'
    }
    It 'rejects missing target identities and executable token text before transport' {
        { Invoke-AgentBrowserFocusObserver -Operation start -TargetBinding @{} } | Should -Throw
        { Invoke-AgentBrowserFocusObserver -Operation read -TargetBinding $script:binding -StartToken "';window.focus();//" } | Should -Throw
        { Invoke-AgentBrowserFocusObserver -Operation read -TargetBinding $script:binding } | Should -Throw
        { Invoke-AgentBrowserFocusObserver -Operation start -TargetBinding $script:binding -StartToken $script:token } | Should -Throw
        { Invoke-AgentBrowserFocusObserver -Operation discover -TargetBinding $script:binding } | Should -Throw
        Should -Invoke Invoke-AgentBrowserCliJson -Times 0 -Exactly
    }
    It 'rejects a returned session mismatch through the production binding assertion' {
        $script:resultSession='other-session'
        { Invoke-AgentBrowserFocusObserver -Operation start -TargetBinding $script:binding } | Should -Throw '*different tab or session*'
    }
    It 'preserves explicit missing evidence without retry or a new start' {
        Mock Invoke-AgentBrowserCliJson { [pscustomobject]@{result=[pscustomobject]@{tab_id='owned-tab';session_key='owned-session';js_return=[pscustomobject]@{schemaVersion=1;ok=$false;focusRequested=$false;reason='missing'}}} }
        (Invoke-AgentBrowserFocusObserver -Operation read -TargetBinding $script:binding -StartToken $script:token).reason | Should -Be 'missing'
        Should -Invoke Invoke-AgentBrowserCliJson -Times 1 -Exactly
    }
}
